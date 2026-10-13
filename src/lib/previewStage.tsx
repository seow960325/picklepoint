/** TEST codes only (TESTMD / TESTXD …): a viewer-side switch that re-draws the
 *  knockout as if the competition were at a chosen stage. Nothing is written to
 *  the database — it only changes what this browser shows, and only on the
 *  public board / combined TV. */
import { useSyncExternalStore } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { Bundle, Match } from './types'

export type PreviewStage = 'r16' | 'qf' | 'sf' | 'final'
const STAGES: { id: PreviewStage; label: string }[] = [
  { id: 'r16', label: 'Round of 16' },
  { id: 'qf', label: 'Quarter-final' },
  { id: 'sf', label: 'Semi-final' },
  { id: 'final', label: 'Final' },
]
const KEY = 'pp.previewstage'
const subs = new Set<() => void>()
const read = (): PreviewStage | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'r16' || v === 'qf' || v === 'sf' || v === 'final' ? v : null
  } catch { return null }
}
export const isTestCode = (code: string | undefined) => !!code && /^TEST/i.test(code)
export function setPreviewStage(s: PreviewStage | null) {
  try { if (s) localStorage.setItem(KEY, s); else localStorage.removeItem(KEY) } catch { /* private mode */ }
  subs.forEach(f => f())
}
export function usePreviewStage(code: string | undefined): PreviewStage | null {
  const s = useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb) } }, read, () => null)
  return isTestCode(code) ? s : null
}

const levelOf = (key: string | null | undefined): number => {
  if (!key) return -1
  if (key === 'KO-3P') return 3
  const n = Number(/^KO-(\d+)-/.exec(key)?.[1])
  return n === 16 ? 0 : n === 8 ? 1 : n === 4 ? 2 : n === 2 ? 3 : -1
}
const CUT: Record<PreviewStage, number> = { r16: 0, qf: 1, sf: 2, final: 3 }

export function applyPreviewStage(b: Bundle, stage: PreviewStage): Bundle {
  const cut = CUT[stage]
  const ko = b.matches.filter(m => levelOf(m.bracket_key) >= 0)
  if (ko.length === 0) return b
  const nameOf = (id: string | null) => b.teams.find(t => t.id === id)?.name ?? ''
  const byId = new Map(ko.map(m => [m.id, m]))
  const teams = new Map<string, { a: string | null; b: string | null }>()
  for (const m of ko) teams.set(m.id, levelOf(m.bracket_key) === 0 ? { a: m.team_a_id, b: m.team_b_id } : { a: null, b: null })
  const out = new Map<string, Match>()
  const now = Date.now()
  const courts = [...b.courts].sort((x, y) => x.number - y.number)
  const pending: Match[] = []
  const levels = [...new Set(ko.map(m => levelOf(m.bracket_key)))].sort((x, y) => x - y)
  for (const lv of levels) {
    const ms = ko.filter(m => levelOf(m.bracket_key) === lv).sort((x, y) => x.sequence - y.sequence)
    ms.forEach((m, i) => {
      const t = teams.get(m.id)!
      if (lv < cut) {
        // decided: keep the real winner when there is one, else Derek's team, else team A
        const real = m.winner_id && (m.winner_id === t.a || m.winner_id === t.b) ? m.winner_id : null
        const w = real ?? (/^derek/i.test(nameOf(t.b)) && !/^derek/i.test(nameOf(t.a)) ? t.b : t.a ?? t.b)
        const l = w === t.a ? t.b : t.a
        const push = (id: string | null, slot: 'a' | 'b' | null, team: string | null) => {
          if (!id || !slot) return
          const x = teams.get(id); if (x) x[slot] = team
        }
        push(m.next_match_id, m.next_slot, w)
        push(m.loser_match_id ?? null, m.loser_slot ?? null, l)
        const lose = 8 + (i * 3) % 11
        out.set(m.id, { ...m, team_a_id: t.a, team_b_id: t.b, status: 'finished', winner_id: w,
          score_a: w === t.a ? 21 : lose, score_b: w === t.b ? 21 : lose, court_id: m.court_id ?? courts[i % Math.max(1, courts.length)]?.id ?? null,
          duration_seconds: 600 + lose * 10 })
      } else {
        const next = { ...m, team_a_id: t.a, team_b_id: t.b, status: 'scheduled' as const, winner_id: null, score_a: 0, score_b: 0,
          court_id: null, started_at: null, finished_at: null, duration_seconds: null, last_scorer: null }
        out.set(m.id, next)
        if (lv === cut && t.a && t.b) pending.push(next)
      }
    })
  }
  // the stage being previewed: up to 3 games on court (live, 0-0), the rest queued
  pending.sort((x, y) => x.sequence - y.sequence).slice(0, Math.max(1, courts.length)).forEach((m, i) => {
    out.set(m.id, { ...m, status: 'live', court_id: courts[i % courts.length]?.id ?? null, started_at: new Date(now - 90_000).toISOString() })
  })
  void byId
  return { ...b, matches: b.matches.map(m => out.get(m.id) ?? m) }
}

/** layout route: renders the page plus the switch on /c/TEST… and /tv/TEST… only */
export function PreviewLayout() {
  const { pathname } = useLocation()
  const hit = /^\/(?:c\/(TEST[^/]*)\/?$|tv\/(TEST[^/]*))/i.exec(pathname)
  const code = hit ? (hit[1] ?? hit[2]).split(/[+,]/)[0] : undefined
  const stage = usePreviewStage(code)
  return (
    <>
      <Outlet />
      {code && (
        <div className="fixed bottom-3 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface/90 p-1 text-xs shadow-lg backdrop-blur">
          <span className="px-2 font-display font-bold uppercase tracking-widest text-fg-subtle">Preview</span>
          {STAGES.map(s => (
            <button key={s.id} onClick={() => setPreviewStage(s.id)}
              className={`min-h-[34px] touch-manipulation whitespace-nowrap rounded-full px-3 font-semibold ${stage === s.id ? 'bg-fg text-canvas' : 'text-fg-muted'}`}>
              {s.label}
            </button>
          ))}
          <button onClick={() => setPreviewStage(null)}
            className={`min-h-[34px] touch-manipulation whitespace-nowrap rounded-full px-3 font-semibold ${stage === null ? 'bg-fg text-canvas' : 'text-fg-muted'}`}>
            Real data
          </button>
        </div>
      )}
    </>
  )
}
