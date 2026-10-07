import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IS_DEMO, join, registerTeam } from '../lib/api'
import { resizeLogoTight } from '../lib/image'
import { makeTeamCartoon } from '../lib/teamLogoAi'
import { TEAM_PROMPT } from '../lib/teamPrompt'
import { Screen } from '../components/ui'
import type { Bundle } from '../lib/types'

const CODES = ['MCMD', 'MCXD']
// Paid AI drawing on this page is OFF unless VITE_REGISTER_AI=1 is set in Vercel.
// The free way (players use their own Gemini app) is always available.
const AI_ON = import.meta.env.VITE_REGISTER_AI === '1'
const MAX_TRIES = 1 // paid AI pictures per phone; redo is done by the organiser
const GEMINI_APP = 'https://gemini.google.com/app'

type Mine = { token: string; name: string }
const regKey = (c: string) => `pp_reg_${c}`
const triesKey = (c: string) => `pp_reg_tries_${c}`
const readMine = (c: string): Mine | null => { try { return JSON.parse(localStorage.getItem(regKey(c)) || 'null') } catch { return null } }
const writeMine = (c: string, m: Mine) => { try { localStorage.setItem(regKey(c), JSON.stringify(m)) } catch { /* ignore */ } }
const readTries = (c: string) => { try { return Number(localStorage.getItem(triesKey(c)) || 0) } catch { return 0 } }
const writeTries = (c: string, n: number) => { try { localStorage.setItem(triesKey(c), String(n)) } catch { /* ignore */ } }
const newToken = () => {
  try { return crypto.randomUUID() } catch { return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('') }
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
}[m] ?? m)

/** one word only: "Ling Xiang" -> "Xiang" (last word), keeps names short enough for the court */
const oneWord = (v: string) => v.trim().split(/\s+/).pop() ?? ''

const fieldCls = 'w-full rounded-xl border-2 border-line bg-surface px-3 py-3 text-lg font-semibold text-fg outline-none focus:border-brand-ink'

function PhotoPick({ label, file, onFile }: { label: string; file: File | null; onFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!file) { setSrc(null); return }
    const u = URL.createObjectURL(file); setSrc(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return (
    <button type="button" onClick={() => ref.current?.click()}
      className="flex aspect-square w-full flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-surface text-fg-muted active:bg-surface-2">
      <input ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { onFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" />
        : <><span className="text-4xl">📷</span><span className="mt-1 px-2 text-center text-sm font-semibold">{label}</span></>}
    </button>
  )
}

export default function Register() {
  const params = useParams()
  const nav = useNavigate()
  const code = (params.code ?? '').toUpperCase()
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [p1, setP1] = useState(''); const [p2, setP2] = useState('')
  const [f1, setF1] = useState<File | null>(null); const [f2, setF2] = useState<File | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [tries, setTries] = useState(() => readTries(code))
  const [busy, setBusy] = useState<null | 'gen' | 'save'>(null)
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
    setBundle(null); setMine(readMine(code)); setTries(readTries(code)); setEditing(false); load()
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const ev = bundle?.events.find((e: any) => e.court_dispatch === 'pool')
  const teams = bundle && ev ? bundle.teams.filter((t: any) => t.event_id === ev.id) : []
  const free = teams.filter((t: any) => !t.logo || t.logo.startsWith('data:image/svg')).length
  const started = !!bundle?.matches.some((m: any) => m.status === 'finished' || m.score_a > 0 || m.score_b > 0)
  const closed = !!bundle && (!ev || started || free === 0)
  const myTeam: any = mine ? teams.find((t: any) => t.name === mine.name) ?? null : null
  const canEdit = !!bundle && !!ev && !started
  const showForm = !!bundle && ((!myTeam && !closed) || (!!myTeam && editing && canEdit))

  const generate = async () => {
    if (!f1 || !f2) return
    setP1(oneWord(p1)); setP2(oneWord(p2))
    setErr(null); setBusy('gen')
    try {
      const png = await makeTeamCartoon(code, [f1, f2])
      setLogo(await resizeLogoTight(png, 400, true))
      const n = tries + 1; writeTries(code, n); setTries(n)
    } catch (e: any) { setErr(e.message || 'Something went wrong.') }
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
      const token = mine?.token ?? newToken()
      const r = await registerTeam(code, oneWord(p1), oneWord(p2), logo, token)
      const m = { token, name: r.name }
      writeMine(code, m); setMine(m); setEditing(false); setLogo(null); setF1(null); setF2(null)
      load()
    } catch (e: any) { setErr(readable(e.message)) }
    finally { setBusy(null) }
  }

  const names = !!oneWord(p1) && !!oneWord(p2)
  const ready = names && !!f1 && !!f2

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

        {showForm && (
          <div className="grid gap-5">
            <div className="text-center text-xs font-semibold uppercase tracking-widest text-fg-subtle">
              {editing ? `Changing ${myTeam?.name}` : `${ev?.name ?? code} · ${free} slot${free === 1 ? '' : 's'} left`}
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
                  <li>Attach one photo of each player, paste the prompt, send.</li>
                  <li>Save the picture Gemini makes, then upload it here.</li>
                </ol>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={async () => { setCopied(await copyText(TEAM_PROMPT)) }}
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

                {AI_ON && tries < MAX_TRIES && (
                  <div className="mt-2 grid gap-2 border-t border-line pt-3">
                    <div className="text-center text-xs text-fg-subtle">or let us draw it (one try per phone)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <PhotoPick label="Photo 1" file={f1} onFile={setF1} />
                      <PhotoPick label="Photo 2" file={f2} onFile={setF2} />
                    </div>
                    <button disabled={!ready || !!busy} onClick={generate}
                      className="rounded-xl border border-line py-3 font-display text-lg font-bold tracking-wide disabled:opacity-30">
                      {busy === 'gen' ? 'DRAWING… (up to 30 s)' : '✨ DRAW IT FOR US'}
                    </button>
                  </div>
                )}
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
