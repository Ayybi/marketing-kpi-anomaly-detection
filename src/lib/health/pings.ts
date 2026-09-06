// Section 15 — pings.ts. Two modes:
//   shallow: config-only (is the integration configured?), cheap, for frequent uptime checks.
//   deep:    a read-only live probe per integration, 6s timeout, classified into six states.
// Never touches per-client data, never writes.
//
// Three-state discipline, generalised to six states so a failure is never mistaken for "healthy"
// or "empty": ok | auth | rate_limited | server_error | unreachable | not_configured.
import { getMongoClient } from "@/lib/mongo"

export type PingStatus = "ok" | "auth" | "rate_limited" | "unreachable" | "not_configured" | "server_error"
export type IntegrationKey =
  | "stripe" | "meta" | "ga4" | "gbp" | "semrush" | "callrail" | "anthropic" | "resend" | "mongodb"

export type IntegrationPing = {
  key: IntegrationKey
  label: string
  configured: boolean
  status: PingStatus
  httpStatus?: number
  detail: string
  hint: string
}

type HttpRequest = { url: string; headers?: Record<string, string> }

type IntegrationSpec = {
  key: IntegrationKey
  label: string
  envVars: string[] // configured when ALL are present
  hint: string
  /** Build the deep-probe request from env, or null when not applicable (e.g. mongodb, handled specially). */
  request?: (env: Record<string, string | undefined>) => HttpRequest
}

const SPECS: IntegrationSpec[] = [
  { key: "stripe", label: "Stripe", envVars: ["STRIPE_SECRET_KEY"], hint: "Billing/payment status. Fix: verify STRIPE_SECRET_KEY and Stripe API availability.",
    request: (e) => ({ url: "https://api.stripe.com/v1/balance", headers: { Authorization: `Bearer ${e.STRIPE_SECRET_KEY}` } }) },
  { key: "meta", label: "Meta / Facebook Ads", envVars: ["META_ACCESS_TOKEN"], hint: "FB ad metrics. Fix: refresh the Meta system-user token (tokens expire).",
    request: (e) => ({ url: `https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(e.META_ACCESS_TOKEN ?? "")}` }) },
  { key: "ga4", label: "Google Analytics 4", envVars: ["GA4_CREDENTIALS"], hint: "Organic sessions. Deep probe tests host reachability; auth needs a signed service-account JWT.",
    request: () => ({ url: "https://analyticsdata.googleapis.com/$discovery/rest?version=v1beta" }) },
  { key: "gbp", label: "Google Business Profile", envVars: ["GBP_CREDENTIALS"], hint: "GBP views. Deep probe tests host reachability; auth needs a signed service-account JWT.",
    request: () => ({ url: "https://mybusinessbusinessinformation.googleapis.com/$discovery/rest?version=v1" }) },
  { key: "semrush", label: "SEMrush", envVars: ["SEMRUSH_API_KEY"], hint: "SEO ranks. Fix: verify SEMRUSH_API_KEY and remaining API units.",
    request: (e) => ({ url: `https://api.semrush.com/?type=domain_ranks&database=us&domain=example.com&key=${encodeURIComponent(e.SEMRUSH_API_KEY ?? "")}` }) },
  { key: "callrail", label: "CallRail", envVars: ["CALLRAIL_API_KEY"], hint: "Call tracking. Fix: verify CALLRAIL_API_KEY.",
    request: (e) => ({ url: "https://api.callrail.com/v3/a.json", headers: { Authorization: `Token token=${e.CALLRAIL_API_KEY}` } }) },
  { key: "anthropic", label: "Anthropic", envVars: ["ANTHROPIC_API_KEY"], hint: "AI features. Fix: verify ANTHROPIC_API_KEY.",
    request: (e) => ({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": e.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" } }) },
  { key: "resend", label: "Resend", envVars: ["RESEND_API_KEY"], hint: "Email delivery. Fix: verify RESEND_API_KEY.",
    request: (e) => ({ url: "https://api.resend.com/domains", headers: { Authorization: `Bearer ${e.RESEND_API_KEY}` } }) },
  { key: "mongodb", label: "MongoDB", envVars: ["MONGODB_URI"], hint: "Persistence. Fix: verify MONGODB_URI and that the database is reachable." },
]

