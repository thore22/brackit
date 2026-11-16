import { rank, readRank, type Match, type Stage } from './model.ts'
import type { Score } from './standings.ts'

export function placementStage(source: Stage, id: string, gap = 0): Stage {
  const [first, second] = source.groups
  const count = Math.min(first?.members.length ?? 0, second?.members.length ?? 0)
  const extras = Array.from({ length: count }, (_, index) => ({
    a: rank(first.id, index + 1), b: rank(second.id, index + 1),
  }))
  return {
    id, gap, name: 'Platzierungsspiele', kind: 'manual', placement: true, rounds: 0, carry: false, extras,
    groups: extras.map(({ a, b }, index) => ({
      id: `${id}-${index + 1}`, name: `Platz ${2 * index + 1} / ${2 * index + 2}`, members: [a, b],
    })),
  }
}

export const placementRank = (match: Match) => readRank(match.a)!.place

export function placementResult(match: Match, score?: Score | null) {
  if (!score || score.a === score.b) return null
  return score.a > score.b ? { winner: match.a, loser: match.b } : { winner: match.b, loser: match.a }
}
