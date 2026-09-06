# API reference

All routes are Next.js App Router handlers under `src/app/api/`. Responses are JSON.

## Authentication

Two seams:

- **User/RBAC** — a **stub** ([`src/lib/auth/access.ts`](../src/lib/auth/access.ts)) that reads
  identity from request headers. Replace with real session/JWT before production.

  | Header | Example |
  |--------|---------|
  | `x-user-id` | `usr_123` |
  | `x-user-role` | `super_admin` \| `user` |
  | `x-org-id` | `org_abc` (optional) |

  → `401` if no `x-user-id`; `403` if a required role isn't met.

- **Cron** — `Authorization: Bearer $CRON_SECRET`. Fails closed (`401`) if unset or wrong.

---

## Cron

### `GET /api/cron/kpi-engine`
Reopen expired snoozes → evaluate rules → reconcile flags → write `sync_log`. Schedule `15,45 * * * *`.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/kpi-engine
# → { "ok": true, "reopened": 0, "flagsOpened": 2, "flagsUpdated": 0, "flagsResolved": 1, "clientsEvaluated": 10 }
```

### `GET /api/cron/health-score`
Recompute + snapshot a 0–100 score for every live client. Schedule `0 3 * * *`.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/health-score
# → { "ok": true, "clientsScored": 10 }
```

Both return `500` with `{ ok: false, error }` on failure — and record it to `sync_log` with
`status: "error"` (never swallowed into a fake `ok`).

---

## Flags

Requires an authenticated user (`requireUser`); creating manual flags requires `super_admin`.

### `GET /api/kpi-flags`
At-risk clients — open flags grouped by client, worst-first (most red, then most amber).
```json
{ "atRisk": [ { "clientId": "...", "red": 3, "amber": 0, "flags": [ { "source": "fb_cpl_high", "severity": "red", "message": "...", "evidence": { "ratio": 3.2 } } ] } ] }
```

### `GET /api/kpi-flags?clientId=<uuid>`
Open flags for one client.
```json
{ "flags": [ { "id": "...", "clientId": "...", "source": "fb_cpl_high", "severity": "red", "message": "...", "evidence": { "currentCpl": 184, "baselineCpl": 57.5, "ratio": 3.2 }, "status": "open" } ] }
```

### `POST /api/kpi-flags`  *(super_admin)*
Raise a manual flag. Only manual sources are allowed (`client_dissatisfied`, `access_lost`).
```jsonc
// body
{ "clientId": "summit-roofing", "source": "client_dissatisfied", "severity": "red", "message": "Voiced dissatisfaction on the monthly call" }
// → 201 { "ok": true }   ·   404 client not found   ·   400 invalid body
```

### `POST /api/kpi-flags/[id]/resolve`
Manually resolve an open flag. → `{ ok: true }` / `404`.

### `POST /api/kpi-flags/[id]/snooze`
Snooze; body `{ "days": 1–90 }` (default `7`). Reopens automatically when the snooze expires.
```json
{ "ok": true, "snoozedUntil": "2026-09-13T..." }
```

### `POST /api/kpi-flags/[id]/unsnooze`
Cancel a snooze, reopening the flag now. → `{ ok: true }` / `404`.

---

## Rules

### `GET /api/rules`
The global rule catalog.
```json
{ "rules": [ { "ruleKey": "lsa_lead_drop", "label": "...", "severity": "amber", "windowDays": 30, "enabled": true, "config": { "dropPct": 30 } } ] }
```

### `GET /api/rules?clientId=<id>`
A client's **effective** rules — global defaults with any per-client override applied, each row
flagged as `global` or `override`.

### `PATCH /api/rules/[ruleKey]`  *(super_admin)*
Update the **global** rule. Any subset of:
```jsonc
{ "enabled": true, "severity": "red", "windowDays": 30, "config": { "multiplier": 2 } }
// → { "ok": true }   ·   404 rule not found
```

### `PUT /api/rules/[ruleKey]?clientId=<id>`  *(super_admin)*
Create/update a **per-client override** (same body as PATCH). → `{ ok: true }` / `400`.

### `DELETE /api/rules/[ruleKey]?clientId=<id>`  *(super_admin)*
Remove the override, reverting that client to the global rule. → `{ ok: true }` / `404`.

---

## System health

### `GET /api/system-health/shallow`
Config-only check — env vars, cron freshness (from `sync_log`), and per-integration status
inferred from configuration. Auto-polled by the dashboard every 30s. **No remote calls.**
```json
{
  "ok": true,
  "env": { "ok": true, "missingRequired": [], "required": [...], "optional": [...] },
  "crons": [ { "source": "kpi-engine", "overall": "ok", "freshness": "12 min", "ageMinutes": 12 } ],
  "integrations": [ { "key": "facebook", "status": "not_configured", "detail": "...", "hint": "..." } ],
  "generatedAt": "2026-09-06T..."
}
```

### `GET /api/system-health/deep`
On-demand deep probe that actually hits each configured remote and classifies the response
(`ok` / `auth` / `rate_limited` / `unreachable` / `not_configured` / `server_error`).

> ⚠️ **Currently unauthenticated — gate this before production.**
