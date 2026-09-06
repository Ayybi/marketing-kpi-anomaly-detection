// B6 — Health score. `computeHealthScore` and the constants/bands are VERBATIM from the spec.
// `recomputeAllHealthScores` is RE-IMPLEMENTED against MongoDB, preserving the spec's exact
// behaviour (non-churned, non-deleted clients; open-flag red/amber counts; billing=late;
// days-since-touch; one snapshot row inserted per client).
import { randomUUID } from "node:crypto"
import { collections } from "@/lib/mongo"
import type { HealthBand, HealthScore } from "@/lib/types"

export type HealthInput = {
  redFlags: number
  amberFlags: number
  billingLate: boolean
  daysSinceTouch: number | null
}

const RED_PENALTY = 20
const AMBER_PENALTY = 8
const RED_CAP = 40
const AMBER_CAP = 24
const BILLING_PENALTY = 15

function bandFor(score: number): HealthBand {
  if (score >= 80) return "green"
  if (score >= 50) return "amber"
  return "red"
}

export function computeHealthScore(input: HealthInput): HealthScore {
  const redDeduction = Math.min(input.redFlags * RED_PENALTY, RED_CAP)
  const amberDeduction = Math.min(input.amberFlags * AMBER_PENALTY, AMBER_CAP)
  const billingDeduction = input.billingLate ? BILLING_PENALTY : 0
  let recencyDeduction = 0
  if (input.daysSinceTouch !== null) {
    if (input.daysSinceTouch > 60) recencyDeduction = 20
    else if (input.daysSinceTouch > 30) recencyDeduction = 10
  }
  const total = redDeduction + amberDeduction + billingDeduction + recencyDeduction
  const score = Math.max(0, Math.min(100, 100 - total))
  return {
    score, band: bandFor(score),
    components: { redFlags: -redDeduction, amberFlags: -amberDeduction, billing: -billingDeduction, recency: -recencyDeduction },
  }
}

const DAY_MS = 86_400_000

/** Recompute + persist a health-score snapshot for every non-churned client (the daily cron). */
export async function recomputeAllHealthScores(): Promise<{ clientsScored: number }> {
  const { clients: clientsCol, kpiFlags, clientHealthScores } = await collections()

  const clientList = await clientsCol
    .find({ stage: { $ne: "churned" }, deleted_at: null })
    .project<{ id: string; status: string | null; last_touched_at: string | null }>({
      _id: 0, id: 1, status: 1, last_touched_at: 1,
    })
    .toArray()
  if (clientList.length === 0) return { clientsScored: 0 }

  const clientIds = clientList.map(c => c.id)
  const flags = await kpiFlags
    .find({ status: "open", client_id: { $in: clientIds } })
    .project<{ client_id: string; severity: string }>({ _id: 0, client_id: 1, severity: 1 })
    .toArray()

  const flagCounts = new Map<string, { red: number; amber: number }>()
  for (const f of flags) {
    const cid = f.client_id
    const entry = flagCounts.get(cid) ?? { red: 0, amber: 0 }
    if (f.severity === "red") entry.red++
    else if (f.severity === "amber") entry.amber++
    flagCounts.set(cid, entry)
  }

  const now = Date.now()
  const calculatedAt = new Date(now).toISOString()
  const rows = clientList.map(c => {
    const counts = flagCounts.get(c.id) ?? { red: 0, amber: 0 }
    const daysSinceTouch = c.last_touched_at ? Math.floor((now - new Date(c.last_touched_at).getTime()) / DAY_MS) : null
    const health = computeHealthScore({ redFlags: counts.red, amberFlags: counts.amber, billingLate: c.status === "late", daysSinceTouch })
    return {
      id: randomUUID(),
      client_id: c.id,
      score: health.score,
      band: health.band,
      components: health.components,
      calculated_at: calculatedAt,
    }
  })

  await clientHealthScores.insertMany(rows)
  return { clientsScored: rows.length }
}
