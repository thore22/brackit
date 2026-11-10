import { keyOf, ScheduleError, type Pair, type SearchBudget } from './model.ts'

export function allPairs(members: string[]): Pair[] {
  return members.flatMap((a, i) => members.slice(i + 1).map(b => ({ a, b })))
}

export function chooseDegrees(
  members: string[], allowed: Pair[], demand: number[], budget: SearchBudget,
  accept: (pairs: Pair[]) => boolean,
): boolean {
  const keys = new Set(allowed.map(pair => keyOf(pair.a, pair.b)))
  const picked: Pair[] = []
  const candidates = (vertex: number) => members
    .map((_, index) => index)
    .filter(index => index !== vertex && demand[index] > 0 && keys.has(keyOf(members[vertex], members[index])))
    .sort((a, b) => demand[b] - demand[a] || a - b)

  function visit(): boolean {
    budget.tick()
    const remaining = members.map((_, index) => index).filter(index => demand[index] > 0)
      .map(index => ({ index, neighbors: candidates(index) }))
      .sort((a, b) => a.neighbors.length - demand[a.index] - (b.neighbors.length - demand[b.index]))
    if (remaining.length === 0) return accept(picked)
    if (remaining.some(({ index, neighbors }) => neighbors.length < demand[index])) return false
    const { index, neighbors } = remaining[0]
    const required = demand[index]
    demand[index] = 0
    function connect(start: number, count: number): boolean {
      budget.tick()
      if (!count) return visit()
      for (let i = start; i <= neighbors.length - count; i++) {
        const other = neighbors[i]
        demand[other]--
        picked.push({ a: members[index], b: members[other] })
        if (connect(i + 1, count - 1)) return true
        picked.pop()
        demand[other]++
      }
      return false
    }
    const found = connect(0, required)
    demand[index] = required
    return found
  }
  return visit()
}

export function roundColor(members: string[], pairs: Pair[], count: number, budget: SearchBudget, needsBye = false): Pair[] | null {
  const limit = Math.floor((members.length - Number(needsBye)) / 2)
  if (pairs.length > count * limit) return null
  const lanes = Array.from({ length: count }, () => new Set<string>())
  const rounds = Array<number>(pairs.length).fill(-1)
  const free = ({ a, b }: Pair, used: Set<string>) => used.size < 2 * limit && !used.has(a) && !used.has(b)
  let fixed = 0
  for (const [index, pair] of pairs.entries()) {
    if (pair.round === undefined) continue
    const lane = lanes[pair.round - 1]
    if (!lane || !free(pair, lane)) return null
    lane.add(pair.a)
    lane.add(pair.b)
    rounds[index] = pair.round
    fixed++
  }
  function visit(depth: number): boolean {
    budget.tick()
    if (depth === pairs.length) return true
    const next = pairs.map((pair, index) => ({ index, options: lanes.flatMap((lane, i) => free(pair, lane) ? [i] : []) }))
      .filter(({ index }) => rounds[index] < 0)
      .sort((a, b) => a.options.length - b.options.length)[0]
    const { a, b } = pairs[next.index]
    const ordered = next.options.sort((i, j) => lanes[i].size - lanes[j].size || i - j)
    for (const index of ordered) {
      const lane = lanes[index]
      const empty = lane.size === 0
      rounds[next.index] = index + 1
      lane.add(a)
      lane.add(b)
      if (visit(depth + 1)) return true
      lane.delete(a)
      lane.delete(b)
      rounds[next.index] = -1
      if (empty) break
    }
    return false
  }
  if (!visit(fixed)) return null
  return pairs.map((pair, index) => ({ ...pair, round: rounds[index] }))
}

export function roundRobin(members: string[], count: number, budget: SearchBudget): Pair[] {
  const pairs = allPairs(members)
  if (count) {
    const colored = roundColor(members, pairs, count, budget)
    if (!colored) throw new ScheduleError(`Eine Gruppe mit ${members.length} Teams benötigt mindestens ${members.length - (members.length % 2 === 0 ? 1 : 0)} logische Runden.`)
    return colored
  }
  const ring: (string | null)[] = [...members]
  if (ring.length % 2) ring.push(null)
  const ordered: Pair[] = []
  for (let round = 1; round < ring.length; round++) {
    for (let index = 0; index < ring.length / 2; index++) {
      const a = ring[index]
      const b = ring[ring.length - 1 - index]
      if (a && b) ordered.push({ a, b, round })
    }
    ring.splice(1, 0, ring.pop()!)
  }
  return ordered
}
