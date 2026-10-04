// Section 15 — crons.ts. Reads the latest sync_log row per cron source and classifies freshness:
//   never_logged | ok | stale, with staleness = min(3 x interval, interval + 48h grace).
// The last run's status maps to overall: 'partial' warns, 'error' fails, missing/stale fails.
// Three-state: a source that has NEVER logged (absent) is distinct from a DB read error, which
// propagates (getCronHealth throws) rather than masquerading as never_logged.
import { readLatestSyncLogs } from "@/lib/sync-log"
import type { SyncLogRow, SyncLogStatus } from "@/lib/types"

export const CRON_SOURCE_KPI_ENGINE = "kpi-engine"
export const CRON_SOURCE_HEALTH_SCORE = "health-score"

export type CronSpec = { source: string; label: string; intervalMinutes: number }

// Staleness is judged against the schedule the deployment actually runs, not a hardcoded one.
// Default 30 min matches vercel.json (`15,45 * * * *`); set KPI_ENGINE_INTERVAL_MINUTES=1440 when
// deploying somewhere that only permits a daily cron (e.g. Vercel Hobby), so the dashboard doesn't
// report a correctly-running cron as stale.
function envInterval(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const CRON_SPECS: CronSpec[] = [
  { source: CRON_SOURCE_KPI_ENGINE, label: "KPI engine sweep", intervalMinutes: envInterval("KPI_ENGINE_INTERVAL_MINUTES", 30) },
  { source: CRON_SOURCE_HEALTH_SCORE, label: "Health-score recompute", intervalMinutes: envInterval("HEALTH_SCORE_INTERVAL_MINUTES", 24 * 60) },
]

export type CronFreshness = "ok" | "stale" | "never_logged"
export type CronOverall = "ok" | "warn" | "fail"

export type CronHealth = {
  source: string
  label: string
  intervalMinutes: number
  freshness: CronFreshness
  lastStatus: SyncLogStatus | null
  lastRanAt: string | null
  ageMinutes: number | null
  staleAfterMinutes: number
  overall: CronOverall
  detail: string
}

const MINUTE_MS = 60_000
const GRACE_MINUTES = 48 * 60

/** staleness threshold in minutes: min(3 x interval, interval + 48h grace). */
export function staleAfterMinutes(intervalMinutes: number): number {
  return Math.min(3 * intervalMinutes, intervalMinutes + GRACE_MINUTES)
}

/** Pure classifier — no DB. `now` and `lastRow` injected for deterministic tests. */
export function classifyCron(spec: CronSpec, lastRow: SyncLogRow | null, now: Date): CronHealth {
  const staleAfter = staleAfterMinutes(spec.intervalMinutes)
  const base = {
    source: spec.source,
    label: spec.label,
    intervalMinutes: spec.intervalMinutes,
    staleAfterMinutes: staleAfter,
  }

  if (!lastRow) {
    return { ...base, freshness: "never_logged", lastStatus: null, lastRanAt: null, ageMinutes: null, overall: "fail", detail: "No run has ever been logged for this cron." }
  }

  const ageMinutes = Math.max(0, Math.floor((now.getTime() - new Date(lastRow.ran_at).getTime()) / MINUTE_MS))
  const freshness: CronFreshness = ageMinutes > staleAfter ? "stale" : "ok"
  const lastStatus = lastRow.status

  let overall: CronOverall
  let detail: string
  if (freshness === "stale") {
    overall = "fail"
    detail = `Last run was ${ageMinutes} min ago (stale after ${staleAfter} min). Check the cron scheduler / CRON_SECRET.`
  } else if (lastStatus === "error") {
    overall = "fail"
    detail = "Last run errored. Inspect the sync_log detail and the cron logs."
  } else if (lastStatus === "partial") {
    overall = "warn"
    detail = "Last run completed with partial results (some reads were skipped)."
  } else {
    overall = "ok"
    detail = `Last run ${ageMinutes} min ago, status ok.`
  }
  return { ...base, freshness, lastStatus, lastRanAt: lastRow.ran_at, ageMinutes, overall, detail }
}

/** DB-backed rollup for the dashboard. Throws on DB read error (a read error is not never_logged). */
export async function getCronHealth(now: Date = new Date(), specs: CronSpec[] = CRON_SPECS): Promise<CronHealth[]> {
  const latest = await readLatestSyncLogs(specs.map(s => s.source))
  return specs.map(spec => classifyCron(spec, latest.get(spec.source) ?? null, now))
}
