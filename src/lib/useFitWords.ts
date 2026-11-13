/** A title must never be cut off: when one of its words ([data-w]) is wider than the room it has,
 *  the font is stepped down until every word fits (never below `min` px). Runs again on resize / rotate. */
import { useLayoutEffect, type RefObject } from 'react'

export function useFitWords(ref: RefObject<HTMLElement>, text: string, min = 12) {
  useLayoutEffect(() => {
    const w = ref.current
    if (!w) return
    const fit = () => {
      w.style.fontSize = ''
      let fs = parseFloat(getComputedStyle(w).fontSize) || 20
      const words = Array.from(w.querySelectorAll<HTMLElement>('[data-w], [data-line]'))
      for (let i = 0; i < 40 && fs > min && words.some(el => el.hasAttribute('data-line')
        // a set row (block on a phone): too wide when its words overflow its own box
        ? getComputedStyle(el).display === 'block' && el.scrollWidth > el.clientWidth + 0.5
        : el.offsetWidth > w.clientWidth + 0.5); i++) {
        fs -= 1
        w.style.fontSize = `${fs}px`
      }
    }
    fit()
    window.addEventListener('resize', fit)
    // web fonts arrive after the first paint and change every width
    void (document as any).fonts?.ready?.then(fit)
    return () => window.removeEventListener('resize', fit)
  }, [ref, text])
}
