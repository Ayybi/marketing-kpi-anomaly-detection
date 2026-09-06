"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { KpiFlag } from "@/lib/types"
import { apiFetch } from "./api"

const HIDDEN_EVIDENCE = new Set(["manual", "raisedBy", "__ages"])

function evidenceChips(evidence: Record<string, unknown>) {
  return Object.entries(evidence)
    .filter(([k]) => !HIDDEN_EVIDENCE.has(k))
    .map(([k, v]) => {
      const val = typeof v === "number" ? (Number.isInteger(v) ? v : Math.round(v * 100) / 100) : String(v)
      return <span className="chip" key={k}>{k} {val}</span>
    })
}

export default function FlagList({ flags }: { flags: KpiFlag[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  async function act(id: string, path: string, body?: object) {
    setBusy(id)
    try {
      const res = await apiFetch(`/api/kpi-flags/${id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined })
      if (res.ok) router.refresh()
    } finally {
      setBusy(null)
    }
  }

  if (flags.length === 0) {
    return <div className="card empty"><span className="dot green" style={{ marginRight: 8 }} />No open flags. This client is clear.</div>
  }

  return (
    <div>
      {flags.map(f => {
        const manual = (f.evidence as { manual?: boolean })?.manual === true
        const snoozed = f.status === "snoozed"
        return (
          <div className={`flag ${f.severity}${snoozed ? " snoozed" : ""}`} key={f.id}>
            <span className={`dot ${f.severity}${f.severity === "red" ? " pulse" : ""}`} style={{ marginTop: 6 }} />
            <div style={{ minWidth: 0 }}>
              <div className="fmsg">{f.message}</div>
              <div className="fsub">
                {f.source}{manual ? " · manual" : ""}{snoozed && f.snoozedUntil ? ` · snoozed until ${new Date(f.snoozedUntil).toLocaleDateString()}` : ""}
              </div>
              <div className="fev">{evidenceChips(f.evidence)}</div>
            </div>
            <div className="factions">
              {snoozed ? (
                <button className="btn btn-ghost btn-sm" disabled={busy === f.id} onClick={() => act(f.id, "unsnooze")}>Unsnooze</button>
              ) : (
                <>
                  <button className="btn btn-ghost btn-sm" disabled={busy === f.id} onClick={() => act(f.id, "snooze", { days: 7 })}>Snooze 7d</button>
                  <button className="btn btn-primary btn-sm" disabled={busy === f.id} onClick={() => act(f.id, "resolve")}>Resolve</button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
