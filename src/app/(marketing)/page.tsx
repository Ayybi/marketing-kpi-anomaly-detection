import Link from "next/link"

const TICKER = [
  { sev: "red", text: "summit-roofing · no_leads · 0 leads / 5d" },
  { sev: "amber", text: "bluepeak-hvac · seo_traffic_drop · −34% MoM" },
  { sev: "red", text: "coastal-dental · fb_cpl_high · 3.2× baseline" },
  { sev: "amber", text: "ironclad-pest · lsa_lead_drop · −44% MoM" },
  { sev: "red", text: "granite-garage · campaign_paused · 0 impr / 7d" },
  { sev: "amber", text: "apex-autoglass · fb_ctr_low · 0.42%" },
]

const RULES = [
  { key: "no_leads", sev: "red", desc: "Combined FB + LSA leads hit zero", win: "5d" },
  { key: "fb_cpl_high", sev: "red", desc: "CPL ≥ 2× the trailing baseline", win: "30d" },
  { key: "fb_spend_zero", sev: "red", desc: "Two complete $0 days on an active account", win: "1d" },
  { key: "campaign_paused", sev: "red", desc: "Delivered, then 0 impressions — no note", win: "7d" },
  { key: "lsa_lead_drop", sev: "amber", desc: "LSA leads down > 30% month-over-month", win: "30d" },
  { key: "seo_traffic_drop", sev: "amber", desc: "Organic sessions down > 20% MoM", win: "30d" },
  { key: "gbp_views_drop", sev: "amber", desc: "Google Business views down > 20% MoM", win: "30d" },
  { key: "payment_failed", sev: "red", desc: "Billing status went late", win: "—" },
]

export default function Landing() {
  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Early-warning for account health</span>
            <h1 style={{ marginTop: 16 }}>
              Know a client is <span className="hl">failing</span> 48 hours before they call.
            </h1>
            <p className="lede">
              Bellwether watches every live campaign — Facebook, LSA, GA4, GBP, SEO, Stripe — and
              raises a flag the moment something breaks, with the exact numbers that tripped it.
            </p>
            <div className="cta-row">
              <Link href="/app" className="btn btn-brand">Open the triage board →</Link>
              <Link href="/pricing" className="btn btn-ghost">See pricing</Link>
            </div>
            <p className="fineprint">No credit card · connect an account · flags within minutes</p>
          </div>

          {/* live "flag stream" preview panel */}
          <div className="panel" aria-hidden>
            <div className="phead">
              <span className="title">At-risk · live</span>
              <span className="mono" style={{ color: "#6ee7a0", fontSize: 12 }}>● reconciled</span>
            </div>
            <div className="flagcard red">
              <div className="row gap-8"><span className="dot red pulse" /><span className="mono" style={{ fontSize: 11, color: "#ff8a80" }}>RED · fb_cpl_high</span></div>
              <div className="fmsg">Facebook CPL $184.00 is 3.2× the 14-day average of $57.50</div>
              <div className="fev">
                <span className="chip">currentCpl 184</span><span className="chip">baselineCpl 57.5</span><span className="chip">ratio 3.2</span>
              </div>
            </div>
            <div className="flagcard amber">
              <div className="row gap-8"><span className="dot amber" /><span className="mono" style={{ fontSize: 11, color: "#f4bf6a" }}>AMBER · lsa_lead_drop</span></div>
              <div className="fmsg">LSA leads down 44% vs the prior 30 days (63 → 35)</div>
              <div className="fev"><span className="chip">current 35</span><span className="chip">previous 63</span><span className="chip">pct −44</span></div>
            </div>
            <div className="row spread" style={{ marginTop: 14 }}>
              <span className="mono" style={{ fontSize: 11, color: "#8b8f9a" }}>health score</span>
              <span className="mono" style={{ fontSize: 13, color: "#ff8a80" }}>25 / 100 · red</span>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <div className="ticker" aria-hidden>
        <div className="track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span className="item" key={i}><span className={`dot ${t.sev}`} />{t.text}</span>
          ))}
        </div>
      </div>

      {/* PROBLEM */}
      <section className="section container">
        <div className="section-head">
          <span className="eyebrow">The gap</span>
          <h2>Your dashboards are honest. They just tell you too late.</h2>
          <p>
            By the time a monthly report shows the dip, the client has already noticed. Bellwether is
            Gainsight for marketing campaigns — a curated rule set with the right thresholds, grace
            periods and suppression logic, learned from real false positives.
          </p>
        </div>
        <div className="grid-3">
          <Stat k="Lead time" v="24–48h" note="before the client feels it" />
          <Stat k="Signals watched" v="6" note="FB · LSA · GA4 · GBP · SEO · Stripe" />
          <Stat k="False-positive guards" v="6" note="grace · baseline · seasonal · suppression" />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="section container" id="how">
        <div className="section-head">
          <span className="eyebrow">How it works</span>
          <h2>Evaluate · reconcile · score.</h2>
        </div>
        <div className="steps">
          <Step n="01" title="Evaluate rules on a schedule">
            Every 30 minutes the engine runs each enabled rule against each client&apos;s rolling
            30-day windows — gated on the services they actually hold live.
          </Step>
          <Step n="02" title="Open a flag with evidence">
            A trip opens a red (money-losing, pinged live) or amber (digest) flag carrying the exact
            numbers and thresholds. A recovered condition auto-resolves. Snooze what you know.
          </Step>
          <Step n="03" title="Roll it into a health score">
            Open flags, billing and recency roll into a portable 0–100 score, banded green/amber/red,
            driving a worst-first triage board.
          </Step>
        </div>
      </section>

      {/* RULE CATALOG */}
      <section className="section container" id="rules">
        <div className="section-head">
          <span className="eyebrow">The moat</span>
          <h2>A rule catalog that is data, not code.</h2>
          <p>Thresholds, enable flags and per-client overrides all live in the database. Tuning is a config change — and every client can run their own rule set.</p>
        </div>
        <div className="catalog">
          {RULES.map(r => (
            <div className="rulecard" key={r.key}>
              <span className={`dot ${r.sev}`} style={{ marginTop: 6 }} />
              <div>
                <div className="key">{r.key}</div>
                <div className="desc">{r.desc}</div>
              </div>
              <span className="tag win">{r.win}</span>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 16, fontSize: 14 }}>…and 10 more, each with grace periods and suppression baked in.</p>
      </section>

      {/* FEATURES */}
      <section className="section container">
        <Feature
          eyebrow="Trust"
          title="A failure never trips a flag."
          body="Every metric read is present, absent, or error — three distinct states. A connector 403 or timeout is surfaced or counted; it never becomes “0 leads” and opens a false red. That discipline is why an operator acts on a flag before the client calls."
          fig={<CodeFig />}
        />
        <Feature
          eyebrow="Per-client control"
          title="Every client, their own rule set."
          body="Start from a shared global catalog, then override thresholds — or enable and disable rules — for any single client. A seasonal HVAC account and a steady law firm shouldn’t answer to the same numbers."
          fig={<OverrideFig />}
        />
        <Feature
          eyebrow="Routing"
          title="The right flag to the right owner."
          body="Red flags live-ping the responsible department lead — Facebook, LSA or SEO — falling back to super-admins, deduped so the bell never spams. Amber collects into a digest."
          fig={<RoutingFig />}
        />
      </section>

      {/* PACKAGING TEASER */}
      <section className="section container">
        <div className="cta-banner">
          <h2>Start on the triage board.</h2>
          <p>Connect an account and get red/amber flags with the evidence, delivered to Slack and email. Upgrade to the health board and per-account rule config when you are ready.</p>
          <div className="row gap-12" style={{ justifyContent: "center" }}>
            <Link href="/app" className="btn btn-brand">Open app</Link>
            <Link href="/pricing" className="btn btn-ghost" style={{ color: "var(--paper)", borderColor: "#3a3d46" }}>Compare plans</Link>
          </div>
        </div>
      </section>
    </>
  )
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="card card-pad">
      <div className="eyebrow">{k}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", margin: "8px 0 4px" }}>{v}</div>
      <div className="muted" style={{ fontSize: 14 }}>{note}</div>
    </div>
  )
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="step">
      <div className="n">{n}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

