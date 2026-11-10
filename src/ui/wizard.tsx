import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ClipboardList, Plus, Save, Sparkles, Trash2, Upload, Volleyball, X } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import { control, errorText, readTournament, savePlan } from '../data/client.ts'
import type { Tournament } from '../data/types.ts'
import { emptyGame } from '../engine/game.ts'
import { participantLabel, rank, type Group, type Named, type Pair, type Plan, type Stage, type Tiebreak, type TournamentConfig } from '../engine/model.ts'
import { emptyTournament, volleyball } from '../engine/template.ts'
import { adminPath, Heading, Notice, ordered } from './common.tsx'
import { ScheduleTable } from './schedule.tsx'

const steps = ['Turnierdaten', 'Teams', 'Spielfelder', 'Turniersystem', 'Gruppen', 'Spiele und Runden', 'Zeiten und Pausen', 'Wertung', 'Plan erzeugen', 'Prüfen und veröffentlichen']
const shortId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
const tieLabels: Record<Tiebreak, string> = { quotient: 'Ballpunktquotient', difference: 'Balldifferenz', headToHead: 'Direkter Vergleich', scored: 'Erzielte Ballpunkte', draw: 'Deterministischer Losentscheid' }
const formats = { roundRobin: 'Jeder gegen jeden', balanced: 'Zielspielzahl ausgleichen', manual: 'Manuelle Begegnungen' }

