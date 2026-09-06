// B12 — POST /api/kpi-flags/[id]/resolve (org-scoped).
import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/access"
import { resolveFlag } from "@/lib/kpi-flags"

export const dynamic = "force-dynamic"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = requireUser(request)
  if ("error" in auth) return auth.error
  const { id } = await ctx.params
  const ok = await resolveFlag(id)
  if (!ok) return NextResponse.json({ error: "flag not found" }, { status: 404 })
  return NextResponse.json({ ok: true, status: "resolved" })
}
