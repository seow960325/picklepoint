import type { Sport } from '../lib/multisport'

/** Sport glyph. Pickleball has no emoji (🏓 is table tennis), so it is drawn: a paddle and a holed ball. */
export function SportIcon({ sport, className = '' }: { sport: Sport; className?: string }) {
  if (sport === 'pickleball') {
    return (
      <svg viewBox="0 0 24 24" className={`inline-block h-[1em] w-[1em] align-[-0.12em] ${className}`} aria-label="pickleball" role="img">
        <g transform="rotate(-35 10 11)">
          <rect x="4.2" y="1.5" width="11.6" height="13.5" rx="5.2" fill="#3b82f6" stroke="#dbeafe" strokeWidth="1.3" />
          <rect x="8.6" y="14.6" width="2.8" height="7" rx="1.2" fill="#e5e7eb" />
        </g>
        <circle cx="18" cy="17.5" r="4.6" fill="#c6ff3d" stroke="#3f6212" strokeWidth="0.9" />
        {[[16.4, 16], [19.4, 15.9], [17.9, 18], [16.2, 19.1], [19.8, 18.9]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="0.75" fill="#3f6212" />)}
      </svg>
    )
  }
  return <span className={className}>{sport === 'badminton' ? '🏸' : '🏐'}</span>
}
