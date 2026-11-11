/** An organiser change to a waiting game (moved up / later): shown red to the
 *  teams in it until the game starts, then back to normal. */
import type { Match } from './types'
export const isAlert = (m: Match): boolean => !!m.alert_at && (m.status === 'scheduled' || m.status === 'on_deck')
export const alertWord = (m: Match): string => m.alert_note === 'later' ? 'MOVED LATER' : 'MOVED UP'
