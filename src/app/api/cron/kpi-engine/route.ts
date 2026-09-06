// B12 — Cron GET /api/cron/kpi-engine (15,45 * * * *): reopen expired snoozes, then evaluate,
// then log counts. Guarded by CRON_SECRET (fail-closed).
import { NextResponse } from "next/server"
import { assertCronSecret } from "@/lib/auth/cron"
import { reopenExpiredSnoozedFlags } from "@/lib/kpi-flags"
import { evaluateKpiRules } from "@/lib/kpi-engine"
import { SuppliedMetricSource } from "@/lib/metric-source"
import { writeSyncLog } from "@/lib/sync-log"
import { CRON_SOURCE_KPI_ENGINE } from "@/lib/health/crons"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = assertCronSecret(request)
  if (unauthorized) return unauthorized

  // PLUG YOUR METRIC LAYER HERE. Until real connectors (Data Hub / connected accounts) are wired,
  // this supplies NO metrics -> every read is ABSENT -> no flags fire (never a false zero).
  // Replace with: new SuppliedMetricSource({ fb, lsa, ga4Aggregate, gbpAggregate, seoRanks })
  // or your own KpiMetricSource implementation.
  const metricSource = new SuppliedMetricSource()

  try {
    const reopened = await reopenExpiredSnoozedFlags()
    const result = await evaluateKpiRules({ metricSource })
    const summary = { reopened, ...result }
    await writeSyncLog(CRON_SOURCE_KPI_ENGINE, "ok", summary)
    console.log("[cron/kpi-engine]", JSON.stringify(summary))
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Record the failure so System Health surfaces it — never swallow it into a fake "ok".
    await writeSyncLog(CRON_SOURCE_KPI_ENGINE, "error", { message }).catch(() => {})
    console.error("[cron/kpi-engine] failed:", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
