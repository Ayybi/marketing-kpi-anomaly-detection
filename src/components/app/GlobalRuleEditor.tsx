"use client"

import { useMemo, useState } from "react"
import type { KpiRuleRow } from "@/lib/types"
import { apiFetch } from "./api"

type Filter = "all" | "red" | "amber" | "disabled"

export default function GlobalRuleEditor({ initial }: { initial: KpiRuleRow[] }) {
  const [rules, setRules] = useState<KpiRuleRow[]>(initial)
  const [filter, setFilter] = useState<Filter>("all")
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => rules.filter(r => {
    if (filter === "disabled") return !r.enabled
    if (filter === "red") return r.severity === "red"
    if (filter === "amber") return r.severity === "amber"
    return true
  }), [rules, filter])

  function patchLocal(key: string, apply: (r: KpiRuleRow) => KpiRuleRow) {
    setRules(prev => prev.map(r => (r.rule_key === key ? apply(r) : r)))
  }

  async function patch(rule: KpiRuleRow, body: { enabled?: boolean; config?: Record<string, unknown> }) {
    setBusy(rule.rule_key)
    try { await apiFetch(`/api/rules/${rule.rule_key}`, { method: "PATCH", body: JSON.stringify(body) }) }
    finally { setBusy(null) }
  }

  async function toggle(rule: KpiRuleRow) {
    const enabled = !rule.enabled
    patchLocal(rule.rule_key, r => ({ ...r, enabled }))
    await patch(rule, { enabled })
  }

  async function setConfig(rule: KpiRuleRow, key: string, raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    const config = { ...rule.config, [key]: value }
    patchLocal(rule.rule_key, r => ({ ...r, config }))
    await patch(rule, { config })
  }

  const disabledCount = rules.filter(r => !r.enabled).length

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="seg">
          {(["all", "red", "amber", "disabled"] as Filter[]).map(f => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "disabled" ? `Disabled${disabledCount ? ` · ${disabledCount}` : ""}` : f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Global defaults. Per-client overrides live on each client&apos;s profile.</span>
      </div>

      {shown.map(r => {
        const numericKeys = Object.entries(r.config ?? {}).filter(([, v]) => typeof v === "number").map(([k]) => k)
        return (
          <div className="rule-row" key={r.rule_key} style={!r.enabled ? { opacity: 0.6 } : undefined}>
            <div style={{ minWidth: 0 }}>
              <div className="row gap-8">
                <span className={`dot ${r.severity === "red" ? "red" : "amber"}`} />
                <span className="rk">{r.rule_key}</span>
                {r.service && <span className="tag">{r.service}</span>}
                {r.window_days > 0 && <span className="tag">{r.window_days}d</span>}
              </div>
              <div className="rl">{r.label}</div>
            </div>

            <div className="row gap-16 wrap">
              {numericKeys.map(k => (
                <div className="field" key={k}>
                  <label>{k}</label>
                  <input
                    className="input" type="number" step="any"
                    defaultValue={String(r.config[k] as number)}
                    disabled={busy === r.rule_key}
                    onBlur={e => { if (e.target.value !== String(r.config[k])) setConfig(r, k, e.target.value) }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  />
                </div>
              ))}
              {numericKeys.length === 0 && <span className="tag">no thresholds</span>}
            </div>

            <div />
            <button className={`toggle${r.enabled ? " on" : ""}`} aria-label="toggle rule" disabled={busy === r.rule_key} onClick={() => toggle(r)} />
          </div>
        )
      })}
    </div>
  )
}
