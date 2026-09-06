// B12 — GET /api/kpi-flags[?clientId=] and POST /api/kpi-flags (super_admin manual flag).
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser, requireRole } from "@/lib/auth/access"
import { createManualFlag, listAtRiskClients, listClientOpenFlags, MANUAL_SOURCES } from "@/lib/kpi-flags"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const auth = requireUser(request)
  if ("error" in auth) return auth.error

  const clientId = new URL(request.url).searchParams.get("clientId")
  if (clientId) {
    return NextResponse.json({ flags: await listClientOpenFlags(clientId) })
  }
  return NextResponse.json({ atRisk: await listAtRiskClients() })
}

const PostBody = z.object({
  clientId: z.string().min(1), // slug or uuid
  source: z.enum(MANUAL_SOURCES), // only client_dissatisfied | access_lost (Section 6)
  severity: z.enum(["amber", "red"]).default("red"),
  message: z.string().min(1),
})

export async function POST(request: Request): Promise<NextResponse> {
  const auth = requireRole(request, "super_admin")
  if ("error" in auth) return auth.error

  let json: unknown
  try { json = await request.json() } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }) }
  const parsed = PostBody.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: "invalid body", details: parsed.error.flatten() }, { status: 400 })

  const { clientId, source, severity, message } = parsed.data
  const result = await createManualFlag({ slugOrId: clientId, source, severity, message, actorId: auth.user.id })
  if (!result.ok) {
    const status = result.error === "client not found" ? 404 : 400
    return NextResponse.json({ error: result.error ?? "failed" }, { status })
  }
  // AUDIT: manual flags are audited (Section 10). Wire to your audit log here.
  return NextResponse.json({ ok: true }, { status: 201 })
}
