import { createClient } from '@supabase/supabase-js'
import type { Match, Plan, TournamentConfig } from '../engine/model.ts'
import { localAudit, localCanReport, localControl, localGame, localIssue, localList, localMove, localRead, localRedeem, localSave, watchLocal } from './local.ts'
import type { AuditEntry, ControlAction, GameCommand, Invitation, Tournament, TournamentSummary } from './types.ts'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const incompleteSetup = Boolean(url) !== Boolean(key)
export const supabase = url && key ? createClient(url, key) : null
export const connected = !!supabase
const knownErrors: Record<string, string> = {
  invalid_credentials: 'E-Mail oder Passwort ist ungültig.',
  email_not_confirmed: 'Bestätige die E-Mail-Adresse dieses Kontos.',
  anonymous_provider_disabled: 'Der Schiedsrichterzugang wurde in Supabase noch nicht aktiviert.',
  over_request_rate_limit: 'Zu viele Anfragen. Versuche es in Kürze erneut.',
  '42501': 'Für diese Aktion fehlt die Berechtigung.',
  '23505': 'Eine Kennung oder Belegung kommt mehrfach vor.',
  '23503': 'Der Plan verweist auf ein unbekanntes Team, Feld oder eine unbekannte Phase.',
}
export function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code ?? '')
    if (!code) return 'Der Server ist gerade nicht erreichbar.'
    if (knownErrors[code]) return knownErrors[code]
    if (code !== 'P0001') return 'Der Server konnte die Aktion nicht abschließen.'
  }
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Die Aktion konnte nicht abgeschlossen werden.'
}
const cacheKey = (id: string) => `turnierleitung.cache.${id}`

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase ist nicht eingerichtet.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export function readCached(id: string): Tournament | null {
  try { return JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null') } catch { return null }
}
export function latestCachedTournament() {
  const prefix = cacheKey('')
  return Object.keys(localStorage).filter(item => item.startsWith(prefix)).map(item => readCached(item.slice(prefix.length)))
    .filter(tournament => tournament !== null).sort((a, b) => Date.parse(b.serverNow) - Date.parse(a.serverNow))[0]
}
export async function readTournament(id: string, admin: boolean) {
  if (!connected) return localRead(id, admin)
  const tournament = await rpc<Tournament>('cup_read', { t: id })
  if (tournament.state !== 'draft') {
    try {
      const cached = readCached(id)
      if (!cached || cached.revision <= tournament.revision) localStorage.setItem(cacheKey(id), JSON.stringify({ ...tournament, admin: false }))
    } catch { /* Storage can be unavailable or full. */ }
  }
  return { ...tournament, admin: admin && tournament.admin }
}
export function watchTournament(id: string, refresh: () => void, ready: (ready: boolean) => void) {
  if (!supabase) { ready(true); return watchLocal(id, refresh) }
  const client = supabase
  const channel = client.channel(`turnier-${id}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `id=eq.${id}` }, refresh)
    .subscribe(status => {
      ready(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') refresh()
    })
  return () => { void client.removeChannel(channel) }
}
export const listTournaments = async () => connected ? rpc<TournamentSummary[]>('cup_list') : localList()
export const savePlan = async (id: string | null, version: number | null, config: TournamentConfig, plan: Plan) =>
  connected ? rpc<string>('cup_save_plan', { t: id, expected: version, cfg: config, plan }) : localSave(id, version, config, plan)
export const control = async (id: string, version: number, action: ControlAction) =>
  connected ? rpc('cup_control', { t: id, expected: version, action }) : localControl(id, version, action)
export const moveMatch = async (id: string, version: number, match: Match) =>
  connected ? rpc('cup_move', { t: id, expected: version, game: match.id, field: match.court, slot: match.slot, ref: match.referee }) : localMove(id, version, match)
export const gameAction = async (id: string, command: GameCommand, admin: boolean) => connected
  ? rpc('cup_game', { t: id, game: command.game, expected: command.version, request: command.request, action: command.action, sa: command.score?.a ?? null, sb: command.score?.b ?? null })
  : localGame(id, command, admin)
export const canReport = async (id: string, game: number) =>
  connected ? !!(await supabase?.auth.getSession())?.data.session && rpc<boolean>('cup_can_report', { t: id, game }) : localCanReport(id, game)
export const issueRef = async (id: string, game: number) =>
  connected ? rpc<Invitation>('cup_issue_ref', { t: id, game }) : localIssue(id, game)
export async function redeemRef(id: string, game: number, token: string, pin: string) {
  if (!supabase) return localRedeem(id, game, token, pin)
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }
  if (!await rpc<boolean>('cup_redeem_ref', { t: id, game, token, pin })) throw new Error('Zugang oder PIN ist ungültig, abgelaufen oder gesperrt.')
}
export const audit = async (id: string) => connected ? rpc<AuditEntry[]>('cup_audit', { t: id }) : localAudit(id)
