import type { Sport } from '../lib/multisport'

const SVG = 'inline-block h-[1em] w-[1em] align-[-0.12em]'

/** Sport glyph = the sport's ball (shuttle for badminton). Pickleball has no
 *  emoji (🏓 is table tennis), so all three are drawn. */
export function SportIcon({ sport, className = '' }: { sport: Sport; className?: string }) {
  if (sport === 'pickleball') {
    // neon green ball with holes — same ball as the serve marker on the court
    const holes = [[-0.32, -0.55], [0.48, -0.35], [-0.58, 0.15], [0.1, 0.6], [0.55, 0.2], [-0.05, -0.05]]
    return (
      <svg viewBox="0 0 24 24" className={`${SVG} ${className}`} aria-label="pickleball" role="img">
        <circle cx="12" cy="12" r="10" fill="#c6ff3d" stroke="#3f6212" strokeWidth="1.2" />
        {holes.map(([x, y], i) => <circle key={i} cx={12 + x * 10} cy={12 + y * 10} r="1.6" fill="#3f6212" opacity="0.75" />)}
      </svg>
    )
  }
  if (sport === 'badminton') {
    // shuttlecock: cork at the bottom, feather skirt opening upwards
    return (
      <svg viewBox="0 0 24 24" className={`${SVG} ${className}`} aria-label="badminton" role="img">
        <path d="M7.6 15.2 L3.2 3.4 Q12 0.6 20.8 3.4 L16.4 15.2 Z" fill="#f8fafc" stroke="#64748b" strokeWidth="1" strokeLinejoin="round" />
        <path d="M9.6 15 L7.4 2.6 M12 15 L12 1.9 M14.4 15 L16.6 2.6" stroke="#94a3b8" strokeWidth="0.9" />
        <path d="M5.4 9.2 Q12 7.4 18.6 9.2" fill="none" stroke="#94a3b8" strokeWidth="0.9" />
        <rect x="7.4" y="14.6" width="9.2" height="2" rx="0.6" fill="#ef4444" />
        <path d="M7.6 16.4 H16.4 Q16.4 22.4 12 22.4 Q7.6 22.4 7.6 16.4 Z" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
      </svg>
    )
  }
  // captain ball: volleyball with curved blue / yellow / white panels
  const C = [['#1d3fbf', 32], ['#f6d32d', 27.5], ['#ffffff', 23], ['#f6d32d', 18.5], ['#1d3fbf', 14]] as const
  return (
    <svg viewBox="0 0 24 24" className={`${SVG} ${className}`} aria-label="captain ball" role="img">
      <defs><clipPath id="cbclip"><circle cx="12" cy="12" r="10" /></clipPath></defs>
      <g clipPath="url(#cbclip)">
        {C.map(([col, r]) => <circle key={r} cx="27" cy="27" r={r} fill={col} />)}
        <g fill="none" stroke="#0f172a" strokeWidth="0.8" opacity="0.6">
          {[27.5, 23, 18.5, 14].map(r => <circle key={r} cx="27" cy="27" r={r} />)}
        </g>
        {/* the cross seam that makes it read as a volleyball */}
        <path d="M15 2.5 Q 13 10 22.5 13" fill="none" stroke="#0f172a" strokeWidth="0.8" opacity="0.6" />
      </g>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#1e293b" strokeWidth="1.3" />
    </svg>
  )
}
