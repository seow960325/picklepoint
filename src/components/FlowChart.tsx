/** Full-picture flow (no scores): groups -> places -> playoff -> semis -> final. */
import type { Bundle } from '../lib/types'
import { teamName, teamLogo } from '../lib/store'
import { Emblem } from './ui'
import type { Flow, FlowGame, FlowSlot } from '../lib/flow'

const C = {
  group: ['border-[#f472b6]/40 bg-[#f472b6]/10', 'border-[#5aa9ff]/40 bg-[#5aa9ff]/10'],
  place: ['border-[#34d399]/40 bg-[#34d399]/10', 'border-[#facc15]/40 bg-[#facc15]/10', 'border-[#94a3b8]/40 bg-[#94a3b8]/10'],
  playoff: 'border-[#facc15]/50 bg-[#facc15]/10',
  semi: 'border-[#5aa9ff]/50 bg-[#5aa9ff]/10',
  final: 'border-[#f4cd6a]/70 bg-[#f4cd6a]/15',
  third: 'border-[#d97706]/50 bg-[#d97706]/10',
}

function Name({ b, id, prov, win, lose }: { b: Bundle; id: string | null; prov?: boolean; win?: boolean; lose?: boolean }) {
  if (!id) return <span className="text-fg-subtle">—</span>
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${win ? 'font-bold text-fg' : lose ? 'text-fg-subtle line-through decoration-1' : prov ? 'italic text-fg-muted' : 'font-semibold text-fg'}`}>
      <Emblem logo={teamLogo(b, id)} flagName={teamName(b, id)} className="h-5 w-5 shrink-0 rounded-[2px]" />
      <span className="truncate">{teamName(b, id)}</span>
      {prov && !win && !lose && <span className="shrink-0 rounded bg-amber-400/20 px-1 text-[9px] font-bold uppercase not-italic text-amber-500">so far</span>}
      {win && <span className="shrink-0 text-[#34d399]">✓</span>}
    </span>
  )
}

function Game({ b, g, tone, icon }: { b: Bundle; g: FlowGame; tone: string; icon?: string }) {
  const row = (s: FlowSlot) => (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{s.label}</div>
      <Name b={b} id={s.id} prov={s.prov} win={!!g.winner && g.winner === s.id} lose={!!g.winner && !!s.id && g.winner !== s.id} />
    </div>
  )
  return (
    <div className={`rounded-xl border p-2.5 ${tone}`}>
      <div className="mb-1.5 flex items-center justify-between font-display text-sm font-bold uppercase tracking-wider">
        <span>{icon} {g.title}</span>
        {g.live && <span className="animate-pulse rounded bg-red-500 px-1.5 text-[10px] text-white">LIVE</span>}
      </div>
      {row(g.a)}
      <div className="my-0.5 text-center text-[10px] text-fg-subtle">vs</div>
      {row(g.b)}
    </div>
  )
}

// phone: stages stacked top to bottom, the two games of a stage side by side
// wide screen: stages left to right like the organiser's chart
const Col = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex w-full shrink-0 flex-col lg:w-52">
    <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-fg-subtle">{title}</div>
    <div className="grid flex-1 grid-cols-2 gap-2 lg:flex lg:flex-col lg:justify-around lg:gap-3">{children}</div>
  </div>
)
const Arrow = () => (
  <div className="flex shrink-0 items-center justify-center py-1 text-xl text-fg-subtle lg:px-1 lg:py-0">
    <span className="lg:hidden">↓</span><span className="hidden lg:inline">→</span>
  </div>
)

export default function FlowChart({ b, flow }: { b: Bundle; flow: Flow }) {
  const g = flow.games
  return (
    <div className="px-3 py-4 lg:overflow-x-auto lg:px-6">
      {flow.champion && (
        <div className="mx-auto mb-4 w-fit rounded-xl border border-[#f4cd6a]/70 bg-[#f4cd6a]/15 px-5 py-2 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-fg-subtle">Champion</div>
          <div className="font-display text-2xl font-black">🏆 {teamName(b, flow.champion)}</div>
        </div>
      )}
      <div className="mx-auto flex max-w-xl flex-col lg:w-max lg:max-w-none lg:flex-row lg:items-stretch">
        <Col title="Groups">
          {flow.groups.map((gr, i) => (
            <div key={gr.pool} className={`rounded-xl border p-2.5 ${C.group[i]}`}>
              <div className="mb-1 font-display text-lg font-bold">Group {gr.pool}</div>
              <div className="space-y-1 text-sm">{gr.ids.map(id => <Name key={id} b={b} id={id} />)}</div>
              <div className="mt-1 text-[10px] text-fg-subtle">round robin</div>
            </div>
          ))}
        </Col>
        <Arrow />
        <Col title="Group places">
          {flow.groups.map(gr => (
            <div key={gr.pool} className="space-y-1.5">
              {gr.places.map((p, i) => (
                <div key={p.label} className={`rounded-lg border px-2 py-1.5 ${C.place[i]}`}>
                  <div className="flex justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                    <span>{p.label}</span><span className="hidden normal-case tracking-normal lg:inline">→ {p.to}</span>
                  </div>
                  <div className="text-sm"><Name b={b} id={p.id} prov={p.prov} /></div>
                </div>
              ))}
            </div>
          ))}
        </Col>
        <Arrow />
        <Col title="Playoff">
          <Game b={b} g={g.P1} tone={C.playoff} />
          <Game b={b} g={g.P2} tone={C.playoff} />
        </Col>
        <Arrow />
        <Col title="Semi-finals">
          <Game b={b} g={g.SF1} tone={C.semi} />
          <Game b={b} g={g.SF2} tone={C.semi} />
        </Col>
        <Arrow />
        <Col title="Medals">
          <Game b={b} g={g.F} tone={C.final} icon="🏆" />
          <Game b={b} g={g['3P']} tone={C.third} icon="🥉" />
        </Col>
      </div>
      <div className="mt-3 text-center text-[11px] text-fg-subtle">
        SO FAR = current group position, not final yet. ✓ = winner.
      </div>
    </div>
  )
}
