import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight, Clock3, LockKeyhole, Maximize, Monitor, Pause, Play, Radio, Timer, Trophy, Users } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { canReport, connected, errorText, redeemRef } from '../data/client.ts'
import type { Tournament } from '../data/types.ts'
import { countdown, formatDuration } from '../engine/game.ts'
import { clock, type Match } from '../engine/model.ts'
import { active, Badge, Brand, courtName, Empty, EventDate, gameOf, Heading, Notice, publicPath, stageName, Status, teamName, upcoming, useNow } from './common.tsx'
import { GamePanel } from './game-panel.tsx'
import { MatchTile, SchedulePage, SlotList, StandingsPage, TableGrid, tablePageCount } from './schedule.tsx'

export function PublicHeader({ tournament }: { tournament: Tournament }) {
  return <header className="public-header"><div><Brand/><Link to={publicPath(tournament.id, 'tv')} className="button secondary"><Monitor size={17}/>TV-Modus<ArrowUpRight size={15}/></Link></div></header>
}
export function LivePage({ tournament, offset }: { tournament: Tournament; offset: number }) {
  const [tab, setTab] = useState('live')
  const running = active(tournament)
  const now = useNow(offset, !!running.length)
  const next = upcoming(tournament, 2)
  return <>
    <section className="live-hero">
      <Badge tone="green"><Radio size={14}/>Live-Ansicht</Badge><h1>{tournament.config.name}</h1>
      <div className="hero-meta"><EventDate tournament={tournament}/><span><Trophy size={16}/>{stageName(tournament)}</span><span><Users size={16}/>{tournament.config.teams.length} Teams</span></div>
    </section>
    <div className="segmented public-tabs" aria-label="Live-Ansicht">
      {[['live', 'Aktuell', Radio], ['schedule', 'Spielplan', CalendarRange], ['table', 'Tabellen', Trophy]].map(([value, label, Icon]) =>
        <button key={String(value)} aria-pressed={tab === value} onClick={() => setTab(String(value))}><Icon size={17}/>{String(label)}</button>)}
    </div>
    {tab === 'live' && <>
      <div className="section-title"><h2>Aktuelle Spiele</h2><span className="muted">{running.length} laufend</span></div>
      {running.length ? <div className="tile-grid">{running.map(match => <MatchTile key={match.id} tournament={tournament} match={match} now={now}/>)}</div> :
        <section className="card"><Empty title="Aktuell läuft kein Spiel" description="Sobald ein Spiel startet, erscheinen der Spielstand und der Countdown hier."/></section>}
      <section className="card"><div className="card-heading"><div><h2>Nächste Begegnungen</h2><p>Die nächsten zwei Slots</p></div><Clock3 size={22}/></div><SlotList tournament={tournament} matches={next} manage={false}/></section>
      <section className="card"><div className="card-heading"><div><h2>Tabellen der {stageName(tournament)}</h2><p>Nur bestätigte Endergebnisse fließen in die Wertung ein.</p></div></div></section>
      <TableGrid tournament={tournament} phase={tournament.config.stages[tournament.released]?.id} compact/>
    </>}
    {tab === 'schedule' && <SchedulePage tournament={tournament}/>}
    {tab === 'table' && <StandingsPage tournament={tournament}/>}
  </>
}

