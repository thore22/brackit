import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, Flag, Pause, Pencil, Play, Plus, RotateCcw, Save, Send, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { errorText, gameAction, moveMatch } from '../data/client.ts'
import { final, type GameAction, type GameCommand, type Tournament } from '../data/types.ts'
import { countdown, formatDuration, type GameState } from '../engine/game.ts'
import { clock, type Match } from '../engine/model.ts'
import type { Score } from '../engine/standings.ts'
import { adminPath, courtName, gameOf, Heading, Notice, Status, teamName, useNow } from './common.tsx'
import { delayMinutes } from './schedule.tsx'

export function GamePanel({ tournament, match, offline, offset, refresh, admin, access }: {
  tournament: Tournament; match: Match; offline: boolean; offset: number; refresh: () => unknown; admin: boolean; access: boolean
}) {
  const state = gameOf(tournament, match.id)
  const now = useNow(offset, state.status === 'running')
  const timer = countdown(state, tournament.config.duration, now)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [correction, setCorrection] = useState(false)
  const retry = useRef<{ fingerprint: string; request: string } | null>(null)
  const unlocked = tournament.state === 'published' && tournament.config.stages.findIndex(stage => stage.id === match.stage) <= tournament.released
  const delay = delayMinutes(tournament, match, now)
  async function apply(action: GameAction, score?: Score, version = state.version) {
    setBusy(true)
    setMessage('')
    const fingerprint = JSON.stringify([match.id, action, version, score])
    const request = retry.current?.fingerprint === fingerprint ? retry.current.request : crypto.randomUUID()
    retry.current = { fingerprint, request }
    const command: GameCommand = { game: match.id, action, version, request, score }
    try {
      await gameAction(tournament.id, command, admin)
      retry.current = null
      await refresh()
      if (action === 'correct') setCorrection(false)
      return true
    } catch (error) {
      setMessage(errorText(error))
      await refresh()
      return false
    } finally { setBusy(false) }
  }
  const disabled = busy || offline
  const button = (action: GameAction, label: string, Icon: typeof Play, kind = 'secondary') =>
    <button className={`button ${kind}`} disabled={disabled} onClick={() => void apply(action)}><Icon size={18}/>{label}</button>
  return <>
    {admin && <Heading eyebrow="Spielverwaltung" title={`Spiel #${match.id}`} subtitle={`${courtName(tournament, match.court)} · Slot ${match.slot} · ${clock(match.start)}–${clock(match.end)} Uhr`}
      actions={<Link className="button secondary" to={`${adminPath(tournament.id)}/spielplan`}><ArrowLeft size={17}/>Spielplan</Link>}/>}
    <section className="card game-card">
      <div className="card-heading"><div><p className="eyebrow">{courtName(tournament, match.court)} · SPIEL {match.id}</p><h2>{teamName(tournament, match.a)} <span className="muted">vs.</span> {teamName(tournament, match.b)}</h2></div><Status game={state}/></div>
      <div className="game-inner">
        <div className="scoreboard">
          <div><small>Aktueller Spielstand</small><strong>{state.live ? `${state.live.a} : ${state.live.b}` : '– : –'}</strong></div>
          <div><small>{timer.label}</small><strong>{formatDuration(timer.seconds)}</strong></div>
        </div>
        <p className="hint game-ref">Pfeif-Team · {teamName(tournament, match.referee)} · Geplant {clock(match.start)}–{clock(match.end)} Uhr</p>
        {admin && state.started && <p className="hint">Tatsächlich {new Date(state.started).toLocaleTimeString('de-DE', { timeZone: tournament.config.timezone, timeStyle: 'short' })} Uhr{state.ended && ` bis ${new Date(state.ended).toLocaleTimeString('de-DE', { timeZone: tournament.config.timezone, timeStyle: 'short' })} Uhr`}</p>}
        {admin && delay > 0 && state.started && <Notice tone="info"><span className="inline-flex items-center gap-2"><TriangleAlert size={17}/>{delay} Min. Verzögerung gegenüber dem Spielplan</span></Notice>}
        {message && <Notice>{message}</Notice>}
        {unlocked && admin && <div className="button-row no-print">
          {state.status === 'scheduled' && button('start', 'Spiel starten', Play, 'primary')}
          {state.status === 'running' && !state.regularEnded && <>
            {state.paused ? button('resume', 'Fortsetzen', Play) : button('pause', 'Pausieren', Pause)}
            {button('regular', 'Reguläre Spielzeit beenden', Flag)}
          </>}
          {state.status === 'submitted' && <>
            {button('confirm', 'Ergebnis bestätigen', Check, 'primary')}
            {button('reject', 'Ergebnis zurückweisen', RotateCcw)}
          </>}
          {(state.status === 'submitted' || final(state)) && <button className="button secondary" disabled={disabled} onClick={() => setCorrection(!correction)}><Pencil size={17}/>{correction ? 'Korrektur schließen' : 'Ergebnis korrigieren'}</button>}
        </div>}
        {!unlocked && <Notice tone="info">{tournament.state === 'archived' ? 'Dieses Turnier ist archiviert.' : 'Das Spiel ist noch nicht zur Eingabe freigegeben.'}</Notice>}
        {access && unlocked && (state.status === 'running' || correction) && <ScoreForm key={String(correction)} tournament={tournament} match={match} state={state} correction={correction} offline={offline} busy={busy} apply={apply}/>}
        {!admin && state.status === 'submitted' && <Notice tone="success">Ergebnis eingereicht. Die Turnierleitung prüft die Freigabe.</Notice>}
        {!admin && final(state) && <Notice tone="success">Das offizielle Ergebnis ist bestätigt.</Notice>}
        {!admin && access && unlocked && state.status === 'scheduled' && <Notice tone="info">Die Turnierleitung startet das Spiel. Die Eingabe wird dann automatisch freigeschaltet.</Notice>}
      </div>
    </section>
    {admin && state.status === 'scheduled' && tournament.state !== 'archived' && <MoveForm tournament={tournament} match={match} refresh={refresh} offline={offline}/>}
  </>
}

