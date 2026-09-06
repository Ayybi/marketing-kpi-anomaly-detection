// Per-client rule sets. The data model already supports overrides via scope='client' + client_id
// (unique on (rule_key, client_id)). This module resolves the EFFECTIVE rule for a client
// (client override else global default) and provides CRUD for the rule-config UI.
import { randomUUID } from "node:crypto"
import { collections } from "@/lib/mongo"
import type { KpiRuleRow, KpiSeverity } from "@/lib/types"

export type EffectiveRuleMap = Map<string, KpiRuleRow>

/** All global rules (enabled or not), keyed by rule_key. */
export async function loadGlobalRules(): Promise<Map<string, KpiRuleRow>> {
  const { kpiRules } = await collections()
  const rows = await kpiRules.find({ scope: "global" }).toArray()
  const map = new Map<string, KpiRuleRow>()
  for (const r of rows) map.set(r.rule_key, r)
  return map
}

/** All client-scoped overrides, grouped by client_id -> rule_key -> row. */
export async function loadClientOverrides(): Promise<Map<string, Map<string, KpiRuleRow>>> {
  const { kpiRules } = await collections()
  const rows = await kpiRules.find({ scope: "client", client_id: { $ne: null } }).toArray()
  const byClient = new Map<string, Map<string, KpiRuleRow>>()
  for (const r of rows) {
    if (!r.client_id) continue
    const m = byClient.get(r.client_id) ?? new Map<string, KpiRuleRow>()
    m.set(r.rule_key, r)
    byClient.set(r.client_id, m)
  }
  return byClient
}

/**
 * Effective ENABLED rule set for one client: for each rule_key, the client override wins over the
 * global default; only enabled rules are included. This is what the engine evaluates per client.
 */
export function effectiveRulesFor(
  clientId: string,
  globals: Map<string, KpiRuleRow>,
  overrides: Map<string, Map<string, KpiRuleRow>>,
): EffectiveRuleMap {
  const clientOv = overrides.get(clientId)
  const out: EffectiveRuleMap = new Map()
  const keys = new Set<string>([...globals.keys(), ...(clientOv?.keys() ?? [])])
  for (const key of keys) {
    const eff = clientOv?.get(key) ?? globals.get(key)
    if (eff && eff.enabled) out.set(key, eff)
  }
  return out
}

// ---------------------------------------------------------------------------
// UI-facing views + CRUD
// ---------------------------------------------------------------------------

export type ClientRuleView = {
  ruleKey: string
  label: string
  service: string | null
  overridden: boolean
  overrideId: string | null
  effective: { enabled: boolean; severity: KpiSeverity; windowDays: number; config: Record<string, unknown> }
  global: { enabled: boolean; severity: KpiSeverity; windowDays: number; config: Record<string, unknown> }
}

function view(g: KpiRuleRow, ov: KpiRuleRow | undefined): ClientRuleView {
  const eff = ov ?? g
  return {
    ruleKey: g.rule_key,
    label: g.label,
    service: g.service,
    overridden: !!ov,
    overrideId: ov?.id ?? null,
    effective: { enabled: eff.enabled, severity: eff.severity, windowDays: eff.window_days, config: eff.config ?? {} },
    global: { enabled: g.enabled, severity: g.severity, windowDays: g.window_days, config: g.config ?? {} },
  }
}

/** The global catalog for the /app/rules page. Projects out Mongo's `_id` (an ObjectId with a
 *  toJSON method) so the rows are plain objects safe to pass to Client Components. */
export async function listGlobalRules(): Promise<KpiRuleRow[]> {
  const { kpiRules } = await collections()
  return kpiRules.find({ scope: "global" }).project<KpiRuleRow>({ _id: 0 }).sort({ severity: 1, rule_key: 1 }).toArray()
}

/** The per-client effective view (global defaults + any overrides) for the client rule editor. */
export async function listClientRules(clientId: string): Promise<ClientRuleView[]> {
  const [globals, overrides] = await Promise.all([loadGlobalRules(), loadClientOverrides()])
  const clientOv = overrides.get(clientId)
  return [...globals.values()]
    .sort((a, b) => (a.severity === b.severity ? a.rule_key.localeCompare(b.rule_key) : a.severity.localeCompare(b.severity)))
    .map(g => view(g, clientOv?.get(g.rule_key)))
}

export type RulePatch = {
  enabled?: boolean
  severity?: KpiSeverity
  windowDays?: number
  config?: Record<string, unknown>
}

/** Update a global rule in place (enable/disable, thresholds, severity, window). */
export async function updateGlobalRule(ruleKey: string, patch: RulePatch): Promise<boolean> {
  const { kpiRules } = await collections()
  const set = buildSet(patch)
  if (Object.keys(set).length === 0) return false
  const res = await kpiRules.updateOne({ rule_key: ruleKey, scope: "global" }, { $set: { ...set, updated_at: new Date().toISOString() } })
  return res.matchedCount > 0
}

/** Create or update a per-client override (copies label/service/severity/window from global). */
export async function upsertClientRuleOverride(clientId: string, ruleKey: string, patch: RulePatch): Promise<{ ok: boolean; error?: string }> {
  const { kpiRules } = await collections()
  const globalRule = await kpiRules.findOne({ rule_key: ruleKey, scope: "global" })
  if (!globalRule) return { ok: false, error: "unknown rule" }
  const nowIso = new Date().toISOString()

  const existing = await kpiRules.findOne({ rule_key: ruleKey, scope: "client", client_id: clientId })
  if (existing) {
    const set = buildSet(patch)
    await kpiRules.updateOne({ id: existing.id }, { $set: { ...set, updated_at: nowIso } })
    return { ok: true }
  }

  // New override seeds from the global rule, then applies the patch.
  await kpiRules.insertOne({
    id: randomUUID(),
    rule_key: ruleKey,
    label: globalRule.label,
    service: globalRule.service,
    window_days: patch.windowDays ?? globalRule.window_days,
    severity: patch.severity ?? globalRule.severity,
    scope: "client",
    client_id: clientId,
    enabled: patch.enabled ?? globalRule.enabled,
    config: patch.config ?? globalRule.config ?? {},
    created_at: nowIso,
    updated_at: nowIso,
  })
  return { ok: true }
}

/** Remove a per-client override, reverting the client to the global default. */
export async function deleteClientRuleOverride(clientId: string, ruleKey: string): Promise<boolean> {
  const { kpiRules } = await collections()
  const res = await kpiRules.deleteOne({ rule_key: ruleKey, scope: "client", client_id: clientId })
  return res.deletedCount > 0
}

function buildSet(patch: RulePatch): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  if (patch.enabled !== undefined) set.enabled = patch.enabled
  if (patch.severity !== undefined) set.severity = patch.severity
  if (patch.windowDays !== undefined) set.window_days = patch.windowDays
  if (patch.config !== undefined) set.config = patch.config
  return set
}
