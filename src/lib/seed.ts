// B5 — Seed the rule catalog. RE-IMPLEMENTED from the spec's verbatim INSERTs to MongoDB,
// preserving every rule_key, service, window, severity, enabled flag and config value exactly
// (this catalog is "the moat"). Idempotent: upsert-on-insert mirrors ON CONFLICT DO NOTHING,
// and the seasonalHold merge mirrors the `config || '{...}'` UPDATE (right operand wins).
import { randomUUID } from "node:crypto"
import type { Db } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"

type SeedRule = {
  rule_key: string
  label: string
  service: string | null
  window_days: number
  severity: "amber" | "red"
  scope: "global" | "client"
  enabled?: boolean
  config?: Record<string, unknown>
}

// Group 1 + Group 2 + Group 3 from B5, in order.
const SEED_RULES: SeedRule[] = [
  // Group 1 — no explicit config (defaults to {})
  { rule_key: "no_leads", label: "0 leads (any source)", service: null, window_days: 5, severity: "red", scope: "global" },
  { rule_key: "fb_spend_zero", label: "Facebook spend = 0 (campaign down)", service: "facebook", window_days: 1, severity: "red", scope: "global" },
  { rule_key: "payment_failed", label: "Failed Stripe payment", service: null, window_days: 0, severity: "red", scope: "global" },

  // Group 2 — with config
  { rule_key: "fb_cpl_high", label: "Facebook CPL above best-month target", service: "facebook", window_days: 30, severity: "red", scope: "global", config: { multiplier: 2 } },
  { rule_key: "fb_no_leads_7d", label: "Facebook: 0 leads in 7 days", service: "facebook", window_days: 7, severity: "red", scope: "global", config: {} },
  { rule_key: "lsa_no_impressions", label: "LSA: 0 impressions in 7 days", service: "lsa", window_days: 7, severity: "red", scope: "global", config: {} },
  { rule_key: "lsa_lead_drop", label: "LSA leads down >30% MoM", service: "lsa", window_days: 30, severity: "amber", scope: "global", config: { dropPct: 30 } },
  { rule_key: "lsa_cpl_up", label: "LSA cost per lead up >40% MoM", service: "lsa", window_days: 30, severity: "amber", scope: "global", config: { risePct: 40 } },
  { rule_key: "seo_traffic_drop", label: "Organic sessions down >20% MoM", service: "seo", window_days: 30, severity: "amber", scope: "global", config: { dropPct: 20 } },
  { rule_key: "gbp_views_drop", label: "GBP views down >20% MoM", service: "seo", window_days: 30, severity: "amber", scope: "global", config: { dropPct: 20 } },
  { rule_key: "lead_drop", label: "Total leads down >30% MoM", service: null, window_days: 30, severity: "amber", scope: "global", config: { dropPct: 30 } },
  { rule_key: "lsa_no_leads", label: "LSA: 0 leads (age-tiered)", service: "lsa", window_days: 0, severity: "red", scope: "global", config: { newAccountDays: 90, newNoLeadDays: 30, oldNoLeadDays: 14 } },
  { rule_key: "fb_ctr_low", label: "Facebook link CTR below floor (CPL also high)", service: "facebook", window_days: 7, severity: "amber", scope: "global", config: { ctrFloor: 0.8 } },
  { rule_key: "client_dissatisfied", label: "Client voiced dissatisfaction (manual)", service: null, window_days: 0, severity: "red", scope: "global", config: {} },
  { rule_key: "access_lost", label: "Platform access revoked or expired", service: null, window_days: 0, severity: "red", scope: "global", config: {} },
  { rule_key: "campaign_paused", label: "FB paused/inactive 7+ days, no note", service: "facebook", window_days: 7, severity: "red", scope: "global", config: {} },

  // Group 3 — shipped DISABLED; enable after the data ramps in
  { rule_key: "seo_no_organic_leads", label: "SEO: organic traffic but 0 organic leads (after month 1)", service: "seo", window_days: 0, severity: "amber", scope: "global", enabled: false, config: { minAgeDays: 30 } },
  { rule_key: "seo_no_movement", label: "SEO: no ranking movement in 30 days", service: "seo", window_days: 30, severity: "amber", scope: "global", enabled: false, config: {} },
]

export async function seedRuleCatalog(db: Db): Promise<{ inserted: number; total: number }> {
  const rules = db.collection(COLLECTIONS.kpiRules)
  const nowIso = new Date().toISOString()
  let inserted = 0

  for (const r of SEED_RULES) {
    // ON CONFLICT DO NOTHING on the global unique key (rule_key where scope='global').
    const res = await rules.updateOne(
      { rule_key: r.rule_key, scope: r.scope },
      {
        $setOnInsert: {
          id: randomUUID(),
          rule_key: r.rule_key,
          label: r.label,
          service: r.service,
          window_days: r.window_days,
          severity: r.severity,
          scope: r.scope,
          client_id: null,
          enabled: r.enabled ?? true,
          config: r.config ?? {},
          created_at: nowIso,
          updated_at: nowIso,
        },
      },
      { upsert: true },
    )
    if (res.upsertedCount > 0) inserted++
  }

  // seasonalHold merge (mirrors: UPDATE ... SET config = config || '{"seasonalHold": false,
  // "winterMonths": [12,1,2]}' WHERE rule_key IN ('lead_drop','lsa_lead_drop') AND scope='global').
  await rules.updateMany(
    { rule_key: { $in: ["lead_drop", "lsa_lead_drop"] }, scope: "global" },
    [
      {
        $set: {
          config: { $mergeObjects: ["$config", { seasonalHold: false, winterMonths: [12, 1, 2] }] },
          updated_at: nowIso,
        },
      },
    ],
  )

  return { inserted, total: SEED_RULES.length }
}
