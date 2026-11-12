/** Event title with a small pickleball that keeps the page alive: it drops in and hops slowly from
 *  word to word (each word appears as the ball lands on it), then stays around for good, resting on
 *  a word for a while, then jumping to another one, sometimes on the top line, sometimes the bottom.
 *  Every few jumps it is driven hard at the logo's cross, which blocks it (and shines) and sends it back.
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
    /** a drive: straight and fast, no arc */
    const shoot = async (to: { x: number; y: number }, ms: number, ease = 'cubic-bezier(.5,0,1,.6)') => {
      const from = pos
      const ax = x.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], { duration: ms, easing: ease, fill: 'forwards' })
      const ay = y.animate([{ transform: `translateY(${from.y}px)` }, { transform: `translateY(${to.y}px)` }], { duration: ms, easing: ease, fill: 'forwards' })
      live.push(ax, ay)
      await Promise.all([ax.finished, ay.finished]).catch(() => {})
      if (dead) return
      place(to); ax.cancel(); ay.cancel(); live.length = 0
    }
    /** the ball is driven hard at the centre of the logo's cross; the cross blocks it (and shines at
     *  that very moment) and the ball comes straight back onto a word */
    const drill = async (back: HTMLElement) => {
      const logo = document.querySelector<HTMLElement>('[data-event-logo]')
      if (!logo) return false
      const b = w.getBoundingClientRect(), r = logo.getBoundingClientRect()
      if (!r.width) return false
      const hit = { x: r.left - b.left + r.width * 0.573 - d / 2 + d * 0.3, y: r.top - b.top + r.height * 0.406 - d / 2 }
      await hop(pos, 420, d * 1.6)                                   // a little toss first
      if (dead) return true
      await shoot(hit, 170)
      if (dead) return true
      const cross = logo.querySelector<HTMLElement>('[data-cross]'), star = logo.querySelector<HTMLElement>('[data-star]')
      cross?.animate([
        { filter: 'drop-shadow(0 0 0 rgba(255,255,255,0)) brightness(1)' },
        { filter: 'drop-shadow(0 0 4px #fff) drop-shadow(0 0 14px rgba(255,255,255,.95)) brightness(1.35)', offset: 0.12 },
        { filter: 'drop-shadow(0 0 0 rgba(255,255,255,0)) brightness(1)' }], { duration: 900, easing: 'ease-out' })
      star?.animate([
        { transform: 'translate(-50%,-50%) scale(0) rotate(0)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.15) rotate(30deg)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%,-50%) scale(0) rotate(90deg)', opacity: 0 }], { duration: 700, easing: 'ease-out' })
      logo.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)', offset: 0.2 }, { transform: 'translateX(1px)', offset: 0.5 }, { transform: 'translateX(0)' }], { duration: 260 })
      // blocked: fast and flat back to the word, then it keeps its momentum: smaller and smaller
      // bounces and a last roll that slows to a stop, spinning the whole time
      const spin = y.animate([{ rotate: '0deg' }, { rotate: '1080deg' }], { duration: 2000, easing: 'cubic-bezier(.2,.6,.3,1)' })
      live.push(spin)
      await hop(spot(back, 0.18), 300, d * 0.9)
      for (const [at, ms, h] of [[0.4, 360, 0.8], [0.56, 270, 0.4], [0.66, 200, 0.16]] as const) {
        if (dead) return true
        await hop(spot(back, at), ms, d * h)
      }
      if (dead) return true
      const stop = spot(back, 0.86)
      await shoot({ x: stop.x, y: pos.y }, 800, 'cubic-bezier(.15,.7,.35,1)')
      return true
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
      let cur = seen.length - 1, jumps = 0, due = 3
      while (!dead) {
        await wait(rnd(1800, 5200))
        if (dead) return
        if (document.hidden) continue
        if (jumps >= due) {                                           // after a few normal jumps: the drive at the cross
          cur = Math.floor(Math.random() * seen.length)
          await drill(seen[cur])
          jumps = 0; due = 3 + Math.floor(Math.random() * 3)
          continue
        }
        jumps++
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
