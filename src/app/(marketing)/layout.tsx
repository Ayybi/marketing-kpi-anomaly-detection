import type { ReactNode } from "react"
import SiteNav from "@/components/site/SiteNav"
import SiteFooter from "@/components/site/SiteFooter"

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  )
}
