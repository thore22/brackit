import { describe, expect, it } from 'vitest'
import { generate } from './generate.ts'
import { volleyball, emptyTournament } from './template.ts'
import { keyOf, rank } from './model.ts'
import { validateSchedule } from './validate.ts'
import { calculateTable, tournamentTables } from './standings.ts'
import { countdown, emptyGame, scheduledEpoch } from './game.ts'

describe('Volleyballvorlage', () => {
  const config = volleyball('2027-06-12')
  const plan = generate(config)
  it('plant 49 Begegnungen und die Mittagspause in genau 25 Slots', () => {
    expect(config.teams).toHaveLength(14)
    expect(plan.matches).toHaveLength(49)
    expect(plan.matches.filter(match => match.stage === 'vorrunde')).toHaveLength(18)
    expect(plan.matches.filter(match => match.stage === 'hauptrunde')).toHaveLength(31)
    expect(new Set(plan.matches.map(match => match.slot)).size).toBe(25)
    expect(plan.matches.find(match => match.slot === 9)?.start).toBe(12 * 60 + 24)
    expect(plan.matches.find(match => match.slot === 10)?.start).toBe(13 * 60 + 27)
    expect(plan.matches.at(-1)).toMatchObject({ slot: 25, start: 17 * 60 + 57, end: 18 * 60 + 12, a: rank('d', 1), b: rank('c', 3), group: null })
    expect(validateSchedule(config, plan)).toEqual([])
    expect(generate(config)).toEqual(plan)
  })
  it('verteilt Gold und Silber auf fünf Runden mit einem rundenfreien Schiedsgericht', () => {
    for (const [group, court] of [['gold', 'feld-1'], ['silber', 'feld-2']]) {
      const games = plan.matches.filter(match => match.group === group)
      expect(games).toHaveLength(15)
      for (let round = 1; round <= 5; round++) {
        const batch = games.filter(match => match.round === round)
        expect(batch).toHaveLength(3)
        expect(new Set(batch.flatMap(match => [match.a, match.b])).size).toBe(6)
        expect(new Set(batch.map(match => match.referee)).size).toBe(1)
        expect(batch.every(match => match.court === court)).toBe(true)
      }
    }
  })
  it('löst Rangplätze, übernimmt sechs Spiele und zählt je realem Team sieben Begegnungen', () => {
    const scores = new Map(plan.matches.map(match => [match.id, { a: 25 + match.id, b: 12 }]))
    const { resolve, tables } = tournamentTables(config, plan, scores)
    const history = plan.matches.map(match => keyOf(resolve(match.a), resolve(match.b)))
    expect(new Set(history).size).toBe(49)
    expect(new Set(tables.get('gold')!.rows.map(row => row.team))).toEqual(new Set(config.stages[1].groups[0].members.map(resolve)))
    expect(new Set(tables.get('silber')!.rows.map(row => row.team))).toEqual(new Set(config.stages[1].groups[1].members.map(resolve)))
    expect(plan.carry.map(carry => keyOf(carry.a, carry.b)).sort()).toEqual([
      '@a/1|@a/2', '@a/3|@a/4', '@b/1|@b/2', '@b/3|@b/4', '@c/1|@c/2', '@d/2|@d/3',
    ])
    for (const team of config.teams) expect(history.filter(pair => pair.split('|').includes(team.id))).toHaveLength(7)
    for (const group of ['gold', 'silber']) expect(tables.get(group)!.rows.reduce((sum, row) => sum + row.games, 0)).toBe(36)
  })
  it('meldet fehlendes Crossover, fehlende Slots und konfliktbehaftete Korrekturen', () => {
    const invalid = structuredClone(config)
    invalid.stages[1].extras = []
    expect(() => generate(invalid)).toThrow(/31 neue Team-Einsätze/)
    expect(() => generate({ ...config, end: '18:14' })).toThrow(/mindestens 25 Slots/)
    const modified = structuredClone(plan)
    modified.matches[0].referee = modified.matches[0].a
    expect(validateSchedule(config, modified)).toContain('Teamkonflikt in Slot 1.')
  })
})

