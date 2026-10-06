/** Top-down pickleball court (or badminton court when sport="badminton"). The two halves ARE the score buttons —
 *  the referee taps the side the point was won on. The court surface is
 *  drawn full-bleed (fills all available space) with a separate, aspect-
 *  correct overlay for the round score circles so they never distort. */
import { useState } from 'react'
import { FlagGlyph } from './ui'

// layout constants for the aspect-correct overlay (480 x 240)
const NET = 240, KIT = 70, MIDY = 120
const HALO = { stroke: '#0b2145', strokeWidth: 6, strokeLinejoin: 'round' as const, paintOrder: 'stroke' as const }
const CXL = 120, CXR = 360, R = 72

export interface CourtProps {
  leftName: string
  /** font size of the sideline team names (SVG units); TV screens ask for bigger */
  nameSize?: number
  /** dark halo behind the sideline names so court lines never run through the letters */
  nameHalo?: boolean
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
  /** 'badminton' swaps the court markings and the serve ball for a shuttlecock.
   *  Omitted / 'pickleball' = the original look, unchanged. */
  sport?: 'pickleball' | 'badminton'
  /** Official "serving-receiving-server#" call (Serve/alternate mode only) —
   *  the exact string a referee would call out loud. Null/undefined hides it
   *  (Winner mode, or game over). */
  callScore?: string | null
  /** MCMD/MCXD (pool events) only: team emblem 1.5x the flag size, no frame
   *  or shadow. Omitted = the original 54x38 framed badge, unchanged. */
  bigEmblem?: boolean
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

/** Shuttlecock — marks who serves next in badminton. Cork faces the net. */
function ShuttleGlyph({ cx, cy, r = 9, dir }: { cx: number; cy: number; r?: number; dir: 'left' | 'right' }) {
  const C = '#ffe45c'
  const s = (r / 9) * 1.35
  return (
    <g transform={`translate(${cx} ${cy}) scale(${dir === 'left' ? 1 : -1} 1)`}>
      <circle r={r} fill="none" stroke={C} strokeWidth="2.5">
        <animate attributeName="r" values={`${r};${r * 2};${r}`} dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;0;0.85" dur="1.4s" repeatCount="indefinite" />
      </circle>
      <circle r={r + 3} fill="#0a0e17" opacity="0.45" />
      <g transform={`scale(${s})`} filter="url(#neonGlow)">
        {/* feather skirt, flaring away from the cork */}
        <polygon points="6,-3.6 -8,-8 -8,8 6,3.6" fill="#f4f7ef" stroke="#0a0e17" strokeWidth="0.8" />
        <line x1="6" y1="0" x2="-8" y2="0" stroke="#9aa5b8" strokeWidth="0.8" />
        <line x1="6" y1="-1.8" x2="-8" y2="-4" stroke="#9aa5b8" strokeWidth="0.8" />
        <line x1="6" y1="1.8" x2="-8" y2="4" stroke="#9aa5b8" strokeWidth="0.8" />
        <line x1="-6" y1="-7.4" x2="-6" y2="7.4" stroke={C} strokeWidth="1.4" />
        {/* cork */}
        <circle cx="7.5" cy="0" r="4.4" fill={C} stroke="#0a0e17" strokeWidth="0.9" />
      </g>
    </g>
  )
}

// Corner slots the serve ball can sit in, near the outer baseline+sideline
// corner of each service court — well clear of the (now sideline-mounted,
// vertical) team name and the top flag/logo badge.
const BALL_X_LEFT = 30, BALL_X_RIGHT = 450
const BALL_Y_TOP = 52, BALL_Y_BOTTOM = 188

/** serverCourt() gives 'right'/'left' from the SERVER'S OWN baseline
 *  perspective (per USA Pickleball: right court on even score, left on
 *  odd) — and that flips which physical screen corner it means depending
 *  on which baseline is serving, exactly like real service courts mirror
 *  across the net. A team on the screen-left baseline faces right (toward
 *  the net); their own right hand points to the bottom corner. A team on
 *  the screen-right baseline faces left; their own right hand points to
 *  the top corner. So the same 'right' court is the BOTTOM corner for the
 *  left-side team but the TOP corner for the right-side team. */
function ballY(court: 'right' | 'left' | null | undefined, servingSide: 'left' | 'right' | null | undefined) {
  if (!court) return null
  const rightIsTop = servingSide === 'right'
  return court === 'right' ? (rightIsTop ? BALL_Y_TOP : BALL_Y_BOTTOM) : (rightIsTop ? BALL_Y_BOTTOM : BALL_Y_TOP)
}

export default function Court({
  leftName, rightName, nameSize = 15, nameHalo = false, leftScore, rightScore, onTap, disabled, serving, serverNo, serverCourt,
  leftFlag, rightFlag, leftLogo, rightLogo, label, callScore, sport, bigEmblem = false,
}: CourtProps) {
  const bad = sport === 'badminton'
  const [down, setDown] = useState<'left' | 'right' | null>(null)
  const ballCy = ballY(serverCourt, serving) ?? MIDY + R + 17 // no active server (game over) — old fixed spot below the circle
  // Team flag/logo badge above each score circle. bigEmblem grows it 1.5x
  // upward (bottom edge stays near the old one so the score is never covered)
  // and drops the frame + shadow; the default path renders exactly as before.
  const EW = bigEmblem ? 81 : 54, EH = bigEmblem ? 57 : 38, EY = bigEmblem ? 10 : 30
  const badge = (cx: number, logo?: string | null, flag?: string | null) => (logo || flag) ? (
    <>
      {!bigEmblem && <rect x={cx - 27} y="31" width="54" height="38" rx="5"
        fill="#0a0e17" opacity="0.45" filter="url(#soft)" />}
      {logo
        ? <image href={logo} x={cx - EW / 2} y={EY} width={EW} height={EH}
            preserveAspectRatio="xMidYMid slice" />
        : <svg x={cx - EW / 2} y={EY} width={EW} height={EH}
            viewBox="0 0 28 20" preserveAspectRatio="xMidYMid slice">
            <FlagGlyph name={flag} />
          </svg>}
      {!bigEmblem && <rect x={cx - 27} y="30" width="54" height="38" rx="5"
        fill="none" stroke="#eaf2ff" strokeOpacity="0.9" strokeWidth="2" />}
    </>
  ) : null
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
          <linearGradient id="badSurface" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d4f3a" />
            <stop offset="100%" stopColor="#0a3e2e" />
          </linearGradient>
          <linearGradient id="badInner" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#177a55" />
            <stop offset="100%" stopColor="#12664a" />
          </linearGradient>
          <linearGradient id="kitchen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22508f" />
            <stop offset="100%" stopColor="#1b4179" />
          </linearGradient>
        </defs>

        {bad ? (
          <>
            <rect x="0" y="0" width="480" height="240" fill="url(#badSurface)" />
            <rect x="3" y="3" width="474" height="234" fill="url(#badInner)" />
            <g stroke="#ffffff" strokeOpacity="0.9" fill="none" strokeWidth="2.5"
              vectorEffect="non-scaling-stroke">
              {/* doubles boundary */}
              <rect x="3" y="3" width="474" height="234" />
              {/* singles side lines */}
              <line x1="3" y1="17" x2="477" y2="17" />
              <line x1="3" y1="223" x2="477" y2="223" />
              {/* short service lines (1.98 m from the net) */}
              <line x1={NET - 71} y1="3" x2={NET - 71} y2="237" />
              <line x1={NET + 71} y1="3" x2={NET + 71} y2="237" />
              {/* doubles long service lines (0.76 m inside the back line) */}
              <line x1="30" y1="3" x2="30" y2="237" />
              <line x1="450" y1="3" x2="450" y2="237" />
              {/* centre lines, short service line to back line */}
              <line x1="3" y1={MIDY} x2={NET - 71} y2={MIDY} />
              <line x1={NET + 71} y1={MIDY} x2="477" y2={MIDY} />
            </g>
          </>
        ) : (
          <>
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

          </>
        )}

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
        {badge(CXL, leftLogo, leftFlag)}
        {serving === 'left' && (bad
          ? <ShuttleGlyph cx={serverCourt ? 52 : CXL} cy={ballCy} r={9} dir="left" />
          : <PickleballGlyph cx={serverCourt ? BALL_X_LEFT : CXL} cy={ballCy} r={9} serverNo={serverNo} />)}
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
        {badge(CXR, rightLogo, rightFlag)}
        {serving === 'right' && (bad
          ? <ShuttleGlyph cx={serverCourt ? 428 : CXR} cy={ballCy} r={9} dir="right" />
          : <PickleballGlyph cx={serverCourt ? BALL_X_RIGHT : CXR} cy={ballCy} r={9} serverNo={serverNo} />)}
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

        {/* official score call, e.g. "3-0-2" — bottom center, Serve mode only */}
        {callScore && (
          <g>
            <rect x="196" y="216" width="88" height="20" rx="10" fill="#0a0e17" opacity="0.55" />
            <text x="240" y="227" textAnchor="middle" dominantBaseline="central"
              fill="#c6ff3d" fontSize="15" fontWeight="700"
              fontFamily="'Barlow Condensed', Impact, sans-serif" letterSpacing="1"
              style={{ fontVariantNumeric: 'tabular-nums' }}>
              {callScore}
            </text>
          </g>
        )}

        {/* team names — mounted vertically on the outer sideline, clear of
            both serve-ball corners (top ~52 and bottom ~188) and the flag */}
        <text x={nameHalo ? 22 : 14} y={MIDY} textAnchor="middle" transform={`rotate(-90 ${nameHalo ? 22 : 14} ${MIDY})`}
          {...(nameHalo ? HALO : {})}
          fill="#c6ff3d" fontSize={nameSize} fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(leftName, 12)}
        </text>
        <text x={nameHalo ? 458 : 466} y={MIDY} textAnchor="middle" transform={`rotate(90 ${nameHalo ? 458 : 466} ${MIDY})`}
          {...(nameHalo ? HALO : {})}
          fill="#22d3ee" fontSize={nameSize} fontWeight="700"
          fontFamily="'Barlow Condensed', sans-serif" letterSpacing="1">
          {clip(rightName, 12)}
        </text>
      </svg>
    </div>
  )
}
