// B9 — The engine loop (WRITE-FROM-SPEC). Implements evaluateKpiRules to the spec's contract:
// load enabled rules -> determine in-scope clients + live service types -> fetch two 30d windows
// via the MetricSource adapter -> evaluate the rule catalog (Section 4) with all guards (Section 5)
// -> apply account-age grace -> reconcile idempotently on (client_id, source) -> route red events.
//
// INVARIANT #1 (three-state reads): every MetricSource call is wrapped so a THROW (error) causes
// the dependent signal to be skipped for that client — it NEVER becomes a false 0 that opens a flag.
// INVARIANT #2 (idempotent reconcile): keyed on (client_id, source); manual flags never auto-resolve.
// INVARIANT #3 (guards before thresholds): grace, zero-baseline (pctChange), min-baseline-leads,
// supporting-metric suppression, seasonal hold, note suppression are all applied.
import { randomUUID } from "node:crypto"
import { collections } from "@/lib/mongo"
import { kpiFlagDepartment } from "@/lib/departments"
import {
  sumLastDays, todayInTimeZone, fbSpendZeroFinding, pctChange, num,
  graceAccountsForSource, buildLiveServiceTypes, inWinterHold,
} from "@/lib/kpi-engine-logic"
import { SuppliedMetricSource } from "@/lib/metric-source"
import { loadGlobalRules, loadClientOverrides, effectiveRulesFor, type EffectiveRuleMap } from "@/lib/rules"
import type {
  KpiMetricSource, MetricWindow, FbMetrics, LsaMetrics, Ga4Metrics, GbpMetrics, SeoRankRow,
} from "@/lib/metric-source"
import type { KpiRuleRow, KpiFlagRow, KpiSeverity, ClientRow, ClientServiceRow } from "@/lib/types"

const DAY_MS = 86_400_000

const ELIGIBLE_STAGES = new Set(["onboarding", "fulfillment", "maintenance"])
const LIVE_CLIENT_STATUSES = new Set(["active", "late"])
const LIVE_SERVICE_STATUSES = new Set(["active", "late", "promo", "on_us", "pending"])

// The auto-resolvable set (PERF_SOURCES) — excludes client_dissatisfied (manual-only, Section 6).
export const PERF_SOURCES = [
  "no_leads", "fb_spend_zero", "payment_failed", "fb_cpl_high", "fb_no_leads_7d", "fb_ctr_low",
  "lsa_no_impressions", "lsa_no_leads", "lsa_lead_drop", "lsa_cpl_up", "lead_drop",
  "seo_traffic_drop", "gbp_views_drop", "seo_no_organic_leads", "seo_no_movement",
  "campaign_paused", "access_lost",
]

export type DesiredFlag = {
  clientId: string
  source: string
  severity: KpiSeverity
  message: string
  evidence: Record<string, unknown>
}

export type NotifyEvent = {
  clientId: string
  source: string
  severity: KpiSeverity
  message: string
  dedupeKey: string // kpi_flag:<clientId>:<source>:<severity> (Section 9)
}

export type EngineDeps = {
  /** The metric-read seam. Default: an all-absent SuppliedMetricSource (safe no-op — no flags). */
  metricSource?: KpiMetricSource
  /** Dispatch red events to owners (Slack/email). Default: no-op. */
  notifier?: (events: NotifyEvent[]) => Promise<void>
  /** campaign_paused suppression: true if an internal note/activity exists within `withinDays`. */
  hasRecentNote?: (clientId: string, withinDays: number) => Promise<boolean>
  /** access_lost source: platform mappings currently in an error/revoked state for the client. */
  accessErrors?: (clientId: string) => Promise<string[]>
  /** Injectable clock for deterministic tests. */
  now?: Date
}

const key = (clientId: string, source: string) => `${clientId}:${source}`

function windowDates(now: Date, daysBack: number, span: number): MetricWindow {
  const to = new Date(now.getTime() - daysBack * DAY_MS)
  const from = new Date(to.getTime() - (span - 1) * DAY_MS)
  return { from: from.toISOString().split("T")[0]!, to: to.toISOString().split("T")[0]! }
}

