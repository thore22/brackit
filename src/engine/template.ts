import { rank, type TournamentConfig } from './model.ts'

export function volleyball(date = new Date().toLocaleDateString('sv-SE')): TournamentConfig {
  const teams = Array.from({ length: 14 }, (_, i) => ({ id: `team-${i + 1}`, name: `Team ${String(i + 1).padStart(2, '0')}` }))
  const [a1, a2, a3, a4] = [1, 2, 3, 4].map(i => rank('a', i))
  const [b1, b2, b3, b4] = [1, 2, 3, 4].map(i => rank('b', i))
  const [c1, c2, c3] = [1, 2, 3].map(i => rank('c', i))
  const [d1, d2, d3] = [1, 2, 3].map(i => rank('d', i))
  return {
    name: 'Volleyball Cup', sport: 'Volleyball', date, timezone: 'Europe/Berlin',
    teams, courts: [{ id: 'feld-1', name: 'Feld 1' }, { id: 'feld-2', name: 'Feld 2' }],
    start: '10:00', end: '18:15', duration: 15, change: 3, breaks: [{ start: '12:42', end: '13:27' }],
    target: 7, referee: 'group',
    rules: { win: 2, loss: 0, draw: 1, allowDraw: false, autoConfirm: false, primary: 'auto', tie: ['quotient', 'difference', 'headToHead', 'scored', 'draw'] },
    stages: [
      {
        id: 'vorrunde', name: 'Vorrunde', kind: 'roundRobin', rounds: 0, gap: 0, carry: false, extras: [],
        groups: [
          { id: 'a', name: 'Gruppe A', members: teams.slice(0, 4).map(team => team.id) },
          { id: 'b', name: 'Gruppe B', members: teams.slice(4, 8).map(team => team.id) },
          { id: 'c', name: 'Gruppe C', members: teams.slice(8, 11).map(team => team.id) },
          { id: 'd', name: 'Gruppe D', members: teams.slice(11).map(team => team.id) },
        ],
      },
      {
        id: 'hauptrunde', name: 'Hauptrunde', kind: 'balanced', rounds: 5, gap: 0, carry: true,
        groups: [
          { id: 'gold', name: 'Gold-Gruppe', members: [a1, b1, c1, d1, a2, b2, c2] },
          { id: 'silber', name: 'Silber-Gruppe', members: [d2, a3, b3, c3, d3, a4, b4] },
        ],
        extras: [{ a: d1, b: c3 }],
      },
    ],
  }
}

export function emptyTournament(): TournamentConfig {
  const { stages, teams, ...config } = volleyball()
  return {
    ...config, name: 'Neues Turnier', sport: '', target: null, breaks: [], referee: 'available',
    teams: teams.slice(0, 8),
    stages: [{ ...stages[0], groups: stages[0].groups.slice(0, 2) }],
  }
}
