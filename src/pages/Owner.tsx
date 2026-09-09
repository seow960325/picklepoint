import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../lib/api'
import { Screen, Spinner } from '../components/ui'

const TOK_KEY = 'pp.owner.token'

function readToken(): string | null {
  try {
    const raw = localStorage.getItem(TOK_KEY)
    if (!raw) return null
    const { t, exp } = JSON.parse(raw)
    if (!t || !exp || Date.now() > exp) { localStorage.removeItem(TOK_KEY); return null }
    return t
  } catch { localStorage.removeItem(TOK_KEY); return null }
}
function writeToken(t: string) {
  localStorage.setItem(TOK_KEY, JSON.stringify({ t, exp: Date.now() + 2 * 60 * 60 * 1000 }))
}

export default function Owner() {
  const [token, setToken] = useState<string | null>(() => readToken())

  if (!token) return <OwnerGate onIn={t => { writeToken(t); setToken(t) }} />
  return <OwnerPanel token={token} onLogout={() => { localStorage.removeItem(TOK_KEY); setToken(null) }} />
}

function OwnerGate({ onIn }: { onIn: (t: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try { onIn(await api.ownerLogin(pin)) }
    catch (e: any) {
      setErr(true); setPin('')
      setLocked(e?.message === 'LOCKED')
    }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-canvas px-6">
      <Link to="/" className="absolute left-4 top-3 text-sm text-fg-subtle">← lobby</Link>
      <form onSubmit={e => { e.preventDefault(); if (pin) submit() }} className="w-full max-w-xs text-center">
        <div className="font-display text-3xl font-bold tracking-widest text-fg-muted">OWNER</div>
        <div className="mt-1 text-sm text-fg-subtle">Master PIN</div>
        {locked && (
          <div className="mt-2 text-xs font-semibold text-red-500">Too many attempts — try again in a minute</div>
        )}
        <input
          type="password" inputMode="numeric" autoFocus value={pin}
          onChange={e => { setErr(false); setLocked(false); setPin(e.target.value) }}
          className={`mt-5 w-full rounded-2xl border-2 bg-surface py-4 text-center font-display text-3xl font-bold tracking-[0.3em] outline-none ${
            err ? 'border-red-500' : 'border-line focus:border-brand-ink'}`}
        />
        <button type="submit" disabled={!pin || busy}
          className="mt-4 w-full rounded-2xl bg-brand py-3 font-display text-lg font-bold text-brand-fg disabled:opacity-40">
          {busy ? 'CHECKING…' : 'ENTER'}
        </button>
      </form>
    </div>
  )
}

function OwnerPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [list, setList] = useState<api.OwnerCompetition[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<api.OwnerCompetition | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.ownerListCompetitions(token).then(setList).catch(e => {
      if (e?.message === 'NOT_OWNER') { onLogout(); return }
      setErr(e?.message ?? 'Failed to load')
      setList([])
    })
  }
  useEffect(load, [token])

  const doDelete = async () => {
    if (!pending) return
    setBusy(true)
    try { await api.ownerDeleteCompetition(token, pending.id); setPending(null); load() }
    catch (e: any) { setErr(e?.message ?? 'Delete failed') }
    finally { setBusy(false) }
  }

  if (!list) return <Screen><Spinner /></Screen>

  const totalTeams = list.reduce((n, c) => n + c.team_count, 0)
  const totalMatches = list.reduce((n, c) => n + c.match_count, 0)

  return (
    <Screen className="px-4 py-4 lg:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-display text-2xl font-bold tracking-wide">All competitions</div>
          <div className="text-xs text-fg-subtle">
            {list.length} competitions · {totalTeams} teams · {totalMatches} matches total
          </div>
        </div>
        <button onClick={onLogout}
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-muted active:bg-surface-2">
          Log out
        </button>
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600">{err}</div>}

      {!list.length && <div className="p-6 text-center text-sm text-fg-subtle">No competitions yet.</div>}

      <div className="space-y-2">
        {list.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
            <div className="min-w-0">
              <div className="truncate font-display text-base font-bold">{c.name}</div>
              <div className="truncate text-xs text-fg-subtle">
                {c.code} · {c.venue || 'no venue'} · {c.event_date} · {c.status}
                {' · '}{c.team_count} teams · {c.match_count} matches
                {' · created '}{new Date(c.created_at).toLocaleDateString()}
              </div>
            </div>
            <button onClick={() => setPending(c)}
              className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-600 active:bg-red-500/10">
              Delete
            </button>
          </div>
        ))}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => !busy && setPending(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5" onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg font-bold text-red-600">Delete {pending.code}?</div>
            <p className="mt-2 text-sm text-fg-muted">
              "{pending.name}" and everything in it — teams, matches, scores — will be
              permanently removed. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setPending(null)} disabled={busy}
                className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg-muted disabled:opacity-40">
                Cancel
              </button>
              <button onClick={doDelete} disabled={busy}
                className="rounded-xl bg-red-600 px-4 py-2 font-display text-sm font-bold text-white disabled:opacity-40">
                {busy ? 'DELETING…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  )
}