export function ReportPage({ tournament, offset, offline, refresh }: { tournament: Tournament; offset: number; offline: boolean; refresh: () => unknown }) {
  const [params] = useSearchParams()
  const field = params.get('field')
  const slot = params.get('slot')
  const expected = params.get('game')
  const token = params.get('token') ?? ''
  const court = tournament.config.courts.find(item => item.id === field) ?? tournament.config.courts[Number(field) - 1]
  const match = tournament.plan.matches.find(match => match.court === court?.id && match.slot === Number(slot) && (!expected || match.id === Number(expected)))
  const [pin, setPin] = useState('')
  const [allowed, setAllowed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const matchId = match?.id
  const permissionKey = `turnierleitung.report.${tournament.id}.${matchId}`
  useEffect(() => {
    let current = true
    setAllowed(!!matchId && sessionStorage.getItem(permissionKey) === '1')
    if (matchId && !offline) canReport(tournament.id, matchId).then(result => {
      if (!current) return
      setAllowed(result)
      if (result) sessionStorage.setItem(permissionKey, '1')
      else sessionStorage.removeItem(permissionKey)
    }).catch(() => {})
    return () => { current = false }
  }, [tournament.id, matchId, offline, permissionKey])
  async function redeem(event: FormEvent) {
    event.preventDefault()
    if (!matchId) return
    setBusy(true); setMessage('')
    try {
      await redeemRef(tournament.id, matchId, token, pin)
      sessionStorage.setItem(permissionKey, '1')
      setAllowed(true)
      setPin('')
    } catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }
  return <>
    <Heading eyebrow="Schiedsgericht" title="Ergebnis melden" subtitle={tournament.config.name} actions={<Link className="button secondary" to={publicPath(tournament.id)}><ArrowLeft size={17}/>Live-Ansicht</Link>}/>
    {!match && <section className="card"><Empty title="Spiel nicht gefunden" description="Der Slot ist frei oder das Spiel wurde verschoben. Bitte verwende den aktuellen QR-Code."/></section>}
    {match && <>
      {!allowed && <section className="card"><div className="card-heading"><div><h2><LockKeyhole size={18}/> Schiedsrichterzugang</h2><p>{courtName(tournament, match.court)} · Slot {match.slot} · Spiel {match.id}</p></div></div>
        <div className="card-body">
          {token ? <form className="form-stack" onSubmit={redeem}>
            <p>Gib die achtstellige PIN ein, die du von der Turnierleitung erhalten hast.</p>
            {!connected && <Notice tone="info">Lokaler Modus. Dieser Zugang funktioniert im Browser mit den gespeicherten Turnierdaten.</Notice>}
            <label>Schiedsrichter-PIN<input type="password" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required value={pin} onChange={event => setPin(event.target.value)}/></label>
            {message && <Notice>{message}</Notice>}
            <button className="button primary fit" disabled={busy || offline}><LockKeyhole size={17}/>Zugang freischalten</button>
          </form> : <Notice tone="info">Scanne den vollständigen Schiedsrichter-QR-Code, um Schreibzugriff für dieses Spiel zu erhalten.</Notice>}
        </div>
      </section>}
      <GamePanel key={match.id} tournament={tournament} match={match} offline={offline} offset={offset} refresh={refresh} admin={false} access={allowed}/>
    </>}
  </>
}

const views = ['Aktuelle Spiele', 'Nächste Begegnungen', 'Live-Tabellen']
export function TVPage({ tournament, offset, offline }: { tournament: Tournament; offset: number; offline: boolean }) {
  const [view, setView] = useState(0)
  const [paused, setPaused] = useState(false)
  const [page, setPage] = useState(0)
  const [message, setMessage] = useState('')
  const now = useNow(offset)
  const running = active(tournament)
  const next = upcoming(tournament, 2)
  const stage = tournament.config.stages[tournament.released]
  const pageCount = view === 0 ? Math.ceil(tournament.config.courts.length / 2) : view === 1 ? Math.ceil(next.length / 4) : tablePageCount(stage)
  function switchView(direction: number) {
    setView(value => (value + direction + views.length) % views.length); setPage(0)
  }
  useEffect(() => {
    if (paused) return
    const timer = window.setTimeout(() => {
      if (page + 1 < pageCount) setPage(page + 1)
      else switchView(1)
    }, 15000)
    return () => clearTimeout(timer)
  }, [paused, view, page, pageCount])
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setMessage('Vollbild ist in diesem Browserfenster nicht verfügbar.') }
  }
  const index = Math.min(page, Math.max(0, pageCount - 1))
  const start = index * (view === 0 ? 2 : 4)
  return <main className="tv-shell"><div className="tv-screen">
    <header className="tv-header">
      <div><div className="hero-tag"><span/>{offline ? 'OFFLINE · DATEN MÖGLICHERWEISE NICHT AKTUELL' : 'TURNIER LIVE'}</div><h1>{tournament.config.name}</h1></div>
      <div className="tv-header-right"><span>{stageName(tournament)}</span><strong>{new Intl.DateTimeFormat('de-DE', { timeZone: tournament.config.timezone, timeStyle: 'short' }).format(now)}</strong></div>
    </header>
    <div className="tv-content">
      <div className="tv-title"><h2>{views[view]}</h2>{pageCount > 1 && <span>{index + 1} / {pageCount}</span>}</div>
      {view === 0 && <div className="tv-fields">
        {tournament.config.courts.slice(start, start + 2).map(court => {
          const match = running.find(item => item.court === court.id)
          return match ? <TVGame key={court.id} tournament={tournament} match={match} now={now}/> : <article key={court.id} className="tv-game idle"><span>{court.name}</span><strong>Kein laufendes Spiel</strong></article>
        })}
      </div>}
      {view === 1 && <div className="tv-next">
        {next.slice(start, start + 4).map(match => <article key={match.id}><strong>{clock(match.start)}</strong><div><small>{courtName(tournament, match.court)} · Slot {match.slot}</small><b>{teamName(tournament, match.a)} – {teamName(tournament, match.b)}</b><span>Pfeift {teamName(tournament, match.referee)}</span></div></article>)}
        {!next.length && <p>Keine weiteren Begegnungen geplant.</p>}
      </div>}
      {view === 2 && stage && <TableGrid tournament={tournament} phase={stage.id} compact page={index}/>}
    </div>
    <footer className="tv-controls">
      <Link to={publicPath(tournament.id)} aria-label="Zur Live-Ansicht" title="Zur Live-Ansicht"><ArrowLeft size={19}/></Link>
      <button onClick={() => switchView(-1)} aria-label="Vorherige Ansicht"><ChevronLeft size={20}/></button>
      {views.map((label, index) => <button key={label} aria-label={label} aria-pressed={view === index} onClick={() => { setView(index); setPage(0) }}><span className="tv-dot"/></button>)}
      <button onClick={() => switchView(1)} aria-label="Nächste Ansicht"><ChevronRight size={20}/></button>
      <button onClick={() => setPaused(!paused)} aria-label={paused ? 'Rotation fortsetzen' : 'Rotation pausieren'}>{paused ? <Play size={18}/> : <Pause size={18}/>}</button>
      <button onClick={() => void fullscreen()} aria-label="Vollbild umschalten"><Maximize size={18}/></button>
      {message && <span role="status">{message}</span>}
    </footer>
  </div></main>
}
function TVGame({ tournament, match, now }: { tournament: Tournament; match: Match; now: number }) {
  const game = gameOf(tournament, match.id)
  const timer = countdown(game, tournament.config.duration, now)
  return <article className="tv-game running"><header><span>{courtName(tournament, match.court)} · SPIEL {match.id}</span><Status game={game}/></header>
    <div><span>{teamName(tournament, match.a)}</span><strong>{game.live?.a ?? 0}</strong></div>
    <div><span>{teamName(tournament, match.b)}</span><strong>{game.live?.b ?? 0}</strong></div>
    <footer><span><Timer size={20}/>{formatDuration(timer.seconds)} · {timer.label}</span><span>Pfeift {teamName(tournament, match.referee)}</span></footer>
  </article>
}
