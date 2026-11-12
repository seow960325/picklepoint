/** Event title with a small pickleball that keeps the page alive: it drops in and hops slowly from
 *  word to word (each word appears as the ball lands on it), then stays around for good, resting on
 *  a word for a while, then jumping to another one, sometimes on the top line, sometimes the bottom.
 *  Without animation support (or with reduced motion) it is just the plain title. */
import { useLayoutEffect, useRef } from 'react'

const UP = 'cubic-bezier(.15,.6,.45,1)', DOWN = 'cubic-bezier(.55,0,.85,.4)'
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export default function BounceTitle({ text, className = '' }: { text: string; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null), bx = useRef<HTMLSpanElement>(null), by = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const w = wrap.current, x = bx.current, y = by.current
    if (!w || !x || !y || typeof w.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const words = Array.from(w.querySelectorAll<HTMLElement>('[data-w]'))
    if (!words.length) return
    let dead = false
    const live: Animation[] = []
    const timers: number[] = []
    const wait = (ms: number) => new Promise<void>(r => { timers.push(window.setTimeout(r, ms)) })
    const d = y.offsetWidth
    // where the ball sits on a word: somewhere along its top edge (measured fresh, so rotation / resize is fine)
    const spot = (el: HTMLElement, at = rnd(0.2, 0.8)) => {
      const b = w.getBoundingClientRect(), r = el.getBoundingClientRect()
      return { x: r.left - b.left + r.width * at - d / 2, y: r.top - b.top - d + r.height * 0.16, ok: r.width > 0 && r.bottom <= b.bottom + 2 }
    }
    let pos = { x: 0, y: 0 }
    const place = (p: { x: number; y: number }) => { pos = p; x.style.transform = `translateX(${p.x}px)`; y.style.transform = `translateY(${p.y}px)` }
    /** one jump from where the ball is to `to`, `ms` long, `h` high */
    const hop = async (to: { x: number; y: number }, ms: number, h: number) => {
      const from = pos, top = Math.min(from.y, to.y) - h
      const ax = x.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], { duration: ms, easing: 'linear', fill: 'forwards' })
      const ay = y.animate([
        { transform: `translateY(${from.y}px)`, easing: UP }, { transform: `translateY(${top}px)`, offset: 0.5, easing: DOWN }, { transform: `translateY(${to.y}px)` },
      ], { duration: ms, fill: 'forwards' })
      live.push(ax, ay)
      await Promise.all([ax.finished, ay.finished]).catch(() => {})
      if (dead) return
      place(to); ax.cancel(); ay.cancel(); live.length = 0
    }
    const show = (el: HTMLElement) => {
      el.style.opacity = ''
      live.push(el.animate([{ opacity: 0, transform: 'translateY(.2em) scale(.85)' }, { opacity: 1, transform: 'translateY(-.04em) scale(1.04)', offset: 0.6 }, { opacity: 1, transform: 'none' }],
        { duration: 420, easing: 'ease-out' }))
    }

    void (async () => {
      const seen = words.filter(el => spot(el).ok)                 // words cut off by the 2-line clamp are left alone
      if (!seen.length) return
      seen.forEach(el => { el.style.opacity = '0' })
      const first = spot(seen[0], 0.5)
      place({ x: first.x - d * 4, y: first.y - d * 2 })
      await wait(450)
      if (dead) return
      y.style.opacity = '1'
      // intro: one slow jump per word
      for (let i = 0; i < seen.length && !dead; i++) {
        await hop(spot(seen[i], 0.5), 620, d * 2.4)
        if (dead) return
        show(seen[i])
        await wait(380)
      }
      // alive: rest, then a little bounce in place or a jump to another word (other line included)
      let cur = seen.length - 1
      while (!dead) {
        await wait(rnd(1800, 5200))
        if (dead) return
        if (document.hidden) continue
        if (Math.random() < 0.3) { await hop(pos, 480, d * 1.3); continue }
        let next = Math.floor(Math.random() * seen.length)
        if (seen.length > 1 && next === cur) next = (next + 1) % seen.length
        const to = spot(seen[next])
        if (!to.ok) continue
        const far = Math.hypot(to.x - pos.x, to.y - pos.y)
        await hop(to, Math.min(1100, 520 + far * 2.2), d * rnd(2, 3.2))
        cur = next
      }
    })()

    return () => {
      dead = true
      timers.forEach(t => window.clearTimeout(t)); live.forEach(a => a.cancel())
      words.forEach(el => { el.style.opacity = '' }); y.style.opacity = '0'
    }
  }, [text])

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <div className="line-clamp-2">
        {text.split(/\s+/).filter(Boolean).map((word, i) => (
          <span key={i}><span data-w className="inline-block whitespace-nowrap">{word}</span>{' '}</span>
        ))}
      </div>
      <span ref={bx} className="pointer-events-none absolute left-0 top-0" aria-hidden="true">
        <span ref={by} className="pp-ball block" style={{ opacity: 0 }} />
      </span>
    </div>
  )
}
