import { useEffect, useState, type ReactNode } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, CalendarRange, ChevronRight, ClipboardCheck, Clock3, Copy, Flag, LayoutGrid, Monitor, QrCode, Radio, Settings2, Trophy, Users, Volleyball } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { audit, control, errorText } from '../data/client.ts'
import type { AuditEntry, ControlAction, Tournament } from '../data/types.ts'
import { active, adminPath, Badge, csvCell, download, Empty, EventDate, gameOf, Heading, LiveLink, Notice, ordered, progress, publicPath, stageName, upcoming, useNow } from './common.tsx'
import { delayMinutes, MatchTile, ScheduleTable } from './schedule.tsx'

export function Dashboard({ tournament, offline, offset, refresh }: { tournament: Tournament; offline: boolean; offset: number; refresh: () => unknown }) {
  const base = adminPath(tournament.id)
  const { completed, pending, total } = progress(tournament)
  const running = active(tournament)
  const now = useNow(offset, !!running.length)
  const next = upcoming(tournament, 3)
  const slot = running[0]?.slot ?? next[0]?.slot
  const countSlots = new Set(tournament.plan.matches.map(match => match.slot)).size
  const percentage = total ? Math.round(completed / total * 100) : 0
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const phase = stageName(tournament)
  const nextStage = tournament.config.stages[tournament.released + 1]
  const stageMatches = tournament.plan.matches.filter(match => match.stage === tournament.config.stages[tournament.released]?.id)
  const finishedStage = stageMatches.length > 0 && stageMatches.every(match => ['confirmed','corrected'].includes(gameOf(tournament, match.id).status))
  const groupCount = tournament.config.stages[tournament.released]?.groups.length ?? 0
  const delays = running.filter(match => delayMinutes(tournament, match, now) > 0)
  async function act(action: ControlAction) {
    setBusy(true); setMessage('')
    try { await control(tournament.id, tournament.revision, action); await refresh() }
    catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }
  return <>
    <Heading eyebrow="Turnierübersicht" title={tournament.config.name} subtitle="Plane Begegnungen, verwalte Ergebnisse und behalte deinen Turniertag im Blick."
      actions={<><LiveLink id={tournament.id}/><Link className="button primary" to={`${base}/spielplan`}><CalendarRange size={18}/>Spielplan öffnen</Link></>}/>
    <section className="event-hero" aria-label="Turnierfortschritt">
      <div className="hero-detail">
        <span className="hero-tag"><span/> {tournament.state === 'published' ? 'VERÖFFENTLICHT' : tournament.state === 'archived' ? 'ARCHIVIERT' : 'ENTWURF'}</span>
        <div><p className="hero-eyebrow">AKTUELLE PHASE</p><h2>{phase}</h2></div>
        <div className="hero-meta"><EventDate tournament={tournament}/><span><Clock3 size={16}/>{tournament.config.start} – {tournament.config.end} Uhr</span><span><LayoutGrid size={16}/>{groupCount} Gruppen</span></div>
      </div>
      <div className="hero-progress">
        <div className="hero-progress-top"><span>TURNIERFORTSCHRITT</span><Activity size={18}/></div>
        <div><strong>{percentage}%</strong><span>{completed} von {total} Spielen</span></div>
        <progress aria-label="Turnierfortschritt" max={100} value={percentage}/>
        <div className="hero-progress-foot"><span>Bestätigte Ergebnisse</span><span>{slot ? `Slot ${slot} / ${countSlots}` : `${countSlots} Slots`}</span></div>
      </div>
    </section>
    {message && <Notice>{message}</Notice>}
    {tournament.state === 'draft' && <Notice tone="info">Der Entwurf ist für Zuschauer noch geschlossen.
      <div className="button-row"><button className="button primary" disabled={busy || offline} onClick={() => void act('publish')}><Radio size={17}/>Turnier veröffentlichen</button><Link className="button secondary" to={`${base}/konfigurieren`}>Konfiguration bearbeiten</Link></div>
    </Notice>}
    {tournament.state === 'published' && nextStage && finishedStage && <Notice tone="success">Die Ergebnisse von {phase} sind vollständig bestätigt. Die Rangplätze für {nextStage.name} wurden ermittelt.
      <div className="button-row"><button className="button primary" disabled={busy || offline} onClick={() => void act('release')}><Flag size={17}/>{nextStage.name} freigeben</button></div>
    </Notice>}
    <div className="metrics">
      <Metric icon={<Users size={20}/>} label="Teams" value={tournament.config.teams.length} caption="Gemeldete Teams" tone="mint"/>
      <Metric icon={<LayoutGrid size={20}/>} label="Spielfelder" value={tournament.config.courts.length} caption={tournament.config.courts.map(court => court.name).join(' · ')} tone="blue"/>
      <Metric icon={<Volleyball size={20}/>} label="Bestätigte Spiele" value={`${completed} / ${total}`} caption={`${countSlots} Slots im Spielplan`} tone="violet"/>
      <Metric icon={<ClipboardCheck size={20}/>} label="Freigaben offen" value={pending} caption={pending ? 'Ergebnisse zur Prüfung' : 'Keine offenen Ergebnisse'} tone="amber" link={`${base}/ergebnisse`}/>
    </div>
    {!!delays.length && <Notice tone="info">{delays.length} laufende {delays.length === 1 ? 'Begegnung liegt' : 'Begegnungen liegen'} hinter dem Plan. Die jeweilige Verzögerung steht in der Spielverwaltung.</Notice>}
    {!!running.length && <section className="card live-dash"><div className="card-heading"><div><h2>Laufende Spiele</h2><p>Spielstand und synchronisierte Zeit</p></div><Badge tone="green">Live</Badge></div>
      <div className="tile-grid card-body">{running.map(match => <MatchTile key={match.id} match={match} tournament={tournament} now={now} manage/>)}</div>
    </section>}
    <div className="dashboard-grid">
      <section className="card">
        <div className="card-heading"><div className="card-heading-title"><span className="section-icon"><CalendarRange size={21}/></span><div><h2>Nächste Begegnungen</h2><p>Die nächsten drei geplanten Spielslots</p></div></div>
          <Link to={`${base}/spielplan`} className="text-link">Alle Spiele <ArrowRight size={17}/></Link></div>
        <ScheduleTable tournament={tournament} matches={next} manage/>
      </section>
      <section className="card quick-card">
        <div className="card-heading"><div className="card-heading-title"><span className="section-icon"><Activity size={21}/></span><div><h2>Schnellzugriff</h2><p>Alles für den Spielbetrieb</p></div></div></div>
        <div className="quick-links">
          <QuickLink icon={<ClipboardCheck size={20}/>} to={`${base}/ergebnisse`} title="Ergebnisse" subtitle="Einreichen und bestätigen" tone="mint"/>
          <QuickLink icon={<QrCode size={20}/>} to={`${base}/qr`} title="QR-Codes" subtitle="Zugänge und Hallenaushänge" tone="blue"/>
          <QuickLink icon={<Monitor size={20}/>} to={publicPath(tournament.id, 'tv')} title="Hallenbildschirm" subtitle="Live-Stand im Großformat" tone="violet"/>
          <QuickLink icon={<Trophy size={20}/>} to={`${base}/tabellen`} title="Tabellen" subtitle="Platzierungen und Wertung" tone="amber"/>
        </div>
      </section>
    </div>
  </>
}
function Metric({ icon, label, value, caption, tone, link }: { icon: ReactNode; label: string; value: string | number; caption: string; tone: string; link?: string }) {
  const content = <><span className={`metric-icon ${tone}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{caption}</small></div>{link && <ArrowUpRight className="metric-arrow" size={15}/>}</>
  return link ? <Link className="metric card" to={link}>{content}</Link> : <article className="metric card">{content}</article>
}
function QuickLink({ icon, title, subtitle, to, tone }: { icon: ReactNode; title: string; subtitle: string; to: string; tone: string }) {
  return <Link className="quick-link" to={to}><span className={`metric-icon ${tone}`}>{icon}</span><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={18}/></Link>
}

export function ResultsPage({ tournament }: { tournament: Tournament }) {
  const [filter, setFilter] = useState('submitted')
  const { pending } = progress(tournament)
  const games = ordered(tournament.plan.matches).filter(match => filter === 'all' || gameOf(tournament, match.id).status === filter ||
    (filter === 'confirmed' && gameOf(tournament, match.id).status === 'corrected'))
  return <>
    <Heading eyebrow="Turnierbetrieb" title="Ergebnisse" subtitle="Erfasse Spielstände und prüfe eingereichte Resultate."/>
    <div className="segmented">
      {[['submitted', `Freigabe offen (${pending})`], ['running','Laufend'], ['confirmed','Bestätigt'], ['all','Alle Spiele']].map(([value, label]) =>
        <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    <section className="card">
      {games.length ? <ScheduleTable tournament={tournament} matches={games} manage/> : <Empty title="Hier ist alles erledigt" description="Neue Einreichungen erscheinen automatisch."/>}
    </section>
  </>
}

export function SettingsPage({ tournament, offline, refresh }: { tournament: Tournament; offline: boolean; refresh: () => unknown }) {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { total, completed } = progress(tournament)
  const { config } = tournament
  useEffect(() => {
    let current = true
    audit(tournament.id).then(result => { if (current) setEntries(result) }, error => { if (current) setMessage(errorText(error)) })
    return () => { current = false }
  }, [tournament.id, tournament.revision])
  async function archive() {
    setBusy(true); setMessage('')
    try { await control(tournament.id, tournament.revision, 'archive'); await refresh() }
    catch (error) { setMessage(errorText(error)) }
    finally { setBusy(false) }
  }
  return <>
    <Heading eyebrow="Verwaltung" title="Turniereinstellungen" subtitle={`Konfiguration Version ${tournament.configurationVersion}`}/>
    <section className="card"><div className="card-heading"><div><h2>Konfiguration</h2><p>{config.name} · {config.sport && `${config.sport} · `}{config.teams.length} Teams · {config.stages.length} Phasen</p></div></div>
      <div className="card-body settings-body">
        <div className="definition-grid">
          <div><small>Turniertag</small><strong><EventDate tournament={tournament}/></strong></div>
          <div><small>Zeitfenster</small><strong>{config.start}–{config.end} Uhr</strong></div>
          <div><small>Spiel / Wechsel</small><strong>{config.duration} / {config.change} Min.</strong></div>
          <div><small>Spiele pro Team</small><strong>{config.target ?? 'Aus Spielplan'}</strong></div>
        </div>
        <div className="button-row">
          {tournament.state === 'draft' && <Link className="button primary" to={`${adminPath(tournament.id)}/konfigurieren`}><Settings2 size={17}/>Konfiguration bearbeiten</Link>}
          <button className="button secondary" onClick={() => navigate('/neu', { state: { config: { ...config, name: `${config.name} – Kopie` } } })}><Copy size={17}/>Duplizieren</button>
          <button className="button secondary" onClick={() => download('turnier.json', JSON.stringify({ config, plan: tournament.plan, games: tournament.games }, null, 2), 'application/json')}><ArrowDownToLine size={17}/>JSON exportieren</button>
          <button className="button secondary" onClick={() => download('teams.csv', '\uFEFFName\r\n' + config.teams.map(team => csvCell(team.name)).join('\r\n'), 'text/csv;charset=utf-8')}><Users size={17}/>Teamliste exportieren</button>
          {tournament.state === 'published' && total === completed && <button className="button secondary" disabled={offline || busy} onClick={() => void archive()}>Turnier archivieren</button>}
        </div>
        {tournament.state === 'published' && total !== completed && <p className="hint">Archivierung ist nach Bestätigung aller Spiele möglich. Zeit- und Regelkonfiguration bleiben ab Veröffentlichung versioniert. Unbegonnene Begegnungen lassen sich im Spielplan verschieben.</p>}
      </div>
    </section>
    {message && <Notice>{message}</Notice>}
    <section className="card"><div className="card-heading"><div><h2>Änderungsprotokoll</h2><p>Letzte 100 Aktionen</p></div></div>
      {entries?.length ? <div className="table-scroll"><table><thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Spiel</th><th>Details</th></tr></thead>
        <tbody>{entries.map((item, index) => <tr key={index}><td>{new Date(item.created_at).toLocaleString('de-DE', { timeZone: config.timezone })}</td><td>{auditNames[item.action] ?? item.action}</td><td>{item.match_id ?? '—'}</td><td>{Object.keys(item.payload).length ? <details><summary>Ansehen</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details> : '—'}</td></tr>)}</tbody>
      </table></div> : <Empty title={entries ? 'Noch keine Aktionen' : 'Protokoll wird geladen'}/>}
    </section>
  </>
}
const auditNames: Record<string, string> = {
  plan: 'Spielplan gespeichert', publish: 'Turnier veröffentlicht', release: 'Phase freigegeben', archive: 'Archiviert',
  start: 'Spiel gestartet', pause: 'Pausiert', resume: 'Fortgesetzt', regular: 'Reguläre Spielzeit beendet',
  live: 'Live-Stand geändert', submit: 'Ergebnis eingereicht', confirm: 'Bestätigt', reject: 'Zurückgewiesen',
  correct: 'Korrigiert', referee_invite: 'QR-Zugang erstellt', referee_redeem: 'Schiedsrichterzugang aktiviert',
  court_activate: 'Feld-QR aktiviert', court_redeem: 'Feld-Zugang freigeschaltet', move: 'Spielplan geändert',
}
