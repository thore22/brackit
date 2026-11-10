import type { GameState } from '../engine/game.ts'
import type { Plan, TournamentConfig } from '../engine/model.ts'
import type { Score } from '../engine/standings.ts'

export type TournamentStatus = 'draft' | 'published' | 'archived'
export interface Tournament {
  id: string; revision: number; configurationVersion: number; state: TournamentStatus; released: number
  admin: boolean; config: TournamentConfig; plan: Plan; games: GameState[]
  serverNow: string; seeds: Record<string, string>
}
export interface TournamentSummary { id: string; name: string; date: string; state: TournamentStatus }
export type GameAction = 'start' | 'pause' | 'resume' | 'regular' | 'live' | 'submit' | 'confirm' | 'reject' | 'correct'
export type ControlAction = 'publish' | 'release' | 'archive'
export interface GameCommand { game: number; version: number; request: string; action: GameAction; score?: Score }
export interface Invitation { token: string; pin: string; expires: string }
export interface AuditEntry { action: string; match_id: number | null; created_at: string; payload: Record<string, unknown> }
export const final = (game: GameState) => game.status === 'confirmed' || game.status === 'corrected'
