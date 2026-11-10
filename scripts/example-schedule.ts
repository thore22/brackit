import { readFileSync, writeFileSync } from 'node:fs'
import { generate } from '../src/engine/generate.ts'
import { volleyball } from '../src/engine/template.ts'
import { clock, participantLabel } from '../src/engine/model.ts'

const config = volleyball('2027-06-12')
const plan = generate(config)
const rows = plan.matches.map(match => {
  const stage = config.stages.find(stage => stage.id === match.stage)!
  const phase = match.group === null ? 'Crossover' : stage.name
  return `| ${match.id} | ${match.slot} | ${clock(match.start)}–${clock(match.end)} | ${config.courts.find(court => court.id === match.court)!.name} | ${phase} | ${match.round} | ${participantLabel(config, match.a)} | ${participantLabel(config, match.b)} | ${participantLabel(config, match.referee)} | Geplant |`
})
const file = new URL('../docs/example-schedule.md', import.meta.url)
const matrix = [
  '# Volleyball Cup · Spielplanmatrix', '',
  'Generiert mit `pnpm matrix`. 49 Begegnungen in 25 Slots. Mittagspause 12:42–13:27 Uhr. Die Zeitspanne je Zeile bezeichnet die reguläre Spielzeit. Der letzte Slot endet einschließlich Wechselzeit um 18:15 Uhr.', '',
  '| Spiel | Slot | Spielzeit | Spielfeld | Phase | Runde | Team 1 | Team 2 | Pfeif-Team | Status |',
  '| ---: | ---: | --- | --- | --- | ---: | --- | --- | --- | --- |', ...rows, '',
].join('\n')
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== matrix) {
    throw new Error('Die gespeicherte Spielplanmatrix weicht von der validierten Vorlage ab. Führe pnpm matrix aus.')
  }
} else writeFileSync(file, matrix)