/** True when a client's live service types satisfy the service a rule source implies. */
function serviceGateSatisfied(source: string, services: Set<string>): boolean {
  if (source === "no_leads" || source === "lead_drop") return services.has("facebook") || services.has("lsa")
  if (source === "campaign_paused" || source.startsWith("fb_")) return services.has("facebook")
  if (source.startsWith("lsa_")) return services.has("lsa")
  if (source.startsWith("seo_") || source.startsWith("gbp_")) return services.has("seo")
  return true // client-level rules (payment_failed, client_dissatisfied, access_lost)
}

function ageDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((now.getTime() - t) / DAY_MS)
}

export async function evaluateKpiRules(deps: EngineDeps = {}): Promise<{
  flagsOpened: number
  flagsUpdated: number
  flagsResolved: number
  clientsEvaluated: number
}> {
  const now = deps.now ?? new Date()
  const source = deps.metricSource ?? new SuppliedMetricSource()
  const { clients: clientsCol, clientServices: servicesCol, kpiFlags } = await collections()

  // 1) Load the rule catalog: global defaults + per-client overrides. The EFFECTIVE rule set is
  //    computed per client below (client override wins over global; only enabled rules evaluate).
  const [globalRules, clientOverrides] = await Promise.all([loadGlobalRules(), loadClientOverrides()])

  // 2) Determine in-scope clients (eligible stage + live status OR a live service) and per-client
  //    live service types.
  const clientDocs = await clientsCol
    .find({ deleted_at: null, stage: { $in: [...ELIGIBLE_STAGES] } })
    .toArray()
  const serviceDocs = await servicesCol
    .find({ status: { $in: [...LIVE_SERVICE_STATUSES] } })
    .toArray()
  const liveServiceTypes = buildLiveServiceTypes(
    serviceDocs.map((s: ClientServiceRow) => ({ client_id: s.client_id, service_type: s.service_type })),
  )
  const clientList = clientDocs.filter(
    (c: ClientRow) =>
      LIVE_CLIENT_STATUSES.has(c.status ?? "") || (liveServiceTypes.get(c.id)?.size ?? 0) > 0,
  )
  // earliest live-service start per client (age-aware rules like seo_no_organic_leads).
  const serviceStart = new Map<string, number>()
  for (const s of serviceDocs) {
    const iso = s.started_at ?? s.created_at
    if (!iso) continue
    const t = new Date(iso).getTime()
    const cur = serviceStart.get(s.client_id)
    if (cur === undefined || t < cur) serviceStart.set(s.client_id, t)
  }

  if (clientList.length === 0) return { flagsOpened: 0, flagsUpdated: 0, flagsResolved: 0, clientsEvaluated: 0 }

  // Precompute each client's effective (enabled) rule map once.
  const effectiveByClient = new Map<string, EffectiveRuleMap>()
  for (const c of clientList) effectiveByClient.set(c.id, effectiveRulesFor(c.id, globalRules, clientOverrides))
  const anyEnabled = (k: string) => clientList.some(c => effectiveByClient.get(c.id)?.has(k))

  // 3) Fetch account-wide aggregates once per window (only if a rule that needs them is enabled for
  //    at least one in-scope client — honoring per-client overrides).
  const cur: MetricWindow = windowDates(now, 0, 30)
  const prev: MetricWindow = windowDates(now, 30, 30)
  const needGa4 = anyEnabled("seo_traffic_drop") || anyEnabled("seo_no_organic_leads")
  const needGa4Prev = anyEnabled("seo_traffic_drop")
  const needGbp = anyEnabled("gbp_views_drop")

  const [ga4Cur, ga4Prev, gbpCur, gbpPrev] = await Promise.all([
    safeMap(needGa4 ? () => source.ga4Aggregate(cur) : null),
    safeMap(needGa4Prev ? () => source.ga4Aggregate(prev) : null),
    safeMap(needGbp ? () => source.gbpAggregate(cur) : null),
    safeMap(needGbp ? () => source.gbpAggregate(prev) : null),
  ])

  const clientIds = clientList.map(c => c.id)

  // Existing open + snoozed flags for the evaluated clients (non-task: checklist_item_id null).
  const priorFlags = await kpiFlags
    .find({ client_id: { $in: clientIds }, status: { $in: ["open", "snoozed"] }, checklist_item_id: null })
    .toArray()
  const existing = new Map<string, KpiFlagRow>()
  const snoozedKeys = new Set<string>()
  const openFlags: KpiFlagRow[] = []
  for (const f of priorFlags) {
    if (f.status === "snoozed") snoozedKeys.add(key(f.client_id, f.source))
    else { existing.set(key(f.client_id, f.source), f); openFlags.push(f) }
  }

  // 4) + 5) Evaluate rules per client, then apply account-age grace.
  const desired = new Map<string, DesiredFlag>()
  for (const client of clientList) {
    const services = liveServiceTypes.get(client.id) ?? new Set<string>()
    const rules = effectiveByClient.get(client.id) ?? new Map<string, KpiRuleRow>()
    const enabled = (k: string) => rules.has(k)
    const clientDesired = await evaluateClientRules({
      client, services, rules, enabled, source, now, cur, prev,
      ga4Cur, ga4Prev, gbpCur, gbpPrev,
      serviceStartMs: serviceStart.get(client.id) ?? null,
      hasRecentNote: deps.hasRecentNote,
      accessErrors: deps.accessErrors,
    })
    for (const d of clientDesired) {
      // account-age grace (CHG-58): drop if any dependent account is younger than the rule window.
      if (isGraced(d, rules, client, source, now)) continue
      desired.set(key(d.clientId, d.source), d)
    }
  }

  // Grace needs the per-client account ages; we fetched fb/lsa inside evaluateClientRules and stored
  // connectedAt on the desired flag's evidence under a private key. See applyGraceInline below.

  // 6) Reconcile — idempotent on (client_id, source).
  let flagsOpened = 0, flagsUpdated = 0, flagsResolved = 0
  const inserts: KpiFlagRow[] = []
  const notifyEvents: NotifyEvent[] = []
  const nowIso = now.toISOString()

  for (const [k, d] of desired) {
    if (snoozedKeys.has(k)) continue // snoozed flags are skipped during reconciliation
    const prior = existing.get(k)
    if (!prior) {
      inserts.push({
        id: randomUUID(),
        client_id: d.clientId,
        source: d.source,
        severity: d.severity,
        message: d.message,
        evidence: d.evidence,
        status: "open",
        snoozed_until: null,
        checklist_item_id: null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      notifyEvents.push(makeEvent(d))
    } else {
      // Update in place — keep created_at (spec). Notify only on amber->red escalation.
      await kpiFlags.updateOne(
        { id: prior.id },
        { $set: { severity: d.severity, message: d.message, evidence: d.evidence, updated_at: nowIso } },
      )
      flagsUpdated++
      if (prior.severity !== d.severity) notifyEvents.push(makeEvent(d))
    }
  }
  if (inserts.length > 0) {
    await kpiFlags.insertMany(inserts)
    flagsOpened = inserts.length
  }

  // Resolve stale non-manual flags (open, no longer desired, evidence.manual !== true).
  const staleIds = openFlags
    .filter(f => !desired.has(key(f.client_id, f.source)) && (f.evidence as { manual?: boolean } | null)?.manual !== true)
    .map(f => f.id)
  if (staleIds.length > 0) {
    const res = await kpiFlags.updateMany({ id: { $in: staleIds } }, { $set: { status: "resolved", updated_at: nowIso } })
    flagsResolved = res.modifiedCount
    // NOTE (Mongo-swap deviation): the spec also deletes matching stored `kpi_flag` notifications so
    // the dashboard bell only shows open flags. This standalone dispatches red events to an external
    // Notifier (Slack/email) instead of persisting notification rows, so there is nothing to delete.
  }

  // Route RED events only (Section 9). Dedupe key: kpi_flag:<clientId>:<source>:<severity>.
  const redEvents = dedupe(notifyEvents.filter(e => e.severity === "red"))
  if (redEvents.length > 0 && deps.notifier) await deps.notifier(redEvents)

  return { flagsOpened, flagsUpdated, flagsResolved, clientsEvaluated: clientList.length }
}

function makeEvent(d: DesiredFlag): NotifyEvent {
  return {
    clientId: d.clientId, source: d.source, severity: d.severity, message: d.message,
    dedupeKey: `kpi_flag:${d.clientId}:${d.source}:${d.severity}`,
  }
}

function dedupe(events: NotifyEvent[]): NotifyEvent[] {
  const seen = new Set<string>()
  const out: NotifyEvent[] = []
  for (const e of events) {
    if (seen.has(e.dedupeKey)) continue
    seen.add(e.dedupeKey)
    out.push(e)
  }
  return out
}

/** Run a Map-returning read, converting an ERROR (throw) into null so callers treat it as "unknown". */
async function safeMap<T>(fn: (() => Promise<Map<string, T>>) | null): Promise<Map<string, T> | null> {
  if (!fn) return null
  try { return await fn() } catch { return null }
}

// ---------------------------------------------------------------------------
// Account-age grace. The dependent account ages are stashed on the desired flag under __ages by
// evaluateClientRules (a private, stripped-before-persist field).
// ---------------------------------------------------------------------------
type Ages = { fb: number | null; lsa: number | null }

function isGraced(
  d: DesiredFlag,
  rules: Map<string, KpiRuleRow>,
  _client: ClientRow,
  _source: KpiMetricSource,
  _now: Date,
): boolean {
  const rule = rules.get(d.source)
  const windowDays = rule?.window_days ?? 0
  if (windowDays <= 0) { delete (d.evidence as Record<string, unknown>).__ages; return false }
  const deps = graceAccountsForSource(d.source)
  const ages = (d.evidence as Record<string, unknown>).__ages as Ages | undefined
  delete (d.evidence as Record<string, unknown>).__ages // never persist the private key
  if (!ages || deps.length === 0) return false
  for (const dep of deps) {
    const a = ages[dep]
    if (a !== null && a !== undefined && a < windowDays) return true // account too young -> drop
  }
  return false
}

// ---------------------------------------------------------------------------
// Per-client rule evaluation.
// ---------------------------------------------------------------------------
type EvalCtx = {
  client: ClientRow
  services: Set<string>
  rules: Map<string, KpiRuleRow>
  enabled: (k: string) => boolean
  source: KpiMetricSource
  now: Date
  cur: MetricWindow
  prev: MetricWindow
  ga4Cur: Map<string, Ga4Metrics> | null
  ga4Prev: Map<string, Ga4Metrics> | null
  gbpCur: Map<string, GbpMetrics> | null
  gbpPrev: Map<string, GbpMetrics> | null
  serviceStartMs: number | null
  hasRecentNote?: (clientId: string, withinDays: number) => Promise<boolean>
  accessErrors?: (clientId: string) => Promise<string[]>
}

async function evaluateClientRules(ctx: EvalCtx): Promise<DesiredFlag[]> {
  const { client, services, rules, enabled, source, now, cur, prev } = ctx
  const out: DesiredFlag[] = []
  const cid = client.id

  const gate = (src: string) => serviceGateSatisfied(src, services)

  // --- Three-state metric reads. present=obj, absent=null, error=thrown (we flip a *Error flag). ---
  let fb: FbMetrics | null = null, fbErr = false
  let fbPrevM: FbMetrics | null = null, fbPrevErr = false
  let lsa: LsaMetrics | null = null, lsaErr = false
  let lsaPrevM: LsaMetrics | null = null, lsaPrevErr = false

  const needFb = gate("fb_") || gate("no_leads") // any fb/ads rule and client has facebook
  const wantsFb = services.has("facebook") && (
    enabled("no_leads") || enabled("lead_drop") || enabled("fb_spend_zero") || enabled("fb_cpl_high") ||
    enabled("fb_no_leads_7d") || enabled("fb_ctr_low") || enabled("campaign_paused")
  )
  const wantsLsa = services.has("lsa") && (
    enabled("no_leads") || enabled("lead_drop") || enabled("lsa_no_impressions") ||
    enabled("lsa_no_leads") || enabled("lsa_lead_drop") || enabled("lsa_cpl_up")
  )
  const wantsFbPrev = services.has("facebook") && enabled("lead_drop")
  const wantsLsaPrev = services.has("lsa") && (enabled("lead_drop") || enabled("lsa_lead_drop") || enabled("lsa_cpl_up"))

  if (wantsFb) { try { fb = await source.fb(cid, cur) } catch { fbErr = true } }
  if (wantsFbPrev) { try { fbPrevM = await source.fb(cid, prev) } catch { fbPrevErr = true } }
  if (wantsLsa) { try { lsa = await source.lsa(cid, cur) } catch { lsaErr = true } }
  if (wantsLsaPrev) { try { lsaPrevM = await source.lsa(cid, prev) } catch { lsaPrevErr = true } }
  void needFb

  const fbAges = ageDays(fb?.connectedAt, now)
  const lsaAges = ageDays(lsa?.connectedAt, now)
  const attachAges = (d: DesiredFlag): DesiredFlag => {
    ;(d.evidence as Record<string, unknown>).__ages = { fb: fbAges, lsa: lsaAges }
    return d
  }

  const fbActive = !!fb && fb.accountInsights.adAccountStatus === "active"
  const lsaActive = !!lsa && lsa.accountInsights?.profileStatus !== "inactive"

  // ===== RED rules =====

  // no_leads: combined FB+LSA leads over the window == 0. Requires ads data with NO error (invariant #1).
  const noLeads = rules.get("no_leads")
  if (noLeads && gate("no_leads")) {
    const hasAdsData = (fb !== null || lsa !== null) && !fbErr && !lsaErr
    if (hasAdsData) {
      const w = noLeads.window_days || 5
      const leads = sumLastDays(fb?.dailyBreakdown, w, "leads") + sumLastDays(lsa?.dailyBreakdown, w, "leads")
      if (leads === 0) out.push(attachAges({ clientId: cid, source: "no_leads", severity: noLeads.severity, message: `No leads from FB/LSA in the last ${w} days`, evidence: { leads: 0, windowDays: w } }))
    }
  }

  // fb_spend_zero: two consecutive complete $0 days on an active account (drops in-progress day, BUG-148).
  const fbSpendZero = rules.get("fb_spend_zero")
  if (fbSpendZero && gate("fb_spend_zero") && fbActive && fb && !fbErr) {
    const today = todayInTimeZone(fb.accountInsights.timezone, now)
    const finding = fbSpendZeroFinding(fb.dailyBreakdown, today)
    if (finding.flag) out.push(attachAges({ clientId: cid, source: "fb_spend_zero", severity: fbSpendZero.severity, message: `Facebook spend was $0 on ${finding.judgedDates.join(" and ")} (campaign may be down)`, evidence: { judgedDates: finding.judgedDates, spend: finding.spend, windowDays: 1 } }))
  }

  // payment_failed: clients.status === 'late'. Client-level; no metric read, no grace.
  const paymentFailed = rules.get("payment_failed")
  if (paymentFailed && client.status === "late") {
    out.push({ clientId: cid, source: "payment_failed", severity: paymentFailed.severity, message: "Stripe payment is late/failed", evidence: { billingStatus: "late" } })
  }

  // fb_cpl_high: current CPL >= multiplier x trailing baseline CPL, guarded by min baseline leads.
  const fbCplHigh = rules.get("fb_cpl_high")
  let fbCplUnhealthy = false
  if (fbCplHigh && gate("fb_cpl_high") && fbActive && fb && !fbErr) {
    const cfg = fbCplHigh.config ?? {}
    const cplMultiplier = num(cfg, "cplMultiplier", num(cfg, "multiplier", 2))
    const baselineDays = Math.round(num(cfg, "baselineDays", 14))
    const currentDays = Math.round(num(cfg, "currentDays", 7))
    const minBaselineLeads = num(cfg, "minBaselineLeads", 5)
    const baseSpend = sumLastDays(fb.dailyBreakdown, baselineDays, "spend"), baseLeads = sumLastDays(fb.dailyBreakdown, baselineDays, "leads")
    const curSpend = sumLastDays(fb.dailyBreakdown, currentDays, "spend"), curLeads = sumLastDays(fb.dailyBreakdown, currentDays, "leads")
    if (baseLeads >= minBaselineLeads && curLeads > 0) {
      const baselineCpl = baseSpend / baseLeads, currentCpl = curSpend / curLeads
      if (baselineCpl > 0 && currentCpl >= cplMultiplier * baselineCpl) {
        fbCplUnhealthy = true
        const ratio = currentCpl / baselineCpl
        out.push(attachAges({ clientId: cid, source: "fb_cpl_high", severity: fbCplHigh.severity, message: `Facebook CPL $${currentCpl.toFixed(2)} (last ${currentDays}d) is ${ratio.toFixed(1)}x the client's ${baselineDays}-day average of $${baselineCpl.toFixed(2)}`, evidence: { currentCpl: round2(currentCpl), baselineCpl: round2(baselineCpl), ratio: round2(ratio), multiplier: cplMultiplier, currentDays, baselineDays, minBaselineLeads } }))
      }
    }
  }

  // fb_no_leads_7d: active account spending but 0 leads in 7d (guard: spend > 0).
  const fbNoLeads = rules.get("fb_no_leads_7d")
  if (fbNoLeads && gate("fb_no_leads_7d") && fbActive && fb && !fbErr) {
    const w = fbNoLeads.window_days || 7
    const spend = sumLastDays(fb.dailyBreakdown, w, "spend"), leads = sumLastDays(fb.dailyBreakdown, w, "leads")
    if (spend > 0 && leads === 0) out.push(attachAges({ clientId: cid, source: "fb_no_leads_7d", severity: fbNoLeads.severity, message: `Facebook spent $${spend.toFixed(2)} but produced 0 leads in ${w} days`, evidence: { spend: round2(spend), leads: 0, windowDays: w } }))
  }

  // lsa_no_impressions: active profile, 0 impressions in 7d.
  const lsaNoImp = rules.get("lsa_no_impressions")
  if (lsaNoImp && gate("lsa_no_impressions") && lsaActive && lsa && !lsaErr) {
    const w = lsaNoImp.window_days || 7
    const imp = sumLastDays(lsa.dailyBreakdown, w, "impressions")
    if (imp === 0) out.push(attachAges({ clientId: cid, source: "lsa_no_impressions", severity: lsaNoImp.severity, message: `LSA profile had 0 impressions in ${w} days`, evidence: { impressions: 0, windowDays: w } }))
  }

  // lsa_no_leads: active profile, 0 leads, age-tiered.
  const lsaNoLeads = rules.get("lsa_no_leads")
  if (lsaNoLeads && gate("lsa_no_leads") && lsaActive && lsa && !lsaErr) {
    const cfg = lsaNoLeads.config ?? {}
    const newAccountDays = num(cfg, "newAccountDays", 90)
    const newNoLeadDays = num(cfg, "newNoLeadDays", 30)
    const oldNoLeadDays = num(cfg, "oldNoLeadDays", 14)
    const age = lsaAges // may be null if connectedAt unknown -> treat as established
    const isNew = age !== null && age < newAccountDays
    const w = isNew ? newNoLeadDays : oldNoLeadDays
    // Require enough history for the window (a brand-new account has no signal yet).
    const enoughHistory = age === null || age >= w
    if (enoughHistory) {
      const leads = sumLastDays(lsa.dailyBreakdown, w, "leads")
      if (leads === 0) out.push(attachAges({ clientId: cid, source: "lsa_no_leads", severity: lsaNoLeads.severity, message: `LSA produced 0 leads in ${w} days`, evidence: { leads: 0, windowDays: w, accountAgeDays: age, tier: isNew ? "new" : "established" } }))
    }
  }

  // campaign_paused: delivered earlier in the month but 0 impressions in the window, no recent note.
  const campaignPaused = rules.get("campaign_paused")
  if (campaignPaused && gate("campaign_paused") && fb && !fbErr) {
    const w = campaignPaused.window_days || 7
    const imp7 = sumLastDays(fb.dailyBreakdown, w, "impressions")
    const imp30 = sumLastDays(fb.dailyBreakdown, 30, "impressions")
    if (imp7 === 0 && imp30 > 0) {
      const pausedWindowDays = num(campaignPaused.config ?? {}, "pausedWindowDays", 7)
      const suppressed = ctx.hasRecentNote ? await ctx.hasRecentNote(cid, pausedWindowDays) : false
      if (!suppressed) out.push(attachAges({ clientId: cid, source: "campaign_paused", severity: campaignPaused.severity, message: `Facebook delivered earlier this month but has had 0 impressions for ${w} days`, evidence: { impressions7: 0, impressions30: imp30, windowDays: w } }))
    }
  }

  // access_lost: a platform mapping is in an error/revoked state (auto), also manual-raiseable.
  const accessLost = rules.get("access_lost")
  if (accessLost && ctx.accessErrors) {
    const platforms = await ctx.accessErrors(cid)
    if (platforms.length > 0) out.push({ clientId: cid, source: "access_lost", severity: accessLost.severity, message: `Platform access revoked or expired: ${platforms.join(", ")}`, evidence: { platforms } })
  }

  // ===== AMBER rules =====

  // fb_ctr_low: link CTR below floor, ONLY when fb_cpl_high is also unhealthy (supporting-metric suppression).
  const fbCtrLow = rules.get("fb_ctr_low")
  if (fbCtrLow && gate("fb_ctr_low") && fbActive && fb && !fbErr && fbCplUnhealthy) {
    const w = fbCtrLow.window_days || 7
    const ctrFloor = num(fbCtrLow.config ?? {}, "ctrFloor", 0.8)
    const ctr = weightedCtr(fb.dailyBreakdown, w)
    if (ctr !== null && ctr < ctrFloor) out.push(attachAges({ clientId: cid, source: "fb_ctr_low", severity: fbCtrLow.severity, message: `Facebook link CTR ${ctr.toFixed(2)}% is below the ${ctrFloor}% floor`, evidence: { ctr: round2(ctr), ctrFloor, windowDays: w } }))
  }

  // lsa_lead_drop: LSA leads down > dropPct MoM, seasonal-hold aware.
  const lsaLeadDrop = rules.get("lsa_lead_drop")
  if (lsaLeadDrop && gate("lsa_lead_drop") && lsa && lsaPrevM && !lsaErr && !lsaPrevErr) {
    const dropPct = num(lsaLeadDrop.config, "dropPct", 30)
    const c = sumLastDays(lsa.dailyBreakdown, 30, "leads"), p = sumLastDays(lsaPrevM.dailyBreakdown, 30, "leads")
    const change = pctChange(c, p)
    if (change !== null && change <= -dropPct && !inWinterHold(lsaLeadDrop.config)) {
      out.push(attachAges({ clientId: cid, source: "lsa_lead_drop", severity: lsaLeadDrop.severity, message: `LSA leads down ${Math.abs(Math.round(change))}% vs the prior 30 days (${p} to ${c})`, evidence: { current: c, previous: p, pct: Math.round(change), dropPct } }))
    }
  }

  // lsa_cpl_up: LSA CPL up > risePct MoM. Skipped if CPL is null either month (zero-lead guard).
  const lsaCplUp = rules.get("lsa_cpl_up")
  if (lsaCplUp && gate("lsa_cpl_up") && lsa && lsaPrevM && !lsaErr && !lsaPrevErr) {
    const risePct = num(lsaCplUp.config, "risePct", 40)
    const curCpl = cpl(lsa.dailyBreakdown), prevCpl = cpl(lsaPrevM.dailyBreakdown)
    if (curCpl !== null && prevCpl !== null) {
      const change = pctChange(curCpl, prevCpl)
      if (change !== null && change >= risePct) out.push(attachAges({ clientId: cid, source: "lsa_cpl_up", severity: lsaCplUp.severity, message: `LSA cost per lead up ${Math.round(change)}% vs the prior 30 days ($${prevCpl.toFixed(2)} to $${curCpl.toFixed(2)})`, evidence: { currentCpl: round2(curCpl), previousCpl: round2(prevCpl), pct: Math.round(change), risePct } }))
    }
  }

  // lead_drop: total FB+LSA leads down > dropPct MoM, seasonal-hold aware.
  const leadDrop = rules.get("lead_drop")
  if (leadDrop && gate("lead_drop")) {
    const adsOk = (fb !== null || lsa !== null) && !fbErr && !lsaErr && !fbPrevErr && !lsaPrevErr
    if (adsOk) {
      const dropPct = num(leadDrop.config, "dropPct", 30)
      const c = sumLastDays(fb?.dailyBreakdown, 30, "leads") + sumLastDays(lsa?.dailyBreakdown, 30, "leads")
      const p = sumLastDays(fbPrevM?.dailyBreakdown, 30, "leads") + sumLastDays(lsaPrevM?.dailyBreakdown, 30, "leads")
      const change = pctChange(c, p)
      if (change !== null && change <= -dropPct && !inWinterHold(leadDrop.config)) {
        out.push(attachAges({ clientId: cid, source: "lead_drop", severity: leadDrop.severity, message: `Total leads down ${Math.abs(Math.round(change))}% vs the prior 30 days (${p} to ${c})`, evidence: { current: c, previous: p, pct: Math.round(change), dropPct } }))
      }
    }
  }

  // seo_traffic_drop: GA4 organic sessions down > dropPct MoM (account-wide aggregate, three-state).
  const seoTraffic = rules.get("seo_traffic_drop")
  if (seoTraffic && gate("seo_traffic_drop") && ctx.ga4Cur && ctx.ga4Prev) {
    const c = ctx.ga4Cur.get(cid), p = ctx.ga4Prev.get(cid)
    if (c && p) {
      const dropPct = num(seoTraffic.config, "dropPct", 20)
      const change = pctChange(c.organicSessions, p.organicSessions)
      if (change !== null && change <= -dropPct) out.push({ clientId: cid, source: "seo_traffic_drop", severity: seoTraffic.severity, message: `Organic sessions down ${Math.abs(Math.round(change))}% vs the prior 30 days (${p.organicSessions} to ${c.organicSessions})`, evidence: { current: c.organicSessions, previous: p.organicSessions, pct: Math.round(change), dropPct } })
    }
  }

  // gbp_views_drop: GBP views down > dropPct MoM.
  const gbpDrop = rules.get("gbp_views_drop")
  if (gbpDrop && gate("gbp_views_drop") && ctx.gbpCur && ctx.gbpPrev) {
    const c = ctx.gbpCur.get(cid), p = ctx.gbpPrev.get(cid)
    if (c && p) {
      const dropPct = num(gbpDrop.config, "dropPct", 20)
      const change = pctChange(c.views, p.views)
      if (change !== null && change <= -dropPct) out.push({ clientId: cid, source: "gbp_views_drop", severity: gbpDrop.severity, message: `GBP views down ${Math.abs(Math.round(change))}% vs the prior 30 days (${p.views} to ${c.views})`, evidence: { current: c.views, previous: p.views, pct: Math.round(change), dropPct } })
    }
  }

  // seo_no_organic_leads (seeded disabled): organic sessions > 0 but 0 organic conversions after min age.
  const seoNoOrganic = rules.get("seo_no_organic_leads")
  if (seoNoOrganic && gate("seo_no_organic_leads") && ctx.ga4Cur) {
    const c = ctx.ga4Cur.get(cid)
    const minAgeDays = num(seoNoOrganic.config, "minAgeDays", 30)
    const age = ctx.serviceStartMs !== null ? Math.floor((now.getTime() - ctx.serviceStartMs) / DAY_MS) : null
    if (c && c.organicSessions > 0 && c.organicConversions === 0 && age !== null && age >= minAgeDays) {
      out.push({ clientId: cid, source: "seo_no_organic_leads", severity: seoNoOrganic.severity, message: `${c.organicSessions} organic sessions but 0 organic conversions (client is ${age}d old)`, evidence: { organicSessions: c.organicSessions, organicConversions: 0, minAgeDays } })
    }
  }

  // seo_no_movement (seeded disabled): every mature keyword flat vs 30d ago.
  const seoNoMovement = rules.get("seo_no_movement")
  if (seoNoMovement && gate("seo_no_movement")) {
    let ranks: SeoRankRow[] | null = null
    try { ranks = await source.seoRanks(cid) } catch { ranks = null } // error -> skip (never false flag)
    if (ranks) {
      const mature = ranks.filter(r => r.rank30dAgo !== null && r.rank !== null)
      if (mature.length > 0) {
        const moved = mature.filter(r => r.rank !== r.rank30dAgo)
        if (moved.length === 0) out.push({ clientId: cid, source: "seo_no_movement", severity: seoNoMovement.severity, message: `No ranking movement across ${mature.length} mature keywords in 30 days`, evidence: { matureKeywords: mature.length, movedKeywords: 0 } })
      }
    }
  }

  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Impression-weighted link CTR (%) over the last `days`; null when there is no delivery. */
function weightedCtr(rows: { date: string; impressions: number; ctr: number; clicks?: number }[] | undefined, days: number): number | null {
  if (!rows || rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days)
  let imp = 0, clicks = 0, weighted = 0, hasClicks = true
  for (const r of sorted) {
    const i = Number(r.impressions) || 0
    imp += i
    if (typeof r.clicks === "number") clicks += r.clicks
    else hasClicks = false
    weighted += (Number(r.ctr) || 0) * i
  }
  if (imp === 0) return null
  return hasClicks ? (clicks / imp) * 100 : weighted / imp
}

/** LSA cost-per-lead over the last 30d; null when leads == 0 (the zero-baseline guard). */
function cpl(rows: { date: string; spend: number; leads: number }[] | undefined): number | null {
  const spend = sumLastDays(rows, 30, "spend"), leads = sumLastDays(rows, 30, "leads")
  if (leads <= 0) return null
  return spend / leads
}

// kpiFlagDepartment is used by the route/notifier layer; re-exported for convenience.
export { kpiFlagDepartment }