function Feature({ eyebrow, title, body, fig }: { eyebrow: string; title: string; body: string; fig: React.ReactNode }) {
  return (
    <div className="feature">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h3 style={{ marginTop: 12 }}>{title}</h3>
        <p>{body}</p>
      </div>
      <div className="fig">{fig}</div>
    </div>
  )
}

function CodeFig() {
  return (
    <pre className="mono" style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--ink)" }}>
{`fb = await source.fb(id, win)
// present → real data (incl. a true 0)
// absent  → not connected (skip)
// error   → `}<span style={{ color: "var(--red)" }}>throw → skip client</span>{`

`}<span style={{ color: "var(--muted)" }}>{`// a 403 never becomes "0 leads"`}</span>
    </pre>
  )
}

function OverrideFig() {
  return (
    <div className="stack gap-8">
      <div className="row spread" style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10 }}>
        <span className="mono" style={{ fontSize: 13 }}>lsa_lead_drop</span>
        <span className="tag">global · dropPct 30</span>
      </div>
      <div className="row spread" style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "inset 3px 0 0 var(--brand-deep)" }}>
        <span className="mono" style={{ fontSize: 13 }}>ironclad-pest</span>
        <span className="pill amber">override · dropPct 10</span>
      </div>
      <div className="row spread" style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10 }}>
        <span className="mono" style={{ fontSize: 13 }}>riverstone-law</span>
        <span className="tag">disabled for this client</span>
      </div>
    </div>
  )
}

function RoutingFig() {
  const rows = [
    ["fb_* / campaign_paused", "→ Facebook lead"],
    ["lsa_*", "→ LSA lead"],
    ["seo_* / gbp_*", "→ SEO lead"],
    ["no_leads / payment_failed", "→ super-admins"],
  ]
  return (
    <div className="stack gap-8">
      {rows.map(([a, b]) => (
        <div className="row spread" key={a} style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
          <span>{a}</span><span className="muted">{b}</span>
        </div>
      ))}
    </div>
  )
}
