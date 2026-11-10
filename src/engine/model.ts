export type Tiebreak = 'quotient' | 'difference' | 'headToHead' | 'scored' | 'draw'
export type RefereeRule = 'group' | 'available' | 'none'
export interface Named { id: string; name: string }
export interface Group extends Named { members: string[] }
export interface Pair { a: string; b: string; group?: string; round?: number }
export interface Stage extends Named {
  kind: 'roundRobin' | 'balanced' | 'manual'
  groups: Group[]
  rounds: number
  gap: number
  carry: boolean
  extras: Pair[]
}
export interface TournamentConfig {
  name: string
  sport?: string
  date: string
  timezone: string
  teams: Named[]
  courts: Named[]
  stages: Stage[]
  start: string
  end: string
  duration: number
  change: number
  breaks: { start: string; end: string }[]
  target: number | null
  referee: RefereeRule
  rules: {
    win: number; loss: number; draw: number; allowDraw: boolean; autoConfirm: boolean
    primary: 'total' | 'average' | 'auto'; tie: Tiebreak[]
  }
}
export interface Match {
  id: number
  stage: string
  group: string | null
  a: string
  b: string
  referee: string | null
  court: string
  slot: number
  round: number
  start: number
  end: number
}
export interface Carry { group: string; source: string; a: string; b: string }
export interface Plan { matches: Match[]; carry: Carry[] }
export const rank = (group: string, place: number) => `@${group}/${place}`
export function readRank(value: string) {
  const match = /^@([a-z0-9_-]+)\/([1-9]\d*)$/.exec(value)
  return match ? { group: match[1], place: Number(match[2]) } : null
}
export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
export const clock = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
export const keyOf = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`
export function participantLabel(config: TournamentConfig, id: string | null) {
  if (!id) return '—'
  const seed = readRank(id)
  if (seed) return `${seed.place}. ${config.stages.flatMap(stage => stage.groups).find(group => group.id === seed.group)?.name ?? seed.group}`
  return config.teams.find(team => team.id === id)?.name ?? id
}

export class ScheduleError extends Error {}
export class SearchBudget {
  private steps = 0
  tick() {
    if (++this.steps > 450_000) throw new ScheduleError('Das Suchlimit wurde erreicht. Mehr Zeit, kleinere Gruppen oder weniger feste Runden erleichtern die Planung.')
  }
}
