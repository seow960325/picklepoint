/** Keep the scoring screen awake. Re-acquires after the tab is backgrounded. */
export function useWakeLockEffect() {
  let lock: any = null
  const acquire = async () => {
    try { lock = await (navigator as any).wakeLock?.request('screen') } catch { /* unsupported */ }
  }
  const onVis = () => { if (document.visibilityState === 'visible') acquire() }
  acquire()
  document.addEventListener('visibilitychange', onVis)
  return () => {
    document.removeEventListener('visibilitychange', onVis)
    try { lock?.release() } catch { /* noop */ }
  }
}
