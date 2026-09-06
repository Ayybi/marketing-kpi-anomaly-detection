// PATCH  /api/rules/[ruleKey]              -> update the GLOBAL rule (super_admin)
// PUT    /api/rules/[ruleKey]?clientId=    -> create/update a per-client override (super_admin)
// DELETE /api/rules/[ruleKey]?clientId=    -> remove a per-client override (revert to global)
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth/access"
import { updateGlobalRule, upsertClientRuleOverride, deleteClientRuleOverride, type RulePatch } from "@/lib/rules"

export const dynamic = "force-dynamic"

const PatchBody = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(["amber", "red"]).optional(),
  windowDays: z.number().int().min(0).max(365).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

async function parse(request: Request): Promise<RulePatch | null> {
  let json: unknown
  try { json = await request.json() } catch { return null }
  const p = PatchBody.safeParse(json)
  return p.success ? p.data : null
}

export async function PATCH(request: Request, ctx: { params: Promise<{ ruleKey: string }> }): Promise<NextResponse> {
  const auth = requireRole(request, "super_admin")
  if ("error" in auth) return auth.error
  const { ruleKey } = await ctx.params
  const patch = await parse(request)
  if (!patch) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const ok = await updateGlobalRule(ruleKey, patch)
  if (!ok) return NextResponse.json({ error: "rule not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function PUT(request: Request, ctx: { params: Promise<{ ruleKey: string }> }): Promise<NextResponse> {
  const auth = requireRole(request, "super_admin")
  if ("error" in auth) return auth.error
  const { ruleKey } = await ctx.params
  const clientId = new URL(request.url).searchParams.get("clientId")
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 })
  const patch = await parse(request)
  if (!patch) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const res = await upsertClientRuleOverride(clientId, ruleKey, patch)
  if (!res.ok) return NextResponse.json({ error: res.error ?? "failed" }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request, ctx: { params: Promise<{ ruleKey: string }> }): Promise<NextResponse> {
  const auth = requireRole(request, "super_admin")
  if ("error" in auth) return auth.error
  const { ruleKey } = await ctx.params
  const clientId = new URL(request.url).searchParams.get("clientId")
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 })
  const ok = await deleteClientRuleOverride(clientId, ruleKey)
  if (!ok) return NextResponse.json({ error: "override not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