describe('Weitere Formate', () => {
  it.each([[8, 2, 4, 12], [10, 1, 5, 9], [12, 3, 4, 8], [16, 4, 4, 7]])('%i Teams, %i Felder', (count, fields, size, duration) => {
    const config = emptyTournament()
    config.teams = Array.from({ length: count }, (_, i) => ({ id: `t${i}`, name: `Team ${i}` }))
    config.courts = Array.from({ length: fields }, (_, i) => ({ id: `f${i}`, name: `Feld ${i}` }))
    config.stages[0].groups = Array.from({ length: count / size }, (_, i) => ({
      id: `g${i}`, name: `Gruppe ${i}`, members: config.teams.slice(i * size, (i + 1) * size).map(team => team.id),
    }))
    config.duration = duration
    config.target = size - 1
    const plan = generate(config)
    expect(plan.matches).toHaveLength(count * (size - 1) / 2)
    expect(validateSchedule(config, plan)).toEqual([])
  })
  it('plant manuell definierte Begegnungen und erkennt ungültige Parität', () => {
    const config = emptyTournament()
    const stage = config.stages[0]
    stage.kind = 'manual'
    stage.extras = stage.groups.flatMap(group => [0, 2].map(index => ({ a: group.members[index], b: group.members[index + 1], group: group.id })))
    config.target = 1
    expect(generate(config).matches).toHaveLength(4)
    config.teams.pop()
    expect(() => generate(config)).toThrow(/ungerade/)
  })
  it('setzt feste Runden für manuelle Begegnungen um und färbt freie Begegnungen ein', () => {
    const config = emptyTournament()
    const stage = config.stages[0]
    stage.kind = 'manual'
    stage.rounds = 2
    stage.extras = stage.groups.flatMap(group => [
      { a: group.members[0], b: group.members[1], group: group.id, round: 2 },
      { a: group.members[0], b: group.members[2], group: group.id },
    ])
    const plan = generate(config)
    expect(plan.matches.map(match => match.round)).toEqual([1, 1, 2, 2])
    expect(plan.matches.filter(match => match.round === 2).map(match => match.b)).toEqual(['team-2', 'team-6'])
  })
})

it('berechnet Quoten, Punkte pro Spiel und direkte Vergleiche in einer Gleichstandsgruppe', () => {
  const rules = volleyball().rules
  const games = [{ a: 'a', b: 'b', score: { a: 15, b: 0 } }, { a: 'a', b: 'c', score: { a: 10, b: 15 } }]
  const rows = calculateTable(['a', 'b', 'c', 'd'], games, rules, 'test')
  expect(rows.map(row => row.team)).toEqual(['c', 'a', 'd', 'b'])
  expect(rows[1]).toMatchObject({ average: 1, points: 2, quotient: 25 / 15 })
  expect(calculateTable(['a', 'b'], games.slice(0, 1), rules, 'test')[0].quotient).toBe(Infinity)
  expect(calculateTable(['b', 'a'], games.slice(0, 1), { ...rules, win: 0, tie: ['scored'] }, 'test')[0].team).toBe('a')
  expect(calculateTable(['b', 'a'], games.slice(0, 1), { ...rules, win: 0, tie: ['difference'] }, 'test')[0].team).toBe('a')
  const headToHead = [
    { a: 'b', b: 'a', score: { a: 20, b: 10 } },
    { a: 'b', b: 'c', score: { a: 10, b: 20 } },
    { a: 'a', b: 'd', score: { a: 20, b: 10 } },
  ]
  expect(calculateTable(['a', 'b', 'c', 'd'], headToHead, { ...rules, tie: ['headToHead'] }, 'test').map(row => row.team)).toEqual(['c', 'b', 'a', 'd'])
})

it('berechnet einen synchronisierten Countdown mit Pause und Zusatzpunkt', () => {
  const started = '2027-06-12T08:00:00Z'
  const state = { ...emptyGame(1), started }
  expect(scheduledEpoch('2027-06-12', 600, 'Europe/Berlin')).toBe(Date.parse(started))
  expect(countdown({ ...state, paused: '2027-06-12T08:05:00Z' }, 15, Date.parse(started) + 900000).seconds).toBe(600)
  expect(countdown(state, 15, Date.parse(started) + 900000)).toEqual({ seconds: 0, label: 'Spielzeit abgelaufen' })
  expect(countdown({ ...state, regularEnded: started, extra: true }, 15, Date.parse(started)).label).toBe('Entscheidender Zusatzpunkt')
})
