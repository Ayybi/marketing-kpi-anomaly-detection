import { listGlobalRules } from "@/lib/rules"
import GlobalRuleEditor from "@/components/app/GlobalRuleEditor"

export const dynamic = "force-dynamic"

export default async function RulesPage() {
  const rules = await listGlobalRules()
  const enabled = rules.filter(r => r.enabled).length

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Rule config</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>The global catalog — data, not code. {enabled}/{rules.length} enabled.</p>
        </div>
      </div>
      <div className="content">
        <GlobalRuleEditor initial={rules} />
      </div>
    </>
  )
}
