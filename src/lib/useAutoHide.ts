import { useEffect, useRef, useState } from 'react'

/** TV controls: hidden until the screen is touched / the mouse moves, then shown for `ms`.
 *  A tap while hidden only reveals them (that first tap is swallowed), so on an iPad
 *  you never trigger a button you could not see — the next tap works normally. */
export function useAutoHide(active: boolean, ms = 5000) {
  const [shown, setShown] = useState(false)
  const shownRef = useRef(false)
  const swallow = useRef(false)
  useEffect(() => {
    if (!active) return
    let t: ReturnType<typeof setTimeout> | undefined
    const show = () => {
      shownRef.current = true; setShown(true)
      clearTimeout(t); t = setTimeout(() => { shownRef.current = false; setShown(false) }, ms)
    }
    const down = (e: PointerEvent) => { swallow.current = e.pointerType !== 'mouse' && !shownRef.current; show() }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('mousemove', show)
    window.addEventListener('keydown', show)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('mousemove', show)
      window.removeEventListener('keydown', show)
      shownRef.current = false; setShown(false)
    }
  }, [active, ms])
  const guard = {
    onClickCapture: (e: { preventDefault(): void; stopPropagation(): void }) => {
      if (swallow.current) { e.preventDefault(); e.stopPropagation(); swallow.current = false }
    },
  }
  return { shown, guard }
}
