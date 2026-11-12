/** Venue map (X Park PJ South): a Map button that opens the floor plan full screen.
 *  `courts` rings the courts of one category (pulsing), so people see where to go. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hubOf, parentHub } from '../lib/hub'

type Sport = 'pickleball' | 'badminton' | 'captainball'
// centre of each court number on the 780 x 1160 map image
const XY: Record<Sport, Record<number, [number, number]>> = {
  pickleball: { 1: [155, 764], 2: [155, 663], 3: [155, 562], 4: [155, 462], 5: [155, 361], 6: [155, 261] },
  badminton: { 1: [621, 258], 2: [621, 342], 3: [621, 427], 4: [621, 512], 5: [621, 596], 6: [621, 681], 7: [621, 765], 8: [621, 850] },
  captainball: { 1: [364, 364], 2: [364, 662], 3: [210, 962] },
}
const W = 780, H = 1160
// MC26 map (960 x 1098): pickleball courts only
const MC = { W: 960, H: 1098, XY: { 1: [682, 763], 2: [510, 763], 3: [338, 763], 4: [408, 462], 5: [408, 298], 6: [408, 137], 7: [682, 190] } as Record<number, [number, number]> }

/** The floor plan in a medium card (not full screen), a red ring on each court of `courts`.
 *  Tap anywhere outside, the Close button, or Esc to close. */
function MapModal({ src, sport, courts, onClose }: { src: string; sport?: Sport; courts?: number[]; onClose: () => void }) {
  const mc = src.includes('mc26')
  const W_ = mc ? MC.W : W, H_ = mc ? MC.H : H
  const rings = sport && courts ? courts.map(n => (mc ? MC.XY[n] : XY[sport][n])).filter(Boolean) : []
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const title = courts?.length ? `${sport === 'captainball' ? 'Captain Ball' : sport === 'badminton' ? 'Badminton' : 'Pickleball'} court ${courts.join(', ')}` : 'Venue map'
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      onClick={e => { e.preventDefault(); e.stopPropagation(); onClose() }}>
      <div className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="min-w-0 truncate font-display text-base font-bold tracking-wide">{title}</span>
          <button type="button" onClick={onClose} aria-label="Close map"
            className="shrink-0 rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-brand-fg">Close</button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-white p-1.5">
          <div className="relative" style={{ width: `min(100%, calc(62vh * ${W_ / H_}))`, aspectRatio: `${W_} / ${H_}` }}>
            <img src={src} alt="Venue map" className="absolute inset-0 h-full w-full select-none" draggable={false} />
            {rings.map(([x, y], i) => (
              <span key={i} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${x / W_ * 100}%`, top: `${y / H_ * 100}%`, width: '12%', aspectRatio: '1 / 1' }}>
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500/50" />
                <span className="absolute inset-0 rounded-full border-[3px] border-red-500 bg-red-500/20" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>, document.body)
}

/** map + sport of a category code (YC26 / MC26 hubs), or null when it has no venue map */
export function mapOf(code?: string | null): { src: string; sport: Sport } | null {
  const up = String(code ?? '').toUpperCase()
  const h = parentHub(up) ?? hubOf(up)
  const sport = h?.cats.find(c => c.code === up)?.sport
  return h?.map && sport ? { src: h.map, sport } : null
}

/** A court number you can tap: opens the venue map with that court ringed in red. */
export function CourtTag({ code, n, children, className = '' }: { code?: string | null; n: number | null | undefined; children?: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const mp = mapOf(code)
  if (!mp || n == null) return <>{children}</>
  return (
    <>
      <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        className={`inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 ${className}`} aria-label={`Show court ${n} on the map`}>
        <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
        {children}
      </button>
      {open && <MapModal src={mp.src} sport={mp.sport} courts={[n]} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function MapButton({ src = '/yc26-map.jpg', sport, courts, className = '', label = 'Map' }: {
  src?: string; sport?: Sport; courts?: number[]; className?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Venue map"
        className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-fg-muted active:bg-surface-2 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>{label}
      </button>
      {open && <MapModal src={src} sport={sport} courts={courts} onClose={() => setOpen(false)} />}
    </>
  )
}
