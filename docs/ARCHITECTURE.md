# Architecture

A tour of how Bellwether is put together, why the pieces are shaped the way they are, and where to
look when you want to change something.

- [Data flow](#data-flow)
- [The engine](#the-engine-srclibkpi-enginets)
- [The three-state read contract](#the-three-state-read-contract)
- [The rule catalog & per-client overrides](#the-rule-catalog--per-client-overrides)
- [The health score](#the-health-score)
- [Data model](#data-model)
- [The MongoDB translation](#the-mongodb-translation)
- [System Health monitor](#system-health-monitor)
- [Auth & multi-tenancy](#auth--multi-tenancy)
- [Directory map](#directory-map)

---

## Data flow

```
 metrics (FB / LSA / GA4 / GBP / SEO / Stripe)
        │  KpiMetricSource  (present / absent / error)
        ▼
 ┌──────────────────┐  every :15,:45   ┌──────────────────┐   daily 03:00   ┌──────────────────┐
 │  evaluateKpiRules │ ───────────────► │  reconcile flags  │ ──────────────► │  recomputeAll     │
 │  (rules × clients)│                  │  (idempotent)     │                 │  HealthScores     │
 └──────────────────┘                  └─────────┬─────────┘                 └─────────┬────────┘
                                                 │ red → live ping (routed, deduped)   │
                                                 │ amber → digest                      │
                                                 ▼                                     ▼
                                            kpi_flags                          client_health_scores
                                                                                       │
                                                                                       ▼
                                                                                triage board (/app)
```

Two crons drive everything (see [`vercel.json`](../vercel.json)):

| Cron | Schedule | Does |
|------|----------|------|
| `/api/cron/kpi-engine` | `15,45 * * * *` | Reopen expired snoozes → evaluate rules → reconcile flags → log |
| `/api/cron/health-score` | `0 3 * * *` | Recompute + snapshot a 0–100 score for every live client |

Both are guarded by `CRON_SECRET` and **fail closed** — no secret, `401`, no run. A failure is
written to `sync_log` with `status: "error"` so System Health surfaces it; it is never swallowed
into a fake `"ok"`.

---

## The engine (`src/lib/kpi-engine.ts`)

`evaluateKpiRules(deps)` is the heart. For each rule × each client it:

1. **Resolves the effective rule** for that client (global catalog, with any per-client override
   applied — see below).
2. **Gates on live services** — an FB rule only runs for clients who actually hold a live Facebook
   service. This is how one config drives a heterogeneous roster.
3. **Reads metrics through the three-state contract** — each read wrapped in its own `try/catch`;
   on error, every rule depending on that signal is dropped *for that client only*.
4. **Applies the guards** — account-age grace, zero-baseline, minimum-baseline-leads, seasonal
   hold, supporting-metric and note suppression.
5. **Reconciles** — opens a flag if newly tripped, resolves it if recovered, leaves it alone
   otherwise. Keyed on `(client_id, source)`, so it is safe to run repeatedly.
6. **Dispatches notifications** — red flags only, routed by department, deduped on
   `kpi_flag:<clientId>:<source>:<severity>`.

Pure, deterministic helpers live in `src/lib/kpi-engine-logic.ts` (`sumLastDays`, `pctChange`,
`graceAccountsForSource`, `inWinterHold`, …). They have no I/O and are exhaustively unit-tested —
this is where the math lives.

---

## The three-state read contract

Defined in [`src/lib/metric-source.ts`](../src/lib/metric-source.ts). This is invariant #1 and the
reason the product exists.

```ts
export interface KpiMetricSource {
  fb(clientId, window):  Promise<FbMetrics | null>        // null = absent, throw = error
  lsa(clientId, window): Promise<LsaMetrics | null>
  ga4Aggregate(window):  Promise<Map<string, Ga4Metrics>> // missing key = absent for that client
  gbpAggregate(window):  Promise<Map<string, GbpMetrics>>
  seoRanks(clientId):    Promise<SeoRankRow[] | null>
}
```

| Return | State | Consequence |
|--------|-------|-------------|
| a populated object / map entry | **present** | evaluate (a real `0` counts) |
| `null` / omitted map key | **absent** | skip the rule for this client |
| `throw` | **error** | drop every dependent rule for this client |

`SuppliedMetricSource` implements the interface over a `Partial<KpiMetricSource>`: provide only the
reads you have; anything you omit defaults to **absent** (never a fabricated zero). This is the
Phase-1 adapter — back it with your Data Hub / connected-accounts layer.

> **Why it matters:** the alternative — letting a `403` become `"0 leads"` — produces a false
> `no_leads` red the moment a token expires. Operators learn that flags lie, and the product dies.
> The contract makes that failure *impossible by construction*, and a failure-path test guards
> every read.

---

## The rule catalog & per-client overrides

Rules are **data**, in the `kpi_rules` collection. Two scopes:

- `scope: "global"` — one row per `rule_key` (partial unique index). The shared catalog.
- `scope: "client"` — one row per `(rule_key, client_id)` (partial unique index). An override.

Resolution (`src/lib/rules.ts`):

```
effectiveRule(client, rule) = { ...globalRule, ...clientOverride }
```

A client override can change any of `enabled`, `severity`, `windowDays`, or the `config`
thresholds. The engine computes an `effectiveByClient` map up front, and uses `anyEnabled(ruleKey)`
to decide whether an expensive aggregate read is worth doing at all (if no client enables a rule,
skip the fetch entirely).

The UI for this is `/app/rules` — `GlobalRuleEditor` (PATCH the catalog) and `RuleEditor`
(PUT/DELETE a per-client override).

---

## The health score

`computeHealthScore` in [`src/lib/health-score.ts`](../src/lib/health-score.ts) is a pure function
(verbatim from spec). Deductions from a base of 100:

| Component | Penalty | Cap |
|-----------|---------|-----|
| Red flags | −20 each | −40 |
| Amber flags | −8 each | −24 |
| Billing late | −15 | — |
| No touch > 30d / > 60d | −10 / −20 | — |

`score = clamp(0, 100, 100 − deductions)`; bands **green ≥ 80**, **amber ≥ 50**, **red < 50**.
Every component is stored on the snapshot and shown on the client detail page — the score is never
a black box. `recomputeAllHealthScores` writes one immutable snapshot row per live (non-churned,
non-deleted) client per run, giving you free history.

---

## Data model

MongoDB collections (see [`src/lib/mongo.ts`](../src/lib/mongo.ts) and
[`src/lib/schema.ts`](../src/lib/schema.ts)):

| Collection | Role | Key constraints |
|------------|------|-----------------|
| `clients` | *prerequisite stub* — the roster | `id` unique |
| `client_services` | live services per client (gates rules) | `(client_id, status)` |
| `users` | *prerequisite stub* — dept leads / admins | `id` unique |
| `kpi_flags` | open/resolved/snoozed flags + evidence | **1 open flag per `(client_id, source)`**; 1 open task flag per `checklist_item_id` |
| `kpi_rules` | the catalog + overrides | 1 global per `rule_key`; 1 override per `(rule_key, client_id)` |
| `client_health_scores` | immutable score snapshots | `(client_id, calculated_at desc)`; score 0–100 |
| `sync_log` | cron run history (feeds System Health) | `(source, ran_at desc)`; status ok/partial/error |

Application-generated UUIDs in an `id` field (not `_id`) — portable, and keeps the reconcile keys
explicit.

---

## The MongoDB translation

This build swaps the spec's Postgres/Supabase layer for MongoDB while preserving **every enforced
constraint**:

| Postgres construct | MongoDB equivalent |
|--------------------|--------------------|
| `CHECK (col IN (...))`, numeric ranges | `$jsonSchema` collection validators |
| partial `UNIQUE` indexes | partial unique indexes with `$type` filters |
| the enum on `kpi_flags.source` | `enum` in the validator (`KPI_FLAG_SOURCES`) |
| RLS (`ENABLE/FORCE ROW LEVEL SECURITY`) | **no equivalent** — enforced at the app layer, documented |

Schema is applied in a mandated order: `applyPrerequisiteSchema` (clients/services/users stubs)
**then** `applyProductSchema` — the product collections reference `clients(id)`, so the stub must
exist first. `npm run migrate` runs both.

---

## System Health monitor

Section 15 of the spec, at `/app/system` ([`SystemHealthDashboard.tsx`](../src/components/SystemHealthDashboard.tsx)).
Three panels, auto-refreshing the shallow check every 30s:

- **Integrations** — a six-state ping per connector (`ok` / `auth` / `rate_limited` /
  `unreachable` / `not_configured` / `server_error`), with a shallow (config-only) check and an
  on-demand **deep probe** that actually hits the remote.
- **Crons** — freshness of each cron from `sync_log`; `ok` / `warn` (stale) / `fail`.
- **Environment** — required vs optional env vars; missing required → the app reports `503`.

Logic is split into pure, testable modules: `health/env.ts`, `health/crons.ts`, `health/pings.ts`.

---

## Auth & multi-tenancy

Deliberately a **stub** — the spec leaves OAuth-app / multi-tenant scope as new work.
[`src/lib/auth/access.ts`](../src/lib/auth/access.ts) reads identity from `x-user-id` /
`x-user-role` / `x-org-id` headers so the route contracts stay honest (three outcomes:
authenticated / forbidden / anonymous). The app UI injects demo headers via
`src/components/app/api.ts`.

**Before production:** replace `access.ts` with real session/JWT verification, enforce `org_id`
scoping in every query (MongoDB has no RLS to fall back on), and gate
`/api/system-health/deep` (currently unauthenticated).

---

## Directory map

```
src/lib/
  kpi-engine.ts         evaluate → reconcile → route (the orchestrator)
  kpi-engine-logic.ts   pure math: baselines, grace, seasonal, pctChange
  health-score.ts       computeHealthScore + recomputeAllHealthScores
  rules.ts              global + per-client rule resolution & CRUD
  kpi-flags.ts          create / resolve / snooze / reopen flags
  metric-source.ts      the three-state read contract + SuppliedMetricSource
  status-board.ts       triage board + client overview queries
  schema.ts             validators + indexes (prerequisite then product)
  seed.ts               the 25-rule global catalog
  mongo.ts              MongoClient singleton + collection accessors
  departments.ts        flag → department routing (verbatim)
  sync-log.ts           cron run history
  auth/access.ts        RBAC stub  ·  auth/cron.ts  CRON_SECRET guard
  health/               env.ts · crons.ts · pings.ts (System Health)

src/app/
  (marketing)/          landing + pricing
  app/                  triage · clients/[id] · rules · system
  api/                  cron/* · kpi-flags/* · rules/* · system-health/*

scripts/  migrate.ts · seed.ts · seed-demo.ts
test/     72 tests (unit + live-mongo integration)
```
