/** Venue map (X Park PJ South): a Map button that opens the floor plan full screen.
 *  `courts` rings the courts of one category (pulsing), so people see where to go. */
import { useState } from 'react'

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

export default function MapButton({ src = '/yc26-map.jpg', sport, courts, className = '', label = 'Map' }: {
  src?: string; sport?: Sport; courts?: number[]; className?: string; label?: string
}) {
  const [open, setOpen] = useState(false)
  const mc = src.includes('mc26')
  const W_ = mc ? MC.W : W, H_ = mc ? MC.H : H
  const rings = sport && courts ? courts.map(n => (mc ? MC.XY[n] : XY[sport][n])).filter(Boolean) : []
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Venue map"
        className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-fg-muted active:bg-surface-2 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>{label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black/90" onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="font-display text-lg font-bold tracking-wide">Venue map{courts?.length ? ` · ${sport === 'captainball' ? 'Captain Ball' : sport === 'badminton' ? 'Badminton' : 'Pickleball'} court ${courts.join(', ')}` : ''}</span>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-xl" aria-label="Close">×</button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2" onClick={e => e.stopPropagation()}>
            <div className="relative max-h-full" style={{ aspectRatio: `${W_} / ${H_}`, height: '100%', maxWidth: '100%' }}>
              <img src={src} alt="Venue map" className="h-full w-full select-none rounded-lg bg-white object-contain" draggable={false} />
              {rings.map(([x, y], i) => (
                <span key={i} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x / W_ * 100}%`, top: `${y / H_ * 100}%` }}>
                  <span className="absolute inset-0 animate-ping rounded-full bg-red-500/60" style={{ width: '9vmin', height: '9vmin', margin: '-4.5vmin' }} />
                  <span className="block rounded-full border-[3px] border-red-500 bg-red-500/25" style={{ width: '9vmin', height: '9vmin', margin: '-4.5vmin' }} />
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
