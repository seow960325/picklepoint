/** Top-down pickleball court. The two halves ARE the score buttons —
 *  the referee taps the side the point was won on. The court surface is
 *  drawn full-bleed (fills all available space) with a separate, aspect-
 *  correct overlay for the round score circles so they never distort. */
import { useState } from 'react'
import { FlagGlyph } from './ui'

// layout constants for the aspect-correct overlay (480 x 240)
const NET = 240, KIT = 70, MIDY = 120
const CXL = 120, CXR = 360, R = 72

export interface CourtProps {
  leftName: string
  rightName: string
  leftScore: number
  rightScore: number
  onTap: (side: 'left' | 'right') => void
  disabled?: boolean
  serving?: 'left' | 'right' | null
  leftFlag?: string | null
  rightFlag?: string | null
}

const clip = (n: string, max = 17) =>
  (n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n).toUpperCase()

export default function Court({
  leftName, rightName, leftScore, rightScore, onTap, disabled, serving,
  leftFlag, rightFlag,
}: CourtProps) {
  const [down, setDown] = useState<'left' | 'right' | null>(null)

  const half = (side: 'left' | 'right') => ({
    onPointerDown: () => !disabled && setDown(side),
    onPointerUp: () => setDown(null),
    onPointerLeave: () => setDown(null),
    onPointerCancel: () => setDown(null),
    onClick: () => !disabled && onTap(side),
    style: { cursor: disabled ? 'default' : 'pointer' } as const,
  })

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#0d131e]">
      {/* ---- court surface, stretched full-bleed ---- */}
      <svg viewBox="0 0 480 240" preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="surface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#173a6b" />
            <stop offset="100%" stopColor="#122c53" />
          </linearGradient>
          <linearGradient id="kitchen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22508f" />
            <stop offset="100%" stopColor="#1b4179" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="480" height="240" fill="url(#surface)" />
        <rect x={NET - KIT} y="0" width={KIT * 2} height="240" fill="url(#kitchen)" />

        <g stroke="#ffffff" strokeOpacity="0.85" fill="none" strokeWidth="2.5"
          vectorEffect="non-scaling-stroke">
          <rect x="3" y="3" width="474" height="234" />
          <line x1={NET - KIT} y1="0" x2={NET - KIT} y2="240" />
          <line x1={NET + KIT} y1="0" x2={NET + KIT} y2="240" />
          <line x1="3" y1={MIDY} x2={NET - KIT} y2={MIDY} />
          <line x1={NET + KIT} y1={MIDY} x2="477" y2={MIDY} />
        </g>

        <line x1={NET} y1="0" x2={NET} y2="240"
          stroke="#0a0e17" strokeWidth="7" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
        <line x1={NET} y1="0" x2={NET} y2="240"
          stroke="#9aa5b8" strokeWidth="2" strokeDasharray="3 3" strokeOpacity="0.8"
          vectorEffect="non-scaling-stroke" />
      </svg>

      {/* ---- tap zones (full height, whole half) ---- */}
      <button {...half('left')} aria-label={`point ${leftName}`}
        className={`absolute inset-y-0 left-0 w-1/2 transition-colors ${down === 'left' ? 'bg-lime/15' : ''}`} />
      <button {...half('right')} aria-label={`point ${rightName}`}
        className={`absolute inset-y-0 right-0 w-1/2 transition-colors ${down === 'right' ? 'bg-cyan/15' : ''}`} />

      {/* ---- score circles + flags + names: aspect-correct overlay ---- */}
      <svg viewBox="0 0 480 240" preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <clipPath id="flagL"><rect x={CXL - 30} y={MIDY - R - 48} width="60" height="42" rx="6" /></clipPath>
          <clipPath id="flagR"><rect x={CXR - 30} y={MIDY - R - 48} width="60" height="42" rx="6" /></clipPath>
        </defs>

        {/* left */}
        <circle cx={CXL} cy={MIDY} r={R + 6} fill="#0a0e17" opacity="0.30" filter="url(#soft)" />
        <circle cx={CXL} cy={MIDY} r={R} fill="#0f2444" />
        <circle cx={CXL} cy={MIDY} r={R} fill="none" stroke="#c6ff3d" strokeWidth="3"
          strokeOpacity={down === 'left' ? 0.95 : 0.6} />
        <text x={CXL} y={MIDY} textAnchor="middle" dominantBaseline="central"
          fill="#ffffff" fontSize="104" fontWeight="700"
          fontFamily="'Barlow Condensed', Impact, sans-serif"
          style={{ fontVariantNumeric: 'tabular-nums' }}>
          {leftScore}
        </text>
        {leftFlag && (
          <>
            <rect x={CXL - 30} y={MIDY - R - 46} width="60" height="42" rx="6"
              fill="#0a0e17" opacity="0.4" filter="url(#soft)" />
            <svg x={CXL - 30} y={MIDY - R - 48} width="60" height="42"
              viewBox="0 0 28 20" preserveAspectRatio="xMidYMid slice" clipPath="url(#flagL)">
              <FlagGlyph name={leftFlag} />
            </svg>
            <rect x={CXL - 30} y={MIDY - R - 48} width="60" height="42" rx="6"
              fill="none" stroke="#eaf2ff" strokeOpacity="0.85" strokeWidth="2" />
          </>
        )}
        {serving === 'left' && <circle cx={CXL} cy={MIDY + R + 14} r="5" fill="#c6ff3d" />}

        {/* right */}
        <circle cx={CXR} cy={MIDY} r={R + 6} fill="#0a0e17" opacity="0.30" filter="url(#soft)" />
        <circle cx={CXR} cy={MIDY} r={R} fill="#0f2444" />
        <circle cx={CXR} cy={MIDY} r={R} fill="none" stroke="#22d3ee" strokeWidth="3"
          strokeOpacity={down === 'right' ? 0.95 : 0.6} />
        <text x={CXR} y={MIDY} textAnchor="middle" dominantBaseline="central"
          fill="#ffffff" fontSize="104" fontWeight="700"
          fontFamily="'Barlow Condensed', Impact, sans-serif"
          style={{ fontVariantNumeric: 'tabular-nums' }}>
          {rightScore}
        </text>
        {rightFlag && (
          <>
            <rect x={CXR - 30} y={MIDY - R - 46} width="60" height="42" rx="6"
              fill="#0a0e17" opacity="0.4" filter="url(#soft)" />
            <svg x={CXR - 30} y={MIDY - R - 48} width="60" height="42"
              viewBox="0 0 28 20" preserveAspectRatio="xMidYMid slice" clipPath="url(#flagR)">
              <FlagGlyph name={rightFlag} />
            </svg>
            <rect x={CXR - 30} y={MIDY - R - 48} width="60" height="42" rx="6"
              fill="none" stroke="#eaf2ff" strokeOpacity="0.85" strokeWidth="2" />
          </>
        )}
        {serving === 'right' && <circle cx={CXR} cy={MIDY + R + 14} r="5" fill="#22d3ee" />}

        {/* team names on the baselines */}
        <text x="10" y="20" fill="#c6ff3d" fontSize="17" fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(leftName)}
        </text>
        <text x="470" y="20" textAnchor="end" fill="#22d3ee" fontSize="17" fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(rightName)}
        </text>
      </svg>
    </div>
  )
}
