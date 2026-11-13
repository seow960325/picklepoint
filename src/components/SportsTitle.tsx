/** YC26 title: three kinds of ball share the title, at most two at a time.
 *  - captain ball: carries the words in (each word appears as the ball lands on it), keeps passing
 *    from word to word a few times, then is thrown out of the box (and later comes back from the other side);
 *  - pickleball: like MC26, hops about the words at random, bounces and settles, then bounces away;
 *    it takes turns with the captain ball;
 *  - shuttlecock: flies in from outside, cork first, over the words and out the other side, again and again,
 *    from the left, then the right. It is the only one that overlaps another ball.
 *  Without animation support (or with reduced motion) it is just the plain title. */
import { useFitWords } from '../lib/useFitWords'
import { useLayoutEffect, useRef } from 'react'
import { SportIcon } from './SportIcon'
import type { Sport } from '../lib/multisport'

const UP = 'cubic-bezier(.15,.6,.45,1)', DOWN = 'cubic-bezier(.55,0,.85,.4)'
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

export default function SportsTitle({ text, className = '', sports }: { text: string; className?: string; sports: Sport[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const pbX = useRef<HTMLSpanElement>(null), pbY = useRef<HTMLSpanElement>(null), pbR = useRef<HTMLSpanElement>(null)   // pickleball
  const cbX = useRef<HTMLSpanElement>(null), cbY = useRef<HTMLSpanElement>(null), cbR = useRef<HTMLSpanElement>(null)   // captain ball
  const shT = useRef<HTMLSpanElement>(null)                                                                             // shuttlecock
  const hasPb = sports.includes('pickleball'), hasCb = sports.includes('captainball'), hasSh = sports.includes('badminton')

  useFitWords(wrap, text)
  useLayoutEffect(() => {
    const w = wrap.current
    if (!w || typeof w.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const words = Array.from(w.querySelectorAll<HTMLElement>('[data-w]'))
    if (!words.length) return
    let dead = false
    const live: Animation[] = []
    const timers: number[] = []
    const wait = (ms: number) => new Promise<void>(r => { timers.push(window.setTimeout(r, ms)) })
    const track = (a: Animation) => { live.push(a); return a }
    const done = async (...as: Animation[]) => { await Promise.all(as.map(a => a.finished)).catch(() => {}) }

    const W = () => w.getBoundingClientRect().width
    /** where an actor sits on a word: along its top edge */
    const spot = (el: HTMLElement, d: number, at = rnd(0.2, 0.8)) => {
      const b = w.getBoundingClientRect(), r = el.getBoundingClientRect()
      return { x: r.left - b.left + r.width * at - d / 2, y: r.bottom - b.top - d * 1.05, top: r.top - b.top - d + r.height * 0.16, ok: r.width > 0 && r.bottom <= b.bottom + 2 }
    }
    const seen = words.filter(el => spot(el, 10).ok)
    if (!seen.length) return

    // ---------------------------------------------------------------- a ground actor (pickleball / captain ball)
    type Pt = { x: number; y: number }
    const actor = (X: HTMLElement | null, Y: HTMLElement | null, R: HTMLElement | null) => {
      if (!X || !Y || !R) return null
      const d = Y.offsetWidth
      let pos: Pt = { x: -d * 3, y: 0 }, angle = 0
      const place = (p: Pt) => { pos = p; X.style.transform = `translateX(${p.x}px)`; Y.style.transform = `translateY(${p.y}px)` }
      const hide = () => { Y.style.opacity = '0' }
      const showIt = () => { Y.style.opacity = '1' }
      /** one jump from where it is to `to`; `spin` turns it with the travel */
      const hop = async (to: Pt, ms: number, h: number, spin = 1) => {
        const from = pos, top = Math.min(from.y, to.y) - h
        const ax = track(X.animate([{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${to.x}px)` }], { duration: ms, easing: 'linear', fill: 'forwards' }))
        const ay = track(Y.animate([{ transform: `translateY(${from.y}px)`, easing: UP }, { transform: `translateY(${top}px)`, offset: 0.5, easing: DOWN }, { transform: `translateY(${to.y}px)` }], { duration: ms, fill: 'forwards' }))
        const turn = (to.x - from.x) / (d / 2) * (180 / Math.PI) * 0.6 * spin
        const ar = track(R.animate([{ rotate: `${angle}deg` }, { rotate: `${angle + turn}deg` }], { duration: ms, easing: 'linear', fill: 'forwards' }))
        await done(ax, ay, ar)
        if (dead) return
        angle = (angle + turn) % 360; R.style.rotate = `${angle}deg`
        place(to); ax.cancel(); ay.cancel(); ar.cancel()
      }
      const settle = async (dir: number) => {
        for (const [ms, h, dx] of [[300, 0.55, 0.45], [210, 0.22, 0.2]] as const) {
          if (dead) return
          await hop({ x: pos.x + dir * d * dx, y: pos.y }, ms, d * h)
        }
      }
      return { d, hop, settle, place, hide, showIt, pos: () => pos }
    }
    const pb = hasPb ? actor(pbX.current, pbY.current, pbR.current) : null
    const cb = hasCb ? actor(cbX.current, cbY.current, cbR.current) : null

    const show = (el: HTMLElement) => {
      el.style.opacity = ''
      track(el.animate([{ opacity: 0, transform: 'translateY(.2em) scale(.85)' }, { opacity: 1, transform: 'translateY(-.04em) scale(1.04)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'ease-out' }))
    }
    const entry = (a: NonNullable<ReturnType<typeof actor>>, fromRight: boolean, target: HTMLElement) => {
      const t = spot(target, a.d, 0.5)
      a.place({ x: fromRight ? W() + a.d * 2 : -a.d * 3, y: t.y - a.d * 0.6 })
      a.showIt()
      return t
    }
    /** leaves the box: one arc past the edge, then hidden */
    const exitArc = async (a: NonNullable<ReturnType<typeof actor>>, toRight: boolean) => {
      const p = a.pos()
      await a.hop({ x: toRight ? W() + a.d * 3 : -a.d * 4, y: p.y }, 1100, a.d * 1.5)
      a.hide()
    }

    // ---------------------------------------------------------------- captain ball: passes, then is thrown out
    let fromRight = false
    const captainTurn = async (intro: boolean) => {
      if (!cb) return
      fromRight = !fromRight
      const first = intro ? seen[0] : seen[Math.floor(Math.random() * seen.length)]
      entry(cb, fromRight, first)
      // flies in to the first word
      await cb.hop(spot(first, cb.d, 0.4), 1100, cb.d * 1.2, 1.4)
      if (dead) return
      if (intro) show(first)
      let cur = first, left = Math.round(rnd(4, 7))
      const rest = intro ? seen.slice(1) : []
      // carries the rest of the words in, one pass each
      for (const el of rest) {
        if (dead) return
        await wait(260)
        await cb.hop(spot(el, cb.d, 0.4), 900, cb.d * rnd(0.9, 1.3), 1.4)
        if (dead) return
        show(el); cur = el; left--
      }
      // keeps passing
      while (left-- > 0 && !dead) {
        await wait(rnd(220, 420))
        let next = seen[Math.floor(Math.random() * seen.length)]
        if (seen.length > 1 && next === cur) next = seen[(seen.indexOf(next) + 1) % seen.length]
        const to = spot(next, cb.d)
        await cb.hop(to, Math.min(1500, 750 + Math.abs(to.x - cb.pos().x) * 2), cb.d * rnd(0.9, 1.5), 1.4)
        cur = next
      }
      if (dead) return
      await wait(200)
      await exitArc(cb, Math.random() < 0.5)                      // thrown out of the box
    }

    // ---------------------------------------------------------------- pickleball: like MC26, random hops
    const pickleTurn = async () => {
      if (!pb) return
      fromRight = !fromRight
      let cur = seen[Math.floor(Math.random() * seen.length)]
      entry(pb, fromRight, cur)
      await pb.hop(spot(cur, pb.d, 0.4), 800, pb.d * 1.6)
      if (dead) return
      await pb.settle(fromRight ? -1 : 1)
      for (let n = Math.round(rnd(5, 8)); n > 0 && !dead; n--) {
        await wait(rnd(500, 1300))
        if (dead) return
        if (Math.random() < 0.3) { await pb.hop(pb.pos(), 480, pb.d * 0.9); continue }
        let next = seen[Math.floor(Math.random() * seen.length)]
        if (seen.length > 1 && next === cur) next = seen[(seen.indexOf(next) + 1) % seen.length]
        const to = spot(next, pb.d)
        const dir = Math.sign(to.x - pb.pos().x) || 1
        await pb.hop(to, Math.min(1200, 560 + Math.abs(to.x - pb.pos().x) * 2.2), pb.d * rnd(1.3, 2))
        if (dead) return
        await pb.settle(dir)
        cur = next
      }
      await wait(500)
      if (!dead) await exitArc(pb, Math.random() < 0.5)
    }

    // ---------------------------------------------------------------- shuttlecock: cork first, over the words, out the other side
    const shuttle = async () => {
      const el = shT.current
      if (!el) return
      let ltr = Math.random() < 0.5
      el.style.opacity = '0'
      while (!dead) {
        await wait(rnd(900, 2600))
        if (dead) return
        if (document.hidden) continue
        const b = w.getBoundingClientRect()
        const d = el.offsetWidth
        const lows = seen.map(s => spot(s, d, 0.5).top)
        const ground = Math.min(...lows)                                   // top edge of the words
        const x0 = ltr ? -d * 2 : b.width + d * 2, x1 = ltr ? b.width + d * 2 : -d * 2
        const yHit = ground - d * rnd(0.2, 0.6), yEnd = ground + d * rnd(0.1, 0.5), lift = d * rnd(0.15, 0.35)   // just above the words
        const N = 48, kf: Keyframe[] = []
        const P = (t: number): Pt => ({ x: x0 + (x1 - x0) * t, y: yHit + (yEnd - yHit) * t * t - lift * 4 * t * (1 - t) })
        for (let i = 0; i <= N; i++) {
          const t = i / N, p = P(t), q = P(Math.min(1, t + 0.02)), r = P(Math.max(0, t - 0.02))
          const dx = q.x - r.x, dy = q.y - r.y
          // the cork (bottom of the picture) leads: turn the picture so its "down" points along the flight
          const ang = Math.atan2(dy, dx) * 180 / Math.PI - 90
          kf.push({ transform: `translate(${p.x - d / 2}px, ${p.y}px) rotate(${ang}deg)`, offset: t })
        }
        el.style.opacity = '1'
        const a = track(el.animate(kf, { duration: rnd(1500, 2100), easing: 'cubic-bezier(.3,.1,.7,.9)', fill: 'forwards' }))
        await done(a)
        if (dead) return
        a.cancel(); el.style.opacity = '0'
        ltr = !ltr                                                          // comes back from the other side
      }
    }

    // ---------------------------------------------------------------- run
    seen.forEach(el => { el.style.opacity = '0' })                          // the captain ball carries them in
    ;[pbY.current, cbY.current].forEach(y => { if (y) y.style.opacity = '0' })
    void shuttle()
    void (async () => {
      await wait(500)
      let first = true
      while (!dead) {
        if (cb) { await captainTurn(first); first = false }
        else seen.forEach(el => { el.style.opacity = '' })
        if (dead) return
        await wait(rnd(500, 1200))
        if (pb) await pickleTurn()
        if (!pb && !cb) return
        await wait(rnd(600, 1400))
      }
    })()

    return () => {
      dead = true
      timers.forEach(t => window.clearTimeout(t)); live.forEach(a => a.cancel())
      words.forEach(el => { el.style.opacity = '' })
    }
  }, [text, hasPb, hasCb, hasSh])

  const SZ = '.62em'
  return (
    <div ref={wrap} className={`relative pt-[0.85em] ${className}`} style={{ overflowX: 'clip' }}>
      <div className="line-clamp-2">
        {text.split(/\s+/).filter(Boolean).map((word, i) => (
          <span key={i}><span data-w className="inline-block whitespace-nowrap">{word}</span>{' '}</span>
        ))}
      </div>
      {hasPb && (
        <span ref={pbX} className="pointer-events-none absolute left-0 top-0 z-10" aria-hidden="true">
          <span ref={pbY} className="block" style={{ opacity: 0 }}><span ref={pbR} className="pp-ball block" /></span>
        </span>
      )}
      {hasCb && (
        <span ref={cbX} className="pointer-events-none absolute left-0 top-0 z-10" aria-hidden="true">
          <span ref={cbY} className="block" style={{ opacity: 0 }}>
            <span ref={cbR} className="block" style={{ width: SZ, height: SZ }}><SportIcon sport="captainball" className="!block !h-full !w-full" /></span>
          </span>
        </span>
      )}
      {hasSh && (
        <span ref={shT} className="pointer-events-none absolute left-0 top-0 block" aria-hidden="true" style={{ width: '.74em', height: '.74em', opacity: 0 }}>
          <SportIcon sport="badminton" className="!block !h-full !w-full" />
        </span>
      )}
    </div>
  )
}
