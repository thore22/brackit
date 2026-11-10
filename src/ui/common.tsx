import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, CalendarDays, CircleHelp, Radio, Volleyball, WifiOff } from 'lucide-react'
import { Link } from 'react-router'
import { connected, errorText, readCached, readTournament, watchTournament } from '../data/client.ts'
import { final, type Tournament } from '../data/types.ts'
import { emptyGame, statusLabel, type GameState } from '../engine/game.ts'
import { participantLabel, type Match } from '../engine/model.ts'

export const adminPath = (id: string) => `/admin/${id}`
export const publicPath = (id: string, page = 'live') => `/t/${id}/${page}`
export const dateLabel = (date: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))
export function teamName(tournament: Tournament, value: string | null) {
  return participantLabel(tournament.config, value ? tournament.seeds[value] ?? value : value)
}
export const courtName = (tournament: Tournament, id: string) => tournament.config.courts.find(court => court.id === id)?.name ?? id
export const groupName = (tournament: Tournament, match: Match) =>
  tournament.config.stages.flatMap(stage => stage.groups).find(group => group.id === match.group)?.name ?? 'Crossover'
export const gameOf = (tournament: Tournament, id: number) => tournament.games.find(game => game.id === id) ?? emptyGame(id)
export const stageName = (tournament: Tournament) => tournament.config.stages[tournament.released]?.name ?? 'Turniertag'
export const ordered = (matches: Match[]) => [...matches].sort((a, b) => a.slot - b.slot || a.id - b.id)
export function upcoming(tournament: Tournament, slots: number) {
  const next = ordered(tournament.plan.matches.filter(match => gameOf(tournament, match.id).status === 'scheduled'))
  const ids = [...new Set(next.map(match => match.slot))].slice(0, slots)
  return next.filter(match => ids.includes(match.slot))
}
export const active = (tournament: Tournament) => ordered(tournament.plan.matches.filter(match => gameOf(tournament, match.id).status === 'running'))
export const progress = (tournament: Tournament) => ({
  completed: tournament.games.filter(final).length, pending: tournament.games.filter(game => game.status === 'submitted').length,
  total: tournament.plan.matches.length,
})
export function useTournament(id: string, admin: boolean) {
  const [snapshot, setSnapshot] = useState<Tournament | null>(() => connected ? readCached(id) : null)
  const [failure, setFailure] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const [linked, setLinked] = useState(!connected)
  const [stale, setStale] = useState(false)
  const [offset, setOffset] = useState(0)
  const current = useRef<(() => Promise<void>) | undefined>(undefined)
  useEffect(() => {
    let disposed = false
    let sequence = 0
    let applied = 0
    setSnapshot(connected ? readCached(id) : null)
    setFailure('')
    setStale(false)
    async function refresh() {
      const ticket = ++sequence
      if (!navigator.onLine && connected) { if (!disposed) setStale(true); return }
      const start = Date.now()
      try {
        const updated = await readTournament(id, admin)
        if (disposed || ticket < applied) return
        applied = ticket
        setSnapshot(previous => previous?.id === id && previous.revision > updated.revision ? previous : updated)
        setOffset(Date.parse(updated.serverNow) - Math.round((start + Date.now()) / 2))
        setStale(false)
        setFailure('')
      } catch (error) {
        if (disposed || ticket < applied) return
        applied = ticket
        setFailure(errorText(error))
        setStale(connected && (!navigator.onLine || !error || typeof error !== 'object' || !('code' in error) || !error.code))
      }
    }
    current.current = refresh
    const network = () => { setOnline(navigator.onLine); void refresh() }
    const unsubscribe = watchTournament(id, () => { void refresh() }, value => { if (!disposed) setLinked(value) })
    window.addEventListener('online', network)
    window.addEventListener('offline', network)
    window.addEventListener('focus', network)
    const polling = connected ? window.setInterval(refresh, 15_000) : undefined
    void refresh()
    return () => {
      disposed = true
      unsubscribe()
      clearInterval(polling)
      window.removeEventListener('online', network)
      window.removeEventListener('offline', network)
      window.removeEventListener('focus', network)
    }
  }, [id, admin])
  return { tournament: snapshot?.id === id ? snapshot : null, failure, offline: !online || stale, linked, offset, refresh: () => current.current?.() }
}

export function useNow(offset = 0, enabled = true) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [enabled])
  return now + offset
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className="brand"><span className="brand-mark"><Volleyball size={22} strokeWidth={1.75}/></span>{!compact && <span>Turnier<span className="brand-accent">leitung</span><small>TURNIER MANAGEMENT</small></span>}</Link>
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}><i/>{children}</span>
}
export function Status({ game }: { game: GameState }) {
  return <Badge tone={game.status === 'running' || final(game) ? 'green' : game.status === 'submitted' ? 'amber' : 'neutral'}>{statusLabel[game.status]}</Badge>
}
export function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' | 'offline' | 'success' }) {
  const Icon = tone === 'offline' ? WifiOff : tone === 'info' ? CircleHelp : AlertCircle
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`notice ${tone}`}><Icon size={18}/><div>{children}</div></div>
}
export function Empty({ title, description }: { title: string; description?: string }) {
  return <div className="empty"><span className="empty-icon"><Volleyball size={24}/></span><strong>{title}</strong>{description && <p>{description}</p>}</div>
}
export function Heading({ eyebrow, title, subtitle, actions }: { eyebrow: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{subtitle && <p className="subheading">{subtitle}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>
}
export function EventDate({ tournament }: { tournament: Tournament }) {
  return <span className="event-date"><CalendarDays size={17}/>{dateLabel(tournament.config.date)}</span>
}
export function LiveLink({ id, icon = true }: { id: string; icon?: boolean }) {
  return <Link to={publicPath(id)} className="button secondary">{icon && <Radio size={17}/>}Live-Ansicht<ArrowUpRight size={15}/></Link>
}
export function download(name: string, contents: string, type: string) {
  const href = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}
export const csvCell = (value: unknown) => {
  const raw = String(value ?? '')
  const safe = /^[\s]*[=+\-@]/.test(raw) ? "'" + raw : raw
  return '"' + safe.replaceAll('"', '""') + '"'
}
