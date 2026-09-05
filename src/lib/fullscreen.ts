import { useCallback, useEffect, useState } from 'react'

/** Cross-browser fullscreen: standard API + WebKit fallback (Safari on
 *  iPad/macOS). iPhone Safari has no element-fullscreen at all, so there
 *  `supported` is false and callers should hide the control — the app is
 *  installable as a PWA (see manifest) for true fullscreen on iPhone. */

const d = () => document as any
const root = () => document.documentElement as any

export function fullscreenSupported(): boolean {
  const doc = d()
  const canRequest = !!(root().requestFullscreen || root().webkitRequestFullscreen)
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? true
  return canRequest && !!enabled
}

function isActive(): boolean {
  return !!(document.fullscreenElement || d().webkitFullscreenElement)
}

export function useFullscreen() {
  const [active, setActive] = useState(isActive)

  useEffect(() => {
    const on = () => setActive(isActive())
    document.addEventListener('fullscreenchange', on)
    document.addEventListener('webkitfullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      document.removeEventListener('webkitfullscreenchange', on)
    }
  }, [])

  const toggle = useCallback(async () => {
    try {
      if (isActive()) {
        await (document.exitFullscreen?.() ?? d().webkitExitFullscreen?.())
      } else {
        await (root().requestFullscreen?.() ?? root().webkitRequestFullscreen?.())
      }
    } catch { /* user gesture / permission — ignore */ }
  }, [])

  return { active, toggle, supported: fullscreenSupported() }
}
