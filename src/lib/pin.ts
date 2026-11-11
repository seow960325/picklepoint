/** "My team": a visitor pins a team on their own phone (no login). Kept in
 *  this browser per front page; every screen reads the pinned ids from
 *  PinCtx to highlight that team. */
import { createContext, useContext, useEffect, useState } from 'react'

export interface Pin { code: string; teamId: string; name: string }
const key = (hub: string) => `pp.pin.${hub.toUpperCase()}`
const EVT = 'pp:pins'

const read = (hub: string): Pin[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key(hub)) ?? '[]')
    return Array.isArray(v) ? v.filter(p => p && typeof p.code === 'string' && typeof p.teamId === 'string') : []
  } catch { return [] }
}
const write = (hub: string, pins: Pin[]) => {
  try { localStorage.setItem(key(hub), JSON.stringify(pins)) } catch { /* private mode: kept for this visit only */ }
  window.dispatchEvent(new CustomEvent(EVT, { detail: { hub, pins } }))
}

export const MAX_PINS = 2

export function usePins(hub: string) {
  const [pins, setPins] = useState<Pin[]>(() => read(hub).slice(-MAX_PINS))
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.hub === hub) setPins(d.pins) }
    window.addEventListener(EVT, on)
    return () => window.removeEventListener(EVT, on)
  }, [hub])
  const toggle = (p: Pin) => {
    const has = pins.some(x => x.code === p.code && x.teamId === p.teamId)
    write(hub, has ? pins.filter(x => !(x.code === p.code && x.teamId === p.teamId)) : [...pins, p].slice(-MAX_PINS))
  }
  return { pins, toggle }
}

/** ids of the pinned teams (empty set when nothing is pinned) */
export const PinCtx = createContext<Set<string>>(new Set())
export const usePinned = () => useContext(PinCtx)
