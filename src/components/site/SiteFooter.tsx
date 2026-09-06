import Link from "next/link"
import { Wordmark } from "./SiteNav"

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="foot-grid">
          <div>
            <Wordmark />
            <p className="muted" style={{ marginTop: 12, fontSize: 14, maxWidth: "34ch" }}>
              Client health, 48 hours early. A rules-driven early-warning system for marketing agencies.
            </p>
          </div>
          <div>
            <h4>Product</h4>
            <a href="/#how">How it works</a>
            <a href="/#rules">Rule catalog</a>
            <Link href="/pricing">Pricing</Link>
            <Link href="/app">Open app</Link>
          </div>
          <div>
            <h4>Surfaces</h4>
            <Link href="/app">Triage board</Link>
            <Link href="/app/rules">Rule config</Link>
            <Link href="/app/system">System health</Link>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/#">About</a>
            <a href="/#">Changelog</a>
            <a href="/#">Contact</a>
          </div>
        </div>
        <div className="spread" style={{ marginTop: 36, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
          <span className="mono muted" style={{ fontSize: 12 }}>© {new Date().getFullYear()} Bellwether</span>
          <span className="mono muted" style={{ fontSize: 12 }}>Built on the KPI / Health-Score engine</span>
        </div>
      </div>
    </footer>
  )
}
