"use client"

import { useMemo, useState } from "react"
import type { ClientRuleView } from "@/lib/rules"
import { apiFetch } from "./api"

type Filter = "all" | "red" | "amber" | "overridden"

export default function RuleEditor({ clientId, initial }: { clientId: string; initial: ClientRuleView[] }) {
  const [rules, setRules] = useState<ClientRuleView[]>(initial)
  const [filter, setFilter] = useState<Filter>("all")
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => rules.filter(r => {
    if (filter === "overridden") return r.overridden
    if (filter === "red") return r.effective.severity === "red"
    if (filter === "amber") return r.effective.severity === "amber"
    return true
  }), [rules, filter])

  const overriddenCount = rules.filter(r => r.overridden).length

  function patchLocal(ruleKey: string, apply: (r: ClientRuleView) => ClientRuleView) {
    setRules(prev => prev.map(r => (r.ruleKey === ruleKey ? apply(r) : r)))
  }

  async function putOverride(rule: ClientRuleView, patch: { enabled?: boolean; config?: Record<string, unknown> }) {
    setBusy(rule.ruleKey)
    try {
      await apiFetch(`/api/rules/${rule.ruleKey}?clientId=${encodeURIComponent(clientId)}`, { method: "PUT", body: JSON.stringify(patch) })
    } finally { setBusy(null) }
  }

  async function toggle(rule: ClientRuleView) {
    const enabled = !rule.effective.enabled
    patchLocal(rule.ruleKey, r => ({ ...r, overridden: true, effective: { ...r.effective, enabled } }))
    await putOverride(rule, { enabled })
  }

  async function setConfig(rule: ClientRuleView, key: string, raw: string) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    const config = { ...rule.effective.config, [key]: value }
    patchLocal(rule.ruleKey, r => ({ ...r, overridden: true, effective: { ...r.effective, config } }))
    await putOverride(rule, { config })
  }

  async function reset(rule: ClientRuleView) {
    setBusy(rule.ruleKey)
    try {
      await apiFetch(`/api/rules/${rule.ruleKey}?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" })
      patchLocal(rule.ruleKey, r => ({ ...r, overridden: false, effective: { ...r.global } }))
    } finally { setBusy(null) }
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="seg">
          {(["all", "red", "amber", "overridden"] as Filter[]).map(f => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "overridden" ? `Overridden${overriddenCount ? ` · ${overriddenCount}` : ""}` : f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Overrides win over the global catalog for this client only.</span>
      </div>

      {shown.map(r => {
        const numericKeys = Object.entries(r.effective.config).filter(([, v]) => typeof v === "number").map(([k]) => k)
        return (
          <div className={`rule-row${r.overridden ? " overridden" : ""}`} key={r.ruleKey}>
            <div style={{ minWidth: 0 }}>
              <div className="row gap-8">
                <span className={`dot ${r.effective.severity === "red" ? "red" : "amber"}`} />
                <span className="rk">{r.ruleKey}</span>
                {r.overridden && <span className="pill" style={{ fontSize: 11 }}>overridden</span>}
              </div>
              <div className="rl">{r.label}</div>
            </div>

            <div className="row gap-16 wrap">
              {numericKeys.map(k => (
                <div className="field" key={k}>
                  <label>{k}</label>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    defaultValue={String(r.effective.config[k] as number)}
                    disabled={busy === r.ruleKey}
                    onBlur={e => { if (e.target.value !== String(r.effective.config[k])) setConfig(r, k, e.target.value) }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
                  />
                </div>
              ))}
              {numericKeys.length === 0 && <span className="tag">no thresholds</span>}
            </div>

            <div className="row gap-8">
              {r.overridden && <button className="btn btn-ghost btn-sm" disabled={busy === r.ruleKey} onClick={() => reset(r)}>Reset</button>}
            </div>

            <button
              className={`toggle${r.effective.enabled ? " on" : ""}`}
              aria-label={r.effective.enabled ? "disable rule" : "enable rule"}
              disabled={busy === r.ruleKey}
              onClick={() => toggle(r)}
            />
          </div>
        )
      })}
    </div>
  )
}
