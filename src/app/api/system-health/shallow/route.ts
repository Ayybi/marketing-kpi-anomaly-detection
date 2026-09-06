// Section 15 — GET /api/system-health/shallow. Cheap, network-free (except the sync_log read):
// env presence + cron freshness + config-only integration pings. A missing REQUIRED env var makes
// the whole check a 503 (per the spec). A sync_log READ ERROR is surfaced as an explicit error,
// never faked into "never_logged".
import { NextResponse } from "next/server"
import { checkEnv } from "@/lib/health/env"
import { getCronHealth, type CronHealth } from "@/lib/health/crons"
import { shallowPing } from "@/lib/health/pings"

export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
  const env = checkEnv()
  const integrations = shallowPing()

  let crons: CronHealth[]
  let cronsError: string | null = null
  try {
    crons = await getCronHealth()
  } catch (err) {
    crons = []
    cronsError = err instanceof Error ? err.message : String(err) // DB read error — surfaced, not hidden
  }

  const body = {
    mode: "shallow" as const,
    ok: env.ok && cronsError === null && crons.every(c => c.overall !== "fail"),
    env,
    crons,
    cronsError,
    integrations,
    generatedAt: new Date().toISOString(),
  }
  // A missing required env var is a 503 (Section 15).
  return NextResponse.json(body, { status: env.ok ? 200 : 503 })
}
