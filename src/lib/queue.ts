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

/** Run `send` over every queued op, oldest first, stopping at the first failure. */
export async function flush(send: (op: QueuedOp) => Promise<void>) {
  for (const op of read()) {
    try { await send(op); drop(op.id) } catch { return }
  }
}
