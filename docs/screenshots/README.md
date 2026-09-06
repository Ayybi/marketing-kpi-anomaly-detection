# Screenshots

Images referenced by the main [README](../../README.md).

## Current shots

| File | Page | Shown in README |
|------|------|-----------------|
| `01-landing.png` | `/` — hero + live flag-stream panel | Top banner |
| `02-rule-catalog.png` | `/` — "rules are data, not code" section | "A look around" |
| `03-system-health.png` | `/app/system` — integrations + crons | "A look around" |
| `04-system-health-env.png` | `/app/system` — environment table | "A look around" |
| `05-landing-cta.png` | `/` — "start on the triage board" CTA + footer | "A look around" |

## 📸 Still worth capturing (highest-impact)

The two shots that best show the *actual product* aren't captured yet. Add them and the README
sells itself:

| Suggested file | Page | Why it's the money shot |
|----------------|------|-------------------------|
| `06-triage-board.png` | `/app` | The worst-first health board — this **is** the product |
| `07-client-detail.png` | `/app/clients/<id>` (open **summit-roofing**) | Flags **with their evidence chips** — the trust story |

Seed demo data first so they look intentional (1 red / 2 amber / 7 green):

```bash
npm run migrate && npm run seed && npm run seed:demo
npm run dev   # then visit /app and /app/clients/<id>
```

Drop them in this folder with those names and I'll wire them into the README.

## Capture tips

- 1440×900 (or 1600×1000) window; export at 2× / retina if possible.
- Hide bookmarks bar & extensions; hard-refresh (Cmd/Ctrl+Shift+R) so fonts aren't stale.
- Optional: a `og-cover.png` (1280×640) title-card for the repo's GitHub social preview.
