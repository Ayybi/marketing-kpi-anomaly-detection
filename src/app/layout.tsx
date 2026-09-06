import type { ReactNode } from "react"
import { Plus_Jakarta_Sans, Inter, IBM_Plex_Mono } from "next/font/google"
import "./globals.css"

// Raw next/font variables — composed (with fallbacks) into --font-* in globals.css. The names must
// differ from the globals tokens, or the CSS variable references itself and becomes invalid (which
// silently falls font-family back to the browser default serif).
const display = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-display-raw", display: "swap" })
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans-raw", display: "swap" })
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono-raw", display: "swap" })

export const metadata = {
  title: "Bellwether — client health, 48 hours early",
  description:
    "A rules-driven early-warning system for marketing agencies. Catch a client's failing campaigns before they call — red/amber flags with the exact evidence, rolled into a 0–100 health score.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
