import { useEffect, useState } from 'react'

/** The scoring screen is designed landscape — the court only reads correctly
 *  when it is wider than it is tall. */
export function useLandscape() {
  const get = () => window.innerWidth >= window.innerHeight
  const [landscape, setLandscape] = useState(get)
  useEffect(() => {
    const on = () => setLandscape(get())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return landscape
}
