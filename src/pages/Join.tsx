import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IS_DEMO } from '../lib/api'
import { rememberCode, lastCode } from '../lib/store'
import { Screen } from '../components/ui'

export default function Join() {
  const [code, setCode] = useState(lastCode())
  const nav = useNavigate()

  const go = (e: React.FormEvent) => {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    if (c.length < 4) return
    rememberCode(c)
    nav(`/c/${c}`)
  }

  return (
    <Screen className="flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-1 text-center font-display text-5xl font-bold tracking-tight text-lime">
          PICKLEPOINT
        </div>
        <div className="mb-10 text-center text-sm text-gray-500">
          Enter your competition code
        </div>

        <form onSubmit={go}>
          <input
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={8}
            className="w-full rounded-2xl border-2 border-edge bg-panel py-6 text-center font-display text-5xl font-bold tracking-[0.3em] text-white outline-none focus:border-lime"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-2xl bg-lime py-5 font-display text-2xl font-bold tracking-wide text-ink active:scale-[0.99]"
          >
            ENTER
          </button>
        </form>

        <Link to="/new"
          className="mt-5 block rounded-2xl border border-edge bg-panel py-4 text-center font-display text-lg font-bold tracking-wide text-gray-300 active:bg-edge">
          + NEW COMPETITION
        </Link>

        {IS_DEMO && (
          <button
            onClick={() => { rememberCode('PICKLE'); nav('/c/PICKLE') }}
            className="mt-6 w-full text-center text-xs text-gray-500 underline underline-offset-4"
          >
            No Supabase configured — open the demo competition (code PICKLE)
          </button>
        )}
      </div>
    </Screen>
  )
}
