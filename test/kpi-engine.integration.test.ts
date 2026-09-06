import { describe, it, expect, beforeEach, afterAll } from "vitest"
import type { Db } from "mongodb"
import { COLLECTIONS } from "@/lib/mongo"
import { evaluateKpiRules } from "@/lib/kpi-engine"
import { SuppliedMetricSource } from "@/lib/metric-source"
import type { FbMetrics, LsaMetrics, Ga4Metrics, MetricProviders } from "@/lib/metric-source"
import { freshDb, teardown, insertClient, insertService, onlyEnableRules, openFlags, daily } from "./helpers"

let db: Db
beforeEach(async () => { db = await freshDb() })
afterAll(teardown)

const activeFb = (rows: FbMetrics["dailyBreakdown"], connectedAt?: string): FbMetrics => ({
  dailyBreakdown: rows, accountInsights: { adAccountStatus: "active", timezone: "America/Los_Angeles" }, connectedAt: connectedAt ?? "2020-01-01",
})
const activeLsa = (rows: LsaMetrics["dailyBreakdown"], connectedAt?: string): LsaMetrics => ({
  dailyBreakdown: rows, accountInsights: { profileStatus: "active" }, connectedAt: connectedAt ?? "2020-01-01",
})

async function fbLsaClient(slug: string): Promise<string> {
  const cid = await insertClient(db, { slug })
  await insertService(db, { client_id: cid, service_type: "facebook" })
  await insertService(db, { client_id: cid, service_type: "lsa" })
  return cid
}

describe("INVARIANT #1 — a read failure must never trip a flag", () => {
  it("a thrown fb read skips the client's no_leads; a real zero opens it", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const errId = await fbLsaClient("err")
    const zeroId = await fbLsaClient("zero")

    const providers: MetricProviders = {
      fb: async (clientId) => {
        if (clientId === errId) throw new Error("Facebook API 403") // ERROR — not "0 leads"
        return activeFb(daily(30, () => ({ leads: 0, spend: 10 }))) // authoritative zero
      },
      lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
    }

    const res = await evaluateKpiRules({ metricSource: new SuppliedMetricSource(providers) })

    const errFlags = await openFlags(db, errId)
    const zeroFlags = await openFlags(db, zeroId)
    expect(errFlags.find(f => f.source === "no_leads")).toBeUndefined() // failure did NOT open a flag
    expect(zeroFlags.find(f => f.source === "no_leads")).toBeDefined() // real zero DID
    expect(res.clientsEvaluated).toBe(2)
  })

  it("a thrown ga4 aggregate skips seo_traffic_drop for everyone", async () => {
    await onlyEnableRules(db, ["seo_traffic_drop"])
    const cid = await insertClient(db, { slug: "seo1" })
    await insertService(db, { client_id: cid, service_type: "seo" })

    const throwing = new SuppliedMetricSource({ ga4Aggregate: async () => { throw new Error("GA4 5xx") } })
    await evaluateKpiRules({ metricSource: throwing })
    expect((await openFlags(db, cid)).find(f => f.source === "seo_traffic_drop")).toBeUndefined()

    // control: present data with a >20% drop DOES flag
    const present = new SuppliedMetricSource({
      ga4Aggregate: async (w) => {
        const m = new Map<string, Ga4Metrics>()
        m.set(cid, w.from < daysAgoIso(45) ? { organicSessions: 1000, organicConversions: 5 } : { organicSessions: 500, organicConversions: 2 })
        return m
      },
    })
    await evaluateKpiRules({ metricSource: present })
    expect((await openFlags(db, cid)).find(f => f.source === "seo_traffic_drop")).toBeDefined()
  })
})

describe("INVARIANT #2 — idempotent, self-healing reconcile", () => {
  it("re-running the sweep neither duplicates nor loses a flag", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const cid = await fbLsaClient("idem")
    const src = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads: 0 }))),
      lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
    })

    const r1 = await evaluateKpiRules({ metricSource: src })
    expect(r1.flagsOpened).toBe(1)
    const r2 = await evaluateKpiRules({ metricSource: src })
    expect(r2.flagsOpened).toBe(0)
    expect(r2.flagsUpdated).toBe(1) // updated in place, not duplicated
    expect(await openFlags(db, cid)).toHaveLength(1)
  })

  it("a recovered condition auto-resolves the flag", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const cid = await fbLsaClient("recover")
    let leads = 0
    const src = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads }))),
      lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
    })

    await evaluateKpiRules({ metricSource: src })
    expect(await openFlags(db, cid)).toHaveLength(1)

    leads = 3 // condition recovers
    const r = await evaluateKpiRules({ metricSource: src })
    expect(r.flagsResolved).toBe(1)
    expect(await openFlags(db, cid)).toHaveLength(0)
    const doc = await db.collection(COLLECTIONS.kpiFlags).findOne({ client_id: cid, source: "no_leads" })
    expect(doc!.status).toBe("resolved")
  })

  it("manual flags are never auto-resolved", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const cid = await fbLsaClient("manual")
    // an open manual flag on an evaluated client, not among desired flags this sweep
    await db.collection(COLLECTIONS.kpiFlags).insertOne({
      id: "m1", client_id: cid, source: "client_dissatisfied", severity: "red", message: "unhappy",
      evidence: { manual: true, raisedBy: "u1" }, status: "open", snoozed_until: null, checklist_item_id: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    const src = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads: 5 }))), // healthy -> nothing desired
      lsa: async () => activeLsa(daily(30, () => ({ leads: 5 }))),
    })
    const r = await evaluateKpiRules({ metricSource: src })
    expect(r.flagsResolved).toBe(0)
    const doc = await db.collection(COLLECTIONS.kpiFlags).findOne({ id: "m1" })
    expect(doc!.status).toBe("open")
  })

  it("snoozed flags are skipped (not reinserted) while the condition persists", async () => {
    await onlyEnableRules(db, ["no_leads"])
    const cid = await fbLsaClient("snooze")
    const src = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads: 0 }))),
      lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
    })
    await evaluateKpiRules({ metricSource: src })
    const id = (await openFlags(db, cid))[0]!.id as string
    await db.collection(COLLECTIONS.kpiFlags).updateOne({ id }, { $set: { status: "snoozed", snoozed_until: new Date(Date.now() + 7 * 86_400_000).toISOString() } })

    const r = await evaluateKpiRules({ metricSource: src })
    expect(r.flagsOpened).toBe(0) // not reinserted
    expect(await openFlags(db, cid)).toHaveLength(0) // still snoozed
    const docs = await db.collection(COLLECTIONS.kpiFlags).find({ client_id: cid, source: "no_leads" }).toArray()
    expect(docs).toHaveLength(1) // no duplicate row
    expect(docs[0]!.status).toBe("snoozed")
  })
})

