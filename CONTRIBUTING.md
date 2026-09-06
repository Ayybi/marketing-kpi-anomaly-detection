# Contributing to Bellwether

Thanks for your interest! This project has a small number of **non-negotiable invariants** that
keep its flags trustworthy. A PR that violates one won't be merged — not because of style, but
because a single fabricated value poisons every downstream flag and score.

## The golden rules

### 1. Three-state reads — a failure is never a value

Every external read returns one of three distinct states:

- **present** — real data (an authoritative `0` is real, and *is* evaluated)
- **absent** — not connected → `null` / omitted map key → skip
- **error** — connector `403` / timeout / `500` → **`throw`**, so the engine skips the affected
  rules for that client only

**An error must NEVER become `0`, `[]`, `false`, or any fallback value.** If you add a new read,
you must also add a **failure-path test** proving the error propagates and does not become a `0`.

### 2. Product guarantees

- **Never auto-merge** flags.
- **Reconcile is idempotent** — keyed on `(client_id, source)`; running it twice changes nothing.
- **No double-counting.**
- **Guards refuse rather than degrade** — when in doubt, don't flag.

## Development setup

```bash
npm install
cp .env.example .env      # point MONGODB_URI at a local mongod
npm run migrate
npm run seed && npm run seed:demo
npm run dev
```

## Before you open a PR

```bash
npm run typecheck   # tsc --noEmit, strict — must pass clean
npm test            # 72 tests — must pass
```

- Add a test for every new rule (a trip case **and** a no-trip/guard case).
- Add a failure-path test for every new external read.
- Match the surrounding code's style: comment density, naming, and idiom. No new dependencies
  without a clear reason.

## Where things live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full map. The engine core is
`src/lib/kpi-engine.ts`; pure helpers are in `src/lib/kpi-engine-logic.ts` (keep them pure and
unit-tested); the read contract is `src/lib/metric-source.ts`.
