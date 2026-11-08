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
  if (sport === 'captainball') {
    // volleyball-style ball in the poster's colours: yellow, blue and white panels
    return (
      <svg viewBox="0 0 24 24" className={`inline-block h-[1em] w-[1em] align-[-0.12em] ${className}`} aria-label="captain ball" role="img">
        <defs><clipPath id="cbclip"><circle cx="12" cy="12" r="9.6" /></clipPath></defs>
        <circle cx="12" cy="12" r="9.6" fill="#ffffff" />
        <g clipPath="url(#cbclip)" fill="none" strokeLinecap="round">
          {/* colour bands, each between two seams */}
          <path d="M10 9.7 A 10 10 0 0 0 1.2 13.9" stroke="#2f6fd6" strokeWidth="4.2" />
          <path d="M13.9 10.6 A 10 10 0 0 0 13.6 1" stroke="#f5b81c" strokeWidth="4.2" />
          <path d="M12.2 14.6 A 10 10 0 0 0 21.4 17.4" stroke="#f5b81c" strokeWidth="4.2" />
          <path d="M9.8 15.2 A 12 12 0 0 0 15.6 21.4" stroke="#2f6fd6" strokeWidth="3.2" />
          {/* seams */}
          <g stroke="#1f2937" strokeWidth="1.15">
            <path d="M12 12a8.5 8.5 0 0 0 8.5 4.25" />
            <path d="M7.2 13.6a12.7 12.7 0 0 0 9 6.9" />
            <path d="M12 12a8.5 8.5 0 0 0 -7.9 5.2" />
            <path d="M13 7.1a12.7 12.7 0 0 0 -10.5 4.4" />
            <path d="M12 12a8.5 8.5 0 0 0 -.6 -9.5" />
            <path d="M15.8 15.6a12.7 12.7 0 0 0 1.5 -10.9" />
          </g>
        </g>
        <circle cx="12" cy="12" r="9.6" fill="none" stroke="#1f2937" strokeWidth="1.6" />
      </svg>
    )
  }
  return <span className={className}>🏸</span>
}
