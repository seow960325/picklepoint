/** Offline-tolerant mutation queue.
 *  Court WiFi drops. Every mutation is stamped with a client_event_id, kept in
 *  localStorage until the server acknowledges it, and replayed on reconnect.
 *  The server ignores duplicate client_event_ids, so replay is safe. */

const KEY = 'pp.queue.v1'

export interface QueuedOp {
  id: string
  kind: 'score' | 'undo' | 'confirm' | 'timeout'
  matchId: string
  side?: 'left' | 'right'
  at: number
  tries?: number
}

export const deviceId = (() => {
  let d = localStorage.getItem('pp.device')
  if (!d) { d = crypto.randomUUID(); localStorage.setItem('pp.device', d) }
  return d
})()

const read = (): QueuedOp[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
const write = (q: QueuedOp[]) => localStorage.setItem(KEY, JSON.stringify(q))

export const enqueue = (op: QueuedOp) => { const q = read(); q.push(op); write(q) }
export const peekAll = () => read()
export const drop = (id: string) => write(read().filter(o => o.id !== id))
export const pending = () => read().length

// A scored point is match data, not a cache entry — it is never discarded
// just because it keeps failing. An op that keeps erroring WHILE ONLINE
// (the server is reachable but rejecting it — a stale token, a match that
// changed underneath it) is flagged "stalled" past STALL_THRESHOLD tries so
// the UI can raise an alarm instead of quietly retrying forever, but it
// stays queued until a human retries it (retryStalled) or it succeeds.
const STALL_THRESHOLD = 3
const bump = (id: string) => {
  const q = read()
  const op = q.find(o => o.id === id)
  if (!op) return
  op.tries = (op.tries ?? 0) + 1
  write(q)
}

/** Ops that have failed repeatedly while online — the scorer should notice
 *  and retry manually rather than trust a silently-stuck queue. */
export const stalledCount = () => read().filter(o => (o.tries ?? 0) >= STALL_THRESHOLD).length

/** Clear every op's failure count so the next flush() retries them fresh. */
export const retryStalled = () => {
  write(read().map(o => ({ ...o, tries: 0 })))
}

/** Run `send` over every queued op, oldest first, stopping at the first
 *  failure so ops for the same match always apply in order. Nothing is
 *  ever dropped on failure — see STALL_THRESHOLD above. */
export async function flush(send: (op: QueuedOp) => Promise<void>) {
  for (const op of read()) {
    try { await send(op); drop(op.id) }
    catch {
      if (typeof navigator !== 'undefined' && navigator.onLine) bump(op.id)
      return
    }
  }
}
