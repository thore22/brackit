import { useId, useState } from 'react'
import { ArrowRight, Download, Pencil, Printer, Timer, Trophy, Users } from 'lucide-react'
import { Link } from 'react-router'
import { clock, type Match, type Stage } from '../engine/model.ts'
import { countdown, formatDuration, scheduledEpoch } from '../engine/game.ts'
import { tournamentTables, type Row } from '../engine/standings.ts'
import type { Tournament } from '../data/types.ts'
import { adminPath, courtName, csvCell, download, Empty, gameOf, groupName, Heading, Notice, ordered, Status, teamName } from './common.tsx'

export function ScheduleTable({ tournament, matches, manage = false }: { tournament: Tournament; matches: Match[]; manage?: boolean }) {
  return matches.length ? <div className="table-scroll"><table className="schedule-table"><thead><tr>
    <th scope="col">Spiel</th><th scope="col">Beginn</th><th scope="col">Begegnung</th><th scope="col">Feld</th><th scope="col">Pfeif-Team</th><th scope="col">Status</th>{manage && <th scope="col"><span className="sr-only">Bearbeiten</span></th>}
  </tr></thead><tbody>
    {matches.map(match => {
      const game = gameOf(tournament, match.id)
      const score = game.official ?? game.live
      return <tr key={match.id}>
        <td className="muted mono">#{String(match.id).padStart(2, '0')}<small>Slot {match.slot}</small></td>
        <td className="mono time-cell">{clock(match.start)}<small>bis {clock(match.end)}</small></td>
        <td><span className="pair-names">{teamName(tournament, match.a)} <span>vs.</span> {teamName(tournament, match.b)}</span><small>{tournament.config.stages.find(stage => stage.id === match.stage)?.name} · {groupName(tournament, match)} · Runde {match.round}</small></td>
        <td><span className="field-tag">{courtName(tournament, match.court)}</span></td>
        <td>{teamName(tournament, match.referee)}</td>
        <td><Status game={game}/>{score && <small>{score.a}:{score.b}</small>}</td>
        {manage && <td><Link className="icon-button minimal" to={`${adminPath(tournament.id)}/spiel/${match.id}`} aria-label={`Spiel ${match.id} verwalten`}><Pencil size={15}/></Link></td>}
      </tr>
    })}
  </tbody></table></div> : <Empty title="Keine Begegnungen gefunden" description="Wähle einen anderen Filter."/>
}

