import { describe, it, expect, beforeEach, afterAll } from "vitest"
import type { Db } from "mongodb"
import { evaluateKpiRules } from "@/lib/kpi-engine"
import { SuppliedMetricSource } from "@/lib/metric-source"
import type { FbMetrics, LsaMetrics } from "@/lib/metric-source"
import {
  effectiveRulesFor, upsertClientRuleOverride, deleteClientRuleOverride, updateGlobalRule,
  listClientRules, loadGlobalRules, loadClientOverrides,
} from "@/lib/rules"
import type { KpiRuleRow } from "@/lib/types"
import { freshDb, teardown, insertClient, insertService, onlyEnableRules, openFlags, daily } from "./helpers"

let db: Db
beforeEach(async () => { db = await freshDb() })
afterAll(teardown)

const fb = (rows: FbMetrics["dailyBreakdown"]): FbMetrics => ({ dailyBreakdown: rows, accountInsights: { adAccountStatus: "active", timezone: "UTC" }, connectedAt: "2020-01-01" })
const lsa = (rows: LsaMetrics["dailyBreakdown"]): LsaMetrics => ({ dailyBreakdown: rows, accountInsights: { profileStatus: "active" }, connectedAt: "2020-01-01" })

async function fbLsa(slug: string): Promise<string> {
  const cid = await insertClient(db, { slug })
  await insertService(db, { client_id: cid, service_type: "facebook" })
  await insertService(db, { client_id: cid, service_type: "lsa" })
  return cid
}

function rule(partial: Partial<KpiRuleRow> & { rule_key: string; enabled: boolean }): KpiRuleRow {
  return {
    id: partial.rule_key, rule_key: partial.rule_key, label: partial.rule_key, service: null,
    window_days: partial.window_days ?? 5, severity: partial.severity ?? "red", scope: partial.scope ?? "global",
    client_id: partial.client_id ?? null, enabled: partial.enabled, config: partial.config ?? {},
    created_at: "", updated_at: "",
  }
}

describe("effectiveRulesFor (pure)", () => {
  it("a client override wins over the global default", () => {
    const globals = new Map([["no_leads", rule({ rule_key: "no_leads", enabled: true })]])
    const overrides = new Map([["c1", new Map([["no_leads", rule({ rule_key: "no_leads", enabled: false, scope: "client", client_id: "c1" })]])]])
    expect(effectiveRulesFor("c1", globals, overrides).has("no_leads")).toBe(false) // disabled for c1
    expect(effectiveRulesFor("c2", globals, overrides).has("no_leads")).toBe(true) // default for c2
  })

  it("an override can enable a globally-disabled rule", () => {
    const globals = new Map([["seo_no_movement", rule({ rule_key: "seo_no_movement", enabled: false })]])
    const overrides = new Map([["c1", new Map([["seo_no_movement", rule({ rule_key: "seo_no_movement", enabled: true, scope: "client", client_id: "c1" })]])]])
    expect(effectiveRulesFor("c1", globals, overrides).has("seo_no_movement")).toBe(true)
  })
})

describe("per-client overrides change engine behavior", () => {
  it("disabling a rule for one client suppresses its flag while others still get it", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const a = await fbLsa("keep")
    const b = await fbLsa("mute")
    await upsertClientRuleOverride(b, "no_leads", { enabled: false })

    const src = new SuppliedMetricSource({
      fb: async () => fb(daily(30, () => ({ leads: 0 }))),
      lsa: async () => lsa(daily(30, () => ({ leads: 0 }))),
    })
    await evaluateKpiRules({ metricSource: src })

    expect((await openFlags(db, a)).some(f => f.source === "no_leads")).toBe(true)
    expect((await openFlags(db, b)).some(f => f.source === "no_leads")).toBe(false)
  })

  it("enabling a globally-disabled rule for one client turns it on for that client only", async () => {
    await onlyEnableRules(db, []) // everything off globally
    const a = await fbLsa("on")
    const b = await fbLsa("off")
    await upsertClientRuleOverride(a, "no_leads", { enabled: true })

    const src = new SuppliedMetricSource({
      fb: async () => fb(daily(30, () => ({ leads: 0 }))),
      lsa: async () => lsa(daily(30, () => ({ leads: 0 }))),
    })
    await evaluateKpiRules({ metricSource: src })

    expect((await openFlags(db, a)).some(f => f.source === "no_leads")).toBe(true)
    expect((await openFlags(db, b)).some(f => f.source === "no_leads")).toBe(false)
  })

  it("a per-client threshold override fires where the global default would not", async () => {
    await onlyEnableRules(db, ["lsa_lead_drop"]) // global dropPct = 30
    const strict = await fbLsa("strict")
    const lax = await fbLsa("sensitive")
    await upsertClientRuleOverride(lax, "lsa_lead_drop", { config: { dropPct: 10 } })

    // -20% MoM: below the global 30% floor, above the client's 10% floor.
    const src = new SuppliedMetricSource({
      lsa: async (_c, w) => {
        const isPrev = new Date(w.to).getTime() < Date.now() - 20 * 86_400_000
        return lsa(daily(30, () => ({ leads: isPrev ? 100 : 80 })))
      },
    })
    await evaluateKpiRules({ metricSource: src })

    expect((await openFlags(db, strict)).some(f => f.source === "lsa_lead_drop")).toBe(false)
    expect((await openFlags(db, lax)).some(f => f.source === "lsa_lead_drop")).toBe(true)
  })
})

describe("rules CRUD", () => {
  it("upsert marks a rule overridden; delete reverts to global", async () => {
    const cid = await insertClient(db, { slug: "acme" })

    let view = (await listClientRules(cid)).find(r => r.ruleKey === "fb_cpl_high")!
    expect(view.overridden).toBe(false)
    expect(view.effective.enabled).toBe(true)

    await upsertClientRuleOverride(cid, "fb_cpl_high", { enabled: false, config: { multiplier: 3 } })
    view = (await listClientRules(cid)).find(r => r.ruleKey === "fb_cpl_high")!
    expect(view.overridden).toBe(true)
    expect(view.effective.enabled).toBe(false)
    expect(view.effective.config).toMatchObject({ multiplier: 3 })
    expect(view.global.enabled).toBe(true) // global untouched

    expect(await deleteClientRuleOverride(cid, "fb_cpl_high")).toBe(true)
    view = (await listClientRules(cid)).find(r => r.ruleKey === "fb_cpl_high")!
    expect(view.overridden).toBe(false)
    expect(view.effective.enabled).toBe(true)
  })

  it("updateGlobalRule toggles the shared default", async () => {
    expect(await updateGlobalRule("no_leads", { enabled: false })).toBe(true)
    const globals = await loadGlobalRules()
    expect(globals.get("no_leads")!.enabled).toBe(false)
    // no client overrides exist
    expect((await loadClientOverrides()).size).toBe(0)
  })
})
