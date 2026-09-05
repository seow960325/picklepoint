import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useFullscreen } from '../lib/fullscreen'

export const Screen = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`min-h-full bg-ink text-gray-100 ${className}`}>{children}</div>
)

export const TopBar = ({ title, sub, back }: { title: string; sub?: string; back?: string }) => (
  <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
    {back && (
      <Link to={back} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-400 hover:text-white">
        ←
      </Link>
    )}
    <div className="min-w-0">
      <div className="truncate font-display text-xl font-bold tracking-wide">{title}</div>
      {sub && <div className="truncate text-xs text-gray-500">{sub}</div>}
    </div>
  </div>
)

export const Pill = ({ children, tone = 'idle' }: { children: ReactNode; tone?: 'live' | 'idle' | 'done' }) => {
  const c = tone === 'live' ? 'bg-lime/15 text-lime border-lime/30'
    : tone === 'done' ? 'bg-gray-700/40 text-gray-400 border-gray-600/40'
    : 'bg-cyan/10 text-cyan border-cyan/25'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${c}`}>{children}</span>
}

export const Spinner = () => (
  <div className="flex h-64 items-center justify-center text-gray-500">Loading…</div>
)


/** Enter/exit fullscreen. Hidden on devices with no fullscreen support
 *  (e.g. iPhone Safari). `className` styles the button wrapper. */
export const FullscreenButton = ({ className = '' }: { className?: string }) => {
  const { active, toggle, supported } = useFullscreen()
  if (!supported) return null
  return (
    <button onClick={toggle} title={active ? 'Exit fullscreen' : 'Fullscreen'}
      aria-label={active ? 'Exit fullscreen' : 'Enter fullscreen'}
      className={className}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
        {active ? (
          <>
            <path d="M8 3v3a2 2 0 0 1-2 2H3" />
            <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
            <path d="M3 16h3a2 2 0 0 1 2 2v3" />
            <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
          </>
        ) : (
          <>
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
            <path d="M3 16v3a2 2 0 0 0 2 2h3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </>
        )}
      </svg>
    </button>
  )
}

// ------------------------------------------------------------- flags
// Simplified national flags as inline SVG — reliable everywhere (unlike
// emoji flags, which don't render on Windows). FlagGlyph renders the raw
// shapes on a 0 0 28 20 canvas so they can be nested inside another SVG
// (e.g. the court circles); Flag wraps them for normal HTML use.

const RED_MY = '#cc0001', BLUE_MY = '#010066', YELLOW_MY = '#ffcc00'
const STAR_MY = [
  [11.0,3.0],[11.47,4.353],[12.90,4.382],[11.76,5.247],[12.18,6.618],
  [11.0,5.8],[9.82,6.618],[10.24,5.247],[9.10,4.382],[10.53,4.353],
].map(p => p.join(',')).join(' ')

function MalaysiaGlyph() {
  const h = 20 / 14
  return (
    <>
      <rect width="28" height="20" fill="#fff" />
      {[0,2,4,6,8,10,12].map(i => (
        <rect key={i} y={i * h} width="28" height={h} fill={RED_MY} />
      ))}
      <rect width="14" height="10" fill={BLUE_MY} />
      <circle cx="5.5" cy="5" r="3" fill={YELLOW_MY} />
      <circle cx="6.7" cy="4.4" r="2.6" fill={BLUE_MY} />
      <polygon points={STAR_MY} fill={YELLOW_MY} />
    </>
  )
}

function CambodiaGlyph() {
  return (
    <>
      <rect width="28" height="20" fill="#032ea1" />
      <rect y="5" width="28" height="10" fill="#e00025" />
      <g fill="#fff">
        <rect x="8.6" y="12.3" width="10.8" height="1.3" />
        <rect x="9.8" y="11.1" width="8.4" height="1.2" />
        <path d="M14 6 L15 9 L15 11 L13 11 L13 9 Z" />
        <path d="M10.8 8 L11.6 10 L11.6 11 L10 11 L10 10 Z" />
        <path d="M17.2 8 L18 10 L18 11 L16.4 11 L16.4 10 Z" />
      </g>
    </>
  )
}

function match(name?: string | null): 'my' | 'kh' | null {
  const n = (name || '').toLowerCase()
  if (n.includes('cambodia') || n.includes('khmer') || n.includes('柬')) return 'kh'
  if (n.includes('malaysia') || n.includes('马来') || n.includes('大马')) return 'my'
  return null
}

/** Raw flag shapes on a 0 0 28 20 canvas (no <svg> wrapper). */
export function FlagGlyph({ name }: { name?: string | null }) {
  const c = match(name)
  if (c === 'kh') return <CambodiaGlyph />
  if (c === 'my') return <MalaysiaGlyph />
  return null
}

/** A flag for a country name as a standalone element, or nothing. */
export function Flag({ name, className = '' }: { name?: string | null; className?: string }) {
  if (!match(name)) return null
  return (
    <svg viewBox="0 0 28 20" preserveAspectRatio="xMidYMid meet"
      className={className} role="img" aria-label={name || 'flag'}>
      <FlagGlyph name={name} />
    </svg>
  )
}
