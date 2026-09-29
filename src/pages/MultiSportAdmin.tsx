/** Admin screens that only exist for multi-sport competitions. Rendered by
 *  Admin.tsx only when competition.multi_sport is true. */
import { useState } from 'react'
import * as api from '../lib/api'
import { teamName } from '../lib/store'
import { validateRules } from '../lib/draw'
import { Field, Stepper, Choice, Warn, inputFull } from '../components/form'
import {
  SPORTS, SPORT_LABEL, SPORT_PRESETS, SPORT_ICON, sportOf, buildTieDraw, type Sport,
} from '../lib/multisport'

const H = ({ children }: any) =>
  <h1 className="font-display text-2xl font-bold tracking-wide">{children}</h1>

const pin4 = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0')
const POOLS = 'ABCDEFGH'

/** Chips that pick which sport's event the Scoring / Teams / Schedule tabs edit. */
export function EventSwitcher({ events, value, onChange }: {
  events: any[]; value: string; onChange: (id: string) => void
}) {
  if (events.length < 2) return null
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {events.map(e => (
        <button key={e.id} onClick={() => onChange(e.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
            e.id === value ? 'border-brand bg-brand text-brand-fg' : 'border-line text-fg-muted'}`}>
          {SPORT_ICON[sportOf(e)]} {e.name}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ sports
export function SportsTab({ bundle, token, run, onAdded }: any) {
  const present = new Set(bundle.events.map((e: any) => sportOf(e)))
  const firstFree = (SPORTS.find(s => !present.has(s)) ?? 'badminton') as Sport

  const [sport, setSport] = useState<Sport>(firstFree)
  const [name, setName] = useState(SPORT_LABEL[firstFree])
  const [rules, setRules] = useState(SPORT_PRESETS[firstFree])
  const [courtCount, setCourtCount] = useState(4)
  const [text, setText] = useState('')

  const pick = (s: Sport) => { setSport(s); setName(SPORT_LABEL[s]); setRules(SPORT_PRESETS[s]) }
  const bad = validateRules({ ...rules, target_score: rules.target_score })

  const parsed = text.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
    const [n, r, p] = l.split(',').map(x => x.trim())
    return {
      name: n,
      roster: r === '4' ? 4 : 6,
      pool: (p || POOLS[i % 2]).toUpperCase().slice(0, 2),
    }
  })

  const copyFrom = (evId: string) => {
    const lines = bundle.teams.filter((t: any) => t.event_id === evId)
      .map((t: any) => `${t.name}, ${t.roster ?? 6}, ${t.pool ?? 'A'}`)
    setText(lines.join('\n'))
  }

  const sportCourts = (s: Sport) => bundle.courts.filter((c: any) => sportOf(c) === s)

  return (
    <div className="max-w-2xl space-y-5">
      <H>Sports</H>

      <div className="divide-y divide-line rounded-xl border border-line text-sm">
        {bundle.events.map((e: any) => (
          <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <span className="font-semibold">{SPORT_ICON[sportOf(e)]} {e.name}</span>
            <span className="text-xs text-fg-subtle">
              {bundle.teams.filter((t: any) => t.event_id === e.id).length} teams ·{' '}
              {sportCourts(sportOf(e)).length} courts · to {e.target_score}, win by {e.win_by}
            </span>
          </div>
        ))}
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className="font-display text-lg font-bold tracking-wide">Add a sport</div>
        <Field label="Sport">
          <Choice value={sport} onChange={pick}
            options={SPORTS.map(s => ({ label: `${SPORT_ICON[s]} ${SPORT_LABEL[s]}`, value: s }))} />
        </Field>
        <Field label="Event name">
          <input className={`${inputFull} max-w-sm`} value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Winning score">
            <Stepper value={rules.target_score} min={1} max={99}
              onChange={v => setRules({ ...rules, target_score: v })} />
          </Field>
          <Field label="Win by">
            <Stepper value={rules.win_by} min={1} max={5}
              onChange={v => setRules({ ...rules, win_by: v })} />
          </Field>
          <Field label="Hard cap">
            <Stepper value={rules.cap} min={1} max={120}
              onChange={v => setRules({ ...rules, cap: v })} />
          </Field>
          <Field label="Switch ends at">
            <Stepper value={rules.switch_at} min={0} max={rules.target_score}
              onChange={v => setRules({ ...rules, switch_at: v })}
              format={v => v === 0 ? 'OFF' : String(v)} />
          </Field>
        </div>
        {bad && <Warn>{bad}</Warn>}
        <Field label={`${SPORT_LABEL[sport]} courts`}>
          <Stepper value={courtCount} min={1} max={16} onChange={setCourtCount} />
        </Field>
        <Field label="Teams — one per line: Name, players (6 or 4), group">
          <textarea className={`${inputFull} h-40 font-mono text-sm`} value={text}
            placeholder={'Team Alpha, 6, A\nTeam Beta, 4, B\nTeam Gamma'}
            onChange={e => setText(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          {bundle.events.map((e: any) => (
            <button key={e.id} onClick={() => copyFrom(e.id)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-fg-muted">
              Copy teams from {e.name}
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-fg-subtle">
          Players 6 = three games per tie (MD, MD, XD); 4 = two games (MD, XD). Blank group
          alternates A / B. Group and player count can be edited later in Teams.
        </p>
        <button disabled={!!bad || parsed.length < 2}
          onClick={() => run(async () => {
            await api.adminAddSportEvent(token, {
              name, sport, ...rules,
              courts: Array.from({ length: courtCount }, (_, i) => ({
                label: `${SPORT_LABEL[sport]} ${i + 1}`, scorer_pin: pin4(),
              })),
              teams: parsed,
            })
            onAdded?.()
          }, `${SPORT_LABEL[sport]} added — generate its schedule next`)}
          className="rounded-xl bg-brand px-6 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">
          ADD {SPORT_LABEL[sport].toUpperCase()}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- schedule
export function TieScheduleTab({ bundle, ev, token, run }: any) {
  const sport = sportOf(ev)
  const teams = bundle.teams.filter((t: any) => t.event_id === ev.id)
  const courts = bundle.courts.filter((c: any) => sportOf(c) === sport)
  const mine = bundle.matches.filter((m: any) => m.event_id === ev.id)
  const started = mine.some((m: any) => m.status === 'finished' || m.score_a > 0 || m.score_b > 0)

  const preview = teams.length >= 2 && courts.length >= 1
    ? buildTieDraw(
        teams.map((t: any) => ({ name: t.name, pool: t.pool ?? 'A', roster: t.roster ?? 6 })),
        courts.length)
    : []
  const ties = new Set(preview.map(p => p.tie)).size

  return (
    <div className="max-w-2xl space-y-4">
      <H>Schedule — {ev.name}</H>
      <div className="rounded-xl border border-line bg-surface p-4 text-sm">
        <div className="text-fg-muted">
          {mine.length} games · {mine.filter((m: any) => m.status === 'finished').length} played
        </div>
        <div className="mt-1 text-xs text-fg-subtle">
          Regenerating builds a round robin per group, each tie split into its games, spread over the{' '}
          {courts.length} {SPORT_LABEL[sport]} court{courts.length === 1 ? '' : 's'} — {ties} ties, {preview.length} games.
        </div>
      </div>
      {courts.length === 0 && <Warn>This sport has no courts yet.</Warn>}
      {started ? (
        <Warn>Games have already been played, so the schedule is locked.</Warn>
      ) : (
        <button disabled={preview.length === 0}
          onClick={() => run(() => api.adminReplaceTieSchedule(
            token, ev.id, preview, teams.map((t: any) => t.id), courts.map((c: any) => c.id)),
            'Schedule regenerated')}
          className="rounded-xl bg-brand px-6 py-3 font-display font-bold text-brand-fg disabled:opacity-30">
          REGENERATE SCHEDULE
        </button>
      )}

      <div className="text-xs text-fg-subtle">Reorder upcoming games on a court with the arrows.</div>
      <div className="divide-y divide-line rounded-xl border border-line text-sm">
        {mine.slice().sort((a: any, b: any) => a.sequence - b.sequence).slice(0, 90).map((m: any) => {
          const sibs = mine
            .filter((x: any) => x.court_id === m.court_id && x.status === 'scheduled')
            .sort((a: any, b: any) => a.sequence - b.sequence)
          const i = sibs.findIndex((x: any) => x.id === m.id)
          const canUp = m.status === 'scheduled' && i > 0
          const canDown = m.status === 'scheduled' && i >= 0 && i < sibs.length - 1
          return (
            <div key={m.id} className="flex items-center gap-2 px-3 py-2">
              <span className="w-8 shrink-0 text-center text-xs text-fg-subtle">
                {bundle.courts.find((c: any) => c.id === m.court_id)?.number ?? '–'}
              </span>
              <span className="w-10 shrink-0 text-xs font-bold text-accent">{m.game_label}</span>
              <span className="grid min-w-0 flex-1 grid-cols-[1fr_1.5rem_1fr] items-center gap-1">
                <span className="truncate text-right">{teamName(bundle, m.team_a_id)}</span>
                <span className="text-center text-xs text-fg-subtle">vs</span>
                <span className="truncate">{teamName(bundle, m.team_b_id)}</span>
              </span>
              <span className="tabular shrink-0 whitespace-nowrap text-right text-xs text-fg-muted">
                {m.status === 'scheduled' ? (m.round ?? '') : `${m.score_a}–${m.score_b}`}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button disabled={!canUp}
                  onClick={() => run(() => api.adminMoveMatch(token, m.id, 'up'), 'Game moved up')}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-line text-fg-muted disabled:opacity-20">▲</button>
                <button disabled={!canDown}
                  onClick={() => run(() => api.adminMoveMatch(token, m.id, 'down'), 'Game moved down')}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-line text-fg-muted disabled:opacity-20">▼</button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 6 / 4 player toggle shown on each team row of a multi-sport competition. */
export function RosterToggle({ t, token, run }: any) {
  const roster = t.roster ?? 6
  return (
    <button onClick={() => run(() => api.adminSetTeamRoster(token, t.id, roster === 6 ? 4 : 6),
        `${t.name}: ${roster === 6 ? 4 : 6} players`)}
      className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs font-bold text-fg-muted">
      {roster} players
    </button>
  )
}

