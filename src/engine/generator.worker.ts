import { generate } from './generate.ts'
import type { TournamentConfig } from './model.ts'

self.onmessage = (event: MessageEvent<TournamentConfig>) => {
  try { self.postMessage({ plan: generate(event.data) }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Der Spielplan konnte nicht erzeugt werden.' }) }
}
