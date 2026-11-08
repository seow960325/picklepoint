import type { Sport } from '../lib/multisport'

const SVG = 'inline-block h-[1em] w-[1em] align-[-0.12em]'

/** Light from the top-left: a soft highlight and a shade on the far side
 *  turn a flat disc into a ball. Same ids on every icon is fine (identical defs). */
const BallShade = () => (
  <>
    <defs>
      <radialGradient id="ppBallLight" cx="0.32" cy="0.28" r="0.75">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
        <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.12" />
        <stop offset="0.7" stopColor="#000000" stopOpacity="0" />
        <stop offset="1" stopColor="#000000" stopOpacity="0.45" />
      </radialGradient>
    </defs>
    <circle cx="12" cy="12" r="10" fill="url(#ppBallLight)" />
    <ellipse cx="8.4" cy="6.9" rx="2.6" ry="1.5" transform="rotate(-35 8.4 6.9)" fill="#ffffff" opacity="0.7" />
  </>
)

/** Sport glyph = the sport's ball (shuttle for badminton), drawn in 3D. */
export function SportIcon({ sport, className = '' }: { sport: Sport; className?: string }) {
  if (sport === 'pickleball') {
    // neon green ball with holes — the serve-marker ball from the court
    const holes = [[-0.32, -0.55, 0.9], [0.48, -0.35, 0.85], [-0.62, 0.15, 0.75], [0.1, 0.62, 0.8], [0.58, 0.22, 0.75], [-0.05, -0.02, 1]]
    return (
      <svg viewBox="0 0 24 24" className={`${SVG} ${className}`} aria-label="pickleball" role="img">
        <circle cx="12" cy="12" r="10" fill="#c6ff3d" />
        {holes.map(([x, y, s], i) => (
          <ellipse key={i} cx={12 + x * 10} cy={12 + y * 10} rx={1.7 * s} ry={1.5 * s} fill="#2f4a0c" opacity="0.8" />
        ))}
        <BallShade />
        <circle cx="12" cy="12" r="10" fill="none" stroke="#3f6212" strokeWidth="0.9" />
      </svg>
    )
  }
  if (sport === 'badminton') {
    // shuttlecock: rounded cork below, feather skirt opening upwards
    return (
      <svg viewBox="0 0 24 24" className={`${SVG} ${className}`} aria-label="badminton" role="img">
        <defs>
          <linearGradient id="ppSkirt" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#cbd5e1" /><stop offset="0.45" stopColor="#ffffff" /><stop offset="1" stopColor="#94a3b8" />
          </linearGradient>
          <radialGradient id="ppCork" cx="0.35" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffffff" /><stop offset="0.6" stopColor="#e2e8f0" /><stop offset="1" stopColor="#64748b" />
          </radialGradient>
        </defs>
        <path d="M7.6 15.2 L3.2 3.4 Q12 0.6 20.8 3.4 L16.4 15.2 Z" fill="url(#ppSkirt)" stroke="#64748b" strokeWidth="0.9" strokeLinejoin="round" />
        <ellipse cx="12" cy="3" rx="8.8" ry="1.5" fill="#e2e8f0" stroke="#64748b" strokeWidth="0.8" />
        <path d="M9.6 15 L7.2 3.6 M12 15 L12 3.8 M14.4 15 L16.8 3.6" stroke="#94a3b8" strokeWidth="0.8" />
        <path d="M5.4 9.2 Q12 7.4 18.6 9.2" fill="none" stroke="#94a3b8" strokeWidth="0.8" />
        <rect x="7.3" y="14.5" width="9.4" height="2.1" rx="0.7" fill="#ef4444" />
        <path d="M7.6 16.4 H16.4 Q16.4 22.6 12 22.6 Q7.6 22.6 7.6 16.4 Z" fill="url(#ppCork)" stroke="#64748b" strokeWidth="0.8" />
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
        <path d="M15 2.5 Q 13 10 22.5 13" fill="none" stroke="#0f172a" strokeWidth="0.8" opacity="0.6" />
      </g>
      <BallShade />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#1e293b" strokeWidth="1.1" />
    </svg>
  )
}
