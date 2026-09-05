import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bundle, EventCfg, Match, Team } from './types'
import type { DuelTally } from './draw'
import * as api from './api'

const CODE_KEY = 'pp.code'
export const rememberCode = (c: string) => localStorage.setItem(CODE_KEY, c.toUpperCase())
export const lastCode = () => localStorage.getItem(CODE_KEY) || ''

export function useCompetition(code: string | undefined) {
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const codeRef = useRef(code)
  codeRef.current = code

  const reload = useCallback(async () => {
    if (!codeRef.current) return
    try { setBundle(await api.refresh(codeRef.current)); setError(null) }
    catch (e: any) { setError(e.message) }
  }, [])

  useEffect(() => {
    let alive = true
    if (!code) { setLoading(false); return }
    setLoading(true)
    api.join(code)
      .then(b => { if (alive) { setBundle(b); setError(null) } })
      .catch(e => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [code])

  useEffect(() => {
    if (!bundle) return
    return api.subscribe(bundle, reload)
  }, [bundle?.competition.id, reload])

  return { bundle, setBundle, error, loading, reload }
}

// ------------------------------------------------------------- selectors
export const teamName = (b: Bundle, id: string | null) =>
  b.teams.find(t => t.id === id)?.name ?? 'TBD'

export const eventOf = (b: Bundle, m: Match): EventCfg =>
  b.events.find(e => e.id === m.event_id)!

export const liveOnCourt = (b: Bundle, courtId: string): Match | undefined =>
  b.matches.find(m => m.court_id === courtId &&
    (m.status === 'live' || m.status === 'awaiting_confirm'))

export const nextOnCourt = (b: Bundle, courtId: string): Match | undefined =>
  b.matches
    .filter(m => m.court_id === courtId && (m.status === 'scheduled' || m.status === 'on_deck'))
    .sort((x, y) => x.sequence - y.sequence)[0]

export const onDeck = (b: Bundle, n = 4): Match[] =>
  b.matches
    .filter(m => m.status === 'scheduled' || m.status === 'on_deck')
    .sort((x, y) => x.sequence - y.sequence)
    .slice(0, n)

export const results = (b: Bundle): Match[] =>
  b.matches.filter(m => m.status === 'finished')
    .sort((x, y) => (y.finished_at ?? '').localeCompare(x.finished_at ?? ''))

export interface Standing {
  team: Team; played: number; won: number; lost: number
  pf: number; pa: number; diff: number
}

/** Pool standings. Tiebreak: wins, then head-to-head, then diff, then points for. */
export function standings(b: Bundle, eventId: string): Record<string, Standing[]> {
  const teams = b.teams.filter(t => t.event_id === eventId)
  const rows = new Map<string, Standing>()
  teams.forEach(t => rows.set(t.id, {
    team: t, played: 0, won: 0, lost: 0, pf: 0, pa: 0, diff: 0,
  }))

  const done = b.matches.filter(m => m.event_id === eventId && m.status === 'finished')
  for (const m of done) {
    const A = rows.get(m.team_a_id!), B = rows.get(m.team_b_id!)
    if (!A || !B) continue
    A.played++; B.played++
    A.pf += m.score_a; A.pa += m.score_b
    B.pf += m.score_b; B.pa += m.score_a
    if (m.score_a > m.score_b) { A.won++; B.lost++ } else { B.won++; A.lost++ }
  }
  rows.forEach(r => { r.diff = r.pf - r.pa })

  const h2h = (x: string, y: string): number => {
    const m = done.find(d =>
      (d.team_a_id === x && d.team_b_id === y) || (d.team_a_id === y && d.team_b_id === x))
    if (!m) return 0
    const xWon = (m.team_a_id === x) === (m.score_a > m.score_b)
    return xWon ? -1 : 1
  }

  const byPool: Record<string, Standing[]> = {}
  for (const r of rows.values()) {
    const p = r.team.pool ?? '—'
    ;(byPool[p] ||= []).push(r)
  }
  for (const p of Object.keys(byPool)) {
    byPool[p].sort((a, z) =>
      z.won - a.won || h2h(a.team.id, z.team.id) || z.diff - a.diff || z.pf - a.pf)
  }
  return byPool
}

// ------------------------------------------------------------- duel format
/** Tally games won per side, plus total points scored as the tiebreak.
 *  A game's winner scores 1 for their side, not their team. */
export function duelTally(b: Bundle, eventId: string): DuelTally {
  const sideOf = (teamId: string | null): 'A' | 'B' | null =>
    b.teams.find(t => t.id === teamId)?.side ?? null

  const games = b.matches.filter(m => m.event_id === eventId)
  const done = games.filter(m => m.status === 'finished')

  let sideAWins = 0, sideBWins = 0, sideAPoints = 0, sideBPoints = 0
  for (const m of done) {
    const aSide = sideOf(m.team_a_id), bSide = sideOf(m.team_b_id)
    const aScore = aSide === 'A' ? m.score_a : m.score_b
    const bScore = aSide === 'A' ? m.score_b : m.score_a
    sideAPoints += aScore; sideBPoints += bScore
    const winnerSide = m.winner_id != null
      ? (m.winner_id === m.team_a_id ? aSide : bSide)
      : (m.score_a > m.score_b ? aSide : bSide)
    if (winnerSide === 'A') sideAWins++
    else if (winnerSide === 'B') sideBWins++
  }

  return {
    sideAWins, sideBWins, sideAPoints, sideBPoints,
    gamesPlayed: done.length, gamesTotal: games.length,
    leader: sideAWins === sideBWins
      ? (sideAWins === sideBWins && sideAPoints !== sideBPoints
          ? (sideAPoints > sideBPoints ? 'A' : 'B') : 'tie')
      : (sideAWins > sideBWins ? 'A' : 'B'),
  }
}

export interface DuelPod {
  label: string
  courtNumber: number | null
  games: Match[]
}

/** Games grouped back into their pods (one pod = one court's 2v2 block),
 *  for the "which games make up this score" breakdown under the scoreboard. */
export function duelPods(b: Bundle, eventId: string): DuelPod[] {
  const games = b.matches.filter(m => m.event_id === eventId)
  const byLabel = new Map<string, Match[]>()
  for (const m of games) {
    const label = m.round ?? 'Pod'
    ;(byLabel.get(label) ?? byLabel.set(label, []).get(label)!).push(m)
  }
  return [...byLabel.entries()]
    .map(([label, gs]) => ({
      label,
      courtNumber: b.courts.find(c => c.id === gs[0]?.court_id)?.number ?? null,
      games: gs.sort((a, z) => a.sequence - z.sequence),
    }))
    .sort((a, z) => a.games[0].sequence - z.games[0].sequence)
}
