/** Top-down pickleball court. The two halves ARE the score buttons —
 *  the referee taps the side the point was won on, exactly as they see it
 *  in front of them. Circles echo the service boxes so the target is obvious. */
import { useState } from 'react'
import { FlagGlyph } from './ui'

// court is 440 x 200 inside a 480 x 240 surround
const X = 20, Y = 20, W = 440, H = 200
const NET = X + W / 2            // 240
const KIT = 70                   // non-volley zone depth each side of the net
const MIDY = Y + H / 2           // 120

export interface CourtProps {
  leftName: string
  rightName: string
  leftScore: number
  rightScore: number
  onTap: (side: 'left' | 'right') => void
  disabled?: boolean
  serving?: 'left' | 'right' | null
  hideNames?: boolean
  leftFlag?: string | null
  rightFlag?: string | null
}

const clip = (n: string, max = 17) =>
  (n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n).toUpperCase()

export default function Court({
  leftName, rightName, leftScore, rightScore, onTap, disabled, serving, hideNames,
  leftFlag, rightFlag,
}: CourtProps) {
  const [down, setDown] = useState<'left' | 'right' | null>(null)

  const half = (side: 'left' | 'right') => ({
    onPointerDown: () => !disabled && setDown(side),
    onPointerUp: () => setDown(null),
    onPointerLeave: () => setDown(null),
    onClick: () => !disabled && onTap(side),
    style: { cursor: disabled ? 'default' : 'pointer' } as const,
  })

  return (
    <svg viewBox="0 0 480 240" preserveAspectRatio="xMidYMid meet"
      className="h-full w-full no-select" style={{ touchAction: 'manipulation' }}>
      <defs>
        <linearGradient id="surface" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#173a6b" />
          <stop offset="100%" stopColor="#122c53" />
        </linearGradient>
        <linearGradient id="kitchen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22508f" />
          <stop offset="100%" stopColor="#1b4179" />
        </linearGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* out-of-bounds surround */}
      <rect x="0" y="0" width="480" height="240" rx="14" fill="#0d131e" />

      {/* playing surface */}
      <rect x={X} y={Y} width={W} height={H} fill="url(#surface)" />
      {/* non-volley zone ("the kitchen") */}
      <rect x={NET - KIT} y={Y} width={KIT * 2} height={H} fill="url(#kitchen)" />

      {/* tap-side tint */}
      <rect x={X} y={Y} width={W / 2} height={H}
        fill="#c6ff3d" opacity={down === 'left' ? 0.26 : 0.05} />
      <rect x={NET} y={Y} width={W / 2} height={H}
        fill="#22d3ee" opacity={down === 'right' ? 0.26 : 0.05} />

      {/* lines */}
      <g stroke="#ffffff" strokeOpacity="0.9" fill="none" strokeWidth="2.5">
        <rect x={X} y={Y} width={W} height={H} />
        {/* kitchen lines */}
        <line x1={NET - KIT} y1={Y} x2={NET - KIT} y2={Y + H} />
        <line x1={NET + KIT} y1={Y} x2={NET + KIT} y2={Y + H} />
        {/* centre service lines — only outside the kitchen */}
        <line x1={X} y1={MIDY} x2={NET - KIT} y2={MIDY} />
        <line x1={NET + KIT} y1={MIDY} x2={X + W} y2={MIDY} />
      </g>

      {/* net */}
      <g>
        <line x1={NET} y1={Y - 12} x2={NET} y2={Y + H + 12}
          stroke="#0a0e17" strokeWidth="7" strokeOpacity="0.85" />
        <line x1={NET} y1={Y - 12} x2={NET} y2={Y + H + 12}
          stroke="#9aa5b8" strokeWidth="2" strokeDasharray="3 3" strokeOpacity="0.8" />
        <circle cx={NET} cy={Y - 12} r="3.5" fill="#9aa5b8" />
        <circle cx={NET} cy={Y + H + 12} r="3.5" fill="#9aa5b8" />
      </g>

      {/* ---- left half: target + score ---- */}
      <g {...half('left')}>
        <rect x={X} y={Y} width={W / 2} height={H} fill="transparent" />
        <circle cx={X + 75} cy={MIDY} r="66" fill="#0a0e17" opacity="0.30" filter="url(#soft)" />
        <circle cx={X + 75} cy={MIDY} r="60" fill="#0f2444" />
        <circle cx={X + 75} cy={MIDY} r="60" fill="none"
          stroke="#c6ff3d" strokeWidth="3" strokeOpacity={down === 'left' ? 0.95 : 0.55} />
        <text x={X + 75} y={MIDY} textAnchor="middle" dominantBaseline="central"
          fill="#ffffff" fontSize="92" fontWeight="700"
          fontFamily="'Barlow Condensed', Impact, sans-serif"
          style={{ fontVariantNumeric: 'tabular-nums' }}>
          {leftScore}
        </text>
        {leftFlag && (
          <>
            <svg x={X + 75 - 16} y={MIDY - 74} width="32" height="22" viewBox="0 0 28 20">
              <FlagGlyph name={leftFlag} />
            </svg>
            <rect x={X + 75 - 16} y={MIDY - 74} width="32" height="22" rx="3"
              fill="none" stroke="#0a0e17" strokeWidth="1.5" />
          </>
        )}
        {serving === 'left' && (
          <circle cx={X + 75} cy={MIDY + 78} r="5" fill="#c6ff3d" />
        )}
      </g>

      {/* ---- right half: target + score ---- */}
      <g {...half('right')}>
        <rect x={NET} y={Y} width={W / 2} height={H} fill="transparent" />
        <circle cx={X + W - 75} cy={MIDY} r="66" fill="#0a0e17" opacity="0.30" filter="url(#soft)" />
        <circle cx={X + W - 75} cy={MIDY} r="60" fill="#0f2444" />
        <circle cx={X + W - 75} cy={MIDY} r="60" fill="none"
          stroke="#22d3ee" strokeWidth="3" strokeOpacity={down === 'right' ? 0.95 : 0.55} />
        <text x={X + W - 75} y={MIDY} textAnchor="middle" dominantBaseline="central"
          fill="#ffffff" fontSize="92" fontWeight="700"
          fontFamily="'Barlow Condensed', Impact, sans-serif"
          style={{ fontVariantNumeric: 'tabular-nums' }}>
          {rightScore}
        </text>
        {rightFlag && (
          <>
            <svg x={X + W - 75 - 16} y={MIDY - 74} width="32" height="22" viewBox="0 0 28 20">
              <FlagGlyph name={rightFlag} />
            </svg>
            <rect x={X + W - 75 - 16} y={MIDY - 74} width="32" height="22" rx="3"
              fill="none" stroke="#0a0e17" strokeWidth="1.5" />
          </>
        )}
        {serving === 'right' && (
          <circle cx={X + W - 75} cy={MIDY + 78} r="5" fill="#22d3ee" />
        )}
      </g>

      {/* team names, sat on the baselines */}
      {!hideNames && (
        <>
          <text x={X + 8} y={Y - 7} fill="#c6ff3d" fontSize="17" fontWeight="700"
            fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
            {clip(leftName)}
          </text>
          <text x={X + W - 8} y={Y - 7} textAnchor="end" fill="#22d3ee" fontSize="17" fontWeight="700"
            fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
            {clip(rightName)}
          </text>
        </>
      )}
      
    </svg>
  )
}
