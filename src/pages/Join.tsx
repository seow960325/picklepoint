import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IS_DEMO } from '../lib/api'
import { rememberCode, lastCode } from '../lib/store'
import { Screen } from '../components/ui'

export default function Join() {
  const [code, setCode] = useState(lastCode())
  const [askNew, setAskNew] = useState(false)
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
        <div className="mb-1 text-center font-display text-5xl font-bold tracking-tight text-brand-ink">
          PICKLEPOINT
        </div>
        <div className="mb-10 text-center text-sm text-fg-muted">
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
            className="w-full rounded-2xl border-2 border-line bg-surface py-6 text-center font-display text-5xl font-bold tracking-[0.3em] text-fg outline-none focus:border-brand-ink"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-2xl bg-brand py-5 font-display text-2xl font-bold tracking-wide text-brand-fg active:scale-[0.99]"
          >
            ENTER
          </button>
        </form>

        <Link to="/quick"
          className="mt-5 block rounded-2xl bg-brand-ink py-4 text-center font-display text-lg font-bold tracking-wide text-brand-fg active:scale-[0.99]">
          ⚡ QUICK START
        </Link>

        {/* new competitions go through the organiser: show the contact (the /new page itself is unchanged) */}
        <button type="button" onClick={() => setAskNew(v => !v)}
          className="mt-3 block w-full rounded-2xl border border-line bg-surface py-4 text-center font-display text-lg font-bold tracking-wide text-fg-muted active:bg-surface-2">
          + NEW COMPETITION
        </button>
        {askNew && (
          <div className="mt-3 rounded-2xl border-2 border-gold/60 bg-gold/10 px-4 py-4 text-center">
            <p className="text-sm font-semibold leading-snug">To create a new competition, please contact us for info:</p>
            <a href="tel:+60177743891" className="mt-1 block font-display text-2xl font-bold tracking-wide">+6017-774 3891</a>
            <div className="mt-3 flex justify-center gap-2">
              <a href="https://wa.me/60177743891?text=Hi%2C%20I%20would%20like%20info%20on%20creating%20a%20competition%20on%20PicklePoint"
                target="_blank" rel="noreferrer" className="rounded-lg bg-[#25D366] px-4 py-2 text-sm font-bold text-black">WhatsApp</a>
              <a href="tel:+60177743891" className="rounded-lg border border-line px-4 py-2 text-sm font-bold">Call</a>
            </div>
          </div>
        )}

        {IS_DEMO && (
          <button
            onClick={() => { rememberCode('PICKLE'); nav('/c/PICKLE') }}
            className="mt-6 w-full text-center text-xs text-fg-muted underline underline-offset-4"
          >
            No Supabase configured — open the demo competition (code PICKLE)
          </button>
        )}
      </div>
      <div className="mt-10 text-center text-xs text-fg-subtle">Developed by Sisikita.Event</div>

      <Link to="/owner" aria-label="owner"
        className="fixed bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full text-fg-subtle/50 active:bg-surface-2">
        ⚙
      </Link>
    </Screen>
  )
}
