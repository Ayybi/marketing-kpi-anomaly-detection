// Observability seam (Section 2/15): cron/integration run records. The System Health monitor
// reads the latest row per source to classify freshness. Kept small and swappable.
import { randomUUID } from "node:crypto"
import { collections } from "@/lib/mongo"
import type { SyncLogRow, SyncLogStatus } from "@/lib/types"

export async function writeSyncLog(
  source: string,
  status: SyncLogStatus,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { syncLog } = await collections()
  const iso = new Date().toISOString()
  await syncLog.insertOne({ id: randomUUID(), source, status, detail, ran_at: iso, created_at: iso })
}

/** Latest row for one source, or null when the source has NEVER logged (absent, not error). */
export async function readLatestSyncLog(source: string): Promise<SyncLogRow | null> {
  const { syncLog } = await collections()
  return syncLog.find({ source }).sort({ ran_at: -1 }).limit(1).next()
}

/** Latest row for each of the given sources (throws on DB error — a read error is not "never logged"). */
export async function readLatestSyncLogs(sources: string[]): Promise<Map<string, SyncLogRow>> {
  const { syncLog } = await collections()
  const rows = await syncLog
    .aggregate<SyncLogRow>([
      { $match: { source: { $in: sources } } },
      { $sort: { ran_at: -1 } },
      { $group: { _id: "$source", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ])
    .toArray()
  const map = new Map<string, SyncLogRow>()
  for (const r of rows) map.set(r.source, r)
  return map
}
