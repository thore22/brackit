import type { Score } from './standings.ts'

export type Status = 'scheduled' | 'running' | 'submitted' | 'confirmed' | 'corrected'
export interface GameState {
  id: number; version: number; status: Status; live: Score | null; official: Score | null
  started: string | null; paused: string | null; pausedMs: number; ended: string | null
  regularEnded: string | null; extra: boolean
}
export const emptyGame = (id: number): GameState => ({
  id, version: 0, status: 'scheduled', live: null, official: null, started: null, paused: null,
  pausedMs: 0, ended: null, regularEnded: null, extra: false,
})
export const statusLabel: Record<Status, string> = {
  scheduled: 'Geplant', running: 'Läuft', submitted: 'Freigabe ausstehend', confirmed: 'Bestätigt', corrected: 'Korrigiert',
}
export function countdown(state: GameState, duration: number, now: number) {
  const elapsed = state.started ? (state.paused ? Date.parse(state.paused) : now) - Date.parse(state.started) - state.pausedMs : 0
  const seconds = Math.max(0, duration * 60 - Math.floor(Math.max(elapsed, 0) / 1000))
  const label = state.ended ? 'Spiel beendet' : state.extra ? 'Entscheidender Zusatzpunkt' : state.regularEnded || !seconds ? 'Spielzeit abgelaufen' : state.paused ? 'Pausiert' : state.started ? 'Reguläre Spielzeit' : 'Spielbeginn ausstehend'
  return { seconds: state.regularEnded || state.ended ? 0 : seconds, label }
}
export const formatDuration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

export function scheduledEpoch(date: string, minute: number, timezone: string) {
  const [y, m, d] = date.split('-').map(Number)
  const intended = Date.UTC(y, m - 1, d, 0, minute)
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  let timestamp = intended
  for (let attempt = 0; attempt < 3; attempt++) {
    const [year, month, day, hour, min] = format.format(timestamp).split(/[- :]/).map(Number)
    const local = Date.UTC(year, month - 1, day, hour, min)
    if (local === intended) return timestamp
    timestamp += intended - local
  }
  throw new Error('Die geplante Ortszeit existiert am gewählten Datum nicht.')
}
