/** Multi-sport (opt-in) knockout presentation: bracket, Final banner and the
 *  champions ceremony. Only rendered for competitions with multi_sport on. */
import { useEffect, useState } from 'react'
import type { Bundle } from '../lib/types'
import { teamName, teamLogo, teamSideName } from '../lib/store'
import { Flag, FlagGlyph, Pill } from './ui'
import {
  koState, semiPlan, finalsPlan, groupEvents, SPORT_ICON, SPORT_LABEL, SPORT_TONE, STAGE_LABEL,
  type Sport, type Tie, type KoState,
} from '../lib/multisport'

const initials = (s: string) =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase()

/** Logo, else country flag, else the team's initials — never an empty circle. */
function Mark({ b, id, px, color = '#e8edf5' }: { b: Bundle; id: string | null; px: number; color?: string }) {
  const logo = teamLogo(b, id)
  const side = teamSideName(b, id)
  if (logo) return <img src={logo} alt="" className="h-[62%] w-[62%] object-contain" />
  if (side && FlagGlyph({ name: side })) return <Flag name={side} className="h-[55%] w-[70%]" />
  return (
    <span className="font-cer font-black leading-none" style={{ fontSize: px * 0.34, color }}>
      {initials(teamName(b, id) || '?')}
    </span>
  )
}

const METAL = {
  gold: {
    c: '#f4cd6a',
    ring: 'linear-gradient(145deg,#fff4c8 0%,#f4cd6a 30%,#a87821 62%,#f7dc8a 100%)',
    face: 'linear-gradient(180deg,#f3d27a 0%,#c99a3c 38%,#7c5818 100%)',
  },
  silver: {
    c: '#dfe4ec',
    ring: 'linear-gradient(145deg,#ffffff 0%,#d9dee6 32%,#8a929f 64%,#eef1f5 100%)',
    face: 'linear-gradient(180deg,#e6eaf0 0%,#a9b1bd 40%,#5d6470 100%)',
  },
  bronze: {
    c: '#e2a866',
    ring: 'linear-gradient(145deg,#ffe0b8 0%,#e2a866 32%,#8c5320 64%,#f0c08a 100%)',
    face: 'linear-gradient(180deg,#e8b47a 0%,#b5743a 40%,#633712 100%)',
  },
} as const
type Metal = keyof typeof METAL

function Medallion({ b, id, metal, px }: { b: Bundle; id: string | null; metal: Metal; px: number }) {
  return (
    <div className="rounded-full p-[3px] shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)]" style={{ background: METAL[metal].ring }}>
      <div className="grid place-items-center overflow-hidden rounded-full"
        style={{ width: px, height: px, background: 'radial-gradient(circle at 50% 35%, #1b2540, #0a0f1c 70%)' }}>
        <Mark b={b} id={id} px={px} color={METAL[metal].c} />
      </div>
    </div>
  )
}

/** Gold laurel wreath drawn around the champion's medallion (open at the top). */
function Laurel({ px }: { px: number }) {
  const leaves: JSX.Element[] = []
  const r = 43
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const deg = 100 + i * 11.5         // from just past the bottom, up the side
      const a = side < 0 ? deg : 180 - deg
      const th = (a * Math.PI) / 180
      const off = i % 2 ? 3.6 : -3.6     // alternate outside / inside the stem
      const x = 50 + (r + off) * Math.cos(th)
      const y = 50 + (r + off) * Math.sin(th)
      const rot = a + (i % 2 ? 32 : -32) * side
      leaves.push(<ellipse key={`${side}${i}`} cx={x} cy={y} rx={2.2} ry={5.6}
        transform={`rotate(${rot} ${x} ${y})`} fill="url(#ppLaurel)" />)
    }
  }
  const arc = (side: number) => {
    const p = (deg: number) => {
      const a = ((side < 0 ? deg : 180 - deg) * Math.PI) / 180
      return `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`
    }
    return `M${p(96)} A${r} ${r} 0 0 ${side < 0 ? 1 : 0} ${p(232)}`
  }
  return (
    <svg viewBox="0 0 100 100" width={px} height={px} className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
      <defs>
        <linearGradient id="ppLaurel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbe7a1" /><stop offset="100%" stopColor="#b8862f" />
        </linearGradient>
      </defs>
      <path d={arc(-1)} fill="none" stroke="url(#ppLaurel)" strokeWidth="1.2" />
      <path d={arc(1)} fill="none" stroke="url(#ppLaurel)" strokeWidth="1.2" />
      {leaves}
    </svg>
  )
}

