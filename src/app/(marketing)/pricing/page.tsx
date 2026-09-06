import Link from "next/link"

export const metadata = { title: "Pricing — Bellwether" }

const TIERS = [
  {
    name: "Alerts",
    price: "$49", unit: "/ account / mo",
    tagline: "Know a client is failing 48h before they call.",
    featured: false,
    features: [
      "Connect FB, LSA, GA4, GBP, SEO, Stripe",
      "Full red/amber flag catalog with evidence",
      "Slack + email delivery, deduped",
      "Account-age grace & false-positive guards",
      "Snooze / resolve workflow",
    ],
    cta: "Start free",
  },
  {
    name: "Health",
    price: "$99", unit: "/ account / mo",
    tagline: "The whole board — triage, scores, department rollups.",
    featured: true,
    features: [
      "Everything in Alerts",
      "0–100 health score with trend",
      "Worst-first status & triage board",
      "Department health rollups",
      "Per-client rule overrides",
      "Manual flags & audit trail",
    ],
    cta: "Start free",
  },
  {
    name: "Agency",
    price: "Custom", unit: "annual",
    tagline: "Many accounts, per-account thresholds, owner routing.",
    featured: false,
    features: [
      "Everything in Health",
      "Owner routing to team leads",
      "Per-account thresholds at scale",
      "Marketing Data Hub as the metric layer",
      "Multi-tenant billing & SSO",
      "Priority support & onboarding",
    ],
    cta: "Talk to us",
  },
]

export default function Pricing() {
  return (
    <section className="section container">
      <div className="section-head center" style={{ margin: "0 auto 44px" }}>
        <span className="eyebrow">Pricing</span>
        <h2 style={{ marginTop: 12 }}>Priced per account. Cancel anytime.</h2>
        <p style={{ marginLeft: "auto", marginRight: "auto" }}>
          Start on Alerts, grow into the full health board, scale to Agency. The engine is the same
          curated rule catalog underneath every tier.
        </p>
      </div>

      <div className="tiers">
        {TIERS.map(t => (
          <div className={`tier${t.featured ? " featured" : ""}`} key={t.name}>
            {t.featured && <span className="pill badge-featured">Most popular</span>}
            <span className="eyebrow" style={t.featured ? { color: "var(--brand)" } : undefined}>{t.name}</span>
            <div className="price">{t.price} <small>{t.unit}</small></div>
            <p className="muted" style={{ fontSize: 14 }}>{t.tagline}</p>
            <ul>{t.features.map(f => <li key={f}>{f}</li>)}</ul>
            <Link href="/app" className={`btn ${t.featured ? "btn-brand" : "btn-ghost"}`} style={{ marginTop: "auto", justifyContent: "center" }}>{t.cta}</Link>
          </div>
        ))}
      </div>

      <div className="card card-pad" style={{ marginTop: 32 }}>
        <div className="spread wrap gap-16">
          <div style={{ maxWidth: "52ch" }}>
            <h3 style={{ fontSize: 20 }}>Bundled with the Marketing Data Hub</h3>
            <p className="muted" style={{ marginTop: 8, fontSize: 15 }}>
              Bellwether&apos;s value depends on a reliable metric layer. Agencies run it best on top of
              the Data Hub — one connection layer feeding both products.
            </p>
          </div>
          <Link href="/pricing" className="btn btn-ghost">Learn more →</Link>
        </div>
      </div>
    </section>
  )
}
