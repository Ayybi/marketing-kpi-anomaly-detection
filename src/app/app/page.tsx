import Link from "next/link"
import { getStatusBoard } from "@/lib/status-board"
import { HealthRing, Money, ServiceTags, StagePill } from "@/components/app/ui"

export const dynamic = "force-dynamic"

export default async function TriagePage() {
  const { rows, summary } = await getStatusBoard()

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Triage</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>Worst-health first. {summary.clients} live clients.</p>
        </div>
        <div className="row gap-12">
          <span className="pill red">{summary.red} red</span>
          <span className="pill amber">{summary.amber} amber</span>
          <Link href="/app/rules" className="btn btn-ghost btn-sm">Rule config</Link>
        </div>
      </div>

      <div className="content">
        <div className="stats">
          <Stat k="Clients live" v={String(summary.clients)} />
          <Stat k="Open red flags" v={String(summary.red)} tone={summary.red ? "red" : undefined} />
          <Stat k="Open amber flags" v={String(summary.amber)} tone={summary.amber ? "amber" : undefined} />
          <Stat k="MRR at risk" v={`$${summary.mrrAtRisk.toLocaleString("en-US")}`} sub={summary.avgScore !== null ? `avg score ${summary.avgScore}` : undefined} />
        </div>

        {rows.length === 0 ? (
          <div className="card empty">
            <p>No clients yet. Run <code>npm run seed:demo</code> to load a sample roster, then refresh.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Health</th>
                  <th>Client</th>
                  <th>Stage</th>
                  <th>Services</th>
                  <th style={{ textAlign: "right" }}>MRR</th>
                  <th style={{ textAlign: "right" }}>Flags</th>
                  <th style={{ width: 90 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.clientId}>
                    <td><HealthRing score={r.score} band={r.band} /></td>
                    <td>
                      <Link href={`/app/clients/${r.clientId}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>{r.daysInStage !== null ? `${r.daysInStage}d since touch` : "—"}</div>
                    </td>
                    <td><StagePill stage={r.stage} status={r.status} /></td>
                    <td><ServiceTags services={r.services} /></td>
                    <td style={{ textAlign: "right" }}><Money value={r.mrr} /></td>
                    <td style={{ textAlign: "right" }}>
                      <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
                        {r.red > 0 && <span className="pill red">{r.red}</span>}
                        {r.amber > 0 && <span className="pill amber">{r.amber}</span>}
                        {r.red === 0 && r.amber === 0 && <span className="pill green">clear</span>}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/app/clients/${r.clientId}`} className="btn btn-ghost btn-sm">Open →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "var(--red)" : tone === "amber" ? "var(--amber)" : undefined
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v" style={color ? { color } : undefined}>{v} {sub && <small>{sub}</small>}</div>
    </div>
  )
}
