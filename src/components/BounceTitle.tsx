/** Event title where a small pickleball bounces from letter to letter; each letter pops in as the
 *  ball lands on it, then the ball hops away. Plays once on load; tap the title to play it again.
 *  Without animation support (or with reduced motion) it is just the plain title. */
import { useLayoutEffect, useRef, useState } from 'react'

const HOP = 115, START = 350

export default function BounceTitle({ text, className = '' }: { text: string; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null), bx = useRef<HTMLSpanElement>(null), by = useRef<HTMLSpanElement>(null)
  const [run, setRun] = useState(0)
  useLayoutEffect(() => {
    const w = wrap.current, x = bx.current, y = by.current
    if (!w || !x || !y || typeof w.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const box = w.getBoundingClientRect()
    const chars = Array.from(w.querySelectorAll<HTMLElement>('[data-ch]'))
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(c => c.r.width > 0 && c.r.bottom <= box.bottom + 2)      // letters cut off by the 2-line clamp are skipped
    if (!chars.length) return
    const d = y.offsetWidth, h = d * 1.5
    const pts = chars.map(c => ({ x: c.r.left + c.r.width / 2 - box.left - d / 2, y: c.r.top - box.top - d + c.r.height * 0.16 }))
    const last = pts[pts.length - 1]
    const all = [{ x: pts[0].x - d * 3, y: pts[0].y - d }, ...pts, { x: last.x + d * 3.5, y: last.y + d * 2.5 }]
    const n = all.length - 1, total = n * HOP
    const xs = all.map((p, i) => ({ transform: `translateX(${p.x}px)`, offset: i / n }))
    const ys: Keyframe[] = []
    all.forEach((p, i) => {
      ys.push({ transform: `translateY(${p.y}px)`, opacity: i === 0 || i === n ? 0 : 1, offset: i / n, easing: 'cubic-bezier(.15,.6,.45,1)' })
      if (i < n) ys.push({ transform: `translateY(${Math.min(p.y, all[i + 1].y) - h}px)`, opacity: 1, offset: (i + 0.5) / n, easing: 'cubic-bezier(.55,0,.85,.4)' })
    })
    const anims = [
      x.animate(xs, { duration: total, delay: START, fill: 'both', easing: 'linear' }),
      y.animate(ys, { duration: total, delay: START, fill: 'both' }),
      ...chars.map((c, i) => c.el.animate(
        [{ opacity: 0, transform: 'translateY(.25em) scale(.5)' }, { opacity: 1, transform: 'translateY(.06em) scale(1.12)', offset: 0.6 }, { opacity: 1, transform: 'none' }],
        { duration: 240, delay: START + (i + 1) * HOP - 30, fill: 'backwards', easing: 'ease-out' })),
    ]
    return () => anims.forEach(a => a.cancel())
  }, [text, run])

  return (
    <div ref={wrap} className={`relative ${className}`} onClick={() => setRun(r => r + 1)}>
      <div className="line-clamp-2">
        {text.split(/\s+/).filter(Boolean).map((word, i) => (
          <span key={i}><span className="inline-block whitespace-nowrap">
            {Array.from(word).map((ch, k) => <span key={k} data-ch className="inline-block">{ch}</span>)}
          </span>{' '}</span>
        ))}
      </div>
      <span ref={bx} className="pointer-events-none absolute left-0 top-0" aria-hidden="true">
        <span ref={by} className="pp-ball block" style={{ opacity: 0 }} />
      </span>
    </div>
  )
}
