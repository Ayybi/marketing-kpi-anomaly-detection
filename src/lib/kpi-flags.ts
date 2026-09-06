// B8 — Flag lifecycle. RE-IMPLEMENTED against MongoDB, preserving the spec's exact behaviour:
//  - createManualFlag: upsert one open flag per (client_id, source) with evidence {manual, raisedBy}
//  - resolve / snooze / unsnooze: status transitions
//  - reopenExpiredSnoozedFlags: reopen snoozes whose window has passed (run BEFORE the sweep)
import { randomUUID } from "node:crypto"
import { collections } from "@/lib/mongo"
import type { KpiFlag, ClientRow } from "@/lib/types"

/** The only sources a person may raise via the API (Section 6). */
export const MANUAL_SOURCES = ["client_dissatisfied", "access_lost"] as const

export type ResolvedClient = { id: string; status: string | null; stage: string | null; lastTouchedAt: string | null }

/**
 * resolveClient (WRITE-FROM-SPEC helper): slug|uuid -> { id, status, stage, lastTouchedAt } | null.
 * The manual-flag path's tenant/identity seam. Looks up by `id` first, then `slug`.
 */
export async function resolveClient(slugOrId: string): Promise<ResolvedClient | null> {
  const { clients } = await collections()
  const doc = await clients.findOne<ClientRow>({ $or: [{ id: slugOrId }, { slug: slugOrId }] })
  if (!doc) return null
  return { id: doc.id, status: doc.status ?? null, stage: doc.stage ?? null, lastTouchedAt: doc.last_touched_at ?? null }
}

export async function createManualFlag(input: {
  slugOrId: string
  source: string
  severity: KpiFlag["severity"]
  message: string
  actorId?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const client = await resolveClient(input.slugOrId)
  if (!client) return { ok: false, error: "client not found" }
  const evidence = { manual: true, raisedBy: input.actorId ?? null }
  const { kpiFlags } = await collections()

  const existing = await kpiFlags.findOne({
    client_id: client.id, source: input.source, status: "open", checklist_item_id: null,
  })

  const nowIso = new Date().toISOString()
  if (existing) {
    const res = await kpiFlags.updateOne(
      { id: existing.id },
      { $set: { severity: input.severity, message: input.message, evidence, updated_at: nowIso } },
    )
    return { ok: res.acknowledged }
  }

  try {
    await kpiFlags.insertOne({
      id: randomUUID(),
      client_id: client.id,
      source: input.source,
      severity: input.severity,
      message: input.message,
      evidence,
      status: "open",
      snoozed_until: null,
      checklist_item_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function resolveFlag(id: string): Promise<boolean> {
  const { kpiFlags } = await collections()
  const res = await kpiFlags.updateOne({ id }, { $set: { status: "resolved", updated_at: new Date().toISOString() } })
  return res.matchedCount > 0
}

export async function snoozeFlag(id: string, untilIso: string): Promise<boolean> {
  const { kpiFlags } = await collections()
  const res = await kpiFlags.updateOne(
    { id },
    { $set: { status: "snoozed", snoozed_until: untilIso, updated_at: new Date().toISOString() } },
  )
  return res.matchedCount > 0
}

export async function unsnoozeFlag(id: string): Promise<boolean> {
  const { kpiFlags } = await collections()
  const res = await kpiFlags.updateOne(
    { id },
    { $set: { status: "open", snoozed_until: null, updated_at: new Date().toISOString() } },
  )
  return res.matchedCount > 0
}

function toKpiFlag(row: {
  id: string; client_id: string; source: string; severity: KpiFlag["severity"]; message: string
  evidence: Record<string, unknown>; status: KpiFlag["status"]; snoozed_until: string | null
  checklist_item_id: string | null; created_at: string
}): KpiFlag {
  return {
    id: row.id, clientId: row.client_id, source: row.source, severity: row.severity, message: row.message,
    evidence: row.evidence, status: row.status, snoozedUntil: row.snoozed_until,
    checklistItemId: row.checklist_item_id, createdAt: row.created_at,
  }
}

/** One client's open flags (GET /api/kpi-flags?clientId=). */
export async function listClientOpenFlags(clientId: string): Promise<KpiFlag[]> {
  const { kpiFlags } = await collections()
  const rows = await kpiFlags.find({ client_id: clientId, status: "open" }).sort({ created_at: -1 }).toArray()
  return rows.map(toKpiFlag)
}

/** One client's active flags (open + snoozed), open first — for the client profile. */
export async function listClientFlags(clientId: string): Promise<KpiFlag[]> {
  const { kpiFlags } = await collections()
  const rows = await kpiFlags.find({ client_id: clientId, status: { $in: ["open", "snoozed"] } }).sort({ created_at: -1 }).toArray()
  const order = { open: 0, snoozed: 1, resolved: 2 } as const
  return rows.map(toKpiFlag).sort((a, b) => order[a.status] - order[b.status])
}

/** At-risk clients: open flags grouped by client with red/amber counts (GET /api/kpi-flags). */
export async function listAtRiskClients(): Promise<
  Array<{ clientId: string; red: number; amber: number; flags: KpiFlag[] }>
> {
  const { kpiFlags } = await collections()
  const rows = await kpiFlags.find({ status: "open" }).sort({ created_at: -1 }).toArray()
  const byClient = new Map<string, { clientId: string; red: number; amber: number; flags: KpiFlag[] }>()
  for (const row of rows) {
    const entry = byClient.get(row.client_id) ?? { clientId: row.client_id, red: 0, amber: 0, flags: [] }
    if (row.severity === "red") entry.red++
    else if (row.severity === "amber") entry.amber++
    entry.flags.push(toKpiFlag(row))
    byClient.set(row.client_id, entry)
  }
  // worst-first: most red, then most amber.
  return [...byClient.values()].sort((a, b) => b.red - a.red || b.amber - a.amber)
}

/** Run from the KPI cron BEFORE evaluateKpiRules so reopened flags re-reconcile in the same pass. */
export async function reopenExpiredSnoozedFlags(): Promise<number> {
  const nowIso = new Date().toISOString()
  const { kpiFlags } = await collections()
  const res = await kpiFlags.updateMany(
    { status: "snoozed", snoozed_until: { $lte: nowIso } },
    { $set: { status: "open", snoozed_until: null, updated_at: nowIso } },
  )
  return res.modifiedCount
}
