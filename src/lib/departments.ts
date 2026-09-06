// B10 — Routing (VERBATIM from the spec).
export function kpiFlagDepartment(source: string | null | undefined): "facebook_ads" | "lsa" | "seo" | null {
  if (!source) return null
  if (source === "campaign_paused" || source.startsWith("fb_")) return "facebook_ads"
  if (source.startsWith("lsa_")) return "lsa"
  if (source.startsWith("seo_") || source.startsWith("gbp_")) return "seo"
  return null // no_leads / lead_drop / payment_failed / access_lost -> super-admins
}

export async function resolveKpiRecipients(
  department: string | null,
  ctx: { superAdminIds: string[]; deptLeadsFor: (d: string) => Promise<string[]> },
): Promise<string[]> {
  if (!department) return ctx.superAdminIds
  const leads = await ctx.deptLeadsFor(department)
  return leads.length > 0 ? leads : ctx.superAdminIds
}
