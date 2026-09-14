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
  /** Which server (1st or 2nd) is up, for side-out/"Serve" mode only —
   *  pass null/undefined in Winner mode where it has no meaning. */
  serverNo?: 1 | 2 | null
  /** Which service court (international rule: even score → right, odd →
   *  left) the serve ball sits in — applies in both serve modes. Pass
   *  null/undefined only when there's no active server (game over) —
   *  the ball then stays at its old spot just below the score circle. */
  serverCourt?: 'right' | 'left' | null
  leftFlag?: string | null
  rightFlag?: string | null
  leftLogo?: string | null
  rightLogo?: string | null
  label?: string | null
}

const clip = (n: string, max = 17) =>
  (n.length > max ? n.slice(0, max - 1).trimEnd() + '…' : n).toUpperCase()

/** Small pickleball glyph — a ball with holes — marking who serves next.
 *  Bright neon green with a single gentle pulsing ring — enough to catch
 *  the eye without being distracting (dialed back from an earlier, busier
 *  double-pulse + full-glow version). */
function PickleballGlyph({ cx, cy, r = 9, serverNo }: { cx: number; cy: number; r?: number; serverNo?: 1 | 2 | null }) {
  const BALL = '#c6ff3d' // neon green — swap to '#f7d774' for gold instead
  const holes = [
    [-0.32, -0.55], [0.48, -0.35], [-0.58, 0.15],
    [0.1, 0.6], [0.55, 0.2], [-0.05, -0.05],
  ]
  return (
    <g>
      {/* one gentle growing pulse ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={BALL} strokeWidth="2.5">
        <animate attributeName="r" values={`${r};${r * 2};${r}`} dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;0;0.85" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={r + 2} fill="#0a0e17" opacity="0.4" />
      <circle cx={cx} cy={cy} r={r} fill={BALL} stroke="#0a0e17" strokeWidth="1.2" filter="url(#neonGlow)" />
      {holes.map(([dx, dy], i) => (
        <circle key={i} cx={cx + dx * r} cy={cy + dy * r} r={r * 0.16} fill="#0a0e17" opacity="0.6" />
      ))}
      {/* server number (side-out mode only) — small badge to the right of the ball */}
      {(serverNo === 1 || serverNo === 2) && (
        <g>
          <circle cx={cx + r + 9} cy={cy} r={7.5} fill="#0a0e17" stroke={BALL} strokeWidth="1.8" />
          <text x={cx + r + 9} y={cy} textAnchor="middle" dominantBaseline="central"
            fill={BALL} fontSize="10.5" fontWeight="700" fontFamily="'Barlow Condensed', Impact, sans-serif">
            {serverNo}
          </text>
        </g>
      )}
    </g>
  )
}

// Corner slots the serve ball can sit in, near the outer baseline+sideline
// corner of each service court — well clear of the (now sideline-mounted,
// vertical) team name and the top flag/logo badge.
const BALL_X_LEFT = 30, BALL_X_RIGHT = 450
const BALL_Y_RIGHT_COURT = 52, BALL_Y_LEFT_COURT = 188 // 'right'/'left' per the serve rule, not screen side

