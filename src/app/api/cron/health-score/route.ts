// B12 — Cron GET /api/cron/health-score (0 3 * * *): recompute + persist a health snapshot per
// non-churned client. Guarded by CRON_SECRET (fail-closed).
import { NextResponse } from "next/server"
import { assertCronSecret } from "@/lib/auth/cron"
import { recomputeAllHealthScores } from "@/lib/health-score"
import { writeSyncLog } from "@/lib/sync-log"
import { CRON_SOURCE_HEALTH_SCORE } from "@/lib/health/crons"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await recomputeAllHealthScores()
    await writeSyncLog(CRON_SOURCE_HEALTH_SCORE, "ok", result)
    console.log("[cron/health-score]", JSON.stringify(result))
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeSyncLog(CRON_SOURCE_HEALTH_SCORE, "error", { message }).catch(() => {})
    console.error("[cron/health-score] failed:", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
