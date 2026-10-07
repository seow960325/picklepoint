import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IS_DEMO, join, registerCheck, registerTeam } from '../lib/api'
import { resizeLogoTight } from '../lib/image'
import { teamPrompt } from '../lib/teamPrompt'
import { Screen } from '../components/ui'
import type { Bundle } from '../lib/types'

const CODES = ['MCMD', 'MCXD']
const GEMINI_APP = 'https://gemini.google.com/app'

type Mine = { token: string; name: string; pin?: string }
const regKey = (c: string) => `pp_reg_${c}`
const pinKey = (c: string) => `pp_pin_${c}`
const tokKey = (c: string) => `pp_tok_${c}`
const readMine = (c: string): Mine | null => { try { return JSON.parse(localStorage.getItem(regKey(c)) || 'null') } catch { return null } }
const writeMine = (c: string, m: Mine) => { try { localStorage.setItem(regKey(c), JSON.stringify(m)) } catch { /* ignore */ } }
const readPin = (c: string) => { try { return localStorage.getItem(pinKey(c)) || '' } catch { return '' } }
const writePin = (c: string, p: string) => { try { p ? localStorage.setItem(pinKey(c), p) : localStorage.removeItem(pinKey(c)) } catch { /* ignore */ } }
const newToken = () => {
  try { return crypto.randomUUID() } catch { return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('') }
}
/** this phone's secret token for the competition (created once, reused by code check and register) */
const phoneToken = (c: string) => {
  try {
    const t = localStorage.getItem(tokKey(c)) || readMine(c)?.token || newToken()
    localStorage.setItem(tokKey(c), t); return t
  } catch { return newToken() }
}
const download = (dataUrl: string, name: string) => {
  const a = document.createElement('a')
  a.href = dataUrl; a.download = `${name.replace(/[^A-Za-z0-9]+/g, '_') || 'team'}.png`
  document.body.appendChild(a); a.click(); a.remove()
}
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
  } catch { return false }
}

const readable = (m: string) => ({
  REG_CLOSED: 'Registration is closed for this competition.',
  FULL: 'All team slots are taken.',
  NAME_TAKEN: 'A team with those names is already registered.',
  BAD_NAME: 'Enter one word for each player name.',
  BAD_LOGO: 'The team picture could not be saved — generate it again.',
  ASK_ORGANISER: 'Groups are already drawn — please ask the organiser to change it.',
  BAD_TOKEN: 'Please reload the page and try again.',
  BAD_PIN: 'That team code is not valid. Check it with the organiser.',
  PIN_USED: 'That team code is already used by another phone.',
}[m] ?? m)

/** one word only: "Ling Xiang" -> "Xiang" (last word), keeps names short enough for the court */
const oneWord = (v: string) => v.trim().split(/\s+/).pop() ?? ''

const fieldCls = 'w-full rounded-xl border-2 border-line bg-surface px-3 py-3 text-lg font-semibold text-fg outline-none focus:border-brand-ink'

