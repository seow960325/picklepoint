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

// Give up on an op that keeps failing WHILE ONLINE — that means the server
// rejected it (e.g. it referenced a match that has since changed), not that
// the device is offline, so retrying forever just shows a phantom count.
const MAX_TRIES = 3
const bump = (id: string) => {
  const q = read()
  const op = q.find(o => o.id === id)
  if (!op) return
  op.tries = (op.tries ?? 0) + 1
  write(op.tries >= MAX_TRIES ? q.filter(o => o.id !== id) : q)
}

/** Run `send` over every queued op, oldest first, stopping at the first failure. */
export async function flush(send: (op: QueuedOp) => Promise<void>) {
  for (const op of read()) {
    try { await send(op); drop(op.id) }
    catch {
      if (typeof navigator !== 'undefined' && navigator.onLine) bump(op.id)
      return
    }
  }
}
