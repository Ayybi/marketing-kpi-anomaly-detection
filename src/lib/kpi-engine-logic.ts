// B7 — Pure rule helpers (VERBATIM from the spec). No DB import; runs on any Node 20+.
export function sumLastDays<T extends { date: string }>(rows: T[] | undefined, days: number, field: keyof T): number {
  if (!rows || rows.length === 0) return 0
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days)
  return sorted.reduce((sum, r) => sum + (Number(r[field]) || 0), 0)
}

export function todayInTimeZone(tz: string | null | undefined, now: Date): string {
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
    } catch { /* invalid tz -> UTC */ }
  }
  return now.toISOString().split("T")[0]
}

export function fbSpendZeroFinding(rows: { date: string; spend: number }[] | undefined, today: string): { flag: boolean; judgedDates: string[]; spend: number[] } {
  const complete = (rows ?? []).filter(r => r.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2)
  const ordered = [...complete].reverse()
  const judgedDates = ordered.map(r => r.date)
  const spend = ordered.map(r => Number(r.spend) || 0)
  const flag = complete.length === 2 && spend.every(s => s === 0)
  return { flag, judgedDates, spend }
}

/** Returns null when previous <= 0: a zero baseline is "no signal", not a 100% drop. THE invariant. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function num(config: Record<string, unknown>, keyName: string, fallback: number): number {
  const v = Number(config?.[keyName])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

export function graceAccountsForSource(source: string): ("fb" | "lsa")[] {
  if (source === "no_leads" || source === "lead_drop") return ["fb", "lsa"]
  if (source === "campaign_paused" || source.startsWith("fb_")) return ["fb"]
  if (source.startsWith("lsa_")) return ["lsa"]
  return []
}

export function buildLiveServiceTypes(rows: { client_id: string; service_type: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = map.get(r.client_id) ?? new Set<string>()
    set.add(r.service_type); map.set(r.client_id, set)
  }
  return map
}

export function earliestServiceStart(rows: { client_id: string; started_at?: string | null; created_at?: string | null }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    const startIso = r.started_at ?? r.created_at
    if (!startIso) continue
    const t = new Date(startIso).getTime()
    const existing = map.get(r.client_id)
    if (existing === undefined || t < existing) map.set(r.client_id, t)
  }
  return map
}

// inWinterHold(config): true when config.seasonalHold and the current month is in config.winterMonths.
export function inWinterHold(config: Record<string, unknown>): boolean {
  if (config?.seasonalHold !== true) return false
  const months = Array.isArray(config.winterMonths) ? (config.winterMonths as number[]) : [12, 1, 2]
  return months.includes(new Date().getMonth() + 1)
}
