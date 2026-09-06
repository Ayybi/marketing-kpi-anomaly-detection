// Section 15 — GET /api/system-health/deep. Runs the read-only live probe per integration (6s
// timeout each), classified into the six ping states. Never touches per-client data, never writes.
// NOTE: this makes outbound calls to third-party APIs; in production consider gating it behind
// requireUser/requireRole or CRON_SECRET to avoid abuse.
import { NextResponse } from "next/server"
import { deepPing } from "@/lib/health/pings"

export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
  const integrations = await deepPing()
  const body = {
    mode: "deep" as const,
    ok: integrations.every(i => i.status === "ok" || i.status === "not_configured"),
    integrations,
    generatedAt: new Date().toISOString(),
  }
  return NextResponse.json(body)
}