export function SchedulePage({ tournament, manage = false, teamFilter }: {
  tournament: Tournament; manage?: boolean; teamFilter?: { value: string; change: (team: string) => void }
}) {
  const filtersId = useId()
  const [phase, setPhase] = useState('')
  const [field, setField] = useState('')
  const [localTeam, setLocalTeam] = useState('')
  const team = teamFilter?.value ?? localTeam
  const setTeam = teamFilter?.change ?? setLocalTeam
  const matches = ordered(tournament.plan.matches).filter(match => (!phase || match.stage === phase) && (!field || match.court === field) &&
    (!team || [match.a, match.b, match.referee].some(seed => seed && (tournament.seeds[seed] ?? seed) === team)))
  function csv() {
    const header = ['Spiel', 'Phase', 'Runde', 'Slot', 'Beginn', 'Ende', 'Feld', 'Team 1', 'Team 2', 'Pfeif-Team', 'Status', 'Punkte 1', 'Punkte 2']
    const rows = matches.map(match => {
      const state = gameOf(tournament, match.id)
      return [match.id, tournament.config.stages.find(stage => stage.id === match.stage)?.name, match.round, match.slot,
        clock(match.start), clock(match.end), courtName(tournament, match.court), teamName(tournament, match.a), teamName(tournament, match.b), teamName(tournament, match.referee),
        { scheduled: 'Geplant', running: 'Läuft', submitted: 'Freigabe ausstehend', confirmed: 'Bestätigt', corrected: 'Korrigiert' }[state.status], state.official?.a, state.official?.b]
    })
    download('spielplan.csv', '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n'), 'text/csv;charset=utf-8')
  }
  return <>
    {manage && <Heading eyebrow="Turnierbetrieb" title="Spielplan" subtitle="Alle Begegnungen, Spielfelder und Schiedsrichtereinsätze."
      actions={<><button className="button secondary" onClick={() => window.print()}><Printer size={17}/>Drucken</button><button className="button primary" onClick={csv}><Download size={17}/>CSV exportieren</button></>}/>}
    <section className="card">
      <div className="card-heading"><div><h2>{team ? `Tagesplan · ${teamName(tournament, team)}` : 'Alle Begegnungen'}</h2><p>{matches.length} Spiele · {new Set(matches.map(match => match.slot)).size} Slots</p></div></div>
      <div className="filters no-print">
        <div className="filter-control"><label htmlFor={`${filtersId}-phase`}>Phase</label><select id={`${filtersId}-phase`} value={phase} onChange={event => setPhase(event.target.value)}><option value="">Alle Phasen</option>{tournament.config.stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></div>
        <div className="filter-control"><label htmlFor={`${filtersId}-court`}>Spielfeld</label><select id={`${filtersId}-court`} value={field} onChange={event => setField(event.target.value)}><option value="">Alle Spielfelder</option>{tournament.config.courts.map(court => <option key={court.id} value={court.id}>{court.name}</option>)}</select></div>
        <div className="filter-control"><label htmlFor={`${filtersId}-team`}>Team</label><select id={`${filtersId}-team`} value={team} onChange={event => { setTeam(event.target.value); setPhase(''); setField('') }}><option value="">Alle Teams</option>{tournament.config.teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      </div>
      {team ? <TeamTimeline tournament={tournament} matches={matches} team={team}/> : <ScheduleTable tournament={tournament} matches={matches} manage={manage}/>}
    </section>
  </>
}
function TeamTimeline({ tournament, matches, team }: { tournament: Tournament; matches: Match[]; team: string }) {
  const resolved = (member: string | null) => member ? tournament.seeds[member] ?? member : ''
  const unresolved = tournament.plan.matches.some(match => [match.a, match.b, match.referee].some(member => resolved(member).startsWith('@')))
  return <div className="timeline">
    {unresolved && <Notice tone="info">Weitere Einsätze werden nach Abschluss der Qualifikation ergänzt.</Notice>}
    {matches.map((match, index) => {
      const prev = matches[index - 1]
      const pause = prev ? match.start - prev.end : 0
      const referee = resolved(match.referee) === team
      return <div key={match.id}>
        {pause > 0 && <p className="timeline-break"><Timer size={16}/>{clock(prev.end)}–{clock(match.start)} · {pause} Min. frei</p>}
        <div className="timeline-row"><div><strong>{clock(match.start)}</strong><small>bis {clock(match.end)}</small></div>
          <div><strong>{referee ? 'Schiedsgericht' : `Spiel gegen ${teamName(tournament, resolved(match.a) === team ? match.b : match.a)}`}</strong><small>{referee && `${teamName(tournament, match.a)} – ${teamName(tournament, match.b)} · `}{courtName(tournament, match.court)} · Spiel {match.id}</small></div>
          <Status game={gameOf(tournament, match.id)}/>
        </div>
      </div>
    })}
    {!matches.length && <Empty title="Keine geplanten Einsätze"/>}
  </div>
}
function tablePanels(stage: Stage | undefined, tv: boolean) {
  return stage?.groups.flatMap(group => Array.from({ length: tv ? Math.ceil(group.members.length / 7) : 1 }, (_, index) =>
    ({ group, offset: index * 7 }))) ?? []
}
export const tablePageCount = (stage: Stage | undefined) => Math.ceil(tablePanels(stage, true).length / 4)

export function TableGrid({ tournament, phase, compact = false, page }: { tournament: Tournament; phase: string; compact?: boolean; page?: number }) {
  const stage = tournament.config.stages.find(stage => stage.id === phase)
  const results = new Map(tournament.games.flatMap(game => game.official ? [[game.id, game.official]] : []))
  const { tables } = tournamentTables(tournament.config, tournament.plan, results)
  const panels = tablePanels(stage, page !== undefined)
  return <div className={`table-grid ${compact ? 'compact' : ''}`}>
    {(page === undefined ? panels : panels.slice(page * 4, page * 4 + 4)).map(({ group, offset }) => {
      const rows = tables.get(group.id)?.rows ?? []
      return <section className="card standings" key={`${group.id}-${offset}`}>
        <div className="card-heading"><div className="card-title-icon"><Trophy size={18}/><h2>{group.name}{offset > 0 && ` · ab Rang ${offset + 1}`}</h2></div></div>
        <RankTable rows={page === undefined ? rows : rows.slice(offset, offset + 7)} tournament={tournament} compact={compact} offset={offset}/>
      </section>
    })}
  </div>
}
function RankTable({ rows, tournament, compact, offset }: { rows: Row[]; tournament: Tournament; compact: boolean; offset: number }) {
  const fmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const draws = tournament.config.rules.allowDraw && !compact
  return <div className="table-scroll"><table className="rank-table"><thead><tr><th>#</th><th>Team</th><th title="Spiele">Sp.</th><th title="Siege">S</th>{draws && <th title="Unentschieden">U</th>}<th title="Niederlagen">N</th><th>Pkt.</th>{!compact && <><th>Pkt./Sp.</th><th>Ballpkt.</th></>}<th title="Ballpunktquotient">Quot.</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.team}><td>{offset + index + 1}</td><th scope="row">{teamName(tournament, row.team)}</th><td>{row.games}</td><td>{row.wins}</td>{draws && <td>{row.draws}</td>}<td>{row.losses}</td><td><strong>{row.points}</strong></td>{!compact && <><td>{fmt.format(row.average)}</td><td>{row.scored}:{row.conceded}</td></>}<td>{fmt.format(row.quotient)}</td></tr>)}</tbody>
  </table></div>
}
export function StandingsPage({ tournament, manage = false }: { tournament: Tournament; manage?: boolean }) {
  const [phase, setPhase] = useState('')
  return <>
    {manage && <Heading eyebrow="Turnierbetrieb" title="Tabellen" subtitle="Offizieller Stand auf Basis der bestätigten Ergebnisse."/>}
    <div className="segmented no-print" aria-label="Turnierphase">{tournament.config.stages.map(stage => <button key={stage.id}
      aria-pressed={(phase || tournament.config.stages[tournament.released]?.id) === stage.id}
      onClick={() => setPhase(stage.id)}>{stage.name}</button>)}</div>
    <TableGrid tournament={tournament} phase={phase || tournament.config.stages[tournament.released]?.id}/>
    <p className="hint">Sp. = gewertete Spiele · Pkt. = Wertungspunkte · Quot. = erzielte Ballpunkte ÷ erhaltene Ballpunkte. Bei erzielten Punkten ohne Gegenpunkt ist der Quotient ∞. Bei 0:0 ist er 0.</p>
  </>
}
export function MatchTile({ tournament, match, now, manage = false }: { tournament: Tournament; match: Match; now: number; manage?: boolean }) {
  const game = gameOf(tournament, match.id)
  const timer = countdown(game, tournament.config.duration, now)
  const score = game.official ?? game.live
  return <article className={`match-tile ${game.status === 'running' ? 'is-active' : ''}`}>
    <div className="match-tile-meta"><span className="field-tag">{courtName(tournament, match.court)}</span><span>Spiel {match.id} · Slot {match.slot}</span><Status game={game}/></div>
    <div className="match-tile-score"><span>{teamName(tournament, match.a)}</span><strong>{score ? `${score.a} : ${score.b}` : '– : –'}</strong><span>{teamName(tournament, match.b)}</span></div>
    <div className="match-tile-meta"><span><Users size={15}/> {teamName(tournament, match.referee)}</span>
      <span><Timer size={15}/> {game.status === 'running' ? `${formatDuration(timer.seconds)} · ${timer.label}` : `${clock(match.start)} Uhr`}</span>
      {manage && <Link to={`${adminPath(tournament.id)}/spiel/${match.id}`} aria-label={`Spiel ${match.id} öffnen`}><ArrowRight size={19}/></Link>}</div>
  </article>
}
export function delayMinutes(tournament: Tournament, match: Match, now: number) {
  try {
    const game = gameOf(tournament, match.id)
    const planned = scheduledEpoch(tournament.config.date, match.start, tournament.config.timezone)
    const elapsed = (game.started ? Date.parse(game.started) : now) - planned
    const finish = (game.ended ? Date.parse(game.ended) : now) - planned - tournament.config.duration * 60_000
    return Math.max(0, Math.floor(Math.max(elapsed, game.started ? finish : 0) / 60_000))
  } catch { return 0 }
}

export function SlotList({ tournament, matches, manage }: { tournament: Tournament; matches: Match[]; manage: boolean }) {
  return matches.length ? <div className="slot-list">{matches.map(match => <div key={match.id} className="slot-item">
    <span className="slot-time">{clock(match.start)}</span>
    <div><span className="slot-field">{courtName(tournament, match.court)} · Slot {match.slot}</span><strong>{teamName(tournament, match.a)} <span>vs.</span> {teamName(tournament, match.b)}</strong><small>{groupName(tournament, match)} · Pfeift {teamName(tournament, match.referee)}</small></div>
    {manage && <Link to={`${adminPath(tournament.id)}/spiel/${match.id}`} aria-label={`Spiel ${match.id} öffnen`} className="icon-button minimal"><ArrowRight size={17}/></Link>}
  </div>)}</div> : <Empty title="Keine weiteren Anpfiffe"/>
}
