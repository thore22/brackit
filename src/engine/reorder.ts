import { type Match, type Plan, ScheduleError, type TournamentConfig } from './model.ts'
import { validateSchedule } from './validate.ts'

export function swapMatches(config: TournamentConfig, plan: Plan, firstId: number, secondId: number): Plan {
  const first = plan.matches.find(match => match.id === firstId)
  const second = plan.matches.find(match => match.id === secondId)
  const stage = config.stages.find(item => item.id === first?.stage)
  if (!first || !second || !stage || first.stage !== second.stage) {
    throw new ScheduleError('Spiele können nur innerhalb derselben Phase getauscht werden.')
  }
  if (first.id === second.id) return plan
  if (stage.placement && first.slot !== second.slot) {
    throw new ScheduleError('Die Platzierungsspiele bleiben in ihrer Reihenfolge. Das Finale findet zuletzt statt.')
  }
  if (stage.rounds && first.round !== second.round) {
    throw new ScheduleError('Tausche Spiele innerhalb derselben logischen Runde.')
  }
  const move = (match: Match, { slot, start, end, court }: Match) => ({ ...match, slot, start, end, court })
  const matches = plan.matches.map(match =>
    match.id === firstId ? move(match, second) : match.id === secondId ? move(match, first) : match)

  for (const slot of new Set([first.slot, second.slot])) {
    const batch = matches.filter(match => match.slot === slot)
    const players = batch.flatMap(match => [match.a, match.b])
    const playing = new Set(players)
    if (playing.size !== players.length) throw new ScheduleError(`Ein Team würde in Slot ${slot} gleichzeitig zweimal spielen.`)
    if (config.stages[1]?.placement && stage === config.stages[0]) {
      const [a, b] = stage.groups
      const balance = (games: Match[]) => Math.abs(games.reduce((sum, game) =>
        sum + (game.group === a.id ? 1 : game.group === b.id ? -1 : 0), 0))
      if (balance(batch) > balance(plan.matches.filter(match => match.slot === slot))) {
        throw new ScheduleError(`Der Tausch würde die Gruppen in Slot ${slot} ungleich verteilen.`)
      }
    }
    if (config.referee === 'none') continue
    const candidates = new Map(batch.map(match => {
      const group = config.referee === 'group' ? stage.groups.find(item => item.id === match.group) : undefined
      const inRound = group && stage.rounds && stage.kind === 'balanced'
        ? new Set(matches.filter(other => other.stage === stage.id && other.group === group.id && other.round === match.round)
          .flatMap(other => [other.a, other.b])) : undefined
      const available = (group?.members ?? stage.groups.flatMap(item => item.members))
        .filter(team => !playing.has(team) && !inRound?.has(team))
        .sort((a, b) => Number(b === match.referee) - Number(a === match.referee))
      return [match.id, available]
    }))
    const assignments = new Map<string, number>()
    function assign(id: number, seen: Set<string>): boolean {
      for (const team of candidates.get(id) ?? []) {
        if (seen.has(team)) continue
        seen.add(team)
        const current = assignments.get(team)
        if (current === undefined || assign(current, seen)) {
          assignments.set(team, id)
          return true
        }
      }
      return false
    }
    if (!batch.every(match => assign(match.id, new Set()))) {
      throw new ScheduleError(`Nach dem Tausch fehlen freie Pfeif-Teams in Slot ${slot}.`)
    }
    for (const [team, id] of assignments) {
      const match = batch.find(item => item.id === id)!
      matches[matches.indexOf(match)] = { ...match, referee: team }
    }
  }
  const updated = { ...plan, matches }
  const issues = validateSchedule(config, updated)
  if (issues.length) throw new ScheduleError(issues[0])
  return updated
}