function Cup({ px }: { px: number }) {
  return (
    <svg viewBox="0 0 64 72" width={px} height={px * 72 / 64} aria-hidden="true"
      className="drop-shadow-[0_0_18px_rgba(247,215,116,0.55)]">
      <defs>
        <linearGradient id="ppCup" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff1bd" /><stop offset="45%" stopColor="#f4cd6a" /><stop offset="100%" stopColor="#9c6f1e" />
        </linearGradient>
      </defs>
      <path d="M16 6h32v16c0 10-7 18-16 18S16 32 16 22V6z" fill="url(#ppCup)" />
      <path d="M16 11H8v6c0 7 5 11 10 12M48 11h8v6c0 7-5 11-10 12" fill="none" stroke="url(#ppCup)" strokeWidth="3.2" />
      <path d="M22 9c0 9 2 17 6 22" stroke="#fff7d6" strokeOpacity=".7" strokeWidth="2" fill="none" />
      <rect x="28" y="40" width="8" height="12" fill="url(#ppCup)" />
      <rect x="20" y="52" width="24" height="5" rx="1.5" fill="url(#ppCup)" />
      <rect x="15" y="57" width="34" height="9" rx="2.5" fill="url(#ppCup)" />
    </svg>
  )
}

/** One-shot confetti, then still. Deterministic pieces (no random reflow). */
function Confetti({ colors }: { colors: string[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 44 }, (_, i) => {
        const left = (i * 37) % 100
        const delay = 1.7 + ((i * 7) % 11) / 10
        const dur = 3.2 + ((i * 13) % 9) / 5
        const w = 6 + (i % 3) * 2
        return (
          <span key={i} className="pp-confetti absolute top-0 block rounded-[1px]"
            style={{
              left: `${left}%`, width: w, height: w * 0.45,
              background: colors[i % colors.length],
              animationDelay: `${delay}s`, animationDuration: `${dur}s`,
              ['--pp-drift' as any]: `${((i * 29) % 120) - 60}px`,
            }} />
        )
      })}
    </div>
  )
}

const SIZE = {
  lg: { gold: 150, other: 104, h: [190, 132, 104], w: [240, 196, 196], name: ['text-4xl', 'text-2xl'], cup: 72, head: 'text-6xl' },
  md: { gold: 112, other: 80, h: [140, 98, 78], w: [190, 154, 154], name: ['text-3xl', 'text-xl'], cup: 56, head: 'text-5xl' },
  sm: { gold: 80, other: 58, h: [104, 74, 58], w: [128, 104, 104], name: ['text-xl', 'text-base'], cup: 42, head: 'text-4xl' },
}

