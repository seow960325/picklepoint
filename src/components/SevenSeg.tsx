/** LED 7-segment digits, like a hall scoreboard. Every character cell has a
 *  fixed width, so "9" and "19", "9:58" and "42.7" never change the layout.
 *  Unlit segments stay faintly visible (real LED boards look like that).
 *  Characters: 0-9, space (all segments unlit), "-", ":" and ".". */

const W = 56, H = 100, T = 10, G = 2.2
const L = T / 2 + 1, R = W - T / 2 - 1, TOP = T / 2 + 1, MID = H / 2, BOT = H - T / 2 - 1

const hz = (x1: number, x2: number, y: number) =>
  `${x1},${y} ${x1 + T / 2},${y - T / 2} ${x2 - T / 2},${y - T / 2} ${x2},${y} ${x2 - T / 2},${y + T / 2} ${x1 + T / 2},${y + T / 2}`
const vt = (x: number, y1: number, y2: number) =>
  `${x},${y1} ${x + T / 2},${y1 + T / 2} ${x + T / 2},${y2 - T / 2} ${x},${y2} ${x - T / 2},${y2 - T / 2} ${x - T / 2},${y1 + T / 2}`

const SEG: Record<string, string> = {
  a: hz(L + G, R - G, TOP),
  b: vt(R, TOP + G, MID - G),
  c: vt(R, MID + G, BOT - G),
  d: hz(L + G, R - G, BOT),
  e: vt(L, MID + G, BOT - G),
  f: vt(L, TOP + G, MID - G),
  g: hz(L + G, R - G, MID),
}
const ON: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd',
  '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
}

function Digit({ ch, color, ghost }: { ch: string; color: string; ghost: number }) {
  const on = ON[ch] ?? ''
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: '1em', width: `${W / H}em`, overflow: 'visible' }} aria-hidden="true">
      <g transform={`skewX(-5) translate(4 0)`}>
        {Object.entries(SEG).map(([k, pts]) => (
          <polygon key={k} points={pts} fill={color} opacity={on.includes(k) ? 1 : ghost} />
        ))}
      </g>
    </svg>
  )
}

function Sep({ ch, color }: { ch: ':' | '.'; color: string }) {
  return (
    <svg viewBox={`0 0 20 ${H}`} style={{ height: '1em', width: '0.2em', overflow: 'visible' }} aria-hidden="true">
      {ch === ':'
        ? <><circle cx="9" cy="32" r="5.5" fill={color} /><circle cx="7" cy="70" r="5.5" fill={color} /></>
        : <circle cx="6" cy={BOT} r="6" fill={color} />}
    </svg>
  )
}

/** `text` is drawn exactly as given — pad it yourself (segScore / segClock). */
export function SevenSeg({ text, color, size, ghost = 0.07, glow = true, label }: {
  text: string; color: string; size: string; ghost?: number; glow?: boolean; label?: string
}) {
  return (
    <span role="img" aria-label={label ?? text.trim()}
      style={{
        fontSize: size, display: 'inline-flex', alignItems: 'center', gap: '0.09em', lineHeight: 1,
        filter: glow ? `drop-shadow(0 0 0.05em ${color}aa) drop-shadow(0 0 0.18em ${color}55)` : undefined,
      }}>
      {[...text].map((ch, i) => ch === ':' || ch === '.'
        ? <Sep key={i} ch={ch} color={color} />
        : <Digit key={i} ch={ch} color={color} ghost={ghost} />)}
    </span>
  )
}

/** Score padded to a fixed number of cells (2, or 3 once it reaches 100). */
export const segScore = (n: number, cells = 2): string => {
  const s = String(Math.max(0, Math.min(999, n)))
  return s.padStart(Math.max(cells, s.length), ' ')
}

/** Game clock in 4 digit cells + 1 separator, always the same width:
 *  " 9:58", "10:00", and under a minute " 42.7" / "  7.3" (tenths, like basketball). */
export function segClock(ms: number, tenths = true): string {
  const t = Math.max(0, ms)
  if (tenths && t < 60000) {
    const d = Math.floor(t / 100)
    return `${String(Math.floor(d / 10)).padStart(3, ' ')}.${d % 10}`
  }
  const s = Math.ceil(t / 1000)
  const m = Math.min(99, Math.floor(s / 60))
  return `${String(m).padStart(2, ' ')}:${String(s % 60).padStart(2, '0')}`
}
