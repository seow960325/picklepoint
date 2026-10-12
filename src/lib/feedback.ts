/** Tap feedback: haptic where available, a short click everywhere else.
 *  Referees score without looking at the screen, so this matters. */
let ctx: AudioContext | null = null

const SOUND_KEY = 'pp.sound'
let soundOn = ((): boolean => { try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true } })()
export const isSoundOn = () => soundOn
export const setSoundOn = (on: boolean) => {
  soundOn = on
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

function tone(freq: number, ms: number, gain = 0.06) {
  if (!soundOn) return
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = freq; o.type = 'square'
    g.gain.value = gain
    o.connect(g); g.connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + ms / 1000)
  } catch { /* audio blocked until first gesture */ }
}

export const tapPoint = () => { navigator.vibrate?.(12); tone(880, 40) }
// A tap that registered but didn't add a point (side-out mode: the receiving
// team, or a serving-team loss that only passes serve) — distinct low double
// buzz/tone so the ref can tell "counted, no score" apart from "no reaction".
export const tapFault = () => { navigator.vibrate?.([10, 30, 10]); tone(220, 55) }
export const tapUndo  = () => { navigator.vibrate?.([8, 40, 8]); tone(330, 60) }
/** Arena end-of-period buzzer: one loud, harsh, sustained blast (stacked sawtooth
 *  partials around 230 Hz with slight beating), like a basketball / hall game horn. */
export function buzzer(ms = 1700) {
  navigator.vibrate?.([300])
  if (!soundOn) return
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime, t1 = t0 + ms / 1000
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, t0)
    master.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02)
    master.gain.setValueAtTime(0.35, t1 - 0.12)
    master.gain.exponentialRampToValueAtTime(0.0001, t1)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800
    master.connect(lp); lp.connect(ctx.destination)
    for (const [f, g] of [[232, 0.5], [234.5, 0.5], [349, 0.3], [466, 0.35], [468.5, 0.3], [698, 0.18], [932, 0.12]] as const) {
      const o = ctx.createOscillator(), og = ctx.createGain()
      o.type = 'sawtooth'; o.frequency.value = f; og.gain.value = g * 0.5
      o.connect(og); og.connect(master); o.start(t0); o.stop(t1 + 0.05)
    }
  } catch { /* audio blocked until first gesture */ }
}
export const hornEnd  = () => buzzer()
export const chimeSwitch = () => { navigator.vibrate?.([40, 60, 40]); tone(660, 120); setTimeout(() => tone(990, 160), 140) }
