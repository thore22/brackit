import { keyOf, minutes, readRank, type Plan, type TournamentConfig } from './model.ts'

export function validateSchedule(config: TournamentConfig, plan: Plan): string[] {
  const errors: string[] = []
  const slots = new Map<number, { start: number; occupied: Set<string>; courts: Set<string>; stage: string }>()
  const ids = new Set<number>()
  const paired = new Set<string>()
  const played = new Set<string>()
  const byStage = new Map(config.stages.map((stage, index) => [stage.id, { stage, index }]))
  for (const match of plan.matches) {
    const { id, a, b, court, slot, start, end, referee, group, round } = match
    const context = byStage.get(match.stage)
    const roster = context?.stage.groups.flatMap(group => group.members) ?? []
    const entry = slots.get(slot) ?? { start, occupied: new Set(), courts: new Set(), stage: match.stage }
    const groupMembers = context?.stage.groups.find(item => item.id === group)?.members
    if (!Number.isInteger(id) || ids.has(id)) errors.push(`Ungültige Spielnummer ${id}.`)
    ids.add(id)
    if (!Number.isInteger(slot) || slot < 1 || entry.start !== start || entry.stage !== match.stage) errors.push(`Ungültiger Slot ${slot}.`)
    if (!Number.isInteger(start) || start < minutes(config.start) || end !== start + config.duration || end + config.change > minutes(config.end) ||
        config.breaks.some(pause => start < minutes(pause.end) && end + config.change > minutes(pause.start))) errors.push(`Spiel ${id} liegt außerhalb des Zeitfensters.`)
    if (!config.courts.some(field => field.id === court) || entry.courts.has(court)) errors.push(`Feldkonflikt in Slot ${slot}.`)
    entry.courts.add(court)
    if (!context || a === b || !roster.includes(a) || !roster.includes(b) || (group && (!groupMembers?.includes(a) || !groupMembers.includes(b)))) errors.push(`Ungültige Paarung in Spiel ${id}.`)
    const key = `${match.stage}:${keyOf(a, b)}`
    if (paired.has(key)) errors.push(`Doppelte Paarung in Spiel ${id}.`)
    paired.add(key)
    if (config.referee !== 'none' && !referee) errors.push(`Pfeif-Team fehlt in Spiel ${id}.`)
    if (referee && (!roster.includes(referee) || (config.referee === 'group' && group && !groupMembers?.includes(referee)))) errors.push(`Ungültiges Pfeif-Team in Spiel ${id}.`)
    for (const member of [a, b, referee]) {
      if (!member) continue
      if (entry.occupied.has(member)) errors.push(`Teamkonflikt in Slot ${slot}.`)
      entry.occupied.add(member)
    }
    slots.set(slot, entry)
    if (context?.stage.rounds && group) {
      if (round < 1 || round > context.stage.rounds || !Number.isInteger(round)) errors.push(`Ungültige Runde in Spiel ${id}.`)
      for (const member of [a, b]) {
        const roundKey = `${match.stage}:${round}:${member}`
        if (played.has(roundKey)) errors.push(`Mehrfache Teambelegung in Runde ${round}.`)
        played.add(roundKey)
      }
      if (context.stage.kind === 'balanced' && config.referee === 'group' && plan.matches.some(other =>
        other.stage === match.stage && other.group === group && other.round === round && (other.a === referee || other.b === referee))) {
        errors.push(`Das Pfeif-Team von Spiel ${id} hat in Runde ${round} kein Freilos.`)
      }
    }
  }
  const sorted = [...slots.entries()].sort(([a], [b]) => a - b)
  let last = minutes(config.start)
  let index = -1
  for (const [slot, entry] of sorted) {
    const next = byStage.get(entry.stage)?.index ?? -1
    const stageGap = next !== index ? config.stages[next]?.gap ?? 0 : 0
    if (entry.start < last + stageGap || next < index) errors.push(`Zeit- oder Phasenkonflikt in Slot ${slot}.`)
    last = entry.start + config.duration + config.change
    index = next
  }
  const carried = new Set<string>()
  for (const entry of plan.carry) {
    const group = config.stages.find(stage => stage.groups.some(group => group.id === entry.group))
    const pair = `${group?.id}:${keyOf(entry.a, entry.b)}`
    if (!group || carried.has(pair) || paired.has(pair) || readRank(entry.a)?.group !== entry.source || readRank(entry.b)?.group !== entry.source) errors.push('Ungültige oder wiederholte Ergebnisübernahme.')
    carried.add(pair)
  }
  return [...new Set(errors)]
}
