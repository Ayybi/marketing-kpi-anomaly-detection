// Section 9 — the status board: a per-client roster (non-churned) with stage, days-in-stage, MRR
// (summed live service amounts), open red/amber counts, and the latest health score, sorted
// worst-health-first then most-red-first.
import { collections } from "@/lib/mongo"
import type { HealthBand } from "@/lib/types"

const DAY_MS = 86_400_000
const LIVE_SERVICE_STATUSES = ["active", "late", "promo", "on_us", "pending"]

export type StatusBoardRow = {
  clientId: string
  name: string
  stage: string | null
  status: string | null
  daysInStage: number | null
  mrr: number
  services: string[]
  red: number
  amber: number
  score: number | null
  band: HealthBand | null
  billingLate: boolean
}

export type StatusBoardSummary = {
  clients: number
  red: number
  amber: number
  mrrAtRisk: number
  avgScore: number | null
}

export async function getStatusBoard(): Promise<{ rows: StatusBoardRow[]; summary: StatusBoardSummary }> {
  const { clients, clientServices, kpiFlags, clientHealthScores } = await collections()

  const clientDocs = await clients.find({ stage: { $ne: "churned" }, deleted_at: null }).toArray()
  if (clientDocs.length === 0) {
    return { rows: [], summary: { clients: 0, red: 0, amber: 0, mrrAtRisk: 0, avgScore: null } }
  }
  const ids = clientDocs.map(c => c.id)

  const [services, flags, healthRows] = await Promise.all([
    clientServices.find({ client_id: { $in: ids }, status: { $in: LIVE_SERVICE_STATUSES } }).toArray(),
    kpiFlags.find({ client_id: { $in: ids }, status: "open" }).project<{ client_id: string; severity: string }>({ _id: 0, client_id: 1, severity: 1 }).toArray(),
    clientHealthScores.find({ client_id: { $in: ids } }).sort({ calculated_at: -1 }).toArray(),
  ])

  const mrr = new Map<string, number>()
  const svcTypes = new Map<string, Set<string>>()
  for (const s of services) {
    mrr.set(s.client_id, (mrr.get(s.client_id) ?? 0) + (s.amount ?? 0))
    const set = svcTypes.get(s.client_id) ?? new Set<string>()
    if (s.service_type) set.add(s.service_type)
    svcTypes.set(s.client_id, set)
  }

  const counts = new Map<string, { red: number; amber: number }>()
  for (const f of flags) {
    const e = counts.get(f.client_id) ?? { red: 0, amber: 0 }
    if (f.severity === "red") e.red++
    else if (f.severity === "amber") e.amber++
    counts.set(f.client_id, e)
  }

  // latest health snapshot per client (rows are sorted desc; first seen wins)
  const latestHealth = new Map<string, { score: number; band: HealthBand }>()
  for (const h of healthRows) {
    if (!latestHealth.has(h.client_id)) latestHealth.set(h.client_id, { score: h.score, band: h.band })
  }

  const now = Date.now()
  const rows: StatusBoardRow[] = clientDocs.map(c => {
    const cnt = counts.get(c.id) ?? { red: 0, amber: 0 }
    const health = latestHealth.get(c.id) ?? null
    const anchor = c.last_touched_at ? new Date(c.last_touched_at).getTime() : null
    return {
      clientId: c.id,
      name: c.slug ?? c.id.slice(0, 8),
      stage: c.stage ?? null,
      status: c.status ?? null,
      daysInStage: anchor ? Math.floor((now - anchor) / DAY_MS) : null,
      mrr: mrr.get(c.id) ?? 0,
      services: [...(svcTypes.get(c.id) ?? [])].sort(),
      red: cnt.red,
      amber: cnt.amber,
      score: health?.score ?? null,
      band: health?.band ?? null,
      billingLate: c.status === "late",
    }
  })

  // worst-health-first (nulls last), then most-red-first.
  rows.sort((a, b) => {
    const sa = a.score ?? 101, sb = b.score ?? 101
    if (sa !== sb) return sa - sb
    return b.red - a.red || b.amber - a.amber
  })

  const summary: StatusBoardSummary = {
    clients: rows.length,
    red: rows.reduce((n, r) => n + r.red, 0),
    amber: rows.reduce((n, r) => n + r.amber, 0),
    mrrAtRisk: rows.filter(r => r.band === "red" || r.red > 0).reduce((n, r) => n + r.mrr, 0),
    avgScore: rows.length ? Math.round(rows.reduce((n, r) => n + (r.score ?? 0), 0) / rows.length) : null,
  }
  return { rows, summary }
}

/** One client's header info (name, stage, status, MRR, services, latest health). */
export async function getClientOverview(clientId: string): Promise<{
  clientId: string; name: string; stage: string | null; status: string | null; mrr: number
  services: string[]; score: number | null; band: HealthBand | null; billingLate: boolean
  daysSinceTouch: number | null
} | null> {
  const { clients, clientServices, clientHealthScores } = await collections()
  const c = await clients.findOne({ id: clientId })
  if (!c) return null
  const [services, health] = await Promise.all([
    clientServices.find({ client_id: clientId, status: { $in: LIVE_SERVICE_STATUSES } }).toArray(),
    clientHealthScores.find({ client_id: clientId }).sort({ calculated_at: -1 }).limit(1).next(),
  ])
  const mrr = services.reduce((n, s) => n + (s.amount ?? 0), 0)
  const svcTypes = [...new Set(services.map(s => s.service_type).filter(Boolean))].sort()
  const anchor = c.last_touched_at ? new Date(c.last_touched_at).getTime() : null
  return {
    clientId,
    name: c.slug ?? clientId.slice(0, 8),
    stage: c.stage ?? null,
    status: c.status ?? null,
    mrr,
    services: svcTypes,
    score: health?.score ?? null,
    band: health?.band ?? null,
    billingLate: c.status === "late",
    daysSinceTouch: anchor ? Math.floor((Date.now() - anchor) / DAY_MS) : null,
  }
}
