import { Children, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** House rule for laying out N cards (courts, groups, ties, sports…) so the space is used:
 *  1 → full · 2 → left/right · 3 → one row of 3 · 4 → 2×2 · 5 → 3 + 2 · 6 → 3 + 3
 *  7 → 4 + 3 · 8 → 4 + 4 · more → rows of 4. A shorter last row is centred. */
export function fillRows(n: number, cap = 4): number[] {
  if (n <= 0) return []
  const base: Record<number, number[]> = { 1: [1], 2: [2], 3: [3], 4: [2, 2], 5: [3, 2], 6: [3, 3], 7: [4, 3], 8: [4, 4] }
  let rows = base[n] ?? Array.from({ length: Math.ceil(n / 4) }, (_, i) => Math.min(4, n - i * 4))
  const c = Math.max(1, cap)
  if (Math.max(...rows) > c) rows = Array.from({ length: Math.ceil(n / c) }, (_, i) => Math.min(c, n - i * c))
  return rows
}

/** How many cards fit side by side in a box this wide (keeps cards readable on phones / half screens). */
export function capFor(width: number, max = 4): number {
  const c = width < 560 ? 1 : width < 900 ? 2 : width < 1200 ? 3 : 4
  return Math.min(c, max)
}

/** Grid + per-card placement for `n` cards in `cap` columns. */
export function fillLayout(n: number, cap: number): { grid: CSSProperties; item: (i: number) => CSSProperties } {
  const rows = fillRows(n, cap)
  const C = Math.max(1, ...rows)
  const start: number[] = []   // index of first card in each row
  rows.reduce((acc, k) => { start.push(acc); return acc + k }, 0)
  return {
    grid: { display: 'grid', gridTemplateColumns: `repeat(${C * 2}, minmax(0, 1fr))` },
    item: (i: number) => {
      const r = start.findIndex((s, j) => i >= s && i < s + rows[j])
      const k = rows[r] ?? C
      // a short row starts half-a-card in per missing card, so it sits centred
      return i === start[r] && k < C ? { gridColumn: `${C - k + 1} / span 2` } : { gridColumn: 'span 2' }
    },
  }
}

/** Cards laid out by the house rule, sized to the width it actually has. */
export default function FillGrid({ children, max = 4, className = '', style, exact = false }: {
  children: ReactNode; max?: number; className?: string; style?: CSSProperties
  exact?: boolean   // use `max` columns as given (a layout already planned to the screen)
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => { const x = el.clientWidth; if (x) setW(x) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const items = Children.toArray(children).filter(Boolean)
  const { grid, item } = fillLayout(items.length, exact ? max : capFor(w, max))
  return (
    <div ref={ref} className={className} style={{ ...grid, ...style }}>
      {items.map((c, i) => (
        <div key={(c as any)?.key ?? i} className="flex min-w-0 flex-col [&>*]:flex-1" style={item(i)}>{c}</div>
      ))}
    </div>
  )
}
