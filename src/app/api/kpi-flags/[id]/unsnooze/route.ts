// B12 — POST /api/kpi-flags/[id]/unsnooze (org-scoped). Restore to open.
import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth/access"
import { unsnoozeFlag } from "@/lib/kpi-flags"

export const dynamic = "force-dynamic"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = requireUser(request)
  if ("error" in auth) return auth.error
  const { id } = await ctx.params
  const ok = await unsnoozeFlag(id)
  if (!ok) return NextResponse.json({ error: "flag not found" }, { status: 404 })
  return NextResponse.json({ ok: true, status: "open" })
}
