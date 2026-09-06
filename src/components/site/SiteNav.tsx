import Link from "next/link"

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="wordmark" style={dark ? { color: "var(--paper)" } : undefined} aria-label="Bellwether home">
      <span className="mark" aria-hidden />
      bellwether
    </Link>
  )
}

export default function SiteNav() {
  return (
    <header className="site-nav">
      <div className="container inner">
        <Wordmark />
        <nav className="nav-links">
          <a href="/#how">How it works</a>
          <a href="/#rules">Rule catalog</a>
          <Link href="/pricing">Pricing</Link>
          <Link href="/app" className="btn btn-ghost btn-sm">Open app</Link>
          <Link href="/app" className="btn btn-brand btn-sm">Start free</Link>
        </nav>
      </div>
    </header>
  )
}
