import { keyOf, minutes, rank, readRank, ScheduleError, SearchBudget, type Carry, type Group, type Match, type Pair, type Plan, type TournamentConfig } from './model.ts'
import { allPairs, chooseDegrees, roundColor, roundRobin } from './pairings.ts'
import { configSchema } from './schema.ts'
import { pack, type ScheduledPair } from './slots.ts'
import { validateSchedule } from './validate.ts'

const unique = (values: string[], label: string) => {
  if (values.length !== new Set(values).size) throw new ScheduleError(`${label} dürfen nicht doppelt vorkommen.`)
}

export function generate(input: TournamentConfig): Plan {
  const parsed = configSchema.safeParse(input)
  if (!parsed.success) throw new ScheduleError(`Ungültige Konfiguration (${parsed.error.issues[0].path.join('.')}). Bitte Eingaben prüfen.`)
  const config = parsed.data
  unique(config.teams.map(team => team.id), 'Teamkennungen')
  unique(config.courts.map(court => court.id), 'Feldkennungen')
  unique(config.stages.map(stage => stage.id), 'Phasenkennungen')
  unique(config.stages.flatMap(stage => stage.groups.map(group => group.id)), 'Gruppenkennungen')
  const deadline = minutes(config.end)
  let time = minutes(config.start)
  const block = config.duration + config.change
  const breaks = config.breaks.map(pause => ({ start: minutes(pause.start), end: minutes(pause.end) })).sort((a, b) => a.start - b.start)
  if (deadline <= time) throw new ScheduleError('Das Turnierende muss am selben Tag nach dem Beginn liegen.')
  let windows = 0
  let boundary = time
  for (const pause of breaks) {
    if (pause.start < boundary || pause.end <= pause.start || pause.end > deadline) throw new ScheduleError('Pausen müssen innerhalb des Turniers liegen und dürfen sich nicht überschneiden.')
    windows += Math.floor((pause.start - boundary) / block)
    boundary = pause.end
  }
  windows += Math.floor((deadline - boundary) / block)
  if (config.target !== null) {
    const appearances = config.teams.length * config.target
    if (appearances % 2) throw new ScheduleError(`${config.teams.length} Teams × ${config.target} Spiele ergeben eine ungerade Zahl an Einsätzen. Ändere die Spielanzahl oder Teamzahl.`)
    const required = Math.ceil(appearances / 2 / config.courts.length)
    if (required > windows) throw new ScheduleError(`Für ${appearances / 2} Begegnungen sind bei ${config.courts.length} Feldern mindestens ${required} Slots erforderlich. Es passen ${windows} Slots. Verlängere das Turnier, verkürze Slots oder ergänze Felder.`)
  }

  const budget = new SearchBudget()
  const prior = new Map<string, { group: Group; full: boolean; qualifiable: boolean; depth: number[] }>()
  const played = new Map(config.teams.map(team => [team.id, 0]))
  const promoted = new Set<string>()
  const qualifiedGroups = new Set<string>()
  const usage = new Map<string, number>()
  const matches: Match[] = []
  const carry: Carry[] = []
  let slotNumber = 0

  for (const stage of config.stages) {
    const roster = stage.groups.flatMap(group => group.members)
    unique(roster, `Teilnehmer in „${stage.name}“`)
    for (const member of roster) {
      const seed = readRank(member)
      if (!seed) {
        if (!played.has(member)) throw new ScheduleError(`Unbekanntes Team „${member}“.`)
        if (qualifiedGroups.size) throw new ScheduleError('Nach Beginn der Qualifikationsphasen müssen Teilnehmer über Rangplätze gewählt werden.')
        continue
      }
      const origin = prior.get(seed.group)
      if (!origin?.qualifiable || seed.place > origin.group.members.length || promoted.has(member)) throw new ScheduleError(`Der Rangplatz „${member}“ ist in dieser Phase nicht verfügbar. Die Quellgruppe benötigt eigene Begegnungen.`)
      if (origin.depth.some(value => value !== origin.depth[0]) && stage.kind === 'balanced') {
        throw new ScheduleError(`Für eine exakte Zielspielzahl müssen die Teams aus „${origin.group.name}“ gleich viele bisherige Spiele haben.`)
      }
      promoted.add(member)
      qualifiedGroups.add(seed.group)
      played.set(member, origin.depth[0])
    }
    if (roster.some(readRank) && roster.some(member => !readRank(member))) throw new ScheduleError('Verwende in einer Phase entweder Teams oder Rangplätze.')
    for (const member of roster) {
      const seed = readRank(member)
      const source = seed && prior.get(seed.group)
      if (source && stage.groups.some(group => source.group.members.some(candidate => group.members.includes(candidate)))) {
        throw new ScheduleError('Ein Team darf in einer Phase nicht zugleich direkt und über einen Rangplatz antreten.')
      }
    }
    for (const extra of stage.extras) {
      const group = stage.groups.find(group => group.id === extra.group)
      if (extra.a === extra.b || !roster.includes(extra.a) || !roster.includes(extra.b) ||
          (extra.group && (!group?.members.includes(extra.a) || !group.members.includes(extra.b)))) {
        throw new ScheduleError(`Ungültige manuelle Begegnung in „${stage.name}“.`)
      }
      if (stage.rounds && extra.round && (extra.group ? extra.round > stage.rounds : extra.round <= stage.rounds)) {
        throw new ScheduleError('Gruppenspiele müssen innerhalb der Gruppenrunden liegen. Crossover-Spiele folgen danach.')
      }
    }
    const roundBatches: ScheduledPair[][] = Array.from({ length: stage.rounds || 1 }, () => [])
    const register = (pair: Pair, group: Group | undefined, lane?: number, bye?: string[]) => {
      const refs = config.referee === 'group' && group ? bye ?? group.members : roster
      return { ...pair, group: group?.id, refs: refs.filter(ref => ref !== pair.a && ref !== pair.b), lane }
    }
    stage.groups.forEach((group, lane) => {
      const already = new Set<string>()
      if (stage.carry) {
        for (const { a, b } of allPairs(group.members)) {
          const left = readRank(a)
          const right = readRank(b)
          if (left && left.group === right?.group) {
            if (!prior.get(left.group)?.full) throw new ScheduleError('Eine Übernahme zwischen Rangplätzen erfordert eine vollständige Jeder-gegen-jeden-Quellgruppe.')
            already.add(keyOf(a, b))
            carry.push({ group: group.id, source: left.group, a, b })
          }
        }
      }
      const extras = stage.extras.filter(pair => pair.group === group.id)
      const excluded = new Set([...already, ...extras.map(pair => keyOf(pair.a, pair.b))])
      const allowed = allPairs(group.members).filter(pair => !excluded.has(keyOf(pair.a, pair.b)))
      let pairs: Pair[] = []
      if (stage.kind === 'roundRobin') {
        if (excluded.size) {
          const entries = [...allowed, ...extras]
          const colored = stage.rounds ? roundColor(group.members, entries, stage.rounds, budget) : entries
          if (!colored) throw new ScheduleError(`Zu wenige logische Runden in „${group.name}“.`)
          pairs = colored
        } else pairs = roundRobin(group.members, stage.rounds, budget)
      }
      if (stage.kind === 'balanced') {
        if (config.target === null) throw new ScheduleError('Die Ausgleichsphase benötigt eine Zielspielzahl pro Team.')
        const target = config.target
        const demand = group.members.map(member => target - played.get(member)! - stage.extras.filter(pair => pair.a === member || pair.b === member).length)
        const total = demand.reduce((sum, value) => sum + value, 0)
        if (total % 2) throw new ScheduleError(`„${group.name}“ benötigt ${total} neue Team-Einsätze. Ergänze ein geeignetes Crossover oder ändere die Qualifikation.`)
        if (demand.some(value => value < 0 || (stage.rounds > 0 && value > stage.rounds))) throw new ScheduleError(`Zielspielzahl und Rundenzahl passen in „${group.name}“ nicht zusammen.`)
        const found = chooseDegrees(group.members, allowed, demand, budget, solution => {
          const entries = [...solution, ...extras]
          const colored = stage.rounds ? roundColor(group.members, entries, stage.rounds, budget, config.referee === 'group') : entries
          if (!colored) return false
          pairs = colored
          return true
        })
        if (!found) throw new ScheduleError(`Für „${group.name}“ gibt es keine Paarungen mit den geforderten Spielzahlen, Übernahmen und Runden.`)
      }
      if (stage.kind === 'manual') {
        const colored = stage.rounds ? roundColor(group.members, extras, stage.rounds, budget) : extras
        if (!colored) throw new ScheduleError(`Die manuellen Begegnungen passen nicht in die Runden von „${group.name}“.`)
        pairs = colored
      }
      unique(pairs.map(pair => keyOf(pair.a, pair.b)), `Paarungen in „${group.name}“`)
      if (pairs.some(pair => already.has(keyOf(pair.a, pair.b)))) throw new ScheduleError('Ein übernommenes Spiel darf nicht erneut angesetzt werden.')
      for (const pair of pairs) {
        const sameRound = pairs.filter(candidate => (candidate.round ?? 1) === (pair.round ?? 1))
        if (stage.rounds && sameRound.filter(candidate => [candidate.a, candidate.b].some(member => member === pair.a || member === pair.b)).length > 1) {
          throw new ScheduleError(`Ein Team spielt in „${group.name}“ mehrfach in derselben logischen Runde.`)
        }
        const bye = stage.rounds && stage.kind === 'balanced'
          ? group.members.filter(member => sameRound.every(candidate => candidate.a !== member && candidate.b !== member))
          : undefined
        roundBatches[stage.rounds ? (pair.round ?? 1) - 1 : 0].push(register(pair, group, stage.kind === 'balanced' ? lane : undefined, bye))
      }
      const full = pairs.length === group.members.length * (group.members.length - 1) / 2
      prior.set(group.id, {
        group, full, qualifiable: pairs.length > 0,
        depth: group.members.map(member => played.get(member)! +
          pairs.filter(pair => pair.a === member || pair.b === member).length +
          stage.extras.filter(pair => !pair.group && (pair.a === member || pair.b === member)).length),
      })
    })
    if (stage.rounds && roundBatches.some(batch => !batch.length)) {
      throw new ScheduleError(`„${stage.name}“ hat weniger belegte als konfigurierte Gruppenrunden. Verringere die Rundenzahl oder ergänze Begegnungen.`)
    }
    const crossovers = stage.extras.filter(pair => !pair.group)
    const seeds = (value: string) => readRank(value)?.group
    if (stage.carry && crossovers.some(pair => seeds(pair.a) && seeds(pair.a) === seeds(pair.b))) {
      throw new ScheduleError('Bei aktivierter Übernahme dürfen Crossover-Teams nicht aus derselben Vorrundengruppe stammen.')
    }
    unique([...roundBatches.flat(), ...crossovers].map(pair => keyOf(pair.a, pair.b)), `Paarungen in „${stage.name}“`)
    const extraRounds = new Map<number, ScheduledPair[]>()
    for (const pair of crossovers) {
      const round = pair.round ?? stage.rounds + 1
      extraRounds.set(round, [...(extraRounds.get(round) ?? []), register({ ...pair, round }, undefined)])
    }
    for (const round of [...extraRounds.keys()].sort((a, b) => a - b)) roundBatches.push(extraRounds.get(round)!)
    if (!roundBatches.flat().length) throw new ScheduleError(`„${stage.name}“ enthält keine Spiele.`)
    time += stage.gap
    for (const batch of roundBatches.filter(batch => batch.length)) {
      const teamLoads = roster.map(member => batch.filter(pair => pair.a === member || pair.b === member).length)
      const lower = Math.max(Math.ceil(batch.length / config.courts.length), ...teamLoads)
      const max = Math.min(batch.length, Math.floor((deadline - time) / block))
      if (batch.some(pair => config.referee !== 'none' && pair.refs.length === 0)) throw new ScheduleError(`Für eine Begegnung in „${stage.name}“ fehlt ein spielfreies Pfeif-Team. Ändere die Schiedsrichterregel oder die Rundenzahl.`)
      let packed: ReturnType<typeof pack> = null
      for (let count = lower; count <= max && !packed; count++) packed = pack(batch, config, count, budget, usage)
      if (!packed) throw new ScheduleError(`„${stage.name}“ passt mit den Feld- und Schiedsrichterregeln nicht in das Zeitfenster. Ergänze Zeit oder lockere die Schiedsrichterregel.`)
      for (const slot of packed) {
        for (const pause of breaks) if (time < pause.end && time + block > pause.start) time = pause.end
        if (time + block > deadline) throw new ScheduleError('Der Spielplan überschreitet das geplante Ende. Verlängere das Zeitfenster oder kürze die Slots.')
        slotNumber++
        slot.sort((a, b) => config.courts.findIndex(court => court.id === a.court) - config.courts.findIndex(court => court.id === b.court))
        for (const { pair, court, referee } of slot) {
          matches.push({ id: matches.length + 1, stage: stage.id, group: pair.group ?? null, a: pair.a, b: pair.b, referee, court, slot: slotNumber, round: pair.round ?? 1, start: time, end: time + config.duration })
          for (const member of [pair.a, pair.b]) played.set(member, played.get(member)! + 1)
        }
        time += block
      }
    }
  }
  if (config.target !== null) {
    const target = config.target
    const rankedMembers = new Set<string>()
    for (const sourceId of qualifiedGroups) {
      const source = prior.get(sourceId)!
      if (source.depth.some(value => value !== source.depth[0])) throw new ScheduleError('Eine exakte Spielzahl pro Rangplatz setzt einheitliche bisherige Spiele in der Quellgruppe voraus.')
      source.group.members.forEach(member => rankedMembers.add(member))
      for (let place = 1; place <= source.group.members.length; place++) {
        const member = rank(sourceId, place)
        if (!played.has(member) && source.depth[0] !== target) throw new ScheduleError(`Rangplatz „${member}“ erreicht die Zielspielzahl ohne weitere Phase nicht.`)
      }
    }
    for (const [member, count] of played) {
      if (!rankedMembers.has(member) && count !== target) throw new ScheduleError(`„${member}“ hat ${count} statt ${target} Spiele. Ändere Gruppen, Zielspielzahl oder Paarungen.`)
    }
    if (matches.length * 2 !== config.teams.length * target) throw new ScheduleError('Die Qualifikationspfade ergeben nicht die geforderte Gesamtzahl an Spielen.')
  }
  const plan = { matches, carry }
  if (matches.length > 1500) throw new ScheduleError('Ein Turnier kann bis zu 1500 Begegnungen enthalten.')
  const issues = validateSchedule(config, plan)
  if (issues.length) throw new ScheduleError(issues.join(' '))
  return plan
}
