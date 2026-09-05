/** Tap feedback: haptic where available, a short click everywhere else.
 *  Referees score without looking at the screen, so this matters. */
let ctx: AudioContext | null = null

function tone(freq: number, ms: number, gain = 0.06) {
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
export const tapUndo  = () => { navigator.vibrate?.([8, 40, 8]); tone(330, 60) }
export const hornEnd  = () => { navigator.vibrate?.([120, 60, 120]); tone(520, 220, 0.09); setTimeout(() => tone(392, 320, 0.09), 240) }
export const chimeSwitch = () => { navigator.vibrate?.([40, 60, 40]); tone(660, 120); setTimeout(() => tone(990, 160), 140) }
