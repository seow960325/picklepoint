import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useFullscreen } from '../lib/fullscreen'
import { useTheme } from '../lib/theme'

export const Screen = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`min-h-full bg-canvas text-fg ${className}`}>{children}</div>
)

export const TopBar = ({ title, sub, back }: { title: string; sub?: string; back?: string }) => (
  <div className="flex items-center gap-3 border-b border-line px-4 py-3">
    {back && (
      <Link to={back} className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
        ←
      </Link>
    )}
    <div className="min-w-0 flex-1">
      <div className="truncate font-display text-xl font-bold tracking-wide">{title}</div>
      {sub && <div className="truncate text-xs text-fg-subtle">{sub}</div>}
    </div>
    <ThemeToggle className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2" />
  </div>
)

export const Pill = ({ children, tone = 'idle' }: { children: ReactNode; tone?: 'live' | 'idle' | 'done' }) => {
  const c = tone === 'live' ? 'bg-brand/15 text-brand border-brand/30'
    : tone === 'done' ? 'bg-surface-2 text-fg-subtle border-line-strong'
    : 'bg-accent/10 text-accent border-accent/25'
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${c}`}>{children}</span>
}

export const Spinner = () => (
  <div className="flex h-64 items-center justify-center text-fg-subtle">Loading…</div>
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

/** Light/dark toggle. Defaults to light; persists the user's choice. */
export const ThemeToggle = ({ className = '' }: { className?: string }) => {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button onClick={toggle} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
        {isDark ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
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