export default function Register() {
  const params = useParams()
  const nav = useNavigate()
  const code = (params.code ?? '').toUpperCase()
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [pin, setPin] = useState(() => readPin(code)) // verified team code
  const [pinIn, setPinIn] = useState('')
  const [busy, setBusy] = useState<null | 'pin' | 'save'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mine, setMine] = useState<Mine | null>(() => readMine(code))
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const ownRef = useRef<HTMLInputElement>(null)

  const load = () => {
    setLoadErr(null)
    if (!code) return
    join(code).then(setBundle).catch(() => setLoadErr('Competition not found.'))
  }
  useEffect(() => {
    setBundle(null); setMine(readMine(code)); setPin(readPin(code)); setPinIn(''); setEditing(false); load()
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const ev = bundle?.events.find((e: any) => e.court_dispatch === 'pool')
  const teams = bundle && ev ? bundle.teams.filter((t: any) => t.event_id === ev.id) : []
  const free = teams.filter((t: any) => !t.logo || t.logo.startsWith('data:image/svg')).length
  const started = !!bundle?.matches.some((m: any) => m.status === 'finished' || m.score_a > 0 || m.score_b > 0)
  const closed = !!bundle && (!ev || started || free === 0)
  const myTeam: any = mine ? teams.find((t: any) => t.name === mine.name) ?? null : null
  const canEdit = !!bundle && !!ev && !started
  const myPin = mine?.pin || pin
  const needPin = !!bundle && !myTeam && !closed && !pin
  const showForm = !!bundle && ((!myTeam && !closed && !!pin) || (!!myTeam && editing && canEdit))

  const checkPin = async () => {
    setErr(null); setBusy('pin')
    try {
      await registerCheck(code, pinIn.trim(), phoneToken(code))
      writePin(code, pinIn.trim()); setPin(pinIn.trim())
    } catch (e: any) { setErr(readable(e.message)) }
    finally { setBusy(null) }
  }

  // the free way: the player made the picture in their own Gemini app
  const onOwnPicture = async (file: File | undefined) => {
    if (!file) return
    setErr(null)
    try { setLogo(await resizeLogoTight(file, 400, true)) }
    catch { setErr('That picture could not be read — try another one.') }
  }

  const submit = async () => {
    if (!logo) return
    setErr(null); setBusy('save')
    try {
      const token = mine?.token ?? phoneToken(code)
      const r = await registerTeam(code, oneWord(p1), oneWord(p2), logo, token, myPin)
      const m = { token, name: r.name, pin: myPin }
      writeMine(code, m); setMine(m); setEditing(false); setLogo(null)
      load()
    } catch (e: any) {
      if (e.message === 'BAD_PIN' || e.message === 'PIN_USED') { writePin(code, ''); setPin(''); setPinIn('') }
      setErr(readable(e.message))
    }
    finally { setBusy(null) }
  }

  const names = !!oneWord(p1) && !!oneWord(p2)

  return (
    <Screen className="px-5 py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="text-center font-display text-4xl font-bold tracking-tight text-brand-ink">TEAM REGISTRATION</div>
        <div className="mb-6 mt-1 text-center text-sm text-fg-muted">Make your doubles team picture</div>

        {!code && (
          <div className="grid gap-3">
            {CODES.map(c => (
              <button key={c} onClick={() => nav(`/register/${c}`)}
                className="rounded-2xl bg-brand py-5 font-display text-3xl font-bold tracking-wide text-brand-fg active:scale-[0.99]">
                {c === 'MCMD' ? "MEN'S DOUBLES" : 'MIXED DOUBLES'}
              </button>
            ))}
          </div>
        )}

        {code && loadErr && <div className="rounded-xl bg-red-500/10 p-4 text-center text-red-500">{loadErr}</div>}
        {code && !bundle && !loadErr && <div className="text-center text-fg-muted">Loading…</div>}

        {bundle && myTeam && !editing && (
          <div className="rounded-2xl border border-brand-ink/40 bg-surface p-5 text-center">
            {myTeam.logo && <img src={myTeam.logo} alt="" className="mx-auto mb-3 h-44 object-contain" />}
            <div className="font-display text-3xl font-bold text-brand-ink">REGISTERED ✓</div>
            <div className="mt-1 text-lg font-semibold">{myTeam.name}</div>
            <div className="mt-2 text-sm text-fg-muted">See you on court. The organiser will announce your group.</div>
            <div className="mt-4 grid gap-2">
              {myTeam.logo && (
                <button onClick={() => download(myTeam.logo, myTeam.name)}
                  className="rounded-xl bg-brand py-3 font-display text-lg font-bold tracking-wide text-brand-fg active:scale-[0.99]">
                  ⬇ DOWNLOAD PICTURE
                </button>
              )}
              {canEdit && (
                <button onClick={() => {
                  const [a = '', b = ''] = String(myTeam.name).split(' & ')
                  setP1(a); setP2(b); setLogo(myTeam.logo ?? null); setErr(null); setEditing(true)
                }}
                  className="rounded-xl border border-line py-3 font-display text-lg font-bold tracking-wide text-fg-muted active:bg-surface-2">
                  ✎ CHANGE OUR REGISTRATION
                </button>
              )}
            </div>
          </div>
        )}

        {bundle && !myTeam && closed && (
          <div className="rounded-xl border border-line bg-surface p-5 text-center text-fg-muted">
            {free === 0 && ev ? 'All team slots are taken.' : 'Registration is closed.'}
          </div>
        )}

        {needPin && (
          <div className="grid gap-4 rounded-2xl border border-line bg-surface p-5 text-center">
            <div className="font-display text-xl font-bold tracking-wide">ENTER YOUR TEAM CODE</div>
            <div className="text-sm text-fg-muted">4 digits, given to your team by the organiser.</div>
            <input className={`${fieldCls} text-center font-display text-4xl tracking-[0.5em]`} inputMode="numeric" pattern="[0-9]*"
              maxLength={4} placeholder="••••" value={pinIn} autoComplete="off"
              onChange={e => setPinIn(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={e => { if (e.key === 'Enter' && pinIn.length === 4) checkPin() }} />
            {err && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{err}</div>}
            <button disabled={pinIn.length !== 4 || busy === 'pin'} onClick={checkPin}
              className="rounded-2xl bg-brand py-4 font-display text-2xl font-bold tracking-wide text-brand-fg active:scale-[0.99] disabled:opacity-30">
              {busy === 'pin' ? 'CHECKING…' : 'CONTINUE'}
            </button>
          </div>
        )}

        {showForm && (
          <div className="grid gap-5">
            <div className="text-center text-xs font-semibold uppercase tracking-widest text-fg-subtle">
              {editing ? `Changing ${myTeam?.name}` : `${ev?.name ?? code} · team code ${pin} ✓`}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input className={fieldCls} placeholder="Player 1" maxLength={14} value={p1}
                onChange={e => setP1(e.target.value)} onBlur={() => setP1(oneWord(p1))} />
              <input className={fieldCls} placeholder="Player 2" maxLength={14} value={p2}
                onChange={e => setP2(e.target.value)} onBlur={() => setP2(oneWord(p2))} />
            </div>
            <div className="-mt-3 text-center text-xs text-fg-subtle">One word per name (e.g. “Ling Xiang” → Xiang)</div>

            <input ref={ownRef} type="file" accept="image/*" className="hidden"
              onChange={e => { onOwnPicture(e.target.files?.[0]); e.target.value = '' }} />

            {logo ? (
              <div className="rounded-2xl border border-line bg-surface p-3 text-center">
                <img src={logo} alt="Team picture" className="mx-auto h-44 object-contain" />
                <div className="mt-1 text-sm font-semibold">{oneWord(p1) || 'Player 1'} & {oneWord(p2) || 'Player 2'}</div>
                <div className="mt-2 flex justify-center gap-4 text-sm font-semibold">
                  <button onClick={() => download(logo, `${oneWord(p1)}_${oneWord(p2)}`)}
                    className="text-brand-ink underline underline-offset-4">⬇ Download</button>
                  <button onClick={() => setLogo(null)} className="text-fg-muted underline underline-offset-4">Change picture</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
                <div className="font-display text-lg font-bold tracking-wide">TEAM PICTURE · FREE</div>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
                  <li>Copy the prompt and open the Gemini app.</li>
                  <li>Attach one photo of each player (Player 1 first{code === 'MCXD' ? ', then Player 2 the lady' : ''}), paste the prompt, send.</li>
                  <li>Save the picture Gemini makes, then upload it here.</li>
                </ol>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={async () => { setCopied(await copyText(teamPrompt(code))) }}
                    className="rounded-xl border border-line py-3 text-sm font-bold active:bg-surface-2">
                    {copied ? '✓ COPIED' : '📋 COPY PROMPT'}
                  </button>
                  <a href={GEMINI_APP} target="_blank" rel="noreferrer"
                    className="rounded-xl border border-line py-3 text-center text-sm font-bold active:bg-surface-2">
                    OPEN GEMINI ↗
                  </a>
                </div>
                <button onClick={() => ownRef.current?.click()}
                  className="rounded-xl bg-brand py-3 font-display text-lg font-bold tracking-wide text-brand-fg active:scale-[0.99]">
                  ⬆ UPLOAD THE PICTURE
                </button>
              </div>
            )}

            {err && <div className="rounded-xl bg-red-500/10 p-3 text-center text-sm text-red-500">{err}</div>}

            {logo && (
              <button disabled={!!busy || !names} onClick={submit}
                className="rounded-2xl bg-brand py-5 font-display text-2xl font-bold tracking-wide text-brand-fg active:scale-[0.99] disabled:opacity-30">
                {busy === 'save' ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'REGISTER OUR TEAM'}
              </button>
            )}
            {editing && (
              <button onClick={() => { setEditing(false); setLogo(null); setErr(null) }}
                className="text-sm text-fg-subtle underline underline-offset-4">Cancel</button>
            )}
          </div>
        )}
        {IS_DEMO && <div className="mt-6 text-center text-xs text-fg-subtle">Demo mode — registration is disabled.</div>}
      </div>
    </Screen>
  )
}