/** The champions ceremony for one sport: bronze, then silver, then gold. */
export function ChampionStage({ b, sport, k, title, size = 'md' }: {
  b: Bundle; sport: Sport; k: KoState; title: string; size?: keyof typeof SIZE
}) {
  const S = SIZE[size]
  const tone = SPORT_TONE[sport]
  const beam = sport === 'badminton' ? '52,211,153' : '90,169,255'
  const f = k.final
  const champA = f && f.a === k.champion
  const won = f ? (champA ? `${f.aGames}–${f.bGames}` : `${f.bGames}–${f.aGames}`) : ''
  const spot = (id: string | null, metal: Metal, place: 1 | 2 | 3, delay: number) => {
    const i = place - 1
    const first = place === 1
    const px = first ? S.gold : S.other
    return (
      <div className="flex flex-col items-center" style={{ width: S.w[i] }}>
        <div className="pp-rise flex w-full flex-col items-center" style={{ animationDelay: `${delay + 0.35}s` }}>
          {first && <div className="pp-pop mb-2" style={{ animationDelay: `${delay + 0.75}s` }}><Cup px={S.cup} /></div>}
          <div className="relative mb-3 grid place-items-center" style={first ? { width: px * 1.42, height: px * 1.32 } : undefined}>
            {first && <Laurel px={px * 1.42} />}
            <div className={first ? 'pp-champ-ring rounded-full' : ''}><Medallion b={b} id={id} metal={metal} px={px} /></div>
          </div>
          <div className={`max-w-full truncate px-1 text-center font-bold leading-tight ${first ? `font-cer ${S.name[0]}` : `font-display ${S.name[1]} text-[#eef2f8]`}`}
            style={first ? { color: '#f4cd6a' } : undefined}>
            {id ? teamName(b, id) : '—'}
          </div>
          <div className="mb-3 mt-0.5 font-display text-xs font-semibold tracking-wide" style={{ color: METAL[metal].c }}>
            {first ? 'Champion' : place === 2 ? 'Runner-up' : 'Third place'}
          </div>
        </div>
        <div className="pp-grow relative w-full overflow-hidden rounded-t-lg"
          style={{ height: S.h[i], background: METAL[metal].face, animationDelay: `${delay}s`,
                   boxShadow: `0 0 50px -14px ${METAL[metal].c}` }}>
          <div className="absolute inset-x-0 top-0 h-2" style={{ background: 'linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,0))' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg,rgba(0,0,0,.25),transparent 25%,transparent 75%,rgba(0,0,0,.3))' }} />
          <div className="absolute inset-x-0 top-[14%] text-center font-cer font-black"
            style={{ fontSize: S.h[0] * 0.42, lineHeight: 1, color: 'rgba(0,0,0,.32)', textShadow: '0 1px 0 rgba(255,255,255,.35)' }}>
            {place}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="relative isolate flex w-full flex-col items-center overflow-hidden rounded-3xl px-3 pb-0 pt-6 text-[#eef2f8]"
      style={{ background: `radial-gradient(80% 60% at 50% 0%, rgba(${beam},.20), transparent 60%), radial-gradient(60% 40% at 50% 100%, rgba(244,205,106,.14), transparent 70%), #070b14` }}>
      {/* spotlights */}
      {[{ side: 'left-[16%] -rotate-[13deg]', c: beam, d: '0s' }, { side: 'right-[16%] rotate-[13deg]', c: '244,205,106', d: '-3s' }].map((l, i) => (
        <div key={i} className={`pp-beam pointer-events-none absolute -top-8 h-[125%] w-[34%] origin-top blur-2xl ${l.side}`} style={{ animationDelay: l.d }}>
          <div className="h-full w-full" style={{ background: `linear-gradient(180deg, rgba(${l.c},.30), rgba(${l.c},.10) 55%, transparent 80%)`, clipPath: 'polygon(44% 0,56% 0,100% 100%,0 100%)' }} />
        </div>
      ))}
      <Confetti colors={['#f7d774', '#fff1bd', '#dfe4ec', `rgb(${beam})`, '#e2a866']} />

      <div className="relative z-[1] mb-6 text-center">
        {title && <div className="font-display text-sm font-semibold tracking-wide text-[#9aa7bd]">{title}</div>}
        <div className={`mt-1 flex items-center justify-center gap-2 font-display text-lg font-bold uppercase tracking-[0.2em] ${tone.text}`}>
          <span>{SPORT_ICON[sport]}</span><span>{SPORT_LABEL[sport]}</span>
        </div>
        <div className={`font-cer font-black tracking-[0.12em] ${S.head}`}
          style={{ backgroundImage: 'linear-gradient(180deg,#ffffff,#f3e2ae 55%,#d9a94a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
          Champions
        </div>
        {f && k.runnerUp && (
          <div className="mt-1 text-sm text-[#b6c1d3]">
            Won the Final {won} against {teamName(b, k.runnerUp)}
          </div>
        )}
      </div>

      <div className="relative z-[1] flex items-end justify-center gap-2 sm:gap-4">
        {spot(k.runnerUp, 'silver', 2, 0.55)}
        {spot(k.champion, 'gold', 1, 1.0)}
        {spot(k.thirdPlace, 'bronze', 3, 0.1)}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6" style={{ background: 'linear-gradient(180deg,transparent,rgba(0,0,0,.55))' }} />
    </div>
  )
}

// ---------------------------------------------------------------- bracket
type Slot = { id: string | null; label: string; seed?: string }

function UnitChips({ t, sport, big }: { t: Tie; sport: Sport; big?: boolean }) {
  const tone = SPORT_TONE[sport]
  return (
    <div className={`flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 ${big ? 'text-sm' : 'text-[11px]'} text-fg-subtle`}>
      {t.units.map(u => {
        const live = u.sets.some(s => s.status === 'live')
        const bo3 = u.sets[0].set_no != null
        const g = u.sets[0]
        const played = u.sets.some(s => s.status === 'finished' || s.status === 'live')
        const txt = !played ? '—' : bo3 ? `${u.aSets}–${u.bSets}` : `${g.score_a}–${g.score_b}`
        return (
          <span key={u.label + g.id} className="tabular whitespace-nowrap">
            <span className={`font-display font-bold ${tone.text}`}>{u.label}</span>{' '}
            <span className={live ? 'font-bold text-fg' : u.winner ? 'text-fg-muted' : ''}>{txt}</span>
            {live && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[rgb(var(--brand))] align-middle" />}
          </span>
        )
      })}
    </div>
  )
}

function TieNode({ b, sport, title, tie, slots, metal, big }: {
  b: Bundle; sport: Sport; title: string; tie?: Tie; slots: [Slot, Slot]
  metal?: 'gold' | 'bronze'; big?: boolean
}) {
  const tone = SPORT_TONE[sport]
  const live = !!tie?.games.some(g => g.status === 'live')
  const provisional = !tie
  const border = metal === 'gold' ? 'border-[#c99a3c]' : metal === 'bronze' ? 'border-[#9c6522]/70' : live ? tone.border : 'border-line'
  const glow = metal === 'gold' ? { boxShadow: '0 0 40px -16px rgba(244,205,106,.7)' } : undefined
  const row = (s: Slot, games: number | null, win: boolean, lose: boolean) => (
    <div className={`grid grid-cols-[1.9rem_1.4rem_minmax(0,1fr)_auto] items-center gap-2 px-3 ${big ? 'py-2 text-lg' : 'py-1.5 text-sm'}`}>
      <span className={`text-[10px] font-bold tracking-wider ${s.seed ? tone.text : 'text-fg-subtle'}`}>{s.seed ?? ''}</span>
      <span className={`grid place-items-center overflow-hidden rounded-full bg-surface-2 ${big ? 'h-6 w-6' : 'h-5 w-5'}`}>
        {s.id && <Mark b={b} id={s.id} px={big ? 24 : 20} />}
      </span>
      <span className={`truncate ${!s.id ? 'italic text-fg-subtle' : win ? 'font-bold text-fg' : lose ? 'text-fg-subtle' : provisional ? 'text-fg-muted' : 'text-fg'}`}>
        {s.id ? teamName(b, s.id) : s.label}
      </span>
      <span className={`tabular font-display font-bold ${big ? 'text-2xl' : 'text-lg'} ${win ? (metal === 'gold' ? 'text-gold' : tone.text) : 'text-fg-subtle'}`}>
        {games ?? ''}
      </span>
    </div>
  )
  const started = !!tie && tie.games.some(g => g.status !== 'scheduled' && g.status !== 'on_deck')
  const aWin = !!tie?.winner && tie.winner === tie.a
  const bWin = !!tie?.winner && tie.winner === tie.b
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${border}`} style={glow}>
      <div className={`flex items-center justify-between gap-2 px-3 pt-2 font-bold uppercase tracking-widest ${big ? 'text-xs' : 'text-[10px]'} ${metal === 'gold' ? 'font-cer text-gold' : 'text-fg-subtle'}`}>
        <span>{title}</span>
        {live ? <Pill tone="live">● live</Pill>
          : tie?.winner ? <span className="text-fg-subtle">decided</span>
          : provisional && slots[0].id ? <span className="normal-case tracking-normal text-fg-subtle">if the groups ended now</span>
          : null}
      </div>
      <div className="divide-y divide-line/60">
        {row(slots[0], started ? tie!.aGames : null, aWin, bWin)}
        {row(slots[1], started ? tie!.bGames : null, bWin, aWin)}
      </div>
      {tie && started && <UnitChips t={tie} sport={sport} big={big} />}
    </div>
  )
}

/** Semi-finals feeding the Final, with the 3rd-place tie under it. Before a
 *  stage is drawn its slots show who would be there (provisional). */
export function KnockoutBracket({ b, sport, big = false }: { b: Bundle; sport: Sport; big?: boolean }) {
  const k = koState(b)
  const gev = groupEvents(b)[0]
  const plan = gev ? semiPlan(b, gev.id) : null
  const fp = finalsPlan(b)
  if (plan && !plan.supported && !k.sf1 && !k.final) {
    return <div className="rounded-xl border border-line p-4 text-sm text-fg-subtle">Knockout needs two groups (or one group of four or more).</div>
  }
  const sfSlots = (i: 0 | 1): [Slot, Slot] => {
    const t = i === 0 ? k.sf1 : k.sf2
    const p = plan?.sf[i]
    const seedOf = (id: string | null) =>
      p ? (p.a.team?.id === id ? p.a.seed : p.b.team?.id === id ? p.b.seed : undefined) : undefined
    if (t) return [{ id: t.a, label: '', seed: seedOf(t.a) }, { id: t.b, label: '', seed: seedOf(t.b) }]
    return [
      { id: p?.a.team?.id ?? null, label: p?.a.seed ?? 'TBD', seed: p?.a.seed },
      { id: p?.b.team?.id ?? null, label: p?.b.seed ?? 'TBD', seed: p?.b.seed },
    ]
  }
  const later = (t: Tie | undefined, pair: [string, string] | null, ph: [string, string]): [Slot, Slot] =>
    t ? [{ id: t.a, label: '' }, { id: t.b, label: '' }]
      : pair ? [{ id: pair[0], label: '' }, { id: pair[1], label: '' }]
      : [{ id: null, label: ph[0] }, { id: null, label: ph[1] }]
  const cols = big ? 'grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)]'
  const line = big ? 'block' : 'hidden lg:block'
  return (
    <div className={`grid gap-x-0 gap-y-4 ${cols}`}>
      <div className="space-y-4">
        <TieNode b={b} sport={sport} big={big} title={STAGE_LABEL.SF1} tie={k.sf1} slots={sfSlots(0)} />
        <TieNode b={b} sport={sport} big={big} title={STAGE_LABEL.SF2} tie={k.sf2} slots={sfSlots(1)} />
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`${line} h-full w-full text-line-strong`} aria-hidden="true">
        <path d="M0 25 H50 V75 H0 M50 50 H100" fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex flex-col justify-center">
        <TieNode b={b} sport={sport} big={big} title={STAGE_LABEL.F} metal="gold" tie={k.final}
          slots={later(k.final, fp.final, ['Winner semi-final 1', 'Winner semi-final 2'])} />
      </div>
      <div className={`${line} ${big ? 'col-span-2' : 'lg:col-span-2'}`} />
      <div className="space-y-4">
        {k.champion && (
          <div className="flex items-center justify-center gap-2 rounded-full border border-[#c99a3c]/60 bg-[#f4cd6a]/10 px-4 py-1.5">
            <Cup px={big ? 26 : 20} />
            <span className={`font-cer font-bold text-gold ${big ? 'text-xl' : 'text-base'}`}>{teamName(b, k.champion)}</span>
          </div>
        )}
        <TieNode b={b} sport={sport} big={big} title={STAGE_LABEL['3P']} metal="bronze" tie={k.third}
          slots={later(k.third, fp.third, ['Loser semi-final 1', 'Loser semi-final 2'])} />
      </div>
    </div>
  )
}

/** Gold strip over the courts while a Final is being played. */
export function FinalBanner({ b, t, big = false }: { b: Bundle; t: Tie; big?: boolean }) {
  const name = (id: string | null) => teamName(b, id)
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-[#c99a3c]/70 px-4 py-3 text-center"
      style={{ background: 'radial-gradient(70% 120% at 50% 0%, rgba(244,205,106,.18), transparent 70%), rgb(var(--surface))' }}>
      <div className={`font-cer font-bold tracking-[0.3em] text-gold ${big ? 'text-base' : 'text-xs'}`}>THE FINAL</div>
      <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <span className={`truncate text-right font-display font-bold ${big ? 'text-3xl' : 'text-lg'}`}>{name(t.a)}</span>
        <span className={`tabular font-display font-bold text-gold ${big ? 'text-6xl' : 'text-4xl'}`}>{t.aGames}–{t.bGames}</span>
        <span className={`truncate text-left font-display font-bold ${big ? 'text-3xl' : 'text-lg'}`}>{name(t.b)}</span>
      </div>
      <div className={`mt-1 flex flex-wrap justify-center gap-x-4 ${big ? 'text-base' : 'text-xs'} text-fg-muted`}>
        {t.units.map(u => (
          <span key={u.label} className="tabular whitespace-nowrap">
            <span className="font-display font-bold text-gold">{u.label}</span> {u.aSets}–{u.bSets}
            {u.sets.some(s => s.status === 'live') && <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[rgb(var(--brand))] align-middle" />}
          </span>
        ))}
      </div>
    </div>
  )
}

/** True when the screen is at least `px` wide (board ceremony size). */
export function useWide(px = 1024): boolean {
  const q = `(min-width: ${px}px)`
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const h = () => setOn(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [q])
  return on
}
