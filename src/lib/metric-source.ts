// B11 — The MetricSource adapter (NEW code). The engine's only external dependency.
//
// THREE-STATE READ CONTRACT (invariant #1 / Section 16): every method is
//   present  -> return the object / a populated Map entry (real data, incl. an authoritative 0)
//   absent   -> return null / omit the Map key (NOT CONNECTED — nothing to evaluate)
//   error    -> THROW, so the engine skips that read for that client and never emits a false 0.
// A connector failure must never surface as "0 leads". The engine wraps each call in try/catch
// and, on throw, drops every rule that depends on the errored signal for that client.

export type MetricDay = {
  date: string // YYYY-MM-DD
  leads: number
  spend: number
  impressions: number
  ctr: number // link CTR, as a percentage (e.g. 1.2 == 1.2%)
  clicks?: number
}

export type FbMetrics = {
  dailyBreakdown: MetricDay[]
  accountInsights: { adAccountStatus: "active" | "inactive" | string; timezone?: string | null }
  connectedAt?: string | null
}

export type LsaMetrics = {
  dailyBreakdown: MetricDay[]
  accountInsights?: { profileStatus?: "active" | "inactive" | string }
  connectedAt?: string | null
}

export type Ga4Metrics = {
  organicSessions: number
  organicConversions: number
}

export type GbpMetrics = {
  views: number
}

export type SeoRankRow = {
  keyword: string
  rank: number | null
  rank30dAgo: number | null
  firstSeenAt?: string | null
}

export type MetricWindow = { from: string; to: string }

export interface KpiMetricSource {
  // Per-client FB/LSA metrics, or null when the account is NOT CONNECTED (absent). Throw on read ERROR.
  fb(clientId: string, window: MetricWindow): Promise<FbMetrics | null>
  lsa(clientId: string, window: MetricWindow): Promise<LsaMetrics | null>
  // Account-wide aggregates keyed by clientId. A missing key == absent for that client. Throw on ERROR.
  ga4Aggregate(window: MetricWindow): Promise<Map<string, Ga4Metrics>>
  gbpAggregate(window: MetricWindow): Promise<Map<string, GbpMetrics>>
  // Per-client SEO ranks, or null when SEO is not connected (absent). Throw on ERROR.
  seoRanks(clientId: string): Promise<SeoRankRow[] | null>
}

/**
 * A supplied-metrics adapter (Phase-1 in the roadmap): back the engine with metrics you push in,
 * or a subset of them. Any read you do not provide defaults to ABSENT (null / empty Map), never a
 * fabricated zero. To signal an ERROR, have your provider throw — it propagates unchanged so the
 * engine's per-read guard can skip the affected client. Plug your Data Hub / connectors here.
 */
export type MetricProviders = Partial<KpiMetricSource>

export class SuppliedMetricSource implements KpiMetricSource {
  constructor(private readonly providers: MetricProviders = {}) {}

  fb(clientId: string, window: MetricWindow): Promise<FbMetrics | null> {
    return this.providers.fb ? this.providers.fb(clientId, window) : Promise.resolve(null)
  }
  lsa(clientId: string, window: MetricWindow): Promise<LsaMetrics | null> {
    return this.providers.lsa ? this.providers.lsa(clientId, window) : Promise.resolve(null)
  }
  ga4Aggregate(window: MetricWindow): Promise<Map<string, Ga4Metrics>> {
    return this.providers.ga4Aggregate ? this.providers.ga4Aggregate(window) : Promise.resolve(new Map())
  }
  gbpAggregate(window: MetricWindow): Promise<Map<string, GbpMetrics>> {
    return this.providers.gbpAggregate ? this.providers.gbpAggregate(window) : Promise.resolve(new Map())
  }
  seoRanks(clientId: string): Promise<SeoRankRow[] | null> {
    return this.providers.seoRanks ? this.providers.seoRanks(clientId) : Promise.resolve(null)
  }
}
