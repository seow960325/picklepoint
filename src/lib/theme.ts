import { useEffect, useState } from 'react'

const KEY = 'picklepoint-theme'
export type Theme = 'light' | 'dark'

const CANVAS: Record<Theme, string> = { light: '#f8fafc', dark: '#0a0e17' }

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', CANVAS[t])
  try { localStorage.setItem(KEY, t) } catch { /* ignore */ }
}

/** Current theme + a setter that persists and updates the document. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getTheme)
  useEffect(() => { applyTheme(theme) }, [theme])
  const setTheme = (t: Theme) => setThemeState(t)
  const toggle = () => setThemeState(t => (t === 'dark' ? 'light' : 'dark'))
  return { theme, setTheme, toggle }
}