function parseTeamList(contents: string, filename: string) {
  const input = contents.replace(/^\uFEFF/, '')
  const first = input.split(/\r?\n/)[0]
  const delimiter = /\.txt$/i.test(filename) ? null : first.includes('\t') ? '\t' : first.includes(';') ? ';' : ','
  const result: string[] = []
  let buffer = ''
  let cells: string[] = []
  let quoted = false
  const row = () => {
    const value = (cells[0] ?? buffer).trim().replace(/^'(?=[=+@-])/, '')
    if (value) result.push(value)
    cells = []
    buffer = ''
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"' && (quoted || !buffer)) {
      if (quoted && input[i + 1] === '"') { buffer += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && char === delimiter) { cells.push(buffer); buffer = '' }
    else if (!quoted && char === '\n') row()
    else if (char !== '\r') buffer += char
  }
  row()
  if (/^(team|name|teamname)$/i.test(result[0] ?? '')) result.shift()
  return result.map(name => name.replace(/\s+/g, ' '))
}

export function Wizard({ existing, offline = false }: { existing?: Tournament; offline?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [config, setConfig] = useState<TournamentConfig>(() => structuredClone(existing?.config ?? location.state?.config ?? emptyTournament()))
  const [step, setStep] = useState(0)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ id: string; revision: number } | null>(null)
  const worker = useRef<Worker | null>(null)
  useEffect(() => () => worker.current?.terminate(), [])
  const patch = (values: Partial<TournamentConfig>) => {
    setConfig(value => ({ ...value, ...values }))
    setPlan(null)
    setSaved(null)
    setError('')
  }
  const updateStage = (id: string, values: Partial<Stage>) =>
    patch({ stages: config.stages.map(stage => stage.id === id ? { ...stage, ...values } : stage) })
  const updateGroup = (stage: Stage, id: string, values: Partial<Group>) =>
    updateStage(stage.id, { groups: stage.groups.map(group => group.id === id ? { ...group, ...values } : group) })
  const updateRules = (values: Partial<TournamentConfig['rules']>) => patch({ rules: { ...config.rules, ...values } })
  function changeStep(next: number) {
    setStep(next); setError('')
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function generatePlan() {
    setBusy(true); setError(''); setPlan(null)
    worker.current?.terminate()
    const task = new Worker(new URL('../engine/generator.worker.ts', import.meta.url), { type: 'module' })
    worker.current = task
    const finish = () => { setBusy(false); task.terminate(); worker.current = null }
    task.onmessage = (event: MessageEvent<{ plan?: Plan; error?: string }>) => {
      if (event.data.plan) setPlan(event.data.plan)
      else setError(event.data.error ?? 'Der Spielplan konnte nicht erzeugt werden.')
      finish()
    }
    task.onerror = () => { setError('Die Spielplanberechnung konnte nicht gestartet werden.'); finish() }
    task.postMessage(config)
  }
  async function save(publish: boolean) {
    if (!plan) return
    setError(''); setSaving(true)
    try {
      let draft = saved
      if (!draft) {
        const id = await savePlan(existing?.id ?? null, existing?.revision ?? null, config, plan)
        const { revision } = await readTournament(id, true)
        draft = { id, revision }
        setSaved(draft)
      }
      if (publish) await control(draft.id, draft.revision, 'publish')
      navigate(adminPath(draft.id))
    } catch (failure) { setError(errorText(failure)) }
    finally { setSaving(false) }
  }
  function removeTeam(id: string) {
    patch({
      teams: config.teams.filter(team => team.id !== id),
      stages: config.stages.map(stage => ({ ...stage,
        groups: stage.groups.map(group => ({ ...group, members: group.members.filter(member => member !== id) })),
        extras: stage.extras.filter(pair => pair.a !== id && pair.b !== id),
      })),
    })
  }
  async function importTeams(file?: File) {
    if (!file) return
    try {
      if (file.size > 128_000) throw new Error('Die Teamliste ist zu groß.')
      const names = parseTeamList(await file.text(), file.name)
      if (!names.length) throw new Error('Die Datei enthält keine Teamnamen.')
      if (config.teams.length + names.length > 80) throw new Error('Maximal 80 Teams sind möglich.')
      patch({ teams: [...config.teams, ...names.map(name => ({ name, id: shortId('team') }))] })
    } catch (failure) { setError(errorText(failure)) }
  }
  const sections: ReactNode[] = [
    <div className="form-grid">
      {!existing && <div className="template-callout"><span className="section-icon"><Volleyball size={23}/></span><div><strong>Vorlage Volleyball Cup</strong><p>14 Teams · 2 Felder · 49 Begegnungen</p></div>
        <button className="button secondary" onClick={() => patch(volleyball(config.date || undefined))}><Sparkles size={16}/>Vorlage laden</button></div>}
      <label>Turniername<input value={config.name} maxLength={100} onChange={event => patch({ name: event.target.value })}/></label>
      <label>Sportart<input value={config.sport ?? ''} maxLength={60} onChange={event => patch({ sport: event.target.value })}/></label>
      <label>Datum<input type="date" value={config.date} onChange={event => patch({ date: event.target.value })}/></label>
      <label>Zeitzone<input value={config.timezone} onChange={event => patch({ timezone: event.target.value })}/></label>
    </div>,
    <div className="form-stack">
      <p className="hint">Eine CSV- oder Textdatei ergänzt die vorhandenen Teams. Der Teamname steht in der ersten Spalte.</p>
      <NameEditor kind="Team" values={config.teams} onChange={teams => patch({ teams })} remove={removeTeam}/>
      <label className="file-input"><Upload size={17}/>Teamliste importieren<input type="file" accept=".csv,.txt,.tsv" onChange={event => { void importTeams(event.target.files?.[0]); event.target.value = '' }}/></label>
    </div>,
    <NameEditor kind="Spielfeld" values={config.courts} onChange={courts => patch({ courts })}/>,
    <div className="form-stack">
      {config.stages.map((stage, index) => <div className="form-box" key={stage.id}>
        <div className="between"><h3>Phase {index + 1}</h3><button aria-label={`Phase ${index + 1} entfernen`} className="icon-button minimal" disabled={config.stages.length === 1} onClick={() => patch({ stages: config.stages.filter(item => item.id !== stage.id) })}><Trash2 size={17}/></button></div>
        <div className="form-grid"><label>Phasenname<input value={stage.name} onChange={event => updateStage(stage.id, { name: event.target.value })}/></label>
          <label>Turniersystem<select value={stage.kind} onChange={event => updateStage(stage.id, { kind: event.target.value as Stage['kind'] })}>
            {Object.entries(formats).map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select></label></div>
        <label className="checkbox"><input type="checkbox" checked={stage.carry} onChange={event => updateStage(stage.id, { carry: event.target.checked })}/>Vorrundenergebnisse für gemeinsame Quellgruppen übernehmen</label>
      </div>)}
      <button className="button secondary fit" onClick={() => patch({ stages: [...config.stages, { id: shortId('phase'), name: `Phase ${config.stages.length + 1}`, kind: 'roundRobin', groups: [], gap: 0, rounds: 0, carry: false, extras: [] }] })}><Plus size={17}/>Phase hinzufügen</button>
    </div>,
    <div className="form-stack">
      <p className="hint">Wähle Teams oder Rangplätze aus früheren Gruppen. Die Reihenfolge der Auswahl dient als reproduzierbare Planungsgrundlage.</p>
      {config.stages.map((stage, index) => {
        const candidates = [...config.teams.map(team => team.id), ...config.stages.slice(0, index).flatMap(earlier => earlier.groups.flatMap(group => group.members.map((_, place) => rank(group.id, place + 1))))]
        const used = new Set(stage.groups.flatMap(group => group.members))
        return <div className="form-box" key={stage.id}>
          <h3>{stage.name}</h3>
          {stage.groups.map(group => <div className="group-editor" key={group.id}>
            <div className="between"><label>Gruppenname<input value={group.name} onChange={event => updateGroup(stage, group.id, { name: event.target.value })}/></label>
              <button className="icon-button minimal" aria-label={`${group.name} entfernen`} onClick={() => updateStage(stage.id, { groups: stage.groups.filter(item => item.id !== group.id) })}><Trash2 size={17}/></button></div>
            <div className="chips">{group.members.map(member => <button key={member} className="chip" onClick={() => updateGroup(stage, group.id, { members: group.members.filter(value => value !== member) })}
              aria-label={`${participantLabel(config, member)} aus ${group.name} entfernen`}>{participantLabel(config, member)}<X size={14}/></button>)}</div>
            <select aria-label={`Teilnehmer für ${group.name} hinzufügen`} value="" onChange={event => updateGroup(stage, group.id, { members: [...group.members, event.target.value] })}>
              <option value="" disabled>Teilnehmer hinzufügen …</option>{candidates.filter(member => !used.has(member)).map(member => <option key={member} value={member}>{participantLabel(config, member)}</option>)}
            </select>
          </div>)}
          <button className="button secondary fit" onClick={() => updateStage(stage.id, { groups: [...stage.groups, { id: shortId('gruppe'), name: `Gruppe ${stage.groups.length + 1}`, members: [] }] })}><Plus size={17}/>Gruppe hinzufügen</button>
        </div>
      })}
    </div>,
    <div className="form-stack">
      <div className="form-grid"><label>Exakte Spiele je Team (optional)<input type="number" min={1} max={80} value={config.target ?? ''} placeholder="Durch Format bestimmt" onChange={event => patch({ target: event.target.value ? +event.target.value : null })}/></label>
        <label>Schiedsgericht<select value={config.referee} onChange={event => patch({ referee: event.target.value as TournamentConfig['referee'] })}>
          <option value="group">Spielfrei in derselben Gruppe</option><option value="available">Beliebiges spielfreies Team</option><option value="none">Externes Schiedsgericht</option>
        </select></label></div>
      {config.stages.map(stage => <div className="form-box" key={stage.id}><h3>{stage.name}</h3>
        <label>Logische Runden (0 = automatisch)<input type="number" min={0} max={80} value={stage.rounds} onChange={event => updateStage(stage.id, { rounds: +event.target.value })}/></label>
        <p className="hint">Manuelle Begegnungen innerhalb einer Gruppe gehen in deren Tabelle ein. Begegnungen ohne Gruppe zählen zur Spielzahl und erscheinen nach den Gruppenrunden.</p>
        {stage.extras.map((pair, index) => <PairEditor key={index} pair={pair} stage={stage} config={config}
          onChange={next => updateStage(stage.id, { extras: stage.extras.map((item, i) => i === index ? next : item) })}
          remove={() => updateStage(stage.id, { extras: stage.extras.filter((_, i) => i !== index) })}/>)}
        <button className="button secondary fit" onClick={() => updateStage(stage.id, { extras: [...stage.extras, { a: '', b: '' }] })}><Plus size={17}/>Begegnung hinzufügen</button>
      </div>)}
    </div>,
    <div className="form-stack"><div className="form-grid">
      <label>Turnierbeginn<input type="time" value={config.start} onChange={event => patch({ start: event.target.value })}/></label>
      <label>Geplantes Ende<input type="time" value={config.end} onChange={event => patch({ end: event.target.value })}/></label>
      <label>Spielzeit in Minuten<input type="number" min={1} value={config.duration} onChange={event => patch({ duration: +event.target.value })}/></label>
      <label>Wechselzeit in Minuten<input type="number" min={0} value={config.change} onChange={event => patch({ change: +event.target.value })}/></label>
    </div>
      <h3>Pausen und Unterbrechungen</h3>
      {config.breaks.map((pause, index) => <div className="inline-edit" key={index}>
        <label>Pausenbeginn<input type="time" value={pause.start} onChange={event => patch({ breaks: config.breaks.map((item, i) => i === index ? { ...item, start: event.target.value } : item) })}/></label>
        <label>Pausenende<input type="time" value={pause.end} onChange={event => patch({ breaks: config.breaks.map((item, i) => i === index ? { ...item, end: event.target.value } : item) })}/></label>
        <button className="icon-button minimal" aria-label="Pause entfernen" onClick={() => patch({ breaks: config.breaks.filter((_, i) => i !== index) })}><Trash2 size={17}/></button>
      </div>)}
      <button className="button secondary fit" onClick={() => patch({ breaks: [...config.breaks, { start: '12:00', end: '12:45' }] })}><Plus size={17}/>Pause hinzufügen</button>
      <div className="form-grid">{config.stages.map(stage => <label key={stage.id}>Zusätzlicher Abstand vor {stage.name} (Min.)<input type="number" min={0} value={stage.gap} onChange={event => updateStage(stage.id, { gap: +event.target.value })}/></label>)}</div>
    </div>,
    <div className="form-stack"><div className="form-grid">
      {(['win','loss','draw'] as const).map((value, index) => <label key={value}>{['Punkte pro Sieg','Punkte pro Niederlage','Punkte pro Unentschieden'][index]}<input type="number" min={0} value={config.rules[value]} onChange={event => updateRules({ [value]: +event.target.value })}/></label>)}
      <label>Primäre Sortierung<select value={config.rules.primary} onChange={event => updateRules({ primary: event.target.value as TournamentConfig['rules']['primary'] })}>
        <option value="auto">Punkte pro Spiel bei ungleichen Spielzahlen</option><option value="total">Absolute Wertungspunkte</option><option value="average">Wertungspunkte pro Spiel</option>
      </select></label></div>
      <label className="checkbox"><input type="checkbox" checked={config.rules.allowDraw} onChange={event => updateRules({ allowDraw: event.target.checked })}/>Unentschieden zulassen</label>
      <label className="checkbox"><input type="checkbox" checked={config.rules.autoConfirm} onChange={event => updateRules({ autoConfirm: event.target.checked })}/>Ergebnisse automatisch bestätigen</label>
      <h3>Kriterien bei Gleichstand</h3><p className="hint">Die Liste wird von oben nach unten angewendet.</p>
      {config.rules.tie.map((criterion, index) => <div className="inline-edit" key={index}><label>Kriterium {index + 1}<select value={criterion} onChange={event => updateRules({ tie: config.rules.tie.map((item, i) => i === index ? event.target.value as Tiebreak : item) })}>
        {(Object.keys(tieLabels) as Tiebreak[]).filter(item => item === criterion || !config.rules.tie.includes(item)).map(item => <option key={item} value={item}>{tieLabels[item]}</option>)}</select></label>
        <button className="icon-button minimal" aria-label="Kriterium entfernen" onClick={() => updateRules({ tie: config.rules.tie.filter((_, i) => i !== index) })}><Trash2 size={17}/></button></div>)}
      {config.rules.tie.length < 5 && <button className="button secondary fit" onClick={() => {
        const next = (Object.keys(tieLabels) as Tiebreak[]).find(item => !config.rules.tie.includes(item))!
        updateRules({ tie: [...config.rules.tie, next] })
      }}><Plus size={17}/>Kriterium hinzufügen</button>}
    </div>,
    <div className="form-stack"><p>Der Generator prüft Spielzahlen, Zeitfenster, Gruppen, Feldbelegung und Schiedsgericht. Die Berechnung läuft im Hintergrund.</p>
      <button className="button primary fit" disabled={busy} onClick={generatePlan}><Sparkles size={17}/>{busy ? 'Spielplan wird berechnet …' : 'Spielplan generieren'}</button>
      {plan && <Notice tone="success">{plan.matches.length} Begegnungen · {new Set(plan.matches.map(match => match.slot)).size} Slots · {plan.carry.length} Ergebnisübernahmen. Der Spielplan ist konfliktfrei.</Notice>}
    </div>,
    plan && <div className="form-stack"><Notice tone="success">Der Spielplan enthält {plan.matches.length} Begegnungen. Rangplätze werden nach Bestätigung der Quellergebnisse aufgelöst.</Notice>
      <div className="card"><ScheduleTable tournament={{ id: '', revision: 0, configurationVersion: 0, state: 'draft', released: 0, admin: true, config, plan, games: plan.matches.map(match => emptyGame(match.id)), serverNow: '', seeds: {} }} matches={ordered(plan.matches)}/></div>
    </div>,
  ]
  return <>
    <Heading eyebrow="Turnier-Konfigurator" title={existing ? 'Entwurf bearbeiten' : 'Turnier einrichten'} subtitle="Richte das Turnier schrittweise ein und prüfe deinen Spielplan vor der Freigabe."
      actions={<Link className="button secondary" to={existing ? adminPath(existing.id) : '/turniere'}><ArrowLeft size={17}/>Zur Verwaltung</Link>}/>
    <div className="wizard-layout">
      <aside className="card wizard-steps" aria-label="Einrichtungsschritte">{steps.map((name, index) => <button key={name} disabled={busy || saving || (index === 9 && !plan)} aria-current={step === index ? 'step' : undefined} onClick={() => changeStep(index)}>
        <span>{index < step ? <Check size={15}/> : index + 1}</span>{name}
      </button>)}</aside>
      <section className="card wizard-card">
        <div className="card-heading"><div><p className="eyebrow">Schritt {step + 1} von {steps.length}</p><h2>{steps[step]}</h2></div><ClipboardList size={21}/></div>
        <div className="card-body">{sections[step]}{error && <Notice>{error}</Notice>}</div>
        <div className="wizard-footer">
          <button className="button secondary" disabled={step === 0 || busy || saving} onClick={() => changeStep(step - 1)}><ArrowLeft size={17}/>Zurück</button>
          {step < 9 ? <button className="button primary" disabled={busy || (step === 8 && !plan)} onClick={() => changeStep(step + 1)}>Weiter<ArrowRight size={17}/></button> :
            <div className="button-row"><button className="button secondary" disabled={offline || saving} onClick={() => void save(false)}><Save size={17}/>Entwurf speichern</button><button className="button primary" disabled={offline || saving} onClick={() => void save(true)}>Veröffentlichen<ArrowRight size={17}/></button></div>}
        </div>
      </section>
    </div>
  </>
}
function NameEditor({ kind, values, onChange, remove }: { kind: string; values: Named[]; onChange: (next: Named[]) => void; remove?: (id: string) => void }) {
  return <div className="form-stack">
    <div className="name-grid">{values.map((item, index) => <div className="inline-edit" key={item.id}>
      <label>{kind} {index + 1}<input value={item.name} maxLength={100} onChange={event => onChange(values.map(value => value.id === item.id ? { ...value, name: event.target.value } : value))}/></label>
      <button aria-label={`${kind} ${index + 1} entfernen`} className="icon-button minimal" onClick={() => remove ? remove(item.id) : onChange(values.filter(value => value.id !== item.id))}><Trash2 size={17}/></button>
    </div>)}</div>
    <button className="button secondary fit" onClick={() => onChange([...values, { id: shortId(kind === 'Team' ? 'team' : 'feld'), name: `${kind} ${values.length + 1}` }])}><Plus size={17}/>{kind} hinzufügen</button>
  </div>
}
function PairEditor({ pair, stage, config, onChange, remove }: { pair: Pair; stage: Stage; config: TournamentConfig; onChange: (pair: Pair) => void; remove: () => void }) {
  const options = (pair.group ? stage.groups.filter(group => group.id === pair.group) : stage.groups).flatMap(group => group.members)
  const select = (side: 'a' | 'b') => <label>{side === 'a' ? 'Team 1' : 'Team 2'}<select value={pair[side]} onChange={event => onChange({ ...pair, [side]: event.target.value })}><option value="">Auswählen</option>
    {options.map(item => <option key={item} value={item}>{participantLabel(config, item)}</option>)}</select></label>
  return <div className="manual-pair">
    <label>Wertung<select value={pair.group ?? ''} onChange={event => onChange({ ...pair, group: event.target.value || undefined, a: '', b: '' })}><option value="">Ohne Gruppe / Crossover</option>
      {stage.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    {select('a')}{select('b')}
    <label>Runde<input type="number" min={1} value={pair.round ?? ''} onChange={event => onChange({ ...pair, round: event.target.value ? +event.target.value : undefined })}/></label>
    <button className="icon-button minimal" aria-label="Begegnung entfernen" onClick={remove}><Trash2 size={17}/></button>
  </div>
}
