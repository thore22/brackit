import { emptyGame } from '../engine/game.ts'
import { generate } from '../engine/generate.ts'
import { tournamentTables } from '../engine/standings.ts'
import { volleyball } from '../engine/template.ts'
import type { Match, Plan, TournamentConfig } from '../engine/model.ts'
import { validateSchedule } from '../engine/validate.ts'
import type { TournamentColors } from './types.ts'
import { final, type AuditEntry, type ControlAction, type CourtActivation, type CourtStation, type GameCommand, type Invitation, type Tournament, type TournamentSummary } from './types.ts'

const prefix = 'turnierleitung.local.'
export const demoId = 'volleyball-cup'
const key = (id: string) => prefix + id
type RecordData = { tournament: Tournament; audit: AuditEntry[]; requests: Record<string, string>; invitations: Record<number, Invitation>; access: Record<number, string> }
type LocalCourtStation = CourtStation & { pin: string; generation: string; failures: number; blockedUntil: number }
const stationsKey = 'turnierleitung.court-stations'
const courtStations = (): LocalCourtStation[] => JSON.parse(localStorage.getItem(stationsKey) ?? '[]')
const courtGrantKey = (id: string, game: number, station: string) => `${key(id)}.court.${game}.${station}`
function newPin(previous?: string) {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000
  const pin = String(value).padStart(8, '0')
  return pin === previous ? String((value + 1) % 100_000_000).padStart(8, '0') : pin
}
const newExpiry = () => new Date(Date.now() + 43_200_000).toISOString()
function build(id: string, config: TournamentConfig, plan: Plan, state: Tournament['state'] = 'draft'): RecordData {
  return {
    tournament: { id, config, plan, state, revision: 1, configurationVersion: 1, released: 0, admin: true,
      games: plan.matches.map(match => emptyGame(match.id)), seeds: {}, serverNow: new Date().toISOString() },
    audit: [], requests: {}, invitations: {}, access: {},
  }
}
function write(record: RecordData) {
  const id = record.tournament.id
  localStorage.setItem(key(id), JSON.stringify(record))
  window.dispatchEvent(new CustomEvent('turnierleitung.local', { detail: id }))
}
function read(id: string): RecordData {
  const value = localStorage.getItem(key(id))
  if (!value) throw new Error('Dieses lokale Turnier ist in diesem Browser nicht verfügbar.')
  return JSON.parse(value)
}
function locked<T>(id: string, task: () => T) {
  return navigator.locks ? navigator.locks.request(key(id), task) : Promise.resolve().then(task)
}
function change(id: string, task: (record: RecordData) => void) {
  return locked(id, () => {
    const record = read(id)
    task(record)
    record.tournament.revision++
    write(record)
  })
}
function checkVersion(tournament: Tournament, version: number) {
  if (tournament.revision !== version) throw new Error('Versionskonflikt. Prüfe den aktuellen Turnierstand.')
}
function append(record: RecordData, action: string, game: number | null = null, payload = {}) {
  record.audit.unshift({ action, match_id: game, payload, created_at: new Date().toISOString() })
}
export function initializeDemo() {
  if (!localStorage.getItem(key(demoId))) {
    const config = volleyball()
    write(build(demoId, config, generate(config), 'published'))
  }
}
export function localRead(id: string, admin: boolean): Tournament {
  const { tournament } = read(id)
  if (!admin && tournament.state === 'draft') throw new Error('Dieses Turnier wurde noch nicht veröffentlicht.')
  return { ...tournament, admin, serverNow: new Date().toISOString() }
}
export function localList(): TournamentSummary[] {
  return Object.keys(localStorage).filter(item => item.startsWith(prefix)).map(item => {
    const { tournament: { id, config, state } } = read(item.slice(prefix.length))
    return { id, name: config.name, date: config.date, state }
  }).sort((a, b) => b.date.localeCompare(a.date))
}
export function localSave(id: string | null, expected: number | null, config: TournamentConfig, plan: Plan) {
  const target = id ?? crypto.randomUUID()
  return locked(target, () => {
    const record = build(target, config, plan)
    if (id) {
      const previous = read(id)
      checkVersion(previous.tournament, expected!)
      if (previous.tournament.state !== 'draft') throw new Error('Die Konfiguration ist nach Veröffentlichung gesperrt.')
      record.tournament.configurationVersion = previous.tournament.configurationVersion + 1
      record.tournament.revision = previous.tournament.revision + 1
      record.tournament.colors = previous.tournament.colors
      record.audit = previous.audit
    }
    append(record, 'plan')
    write(record)
    return target
  })
}
export function localSaveColors(id: string, version: number, colors: TournamentColors) {
  return change(id, record => {
    checkVersion(record.tournament, version)
    record.tournament.colors = colors
    append(record, 'colors', null, colors)
  })
}
export function localControl(id: string, version: number, action: ControlAction) {
  return change(id, record => {
    const tournament = record.tournament
    checkVersion(tournament, version)
    if (action === 'publish' && tournament.state === 'draft') tournament.state = 'published'
    else if (action === 'release' && tournament.state === 'published') {
      if (tournament.released + 1 >= tournament.config.stages.length) throw new Error('Es gibt keine weitere Phase.')
      const prior = new Set(tournament.config.stages.slice(0, tournament.released + 1).map(stage => stage.id))
      if (tournament.games.some(game => !final(game) && prior.has(tournament.plan.matches.find(match => match.id === game.id)!.stage))) {
        throw new Error('Bestätige zuerst alle Ergebnisse der freigegebenen Phasen.')
      }
      tournament.released++
    } else if (action === 'archive' && tournament.state === 'published' && tournament.games.every(final)) tournament.state = 'archived'
    else throw new Error('Diese Aktion ist im aktuellen Turnierstatus nicht verfügbar.')
    append(record, action)
  })
}
export function localMove(id: string, version: number, match: Match) {
  return change(id, record => {
    const tournament = record.tournament
    checkVersion(tournament, version)
    const current = tournament.games.find(game => game.id === match.id)
    if (tournament.state === 'archived' || !current || current.status !== 'scheduled') throw new Error('Dieses Spiel ist gesperrt.')
    if (tournament.plan.matches.some(other => other.slot === match.slot && tournament.games.find(game => game.id === other.id)?.version)) throw new Error('Der Zielslot wurde bereits begonnen.')
    const original = tournament.plan.matches.find(other => other.id === match.id)!
    const stage = tournament.config.stages.find(stage => stage.id === original.stage)!
    if (stage.rounds && tournament.plan.matches.some(other => other.id !== match.id && other.slot === match.slot && other.round !== original.round)) throw new Error('Der Zielslot gehört einer anderen logischen Runde.')
    const plan = { ...tournament.plan, matches: tournament.plan.matches.map(other => other.id === match.id ? match : other) }
    const errors = validateSchedule(tournament.config, plan)
    if (errors.length) throw new Error(errors.join(' '))
    tournament.plan = plan
    delete record.access[match.id]
    delete record.invitations[match.id]
    append(record, 'move', match.id, { slot: match.slot, court: match.court, referee: match.referee })
  })
}
export function localCanReport(id: string, game: number) {
  const { access, tournament } = read(id)
  const expires = access[game]
  if (expires && Date.parse(expires) > Date.now() && sessionStorage.getItem(`${key(id)}.access.${game}`)) return true
  const match = tournament.plan.matches.find(match => match.id === game)
  return tournament.state === 'published' && !!match && courtStations().some(station =>
    station.assignment?.tournamentId === id && station.assignment.field === match.court &&
    !!station.expires && Date.parse(station.expires) > Date.now() &&
    sessionStorage.getItem(courtGrantKey(id, game, station.id)) === station.generation)
}
export function localRedeem(id: string, game: number, token: string, pin: string) {
  return change(id, record => {
    const invite = record.invitations[game]
    if (!invite || invite.token !== token || invite.pin !== pin || Date.parse(invite.expires) <= Date.now()) throw new Error('Der Zugang oder die PIN ist ungültig.')
    record.access[game] = invite.expires
    sessionStorage.setItem(`${key(id)}.access.${game}`, '1')
    append(record, 'referee_redeem', game)
  })
}
export async function localIssue(id: string, game: number): Promise<Invitation> {
  const invitation = {
    token: Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join(''),
    pin: newPin(),
    expires: newExpiry(),
  }
  await change(id, record => {
    const { tournament } = record
    if (tournament.state !== 'published' || !tournament.games.some(state => state.id === game && ['scheduled', 'running'].includes(state.status))) throw new Error('Wähle ein geplantes oder laufendes Spiel.')
    delete record.access[game]
    record.invitations[game] = invitation
    append(record, 'referee_invite', game)
  })
  return invitation
}
export function localListCourtStations(): CourtStation[] {
  return courtStations().map(({ id, name, assignment, tournamentName, expires }) => ({ id, name, assignment, tournamentName, expires }))
}
export function localResolveCourt(id: string) {
  const station = courtStations().find(station => station.id === id)
  const assignment = station?.assignment
  return assignment && station.expires && read(assignment.tournamentId).tournament.state === 'published'
    ? { ...assignment, expires: station.expires } : null
}
export function localActivateCourt(id: string, field: string, observed?: CourtStation): Promise<CourtActivation> {
  return locked(stationsKey, () => {
    const { tournament } = read(id)
    const court = tournament.config.courts.find(court => court.id === field)
    if (tournament.state !== 'published' || !court) throw new Error('Veröffentliche das Turnier, bevor du einen Feld-QR zuordnest.')
    const stations = courtStations()
    const existing = stations.find(station => station.id === observed?.id)
    if (observed && existing?.expires !== observed.expires) throw new Error('Dieser Feld-QR wurde inzwischen geändert. Prüfe die aktuelle Zuordnung.')
    if (stations.some(station => station.id !== observed?.id && station.assignment?.tournamentId === id && station.assignment.field === field)) {
      throw new Error('Diesem Feld ist bereits ein Feld-QR zugeordnet.')
    }
    const station = {
      id: existing?.id ?? crypto.randomUUID(), name: existing?.name ?? court.name,
      assignment: { tournamentId: id, field }, tournamentName: tournament.config.name,
      pin: newPin(existing?.pin), expires: newExpiry(), generation: crypto.randomUUID(), failures: 0, blockedUntil: 0,
    }
    localStorage.setItem(stationsKey, JSON.stringify([...stations.filter(item => item.id !== station.id), station]))
    return { id: station.id, pin: station.pin, expires: station.expires }
  })
}
export function localRedeemCourt(stationId: string, id: string, game: number, pin: string) {
  return locked(stationsKey, () => {
    const { tournament } = read(id)
    const match = tournament.plan.matches.find(match => match.id === game)
    const stations = courtStations()
    const station = stations.find(station => station.id === stationId)
    const now = Date.now()
    if (!station || station.assignment?.tournamentId !== id || station.assignment.field !== match?.court ||
      tournament.state !== 'published' || !tournament.games.some(state => state.id === game && state.status === 'running') ||
      !station.expires || Date.parse(station.expires) <= now || station.blockedUntil > now || !/^[0-9]{8}$/.test(pin)) return false
    if (station.pin !== pin) {
      if (++station.failures === 8) {
        station.failures = 0
        station.blockedUntil = now + 300_000
      }
      localStorage.setItem(stationsKey, JSON.stringify(stations))
      return false
    }
    station.failures = 0
    station.blockedUntil = 0
    localStorage.setItem(stationsKey, JSON.stringify(stations))
    sessionStorage.setItem(courtGrantKey(id, game, stationId), station.generation)
    return true
  })
}
export const localAudit = (id: string) => read(id).audit.slice(0, 100)
export function watchLocal(id: string, refresh: () => void) {
  const local = (event: Event) => { if ((event as CustomEvent).detail === id) refresh() }
  const other = (event: StorageEvent) => { if (event.key === key(id)) refresh() }
  window.addEventListener('turnierleitung.local', local)
  window.addEventListener('storage', other)
  return () => {
    window.removeEventListener('turnierleitung.local', local)
    window.removeEventListener('storage', other)
  }
}
export function localGame(id: string, command: GameCommand, admin: boolean) {
  return change(id, record => {
    const { tournament } = record
    const { game: number, version, action, score, request } = command
    if (!admin && (!['live', 'submit'].includes(action) || !localCanReport(id, number))) throw new Error('Kein gültiger Schreibzugang für dieses Spiel.')
    if (tournament.state !== 'published') throw new Error('Das Turnier ist für Eingaben geschlossen.')
    const game = tournament.games.find(game => game.id === number)
    const match = tournament.plan.matches.find(match => match.id === number)
    if (!game || !match) throw new Error('Spiel nicht gefunden.')
    const fingerprint = JSON.stringify(command)
    if (record.requests[request] === fingerprint) return
    if (record.requests[request]) throw new Error('Die Anfragekennung wurde bereits verwendet.')
    if (game.version !== version) throw new Error('Versionskonflikt. Prüfe den aktuellen Spielstand.')
    const stageIndex = tournament.config.stages.findIndex(stage => stage.id === match.stage)
    if (stageIndex > tournament.released) throw new Error('Diese Phase wurde noch nicht freigegeben.')
    const { rules } = tournament.config
    if (['live', 'submit', 'correct'].includes(action) && (!score || Object.values(score).some(value => !Number.isInteger(value) || value < 0 || value > 999))) throw new Error('Gib je Team eine ganze Punktzahl zwischen 0 und 999 ein.')
    if (score && ['submit', 'correct'].includes(action) && !rules.allowDraw && score.a === score.b) throw new Error('Bei Gleichstand entscheidet der nächste Punkt.')
    const now = new Date().toISOString()
    const resolve = (seed: string | null) => seed ? tournament.seeds[seed] ?? seed : null
    const people = (match: Match) => [match.a, match.b, match.referee].map(resolve).filter(Boolean)
    const before = game.live
    if (action === 'start' && game.status === 'scheduled') {
      const participants = people(match)
      if (participants.some(id => id?.startsWith('@')) || new Set(participants).size !== participants.length) throw new Error('Die Teilnehmerzuordnung ist noch nicht vollständig oder enthält einen Konflikt.')
      const running = tournament.plan.matches.filter(other => tournament.games.some(state => state.id === other.id && state.status === 'running'))
      if (running.some(other => other.court === match.court || people(other).some(member => participants.includes(member)))) throw new Error('Feld oder Team ist in einem laufenden Spiel belegt.')
      Object.assign(game, { status: 'running', started: now, live: { a: 0, b: 0 } })
    } else if (action === 'pause' && game.status === 'running' && !game.paused && !game.regularEnded) game.paused = now
    else if (action === 'resume' && game.status === 'running' && game.paused && !game.regularEnded) {
      game.pausedMs += Math.max(0, Date.parse(now) - Date.parse(game.paused))
      game.paused = null
    } else if (action === 'regular' && game.status === 'running' && !game.regularEnded) {
      game.regularEnded = now
      game.paused = null
      game.extra = !rules.allowDraw && game.live?.a === game.live?.b
    } else if ((action === 'live' || action === 'submit') && game.status === 'running' && score) {
      if (game.extra && game.live) {
        const da = score.a - game.live.a
        const db = score.b - game.live.b
        if ((da || db) && (game.live.a !== game.live.b || da < 0 || db < 0 || da + db !== 1)) throw new Error('Beim Zusatzpunkt darf genau ein Team einen Punkt erzielen.')
      }
      game.live = score
      if (action === 'submit') {
        game.status = rules.autoConfirm ? 'confirmed' : 'submitted'
        game.ended = now
        game.paused = null
        if (rules.autoConfirm) game.official = score
      }
    } else if (action === 'confirm' && game.status === 'submitted') {
      game.status = 'confirmed'
      game.official = game.live
    } else if (action === 'reject' && game.status === 'submitted') {
      if (tournament.games.some(state => state.status === 'running')) throw new Error('Beende die laufenden Spiele, bevor ein Ergebnis zur Neueingabe geöffnet wird.')
      game.status = 'running'
      game.ended = null
    } else if (action === 'correct' && ['submitted', 'confirmed', 'corrected'].includes(game.status) && score) {
      if (tournament.plan.matches.some(other => tournament.config.stages.findIndex(stage => stage.id === other.stage) > stageIndex &&
        tournament.games.some(state => state.id === other.id && state.started))) throw new Error('Ein Ergebnis einer früheren Phase ist nach Beginn einer Folgephase gesperrt.')
      Object.assign(game, { status: 'corrected', live: score, official: score })
    } else throw new Error('Diese Aktion ist im aktuellen Spielstatus nicht verfügbar.')
    game.version++
    record.requests[request] = fingerprint
    tournament.seeds = Object.fromEntries(tournamentTables(tournament.config, tournament.plan, new Map(tournament.games.flatMap(state => state.official ? [[state.id, state.official]] : []))).seeds)
    append(record, action, number, { before, after: game.live })
  })
}
