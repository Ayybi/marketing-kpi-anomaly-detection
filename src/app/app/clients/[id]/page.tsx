import Link from "next/link"
import { notFound } from "next/navigation"
import { getClientOverview } from "@/lib/status-board"
import { listClientFlags } from "@/lib/kpi-flags"
import { listClientRules } from "@/lib/rules"
import { HealthRing, Money, ServiceTags, StagePill } from "@/components/app/ui"
import FlagList from "@/components/app/FlagList"
import RuleEditor from "@/components/app/RuleEditor"
import RaiseFlag from "@/components/app/RaiseFlag"

export const dynamic = "force-dynamic"

export default async function ClientProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [overview, flags, rules] = await Promise.all([
    getClientOverview(id),
    listClientFlags(id),
    listClientRules(id),
  ])
  if (!overview) notFound()

  const red = flags.filter(f => f.severity === "red" && f.status === "open").length
  const amber = flags.filter(f => f.severity === "amber" && f.status === "open").length

  return (
    <>
      <div className="topbar">
        <div className="row gap-12">
          <Link href="/app" className="btn btn-ghost btn-sm">← Triage</Link>
          <h1>{overview.name}</h1>
        </div>
        <RaiseFlag clientId={id} />
      </div>

      <div className="content">
        {/* header card */}
        <div className="card card-pad" style={{ marginBottom: 26 }}>
          <div className="spread wrap gap-24">
            <div className="row gap-24">
              <HealthRing score={overview.score} band={overview.band} lg />
              <div className="stack gap-8">
                <StagePill stage={overview.stage} status={overview.status} />
                <ServiceTags services={overview.services} />
                <div className="row gap-16" style={{ marginTop: 4 }}>
                  <span className="muted mono" style={{ fontSize: 12 }}>MRR <Money value={overview.mrr} /></span>
                  <span className="muted mono" style={{ fontSize: 12 }}>{overview.daysSinceTouch !== null ? `${overview.daysSinceTouch}d since touch` : "no touch logged"}</span>
                </div>
              </div>
            </div>
            <div className="row gap-8">
              {red > 0 && <span className="pill red">{red} red</span>}
              {amber > 0 && <span className="pill amber">{amber} amber</span>}
              {red === 0 && amber === 0 && <span className="pill green">clear</span>}
              {overview.billingLate && <span className="pill red">billing late</span>}
            </div>
          </div>
        </div>

        <div className="grid-2" style={{ alignItems: "start" }}>
          {/* flags */}
          <section>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 18 }}>Open flags</h2>
              <span className="muted" style={{ fontSize: 12 }}>{flags.length} active</span>
            </div>
            <FlagList flags={flags} />
          </section>

          {/* rules */}
          <section>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 18 }}>Rule set</h2>
              <span className="muted" style={{ fontSize: 12 }}>this client&apos;s effective rules</span>
            </div>
            <RuleEditor clientId={id} initial={rules} />
          </section>
        </div>
      </div>
    </>
  )
}
