"use client"

// Section 15 — SystemHealthDashboard, restyled into the control-room theme. Auto-refreshes the
// shallow check every 30s, offers a deep-check button, renders integration / cron / env tables
// with hover tooltips (title=) explaining what's wrong and how to fix it.
import { useCallback, useEffect, useState } from "react"

type PingStatus = "ok" | "auth" | "rate_limited" | "unreachable" | "not_configured" | "server_error"
type CronOverall = "ok" | "warn" | "fail"

type IntegrationPing = { key: string; label: string; configured: boolean; status: PingStatus; httpStatus?: number; detail: string; hint: string }
type EnvVarStatus = { name: string; present: boolean; required: boolean; hint: string }
type CronHealth = { source: string; label: string; freshness: string; lastStatus: string | null; lastRanAt: string | null; ageMinutes: number | null; overall: CronOverall; detail: string }

type ShallowResponse = {
  ok: boolean
  env: { ok: boolean; missingRequired: string[]; required: EnvVarStatus[]; optional: EnvVarStatus[] }
  crons: CronHealth[]
  cronsError: string | null
  integrations: IntegrationPing[]
  generatedAt: string
}
type DeepResponse = { ok: boolean; integrations: IntegrationPing[]; generatedAt: string }

// map a state to a semaphore dot color class
const PING_DOT: Record<PingStatus, string> = { ok: "green", auth: "red", rate_limited: "amber", unreachable: "red", not_configured: "slate", server_error: "red" }
const OVERALL_DOT: Record<CronOverall, string> = { ok: "green", warn: "amber", fail: "red" }

function Cell({ dot, text, title }: { dot: string; text: string; title?: string }) {
  return <span className="row gap-8" title={title}><span className={`dot ${dot}`} />{text}</span>
}

export default function SystemHealthDashboard() {
  const [shallow, setShallow] = useState<ShallowResponse | null>(null)
  const [deep, setDeep] = useState<DeepResponse | null>(null)
  const [loadingShallow, setLoadingShallow] = useState(false)
  const [loadingDeep, setLoadingDeep] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadShallow = useCallback(async () => {
    setLoadingShallow(true)
    try { const r = await fetch("/api/system-health/shallow", { cache: "no-store" }); setShallow(await r.json()); setErr(null) }
    catch (e) { setErr(e instanceof Error ? e.message : "failed to load") }
    finally { setLoadingShallow(false) }
  }, [])

  const runDeep = useCallback(async () => {
    setLoadingDeep(true)
    try { const r = await fetch("/api/system-health/deep", { cache: "no-store" }); setDeep(await r.json()) }
    catch (e) { setErr(e instanceof Error ? e.message : "deep check failed") }
    finally { setLoadingDeep(false) }
  }, [])

  useEffect(() => {
    loadShallow()
    const id = setInterval(loadShallow, 30_000)
    return () => clearInterval(id)
  }, [loadShallow])

  const deepByKey = new Map((deep?.integrations ?? []).map(i => [i.key, i]))
  const envVars = [...(shallow?.env.required ?? []), ...(shallow?.env.optional ?? [])]
  const missing = shallow?.env.missingRequired.length ?? 0

  return (
    <>
      <div className="topbar">
        <div>
          <h1>System health</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {shallow ? `Shallow checked ${new Date(shallow.generatedAt).toLocaleTimeString()} · auto-refresh 30s` : "loading…"}
          </p>
        </div>
        <div className="row gap-8">
          {shallow && <span className={`pill ${shallow.ok ? "green" : "red"}`}>{shallow.ok ? "all systems ok" : `${missing} required env missing`}</span>}
          <button className="btn btn-ghost btn-sm" onClick={loadShallow} disabled={loadingShallow}>{loadingShallow ? "Refreshing…" : "Refresh"}</button>
          <button className="btn btn-primary btn-sm" onClick={runDeep} disabled={loadingDeep}>{loadingDeep ? "Probing…" : "Run deep check"}</button>
        </div>
      </div>

      <div className="content">
        {err && <div className="card empty" style={{ color: "var(--red)" }}>{err}</div>}

        {/* Integrations */}
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Integrations</h2>
        <div className="card" style={{ overflow: "hidden", marginBottom: 26 }}>
          <table className="dtable">
            <thead><tr><th>Integration</th><th>Shallow</th><th>Deep probe</th></tr></thead>
            <tbody>
              {(shallow?.integrations ?? []).map(i => {
                const d = deepByKey.get(i.key)
                return (
                  <tr key={i.key}>
                    <td title={i.hint} style={{ fontWeight: 550 }}>{i.label}</td>
                    <td><Cell dot={PING_DOT[i.status]} text={i.status} title={i.detail} /></td>
                    <td>{d ? <Cell dot={PING_DOT[d.status]} text={`${d.status}${d.httpStatus ? ` · ${d.httpStatus}` : ""}`} title={d.detail} /> : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
              {!shallow && <tr><td colSpan={3} className="muted" style={{ padding: 20 }}>loading…</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Crons */}
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Crons</h2>
        {shallow?.cronsError && <div className="card empty" style={{ color: "var(--red)" }}>Could not read cron history: {shallow.cronsError}</div>}
        <div className="card" style={{ overflow: "hidden", marginBottom: 26 }}>
          <table className="dtable">
            <thead><tr><th>Cron</th><th>Status</th><th>Freshness</th><th>Last run</th></tr></thead>
            <tbody>
              {(shallow?.crons ?? []).map(c => (
                <tr key={c.source}>
                  <td style={{ fontWeight: 550 }}>{c.label}<div className="muted mono" style={{ fontSize: 11 }}>{c.source}</div></td>
                  <td><Cell dot={OVERALL_DOT[c.overall]} text={c.overall} title={c.detail} /></td>
                  <td className="num">{c.freshness}</td>
                  <td className="num muted">{c.lastRanAt ? `${c.ageMinutes} min ago` : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Env */}
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Environment {missing > 0 && <span className="pill red" style={{ marginLeft: 8 }}>{missing} missing → 503</span>}</h2>
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="dtable">
            <thead><tr><th>Variable</th><th>Scope</th><th>Present</th></tr></thead>
            <tbody>
              {envVars.map(v => (
                <tr key={v.name}>
                  <td className="mono" title={v.hint}>{v.name}</td>
                  <td>{v.required ? <span className="tag">required</span> : <span className="tag">optional</span>}</td>
                  <td><Cell dot={v.present ? "green" : v.required ? "red" : "slate"} text={v.present ? "yes" : "no"} title={v.present ? "Present." : v.hint} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
