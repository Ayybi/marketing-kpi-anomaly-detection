// B12 — POST /api/kpi-flags/[id]/snooze (org-scoped). Body { days } 1-90, default 7.
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireUser } from "@/lib/auth/access"
import { snoozeFlag } from "@/lib/kpi-flags"

export const dynamic = "force-dynamic"

const Body = z.object({ days: z.number().int().min(1).max(90).default(7) })

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = requireUser(request)
  if ("error" in auth) return auth.error
  const { id } = await ctx.params

  let json: unknown = {}
  try { json = await request.json() } catch { /* empty body -> default 7 days */ }
  const parsed = Body.safeParse(json ?? {})
  if (!parsed.success) return NextResponse.json({ error: "invalid body", details: parsed.error.flatten() }, { status: 400 })

  const until = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString()
  const ok = await snoozeFlag(id, until)
  if (!ok) return NextResponse.json({ error: "flag not found" }, { status: 404 })
  return NextResponse.json({ ok: true, snoozedUntil: until })
}
