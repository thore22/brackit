import { rank, type Group, type Match, type Plan, type TournamentConfig } from './model.ts'

export interface Score { a: number; b: number }
export interface Row {
  team: string; games: number; wins: number; draws: number; losses: number
  points: number; average: number; scored: number; conceded: number; quotient: number; difference: number
}
type Game = { a: string; b: string; score: Score }

function hash(value: string) {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}
export function calculateTable(teams: string[], games: Game[], rules: TournamentConfig['rules'], salt: string): Row[] {
  const rows = new Map(teams.map(team => [team, {
    team, games: 0, wins: 0, draws: 0, losses: 0, points: 0, average: 0,
    scored: 0, conceded: 0, quotient: 0, difference: 0,
  }]))
  const add = (row: Row, a: number, b: number) => {
    row.games++
    row.scored += a
    row.conceded += b
    if (a > b) { row.wins++; row.points += rules.win }
    else if (a === b) { row.draws++; row.points += rules.draw }
    else { row.losses++; row.points += rules.loss }
  }
  for (const { a, b, score } of games) {
    const home = rows.get(a)
    const away = rows.get(b)
    if (!home || !away) continue
    add(home, score.a, score.b)
    add(away, score.b, score.a)
  }
  for (const row of rows.values()) {
    row.average = row.games ? row.points / row.games : 0
    row.quotient = row.conceded ? row.scored / row.conceded : row.scored ? Infinity : 0
    row.difference = row.scored - row.conceded
  }
  const entries = [...rows.values()]
  const useAverage = rules.primary === 'average' || (rules.primary === 'auto' && new Set(entries.map(row => row.games)).size > 1)
  const criteria = [useAverage ? 'average' : 'points', ...rules.tie] as const
  function order(block: Row[], index: number): Row[] {
    if (block.length <= 1) return block
    const criterion = criteria[index]
    if (!criterion) return block.sort((a, b) => a.team < b.team ? -1 : a.team > b.team ? 1 : 0)
    const mini = new Map(block.map(row => [row.team, 0]))
    if (criterion === 'headToHead') {
      for (const game of games) {
        if (!mini.has(game.a) || !mini.has(game.b)) continue
        const points = (a: number, b: number) => a === b ? rules.draw : a > b ? rules.win : rules.loss
        mini.set(game.a, mini.get(game.a)! + points(game.score.a, game.score.b))
        mini.set(game.b, mini.get(game.b)! + points(game.score.b, game.score.a))
      }
    }
    const buckets = new Map<number, Row[]>()
    for (const row of block) {
      const value = criterion === 'draw' ? hash(`${salt}/${row.team}`) :
        criterion === 'headToHead' ? mini.get(row.team)! : row[criterion]
      const bucket = buckets.get(value) ?? []
      bucket.push(row)
      buckets.set(value, bucket)
    }
    return [...buckets.keys()].sort((a, b) => b - a).flatMap(key => order(buckets.get(key)!, index + 1))
  }
  return order(entries, 0)
}

export function tournamentTables(config: TournamentConfig, plan: Plan, scores: Map<number, Score>) {
  const seeds = new Map<string, string>()
  const tables = new Map<string, { group: Group; rows: Row[]; complete: boolean }>()
  const resolve = (member: string) => seeds.get(member) ?? member
  const settled = (member: string) => !resolve(member).startsWith('@')
  const game = (match: Match): Game | null => {
    const score = scores.get(match.id)
    return score && settled(match.a) && settled(match.b) ? { a: resolve(match.a), b: resolve(match.b), score } : null
  }
  for (const stage of config.stages) {
    for (const group of stage.groups) {
      const own = plan.matches.filter(match => match.group === group.id)
      const games = own.flatMap(match => game(match) ?? [])
      const imports = plan.carry.filter(carry => carry.group === group.id)
      let used = 0
      for (const carry of imports) {
        if (!settled(carry.a) || !settled(carry.b)) continue
        const members = new Set([resolve(carry.a), resolve(carry.b)])
        const original = plan.matches.find(match => match.group === carry.source && members.has(resolve(match.a)) && members.has(resolve(match.b)))
        const imported = original && game(original)
        if (imported) { games.push(imported); used++ }
      }
      const rows = calculateTable(group.members.map(resolve), games, config.rules, group.id)
      const complete = group.members.every(settled) && own.length > 0 && own.every(match => scores.has(match.id)) && used === imports.length
      if (complete) rows.forEach((row, index) => seeds.set(rank(group.id, index + 1), row.team))
      tables.set(group.id, { group, rows, complete })
    }
  }
  return { tables, seeds, resolve }
}
