"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/app", label: "Triage", exact: true, icon: "M3 12h4l2 5 4-12 2 7h3" },
  { href: "/app/rules", label: "Rule config", icon: "M4 6h16M4 12h10M4 18h7" },
  { href: "/app/system", label: "System health", icon: "M12 3l7 4v5c0 4-3 7-7 8-4-1-7-4-7-8V7l7-4z" },
]

function Icon({ d }: { d: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

export default function Sidebar() {
  const path = usePathname()
  return (
    <aside className="sidebar">
      <Link href="/" className="wordmark" aria-label="Bellwether">
        <span className="mark" aria-hidden />
        bellwether
      </Link>
      {NAV.map(n => {
        const active = n.exact ? path === n.href : path.startsWith(n.href)
        return (
          <Link key={n.href} href={n.href} className={`nav-item${active ? " active" : ""}`}>
            <Icon d={n.icon} />
            {n.label}
          </Link>
        )
      })}
      <div className="foot">
        <div>demo workspace</div>
        <div style={{ marginTop: 4 }}>engine · 15,45 * * * *</div>
      </div>
    </aside>
  )
}