function isConfigured(spec: IntegrationSpec, env: Record<string, string | undefined>): boolean {
  return spec.envVars.every(v => typeof env[v] === "string" && env[v]!.trim() !== "")
}

/** Map an HTTP status code to one of the six ping states. */
export function classifyHttpStatus(status: number): PingStatus {
  if (status >= 200 && status < 300) return "ok"
  if (status === 401 || status === 403) return "auth"
  if (status === 429) return "rate_limited"
  if (status >= 500) return "server_error"
  return "server_error" // any other unexpected response (4xx/3xx) — reachable but not healthy
}

export type ProbeDeps = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** A single read-only HTTP probe with a hard timeout. Never throws — always resolves to a state. */
export async function probeHttp(
  req: HttpRequest,
  deps: ProbeDeps = {},
): Promise<{ status: PingStatus; httpStatus?: number; detail: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const timeoutMs = deps.timeoutMs ?? 6_000
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchImpl(req.url, { method: "GET", headers: req.headers, signal: ac.signal, redirect: "follow" })
    return { status: classifyHttpStatus(res.status), httpStatus: res.status, detail: `HTTP ${res.status}` }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError"
    return { status: "unreachable", detail: aborted ? `timeout after ${timeoutMs}ms` : (err instanceof Error ? err.message : "network error") }
  } finally {
    clearTimeout(timer)
  }
}

export type ShallowOptions = { env?: Record<string, string | undefined> }

/** SHALLOW: config-only. Every integration is either configured (ok) or not_configured. No network. */
export function shallowPing(opts: ShallowOptions = {}): IntegrationPing[] {
  const env = opts.env ?? process.env
  return SPECS.map(spec => {
    const configured = isConfigured(spec, env)
    return {
      key: spec.key,
      label: spec.label,
      configured,
      status: configured ? "ok" : "not_configured",
      detail: configured ? "Configured." : `Not configured — missing ${spec.envVars.join(", ")}.`,
      hint: spec.hint,
    }
  })
}

export type DeepOptions = {
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Redirect HTTP probes (used by tests to point at a local fake server). */
  endpointOverride?: (key: IntegrationKey, req: HttpRequest) => HttpRequest
  /** Override the mongodb probe (tests). */
  probeMongo?: (deps: ProbeDeps) => Promise<{ status: PingStatus; detail: string }>
  /** Limit which integrations to probe (tests / partial checks). */
  only?: IntegrationKey[]
}

async function defaultProbeMongo(deps: ProbeDeps): Promise<{ status: PingStatus; detail: string }> {
  const timeoutMs = deps.timeoutMs ?? 6_000
  try {
    const client = await getMongoClient()
    const ping = client.db().command({ ping: 1 })
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))
    await Promise.race([ping, timeout])
    return { status: "ok", detail: "ping ok" }
  } catch (err) {
    return { status: "unreachable", detail: err instanceof Error ? err.message : "unreachable" }
  }
}

/** DEEP: a read-only live probe per configured integration, classified into the six states. */
export async function deepPing(opts: DeepOptions = {}): Promise<IntegrationPing[]> {
  const env = opts.env ?? process.env
  const deps: ProbeDeps = { fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs }
  const specs = opts.only ? SPECS.filter(s => opts.only!.includes(s.key)) : SPECS

  return Promise.all(specs.map(async (spec): Promise<IntegrationPing> => {
    const configured = isConfigured(spec, env)
    if (!configured) {
      return { key: spec.key, label: spec.label, configured: false, status: "not_configured", detail: `Not configured — missing ${spec.envVars.join(", ")}.`, hint: spec.hint }
    }

    if (spec.key === "mongodb") {
      const probe = opts.probeMongo ?? defaultProbeMongo
      const r = await probe(deps)
      return { key: spec.key, label: spec.label, configured: true, status: r.status, detail: r.detail, hint: spec.hint }
    }

    let req = spec.request!(env)
    if (opts.endpointOverride) req = opts.endpointOverride(spec.key, req)
    const r = await probeHttp(req, deps)
    return { key: spec.key, label: spec.label, configured: true, status: r.status, httpStatus: r.httpStatus, detail: r.detail, hint: spec.hint }
  }))
}

export const INTEGRATION_KEYS: IntegrationKey[] = SPECS.map(s => s.key)
