/** Knockout bracket for a phone: the same picture as the wide poster bracket,
 *  turned upright. The top half of the draw comes down, the bottom half comes
 *  up, and they meet at the Final in the middle. Full names, readable scores. */
import type { Bundle, EventCfg, Match } from '../lib/types'
import { teamName } from '../lib/store'
import TeamMark from './TeamMark'
import { koSlotLabel } from '../lib/pool'

type Col = { round: string; matches: Match[] }

function roundTitle(col: Col, m: Match, all: Match[]): string {
  if (m.round === 'Final') return all.filter(x => x.round === 'Final').length > 1 ? `Final · game ${all.filter(x => x.round === 'Final').indexOf(m) + 1}` : 'Final'
  if (m.round === 'Third place') return '3rd place'
  const same = all.filter(x => x.round === m.round)
  return `${col.round} ${same.findIndex(x => x.id === m.id) + 1}`
}

function Side({ b, ev, m, s, big }: { b: Bundle; ev: EventCfg; m: Match; s: 'a' | 'b'; big?: boolean }) {
  const id = s === 'a' ? m.team_a_id : m.team_b_id
  const score = s === 'a' ? m.score_a : m.score_b
  const done = m.status === 'finished'
  const live = (m.status === 'live' || m.status === 'awaiting_confirm') && (m.score_a > 0 || m.score_b > 0 || !!m.started_at)
  const win = done && m.winner_id === id
  const lose = done && !!id && m.winner_id !== id
  if (!id) {
    return (
      <div className={`flex items-center gap-2 border-l-[3px] border-transparent px-2.5 ${big ? 'py-3' : 'py-2.5'}`}>
                <span className={`min-w-0 flex-1 italic text-fg-subtle ${big ? 'text-sm' : 'text-xs'}`}>{ev.bracket_preview ? koSlotLabel(b, ev, m, s) : 'To be decided'}</span>
      </div>
    )
  }
  const parts = teamName(b, id).split(' & ')
  return (
    <div className={`flex items-center gap-2 border-l-[3px] px-2.5 ${big ? 'py-2.5' : 'py-2'} ${win ? 'border-gold bg-gold/10' : 'border-transparent'} ${lose ? 'opacity-50' : ''}`}>
      <TeamMark nameOnly b={b} id={id} box={big ? 'h-7 w-9' : 'h-5 w-7'} ring={big ? 'h-9 w-9 text-sm' : 'h-7 w-7 text-[11px]'} />
      <span className={`min-w-0 flex-1 break-words leading-tight ${big ? 'text-[19px]' : 'text-[15px]'} ${win || live ? 'font-bold text-fg' : 'font-semibold text-fg-muted'}`}>
        {parts.length === 2 ? <>{parts[0]}<br />{parts[1]}</> : parts[0]}
      </span>
      {(done || live) && <span className={`tabular shrink-0 font-display font-bold leading-none ${big ? 'text-2xl' : 'text-lg'} ${win ? 'text-gold' : live ? 'text-brand-ink' : 'text-fg-subtle'}`}>{score}</span>}
    </div>
  )
}

function Card({ b, ev, m, title, big, gold }: { b: Bundle; ev: EventCfg; m: Match; title: string; big?: boolean; gold?: boolean }) {
  const live = m.status === 'live' || m.status === 'awaiting_confirm'
  const started = live && (m.score_a > 0 || m.score_b > 0 || !!m.started_at)
  const courtNo = b.courts.find(c => c.id === m.court_id)?.number ?? ev.ko_court_plan?.[m.bracket_key ?? ''] ?? null
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${started ? 'border-brand pp-live' : gold ? 'border-gold/60' : 'border-line'}`}
      style={gold ? { boxShadow: '0 0 34px -14px rgba(244,205,106,0.7)' } : undefined}>
      <div className={`flex items-center justify-between gap-2 px-2.5 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] ${gold ? 'text-gold' : 'text-fg-subtle'}`}>
        <span className="truncate">{title}</span>
        {started
          ? <span className="flex shrink-0 items-center gap-1 text-[#34d399]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />live</span>
          : m.status === 'finished' ? <span className="shrink-0 font-semibold normal-case tracking-normal">full time</span>
          : courtNo != null ? <span className="shrink-0 font-semibold normal-case tracking-normal">Court {courtNo}</span> : null}
      </div>
      <Side b={b} ev={ev} m={m} s="a" big={big} />
      <div className="mx-2.5 h-px bg-line" />
      <Side b={b} ev={ev} m={m} s="b" big={big} />
    </div>
  )
}

/** lines between two rows: `from` cards above (or below when `up`) joining `to` cards */
function Join({ from, to, up }: { from: number; to: number; up?: boolean }) {
  const d = from === 2 && to === 1 ? 'M25 0 V50 H75 V0 M50 50 V100' : 'M50 0 V100'
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={`h-5 w-full text-fg-subtle/60 ${up ? 'rotate-180' : ''}`} aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Row({ b, ev, col, all }: { b: Bundle; ev: EventCfg; col: Col; all: Match[] }) {
  const n = col.matches.length
  return (
    <div className={n === 1 ? 'mx-auto w-[64%]' : 'grid grid-cols-2 gap-2'}>
      {col.matches.map(m => <Card key={m.id} b={b} ev={ev} m={m} title={roundTitle(col, m, all)} />)}
    </div>
  )
}

export default function PhoneBracket({ b, ev, top, bottom, finals, third }: {
  b: Bundle; ev: EventCfg
  /** each half of the draw, earliest round first */
  top: Col[]; bottom: Col[]; finals: Match[]; third?: Match
}) {
  const all = b.matches.filter(m => m.event_id === ev.id && m.bracket_key != null).sort((x, y) => x.sequence - y.sequence)
  const finalCol: Col = { round: 'Final', matches: finals }
  return (
    <div className="mx-auto max-w-md px-3 py-4" style={{ background: 'radial-gradient(60% 30% at 50% 50%, rgba(244,205,106,0.07), transparent 70%)' }}>
      {top.map((col, i) => (
        <div key={'t' + i}>
          <Row b={b} ev={ev} col={col} all={all} />
          <Join from={Math.min(2, col.matches.length)} to={Math.min(2, top[i + 1]?.matches.length ?? 1)} />
        </div>
      ))}
      <div className="space-y-2">
        {finals.map(m => <Card key={m.id} b={b} ev={ev} m={m} title={`🏆 ${roundTitle(finalCol, m, all)}`} big gold />)}
      </div>
      {[...bottom].reverse().map((col, i, arr) => (
        <div key={'b' + i}>
          <Join up from={Math.min(2, col.matches.length)} to={Math.min(2, arr[i - 1]?.matches.length ?? 1)} />
          <Row b={b} ev={ev} col={col} all={all} />
        </div>
      ))}
      {third && (
        <div className="mt-5 border-t border-line/60 pt-4">
          <div className="mx-auto w-[64%]"><Card b={b} ev={ev} m={third} title="🥉 3rd place" /></div>
        </div>
      )}
    </div>
  )
}