describe("INVARIANT #3 — guards before thresholds", () => {
  it("account-age grace drops a flag while the fb account is younger than the window", async () => {
    await onlyEnableRules(db, ["fb_no_leads_7d"])
    const cid = await fbLsaClient("grace")
    // young account (connected 2 days ago) < 7d window -> graced
    const young = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads: 0, spend: 20 })), daysAgoIso(2)),
    })
    await evaluateKpiRules({ metricSource: young })
    expect((await openFlags(db, cid)).find(f => f.source === "fb_no_leads_7d")).toBeUndefined()

    // matured account (connected 30 days ago) -> flag fires
    const old = new SuppliedMetricSource({
      fb: async () => activeFb(daily(30, () => ({ leads: 0, spend: 20 })), daysAgoIso(30)),
    })
    await evaluateKpiRules({ metricSource: old })
    expect((await openFlags(db, cid)).find(f => f.source === "fb_no_leads_7d")).toBeDefined()
  })

  it("fb_ctr_low only fires when fb_cpl_high is also unhealthy (supporting-metric suppression)", async () => {
    await onlyEnableRules(db, ["fb_cpl_high", "fb_ctr_low"])
    const cid = await fbLsaClient("ctr")
    // Baseline 14d: cheap CPL ($1). Current 7d: expensive CPL (>=2x) AND low CTR.
    // days 0-6 (most recent) => current window; days 7-13 => part of baseline.
    const rows = daily(30, (i) => {
      if (i < 7) return { leads: 1, spend: 10, impressions: 1000, clicks: 3 } // CPL $10, CTR 0.3%
      return { leads: 10, spend: 10, impressions: 1000, clicks: 50 } // CPL $1 baseline, CTR 5%
    })
    const src = new SuppliedMetricSource({ fb: async () => activeFb(rows) })
    await evaluateKpiRules({ metricSource: src })
    const flags = await openFlags(db, cid)
    expect(flags.find(f => f.source === "fb_cpl_high")).toBeDefined()
    expect(flags.find(f => f.source === "fb_ctr_low")).toBeDefined()
  })

  it("seasonal hold suppresses lead_drop in a winter month", async () => {
    await onlyEnableRules(db, ["lead_drop"])
    // force seasonal hold ON for the current month
    const month = new Date().getMonth() + 1
    await db.collection(COLLECTIONS.kpiRules).updateOne(
      { rule_key: "lead_drop", scope: "global" },
      { $set: { "config.seasonalHold": true, "config.winterMonths": [month] } },
    )
    const cid = await fbLsaClient("season")
    const src = new SuppliedMetricSource({
      // current 30d: 10 leads; prior 30d: 100 leads -> -90% MoM
      fb: async (_c, w) => activeFb(daily(30, () => ({ leads: w.from < daysAgoIso(45) ? 100 : 10 }))),
      lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
    })
    await evaluateKpiRules({ metricSource: src })
    expect((await openFlags(db, cid)).find(f => f.source === "lead_drop")).toBeUndefined()
  })
})

describe("client-level rule: payment_failed", () => {
  it("fires for a late client with no service reads", async () => {
    await onlyEnableRules(db, ["payment_failed"])
    const cid = await insertClient(db, { slug: "late", status: "late" })
    await evaluateKpiRules({ metricSource: new SuppliedMetricSource() })
    expect((await openFlags(db, cid)).find(f => f.source === "payment_failed")).toBeDefined()
  })
})

describe("notifications", () => {
  it("routes only red events, deduped by kpi_flag:<client>:<source>:<severity>", async () => {
    await onlyEnableRules(db, ["no_leads"]) // red
    const cid = await fbLsaClient("notify")
    const events: string[] = []
    await evaluateKpiRules({
      metricSource: new SuppliedMetricSource({
        fb: async () => activeFb(daily(30, () => ({ leads: 0 }))),
        lsa: async () => activeLsa(daily(30, () => ({ leads: 0 }))),
      }),
      notifier: async (evts) => { for (const e of evts) events.push(e.dedupeKey) },
    })
    expect(events).toEqual([`kpi_flag:${cid}:no_leads:red`])
  })
})

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0]!
}
