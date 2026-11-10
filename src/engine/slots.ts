import { keyOf, type Match, type Pair, type SearchBudget, type TournamentConfig } from './model.ts'

export type ScheduledPair = Pair & { refs: string[]; lane?: number }
type Assignment = { pair: ScheduledPair; court: string; referee: string | null }

export function pack(
  pairs: ScheduledPair[], config: TournamentConfig, limit: number, budget: SearchBudget, usage: Map<string, number>,
): Assignment[][] | null {
  const courts = config.courts
  const capacity = courts.length
  const slots: Assignment[][] = []
  const needsRef = config.referee !== 'none'
  const left = [...pairs]
  const laneUse = new Map<string, number>()
  const same = (a: ScheduledPair, b: ScheduledPair) => a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b
  const legal = (batch: ScheduledPair[]) => {
    if (!needsRef) return true
    const playing = new Set(batch.flatMap(({ a, b }) => [a, b]))
    return batch.every(pair => pair.refs.some(ref => !playing.has(ref)))
  }

  function assign(batch: ScheduledPair[]): Assignment[] | null {
    const playing = new Set(batch.flatMap(({ a, b }) => [a, b]))
    const busy = new Set<string>()
    const fields = new Set<string>()
    const picked: Assignment[] = []
    function visit(index: number): boolean {
      budget.tick()
      if (index === batch.length) return true
      const pair = batch[index]
      const refs = needsRef ? pair.refs.filter(ref => !playing.has(ref) && !busy.has(ref))
        .sort((a, b) => (usage.get(a) ?? 0) - (usage.get(b) ?? 0)) : [null]
      const court = [...courts].filter(field => !fields.has(field.id))
        .sort((a, b) => {
          const preferred = pair.lane === undefined ? undefined : courts[pair.lane % capacity]?.id
          const aLoad = (laneUse.get(keyOf(pair.a, a.id)) ?? 0) + (laneUse.get(keyOf(pair.b, a.id)) ?? 0)
          const bLoad = (laneUse.get(keyOf(pair.a, b.id)) ?? 0) + (laneUse.get(keyOf(pair.b, b.id)) ?? 0)
          return Number(b.id === preferred) - Number(a.id === preferred) || aLoad - bLoad
        })[0]
      for (const referee of refs) {
        if (referee) busy.add(referee)
        fields.add(court.id)
        picked.push({ pair, court: court.id, referee })
        if (visit(index + 1)) return true
        if (referee) busy.delete(referee)
        fields.delete(court.id)
        picked.pop()
      }
      return false
    }
    return visit(0) ? picked : null
  }

  const count = (map: Map<string, number>, key: string, delta: number) => map.set(key, (map.get(key) ?? 0) + delta)
  function place(remaining: ScheduledPair[]): boolean {
    budget.tick()
    if (!remaining.length) return true
    const open = limit - slots.length
    if (!open || remaining.length > open * capacity) return false
    const previous = new Set(slots.at(-1)?.flatMap(({ pair }) => [pair.a, pair.b]) ?? [])
    const consecutive = (pair: ScheduledPair) => Number(previous.has(pair.a)) + Number(previous.has(pair.b))
    const ordered = [...remaining].sort((a, b) => consecutive(a) - consecutive(b))
    const first = ordered[0]
    const batch = [first]
    const minSize = Math.max(1, remaining.length - (open - 1) * capacity)
    function fill(start: number, size: number): boolean {
      budget.tick()
      if (batch.length === size) {
        const slot = assign(batch)
        if (!slot) return false
        slots.push(slot)
        const update = (delta: number) => {
          for (const { pair, court, referee } of slot) {
            if (referee) count(usage, referee, delta)
            count(laneUse, keyOf(pair.a, court), delta)
            count(laneUse, keyOf(pair.b, court), delta)
          }
        }
        update(1)
        if (place(ordered.filter(pair => !batch.includes(pair)))) return true
        update(-1)
        slots.pop()
        return false
      }
      for (let i = start; i <= ordered.length - (size - batch.length); i++) {
        const pair = ordered[i]
        if (batch.some(other => same(pair, other))) continue
        batch.push(pair)
        if (legal(batch) && fill(i + 1, size)) return true
        batch.pop()
      }
      return false
    }
    for (let size = Math.min(capacity, remaining.length); size >= minSize; size--) {
      if (fill(1, size)) return true
    }
    return false
  }

  return place(left) ? slots : null
}

export function isOccupied(match: Match, member: string) {
  return match.a === member || match.b === member || match.referee === member
}
