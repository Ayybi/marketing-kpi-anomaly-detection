import type { ReactNode } from "react"
import Sidebar from "@/components/app/Sidebar"

export const metadata = { title: "Bellwether — control room" }

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">{children}</div>
    </div>
  )
}
