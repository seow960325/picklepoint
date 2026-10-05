/** Admin screens that only exist for multi-sport competitions. Rendered by
 *  Admin.tsx only when competition.multi_sport is true. */
import { useState } from 'react'
import * as api from '../lib/api'
import { teamName } from '../lib/store'
import { validateRules } from '../lib/draw'
import { Field, Stepper, Choice, Warn, inputFull } from '../components/form'
import { ScheduleRow, scheduleStatus } from '../components/ScheduleRow'
import {
  SPORTS, SPORT_LABEL, SPORT_PRESETS, SPORT_ICON, SPORT_TONE, FINAL_PRESETS, sportOf, buildTieDraw,
  sportBundle, sportsPresent, groupEvents, finalEventOf, koState, semiPlan, finalsPlan, koGames, koCourtLabel,
  type Sport, type KoGame,
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
          className={`whitespace-nowrap rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wider ${
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
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
        courts.map((c: any) => c.game_group ?? null))
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
          // "A · R1" for group games, "SF1" / "FINAL · G2" for knockout games
          const st = scheduleStatus(m, koCourtLabel(m)?.replace(/ · (MD1|MD2|MD|XD)\b/, '') ??
            (m.round ?? '').split(' · ').slice(0, 2).join(' · '))
          return (
            <ScheduleRow key={m.id} bundle={bundle} a={m.team_a_id} b={m.team_b_id}
              meta={<>
                <span className="block font-display text-sm font-bold text-accent">{m.game_label}{m.set_no ? ` G${m.set_no}` : ''}</span>
                <span className="block">Ct {bundle.courts.find((c: any) => c.id === m.court_id)?.number ?? '–'}</span>
              </>}
              status={st.text} live={st.live}
              canUp={canUp} canDown={canDown}
              onUp={() => run(() => api.adminMoveMatch(token, m.id, 'up'), 'Game moved up')}
              onDown={() => run(() => api.adminMoveMatch(token, m.id, 'down'), 'Game moved down')} />
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ courts
const GROUPS = ['MD1', 'MD2', 'XD'] as const
const GROUP_HINT: Record<string, string> = {
  MD1: 'Men\'s doubles 1 (also the single MD of a 4-player tie)',
  MD2: 'Men\'s doubles 2',
  XD: 'Mixed doubles',
}

/** How many courts each game type gets, per sport. Multi-sport competitions only. */
export function SportCourts({ bundle, token, run, sport, onApplied }: any) {
  const mine = bundle.courts.filter((c: any) => sportOf(c) === sport)
  const initial = () => {
    const tagged = GROUPS.map(g => mine.filter((c: any) => c.game_group === g).length)
    if (tagged.some(n => n > 0)) return tagged
    // untagged courts: spread them evenly over the three game types
    const base = Math.floor(mine.length / 3), extra = mine.length % 3
    return GROUPS.map((_, i) => base + (i < extra ? 1 : 0))
  }
  const [plan, setPlan] = useState<number[]>(initial)
  const total = plan.reduce((a, b) => a + b, 0)
  const played = bundle.matches.some((m: any) =>
    bundle.events.some((e: any) => e.id === m.event_id && sportOf(e) === sport) &&
    (m.status === 'finished' || m.score_a > 0 || m.score_b > 0))

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="font-display text-lg font-bold tracking-wide">{SPORT_ICON[sport as Sport]} {SPORT_LABEL[sport as Sport]}</div>
        <div className="text-xs text-fg-subtle">Courts per game</div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {GROUPS.map((g, i) => (
          <Field key={g} label={g}>
            <Stepper value={plan[i]} min={0} max={12}
              onChange={v => setPlan(p => p.map((x, j) => (j === i ? v : x)))} />
            <div className="mt-1 text-[11px] leading-snug text-fg-subtle">{GROUP_HINT[g]}</div>
          </Field>
        ))}
      </div>
      <div className="text-xs text-fg-muted">
        Total {total} court{total === 1 ? '' : 's'} (currently {mine.length}).
        Applying clears this sport's unplayed schedule — press Regenerate schedule afterwards.
      </div>
      {played && <Warn>Games have already been played, so the courts are locked.</Warn>}
      <button disabled={total < 1 || played}
        onClick={() => run(async () => {
          await api.adminSetSportCourts(token, sport,
            { MD1: plan[0], MD2: plan[1], XD: plan[2] })
          onApplied?.()
        }, `${SPORT_LABEL[sport as Sport]} courts updated — now regenerate its schedule`)}
        className="rounded-xl bg-brand px-6 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">
        APPLY COURTS
      </button>
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


// ---------------------------------------------------------------- knockout
/** Semi-finals -> 3rd place + Final, per sport. Each step is one tap once the
 *  previous stage is decided; an unplayed stage can be undone. */
export function KnockoutTab({ bundle, token, run }: any) {
  const sports = sportsPresent(bundle)
  return (
    <div className="max-w-3xl space-y-6">
      <H>Knockout</H>
      <p className="text-sm text-fg-muted">
        Group A / B winners and runners-up cross into the semi-finals (A1 v B2, B1 v A2).
        Semi-final winners play the Final, losers play for 3rd place. Knockout ties never
        change the group tables.
      </p>
      {sports.map(s => <SportKnockout key={s} bundle={bundle} sport={s} token={token} run={run} />)}
    </div>
  )
}

/** Pretend the games about to be created are already queued, so the next
 *  stage's court choice sees the load. */
const withPending = (sb: any, games: KoGame[]) => ({
  ...sb,
  matches: [...sb.matches, ...games.map((g, i) => ({ id: `pending${i}`, court_id: g.court, status: 'scheduled' }))],
})

function SportKnockout({ bundle, sport, token, run }: any) {
  const sb = sportBundle(bundle, sport)
  const gev = groupEvents(sb)[0]
  const fev = finalEventOf(sb, sport)
  const k = koState(sb)
  const plan = gev ? semiPlan(sb, gev.id) : { supported: false, ready: false, sf: [] as any[] }
  const fp = finalsPlan(sb)
  const team = (id: string | null) => sb.teams.find((t: any) => t.id === id)!
  const name = (id: string | null) => teamName(bundle, id)
  const [rules, setRules] = useState(() => fev
    ? { target_score: fev.target_score, win_by: fev.win_by, cap: fev.cap, switch_at: fev.switch_at, serve_mode: fev.serve_mode ?? 'winner' }
    : FINAL_PRESETS[sport as Sport])
  const [bo3, setBo3] = useState(true)
  const bad = validateRules(rules)
  const started = (t?: any) => !!t && t.games.some((g: any) => g.status === 'finished' || g.score_a > 0 || g.score_b > 0)
  const tone = SPORT_TONE[sport as Sport]

  if (!gev) return null

  const drawSemis = () => run(async () => {
    let pending: KoGame[] = []
    for (const s of plan.sf) {
      if ((s.stage === 'SF1' && k.sf1) || (s.stage === 'SF2' && k.sf2)) continue
      const games = koGames(withPending(sb, pending), s.stage, s.a.team, s.b.team)
      await api.adminAddTieStage(token, gev.id, s.stage, games)
      pending = pending.concat(games)
    }
  }, `${SPORT_LABEL[sport as Sport]} semi-finals drawn`)

  const createFinals = () => run(async () => {
    const finalEv = await api.adminTieFinalEvent(token, gev.id, rules)
    const third = fp.third && !k.third ? koGames(sb, '3P', team(fp.third[0]), team(fp.third[1])) : []
    if (third.length) await api.adminAddTieStage(token, gev.id, '3P', third)
    if (!k.final) {
      const fin = koGames(withPending(sb, third), 'F', team(fp.final![0]), team(fp.final![1]), { bestOf3: bo3 })
      await api.adminAddTieStage(token, finalEv, 'F', fin)
    }
  }, `${SPORT_LABEL[sport as Sport]} Final and 3rd place created`)

  const row = (label: string, a: string, b: string, sub?: string) => (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className="min-w-0 truncate">{a} <span className="text-fg-subtle">v</span> {b}
        {sub && <span className="ml-2 text-xs text-fg-subtle">{sub}</span>}</span>
    </div>
  )

  return (
    <section className={`space-y-4 rounded-xl border bg-surface p-4 ${tone.border}`}>
      <div className={`font-display text-xl font-bold uppercase tracking-widest ${tone.text}`}>
        {SPORT_ICON[sport as Sport]} {SPORT_LABEL[sport as Sport]}
        <span className="ml-2 text-xs font-semibold normal-case tracking-normal text-fg-subtle">
          {k.phase === 'groups' ? 'group stage' : k.phase === 'semis' ? 'semi-finals' : k.phase === 'finals' ? 'finals' : 'complete'}
        </span>
      </div>

      {/* 1 — semis */}
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-widest text-fg-muted">1 · Semi-finals</div>
        {k.sf1 || k.sf2 ? (
          <>
            {k.sf1 && row('Semi-final 1', name(k.sf1.a), name(k.sf1.b), `${k.sf1.aGames}–${k.sf1.bGames}`)}
            {k.sf2 && row('Semi-final 2', name(k.sf2.a), name(k.sf2.b), `${k.sf2.aGames}–${k.sf2.bGames}`)}
            {(!k.sf1 || !k.sf2) && plan.supported && (
              <button onClick={drawSemis}
                className="mt-2 block rounded-xl bg-brand px-5 py-2.5 font-display font-bold text-brand-fg">
                DRAW THE MISSING SEMI-FINAL
              </button>
            )}
            {!k.third && !k.final && !started(k.sf1) && !started(k.sf2) && (
              <button onClick={() => run(() => Promise.all([
                api.adminClearTieStage(token, gev.id, 'SF1'), api.adminClearTieStage(token, gev.id, 'SF2'),
              ]), 'Semi-finals removed')}
                className="mt-1 text-xs text-fg-subtle underline underline-offset-4">undo semi-finals</button>
            )}
          </>
        ) : !plan.supported ? (
          <Warn>Semi-finals need two groups with at least two teams each (or one group of four or more).</Warn>
        ) : (
          <>
            {plan.sf.map((s: any) => row(s.stage === 'SF1' ? 'Semi-final 1' : 'Semi-final 2',
              `${s.a.seed} ${s.a.team?.name ?? '—'}`, `${s.b.seed} ${s.b.team?.name ?? '—'}`))}
            {!plan.ready && <div className="mt-1 text-xs text-amber-400">Group stage not finished — these are the current leaders.</div>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button disabled={!plan.ready} onClick={drawSemis}
                className="rounded-xl bg-brand px-5 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">
                DRAW SEMI-FINALS
              </button>
              {!plan.ready && (
                <button onClick={drawSemis} className="text-xs text-fg-subtle underline underline-offset-4">
                  draw now with current standings
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 2 — final + third */}
      <div className="border-t border-line pt-4">
        <div className="mb-1 text-xs font-bold uppercase tracking-widest text-fg-muted">2 · Final &amp; 3rd place</div>
        {k.final || k.third ? (
          <>
            {k.third && row('3rd place', name(k.third.a), name(k.third.b), `${k.third.aGames}–${k.third.bGames}`)}
            {k.final && row('Final', name(k.final.a), name(k.final.b), `${k.final.aGames}–${k.final.bGames}`)}
            {!started(k.final) && !started(k.third) && (
              <button onClick={() => run(async () => {
                await api.adminClearTieStage(token, gev.id, '3P')
                await api.adminClearTieStage(token, gev.id, 'F')
              }, 'Final and 3rd place removed')}
                className="mt-1 text-xs text-fg-subtle underline underline-offset-4">undo final &amp; 3rd place</button>
            )}
          </>
        ) : fp.ready ? (
          <>
            {row('Final', name(fp.final![0]), name(fp.final![1]))}
            {row('3rd place', name(fp.third![0]), name(fp.third![1]))}
          </>
        ) : (
          <div className="text-sm text-fg-subtle">Waiting for both semi-finals to be decided.</div>
        )}

        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Final scoring</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
            <Field label="Winning score">
              <Stepper value={rules.target_score} min={1} max={99} onChange={v => setRules({ ...rules, target_score: v })} />
            </Field>
            <Field label="Win by">
              <Stepper value={rules.win_by} min={1} max={5} onChange={v => setRules({ ...rules, win_by: v })} />
            </Field>
            <Field label="Hard cap">
              <Stepper value={rules.cap} min={1} max={120} onChange={v => setRules({ ...rules, cap: v })} />
            </Field>
            <Field label="Switch ends at">
              <Stepper value={rules.switch_at} min={0} max={rules.target_score}
                onChange={v => setRules({ ...rules, switch_at: v })} format={v => v === 0 ? 'OFF' : String(v)} />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Serve">
              <Choice value={rules.serve_mode} onChange={v => setRules({ ...rules, serve_mode: v })}
                options={[{ label: 'Rally', value: 'winner' }, { label: 'Side-out', value: 'alternate' }]} />
            </Field>
            {!k.final && (
              <Field label="Each discipline">
                <Choice value={bo3 ? 'bo3' : 'one'} onChange={v => setBo3(v === 'bo3')}
                  options={[{ label: 'Best of 3', value: 'bo3' }, { label: 'One game', value: 'one' }]} />
              </Field>
            )}
          </div>
          {bad && <Warn>{bad}</Warn>}
          {k.final && (
            <button disabled={!!bad} onClick={() => run(() => api.adminTieFinalEvent(token, gev.id, rules), 'Final scoring saved')}
              className="mt-3 rounded-lg border border-line px-4 py-2 text-xs font-bold uppercase tracking-wider text-fg-muted disabled:opacity-30">
              Save final scoring
            </button>
          )}
        </div>

        {(!k.final || !k.third) && fp.ready && (
          <button disabled={!!bad} onClick={createFinals}
            className="mt-3 rounded-xl bg-brand px-5 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">
            CREATE FINAL &amp; 3RD PLACE
          </button>
        )}
      </div>

      {k.phase === 'done' && (
        <div className="border-t border-line pt-4 text-sm">
          {[['Champion', k.champion, 'font-bold text-gold'], ['Runner-up', k.runnerUp, 'text-fg'], ['3rd place', k.thirdPlace, 'text-fg']]
            .filter(([, id]) => id)
            .map(([label, id, cls]) => (
              <div key={label as string} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2 py-0.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{label}</span>
                <span className={`truncate ${cls}`}>{name(id as string)}</span>
              </div>
            ))}
        </div>
      )}
    </section>
  )
}
