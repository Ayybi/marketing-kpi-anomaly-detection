"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "./api"

// Manual flags: only client_dissatisfied | access_lost may be raised by a person (Section 6).
const SOURCES = [
  { value: "client_dissatisfied", label: "Client dissatisfied" },
  { value: "access_lost", label: "Access lost" },
]

export default function RaiseFlag({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(SOURCES[0]!.value)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!message.trim()) return
    setBusy(true)
    try {
      const res = await apiFetch("/api/kpi-flags", { method: "POST", body: JSON.stringify({ clientId, source, severity: "red", message }) })
      if (res.ok) { setOpen(false); setMessage(""); router.refresh() }
    } finally { setBusy(false) }
  }

  if (!open) return <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>+ Raise flag</button>

  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div className="row gap-12 wrap">
        <select className="input" style={{ width: 190 }} value={source} onChange={e => setSource(e.target.value)}>
          {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 200, width: "auto" }} placeholder="What happened?" value={message} onChange={e => setMessage(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={busy || !message.trim()} onClick={submit}>Raise</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}
