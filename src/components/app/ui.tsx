import type { HealthBand } from "@/lib/types"

const BAND_COLOR: Record<HealthBand, string> = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" }

export function bandOf(score: number | null): HealthBand | null {
  if (score === null) return null
  if (score >= 80) return "green"
  if (score >= 50) return "amber"
  return "red"
}

export function HealthRing({ score, band, lg = false }: { score: number | null; band: HealthBand | null; lg?: boolean }) {
  const b = band ?? bandOf(score)
  const col = b ? BAND_COLOR[b] : "var(--muted-2)"
  const pct = score ?? 0
  return (
    <div className={`ring${lg ? " lg" : ""}`} style={{ ["--pct" as string]: pct, ["--col" as string]: col }} title={b ? `${score} / 100 · ${b}` : "no score yet"}>
      <div className="inner">{score ?? "—"}</div>
    </div>
  )
}

export function Money({ value }: { value: number }) {
  return <span className="num">${value.toLocaleString("en-US")}</span>
}

export function ServiceTags({ services }: { services: string[] }) {
  if (services.length === 0) return <span className="muted" style={{ fontSize: 13 }}>—</span>
  return (
    <span className="row gap-8 wrap">
      {services.map(s => <span className="tag" key={s}>{s}</span>)}
    </span>
  )
}

export function StagePill({ stage, status }: { stage: string | null; status: string | null }) {
  const late = status === "late"
  return (
    <span className="row gap-8">
      <span className="tag">{stage ?? "—"}</span>
      {late && <span className="pill red">late</span>}
    </span>
  )
}
