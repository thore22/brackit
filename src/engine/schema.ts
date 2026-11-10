import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9_-]{1,48}$/)
const seed = z.string().regex(/^(?:[a-z0-9_-]{1,48}|@[a-z0-9_-]{1,48}\/[1-9]\d*)$/)
const name = z.string().trim().min(1).max(100)
const named = z.object({ id, name })
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const tie = z.enum(['quotient', 'difference', 'headToHead', 'scored', 'draw'])
export const configSchema = z.object({
  name, sport: z.string().trim().max(60).optional(), date: z.iso.date(), timezone: z.string().refine(value => {
    try { new Intl.DateTimeFormat('de', { timeZone: value }); return true } catch { return false }
  }, 'Unbekannte Zeitzone'),
  teams: z.array(named).min(2).max(80), courts: z.array(named).min(1).max(16),
  stages: z.array(named.extend({
    kind: z.enum(['roundRobin', 'balanced', 'manual']),
    groups: z.array(named.extend({ members: z.array(seed).min(2).max(32) })).min(1).max(32),
    rounds: z.number().int().min(0).max(80),
    gap: z.number().int().min(0).max(240), carry: z.boolean(),
    extras: z.array(z.object({ a: seed, b: seed, group: id.optional(), round: z.number().int().positive().max(80).optional() })).max(400),
  })).min(1).max(10),
  start: time, end: time, duration: z.number().int().min(1).max(180), change: z.number().int().min(0).max(120),
  breaks: z.array(z.object({ start: time, end: time })).max(20),
  target: z.number().int().min(1).max(80).nullable(),
  referee: z.enum(['group', 'available', 'none']),
  rules: z.object({
    win: z.number().int().min(0).max(100), loss: z.number().int().min(0).max(100), draw: z.number().int().min(0).max(100),
    allowDraw: z.boolean(), autoConfirm: z.boolean(), primary: z.enum(['total', 'average', 'auto']),
    tie: z.array(tie).max(5).refine(items => new Set(items).size === items.length, 'Kriterien dürfen nicht doppelt vorkommen'),
  }),
})