type Draft = { score: Score; version: number }
function ScoreForm({ tournament, match, state, correction, offline, busy, apply }: {
  tournament: Tournament; match: Match; state: GameState; correction: boolean; offline: boolean; busy: boolean
  apply: (action: GameAction, score: Score, version: number) => Promise<boolean>
}) {
  const draftKey = `turnierleitung.score.${tournament.id}.${match.id}.${correction ? 'correction' : 'live'}`
  const load = (): Draft | null => {
    try { return JSON.parse(localStorage.getItem(draftKey) ?? 'null') } catch { return null }
  }
  const [draft, setDraft] = useState(load)
  const [dirty, setDirty] = useState(!!draft)
  const [version, setVersion] = useState(draft?.version ?? state.version)
  const [a, setA] = useState(String(draft?.score.a ?? state.live?.a ?? 0))
  const [b, setB] = useState(String(draft?.score.b ?? state.live?.b ?? 0))
  const [feedback, setFeedback] = useState('')
  const [invalid, setInvalid] = useState(false)
  const conflict = dirty && version !== state.version
  useEffect(() => {
    if (!dirty) {
      setA(String(state.live?.a ?? 0))
      setB(String(state.live?.b ?? 0))
      setVersion(state.version)
    }
  }, [state.version, state.live?.a, state.live?.b, dirty])
  function clear() {
    localStorage.removeItem(draftKey)
    setDraft(null)
    setDirty(false)
  }
  function input(side: 'a' | 'b', value: string) {
    if (!dirty) setVersion(state.version)
    setDirty(true)
    if (side === 'a') setA(value)
    else setB(value)
    setFeedback('')
  }
  async function save(action: GameAction) {
    setInvalid(false)
    setFeedback('')
    const score = { a: Number(a), b: Number(b) }
    if (!a.trim() || !b.trim() || Object.values(score).some(value => !Number.isInteger(value) || value < 0 || value > 999)) {
      setFeedback('Gib je Team eine ganze Punktzahl zwischen 0 und 999 ein.')
      setInvalid(true)
      return
    }
    const next = { score, version }
    try { localStorage.setItem(draftKey, JSON.stringify(next)); setDraft(next) }
    catch { if (offline) { setFeedback('Der lokale Speicher ist nicht verfügbar.'); setInvalid(true); return } }
    if (offline) { setFeedback('Entwurf lokal gespeichert. Übertrage ihn nach der Synchronisierung manuell.'); return }
    if (await apply(action, score, version)) {
      clear()
      setFeedback(action === 'live' ? 'Spielstand aktualisiert.' : 'Ergebnis übertragen.')
    }
  }
  const side = (id: 'a' | 'b', seed: string, value: string) => <label className="score-input">
    {teamName(tournament, seed)}
    <span><input aria-label={`Punkte ${teamName(tournament, seed)}`} type="number" inputMode="numeric" min={0} max={999} value={value} onChange={event => input(id, event.target.value)}/>
      <button type="button" className="icon-button" aria-label={`Punkt für ${teamName(tournament, seed)}`} onClick={() => input(id, String(Math.min(999, Number(value) + 1)))}><Plus size={22}/></button></span>
  </label>
  return <form className="score-form" onSubmit={event => { event.preventDefault(); void save(correction ? 'correct' : 'submit') }}>
    <h3>{correction ? 'Offizielles Ergebnis korrigieren' : 'Punkte erfassen'}</h3>
    {draft && !conflict && !feedback && <Notice tone="info">Lokaler Entwurf geladen. Prüfe die Werte vor dem Einreichen.</Notice>}
    {conflict && <Notice>Der Stand auf dem Server hat sich geändert. Vergleiche den aktuellen Spielstand mit deinen Eingaben.
      <div className="button-row"><button type="button" className="button secondary" onClick={clear}><RotateCcw size={16}/>Aktuellen Stand übernehmen</button></div>
    </Notice>}
    <div className="score-fields">{side('a', match.a, a)}{side('b', match.b, b)}</div>
    {feedback && <Notice tone={invalid ? 'error' : 'success'}>{feedback}</Notice>}
    <div className="button-row">
      {offline ? <button className="button primary" type="submit"><Save size={18}/>Entwurf lokal speichern</button> : <>
        {!correction && <button className="button secondary" type="button" disabled={busy || conflict} onClick={() => void save('live')}><Save size={17}/>Live-Stand aktualisieren</button>}
        <button className="button primary" type="submit" disabled={busy || conflict}><Send size={17}/>{correction ? 'Korrektur bestätigen' : 'Ergebnis einreichen'}</button>
      </>}
    </div>
  </form>
}
function MoveForm({ tournament, match, refresh, offline }: { tournament: Tournament; match: Match; refresh: () => unknown; offline: boolean }) {
  const [slot, setSlot] = useState(match.slot)
  const [field, setField] = useState(match.court)
  const [referee, setReferee] = useState(match.referee ?? '')
  const [feedback, setFeedback] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const stage = tournament.config.stages.find(stage => stage.id === match.stage)!
  const slots = [...new Map(tournament.plan.matches.filter(other => other.stage === match.stage && (!stage.rounds || other.round === match.round)).map(other => [other.slot, other])).values()].sort((a,b) => a.slot-b.slot)
  const members = (tournament.config.referee === 'group' && match.group ? stage.groups.filter(group => group.id === match.group) : stage.groups)
    .flatMap(group => group.members).filter(member => ![match.a, match.b].includes(member))
  async function save(event: FormEvent) {
    event.preventDefault()
    const destination = slots.find(item => item.slot === slot)
    if (!destination) return
    setBusy(true)
    setFeedback('')
    try {
      await moveMatch(tournament.id, tournament.revision, { ...match, slot, court: field, referee: referee || null, start: destination.start, end: destination.end })
      await refresh()
      setSuccess(true)
      setFeedback('Spielplan aktualisiert. Vorherige QR-Zugänge für dieses Spiel wurden widerrufen.')
    } catch (error) {
      setSuccess(false); setFeedback(errorText(error))
    } finally { setBusy(false) }
  }
  return <section className="card"><div className="card-heading"><div><h2>Spielplan bearbeiten</h2><p>Verschiebe das Spiel in einen freien Slot derselben Phase.</p></div></div>
    <form className="card-body form-grid" onSubmit={save}>
      <label>Slot<select value={slot} onChange={event => setSlot(+event.target.value)}>{slots.map(item => <option key={item.slot} value={item.slot}>Slot {item.slot} · {clock(item.start)} Uhr</option>)}</select></label>
      <label>Feld<select value={field} onChange={event => setField(event.target.value)}>{tournament.config.courts.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Pfeif-Team<select value={referee} onChange={event => setReferee(event.target.value)}><option value="">Ohne Pfeif-Team</option>{members.map(member => <option key={member} value={member}>{teamName(tournament, member)}</option>)}</select></label>
      <div className="button-row"><button className="button secondary" disabled={busy || offline}><Save size={17}/>Änderung speichern</button></div>
      {feedback && <Notice tone={success ? 'success' : 'error'}>{feedback}</Notice>}
    </form>
  </section>
}
