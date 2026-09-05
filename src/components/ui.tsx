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