export default function Court({
  leftName, rightName, leftScore, rightScore, onTap, disabled, serving, serverNo, serverCourt,
  leftFlag, rightFlag, leftLogo, rightLogo, label,
}: CourtProps) {
  const [down, setDown] = useState<'left' | 'right' | null>(null)
  const ballCy = serverCourt === 'right' ? BALL_Y_RIGHT_COURT
    : serverCourt === 'left' ? BALL_Y_LEFT_COURT
    : MIDY + R + 17 // no active server (game over) — old fixed spot below the circle
  // Tap acknowledgement — flashes the tapped half on every tap, even when the
  // score doesn't move (side-out mode: a fault or the receiving team getting
  // tapped by mistake), so the ref always sees "that tap counted".
  const [flash, setFlash] = useState<{ side: 'left' | 'right'; key: number } | null>(null)

  const half = (side: 'left' | 'right') => ({
    onPointerDown: () => !disabled && setDown(side),
    onPointerUp: () => setDown(null),
    onPointerLeave: () => setDown(null),
    onPointerCancel: () => setDown(null),
    onClick: () => {
      if (disabled) return
      setFlash(f => ({ side, key: (f?.key ?? 0) + 1 }))
      onTap(side)
    },
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

      {/* ---- score circles + flags + names: aspect-correct overlay ---- */}
      <svg viewBox="0 0 480 240" preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full" style={{ touchAction: 'manipulation' }}>
        <defs>
          <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          {/* neon bloom used by the serve-ball glyph — makes it pop visually
              since sound alone isn't reliable feedback (some refs mute it) */}
          <filter id="neonGlow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
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
        {(leftLogo || leftFlag) && (
          <>
            <rect x={CXL - 27} y="31" width="54" height="38" rx="5"
              fill="#0a0e17" opacity="0.45" filter="url(#soft)" />
            {leftLogo
              ? <image href={leftLogo} x={CXL - 27} y="30" width="54" height="38"
                  preserveAspectRatio="xMidYMid slice" />
              : <svg x={CXL - 27} y="30" width="54" height="38"
                  viewBox="0 0 28 20" preserveAspectRatio="xMidYMid slice">
                  <FlagGlyph name={leftFlag} />
                </svg>}
            <rect x={CXL - 27} y="30" width="54" height="38" rx="5"
              fill="none" stroke="#eaf2ff" strokeOpacity="0.9" strokeWidth="2" />
          </>
        )}
        {serving === 'left' && <PickleballGlyph cx={serverCourt ? BALL_X_LEFT : CXL} cy={ballCy} r={9} serverNo={serverNo} />}
        {flash?.side === 'left' && (
          <circle key={`flash-left-${flash.key}`} cx={CXL} cy={MIDY} r={R + 10}
            fill="none" stroke="#c6ff3d" strokeWidth="6" filter="url(#neonGlow)">
            <animate attributeName="opacity" values="1;0" dur="0.4s" fill="freeze" />
            <animate attributeName="r" values={`${R};${R + 22}`} dur="0.4s" fill="freeze" />
          </circle>
        )}

        {/* tap zone — only the number circle (plus a bit of padding) counts */}
        <circle {...half('left')} cx={CXL} cy={MIDY} r={R + 24} fill="transparent"
          pointerEvents="all" aria-label={`point ${leftName}`} role="button" />

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
        {(rightLogo || rightFlag) && (
          <>
            <rect x={CXR - 27} y="31" width="54" height="38" rx="5"
              fill="#0a0e17" opacity="0.45" filter="url(#soft)" />
            {rightLogo
              ? <image href={rightLogo} x={CXR - 27} y="30" width="54" height="38"
                  preserveAspectRatio="xMidYMid slice" />
              : <svg x={CXR - 27} y="30" width="54" height="38"
                  viewBox="0 0 28 20" preserveAspectRatio="xMidYMid slice">
                  <FlagGlyph name={rightFlag} />
                </svg>}
            <rect x={CXR - 27} y="30" width="54" height="38" rx="5"
              fill="none" stroke="#eaf2ff" strokeOpacity="0.9" strokeWidth="2" />
          </>
        )}
        {serving === 'right' && <PickleballGlyph cx={serverCourt ? BALL_X_RIGHT : CXR} cy={ballCy} r={9} serverNo={serverNo} />}
        {flash?.side === 'right' && (
          <circle key={`flash-right-${flash.key}`} cx={CXR} cy={MIDY} r={R + 10}
            fill="none" stroke="#22d3ee" strokeWidth="6" filter="url(#neonGlow)">
            <animate attributeName="opacity" values="1;0" dur="0.4s" fill="freeze" />
            <animate attributeName="r" values={`${R};${R + 22}`} dur="0.4s" fill="freeze" />
          </circle>
        )}

        {/* tap zone — only the number circle (plus a bit of padding) counts */}
        <circle {...half('right')} cx={CXR} cy={MIDY} r={R + 24} fill="transparent"
          pointerEvents="all" aria-label={`point ${rightName}`} role="button" />

        {label && (
          <text x="240" y="19" textAnchor="middle" fill="#f7d774" fontSize="16" fontWeight="700"
            fontFamily="'Barlow Condensed', sans-serif" letterSpacing="2.5">
            {label.toUpperCase()}
          </text>
        )}

        {/* team names — mounted vertically on the outer sideline, clear of
            both serve-ball corners (top ~52 and bottom ~188) and the flag */}
        <text x="14" y={MIDY} textAnchor="middle" transform={`rotate(-90 14 ${MIDY})`}
          fill="#c6ff3d" fontSize="15" fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(leftName, 12)}
        </text>
        <text x="466" y={MIDY} textAnchor="middle" transform={`rotate(90 466 ${MIDY})`}
          fill="#22d3ee" fontSize="15" fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(rightName, 12)}
        </text>
      </svg>
    </div>
  )
}
