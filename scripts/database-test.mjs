import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { generate } from '../src/engine/generate.ts'
import { volleyball } from '../src/engine/template.ts'
import { tournamentTables } from '../src/engine/standings.ts'

const db = new PGlite({ extensions: { pgcrypto } })
const user = randomUUID()
const referee = randomUUID()
const directory = new URL('../supabase/migrations/', import.meta.url)
const config = volleyball('2027-06-12')
const plan = generate(config)
let tour
const query = async (sql, values = []) => (await db.query(sql, values)).rows
const one = async (sql, ...values) => (await query(sql, values))[0]?.v
async function actor(role, id = '', anonymous = false) {
  await db.exec('reset role')
  await query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ is_anonymous: anonymous })])
  await db.exec(`set role ${role}`)
}
const save = (id, rev, draft = plan) => one('select public.cup_save_plan($1,$2,$3,$4) v', id, rev, config, draft)
const read = () => one('select public.cup_read($1) v', tour)
const control = async (action) => one('select public.cup_control($1,$2,$3) v', tour, (await read()).revision, action)
const game = (id, rev, action, a = null, b = null, request = randomUUID()) =>
  one('select public.cup_game($1,$2,$3,$4,$5,$6,$7) v', tour, id, rev, request, action, a, b)

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    create publication supabase_realtime;
  `)
  await query('insert into auth.users values ($1),($2)', [user, referee])
  for (const file of (await readdir(directory)).sort()) {
    await db.exec(await readFile(new URL(file, directory), 'utf8'))
    console.log('Migration geprüft:', file)
  }
  await actor('authenticated', user)
  tour = await save(null, null)
  await save(tour, (await read()).revision)
  assert.equal((await read()).configurationVersion, 2)
  const badPlan = structuredClone(plan)
  badPlan.matches[0].referee = badPlan.matches[0].a
  await assert.rejects(() => save(tour, 3, badPlan), /unique constraint/)
  assert.equal((await read()).configurationVersion, 2)
  await actor('anon')
  await assert.rejects(read, /nicht verfügbar/)
  await actor('authenticated', user)
  await control('publish')
  const move = async (ref) => one('select public.cup_move($1,1,$2,$3,1,$4) v', tour, (await read()).revision, 'feld-1', ref)
  await assert.rejects(() => move('team-1'), /bereits belegt/)
  await move('team-3')
  assert.equal((await read()).plan.matches[0].referee, 'team-3')
  await assert.rejects(() => control('release'), /zuerst alle/)
  const invitation = await one('select public.cup_issue_ref($1,1) v', tour)
  await game(1, 0, 'start')
  await game(1, 1, 'pause')
  await game(1, 2, 'resume')
  await game(1, 3, 'regular')
  await actor('anon')
  assert.equal((await read()).games[0].extra, true)
  await assert.rejects(() => game(1, 4, 'submit', 1, 0), /permission denied/)
  await actor('authenticated', referee, true)
  await assert.rejects(() => save(null, null), /Administratorkonto/)
  await assert.rejects(() => game(1, 4, 'live', 1, 0), /Schreibzugang/)
  assert.equal(await one('select public.cup_redeem_ref($1,1,$2,$3) v', tour, invitation.token, '00000000' === invitation.pin ? '11111111' : '00000000'), false)
  assert.equal(await one('select public.cup_redeem_ref($1,1,$2,$3) v', tour, invitation.token, invitation.pin), true)
  await assert.rejects(() => game(2, 0, 'live', 1, 0), /Schreibzugang/)
  await assert.rejects(() => game(1, 4, 'submit', 2, 0), /genau ein Team/)
  const request = randomUUID()
  assert.equal(await game(1, 4, 'submit', 1, 0, request), 5)
  assert.equal(await game(1, 4, 'submit', 1, 0, request), 5)
  assert.equal((await read()).games[0].official, null)
  await assert.rejects(() => game(1, 4, 'submit', 0, 1), /Versionskonflikt/)
  await assert.rejects(() => game(1, 5, 'confirm'), /Schreibzugang/)
  await assert.rejects(() => query('update public.matches set status = $1', ['confirmed']), /permission denied/)
  await actor('authenticated', user)
  await game(1, 5, 'confirm')
  await game(1, 6, 'correct', 16, 14)
  for (const match of plan.matches.slice(1)) {
    if (match.id === 19) await control('release')
    await game(match.id, 0, 'start')
    if (match.id === 19) await assert.rejects(() => game(1, 7, 'correct', 17, 14), /Folgephase/)
    await game(match.id, 1, 'submit', 20 + match.id % 4, 15 + match.id % 5)
    await game(match.id, 2, 'confirm')
  }
  const snapshot = await read()
  const scores = new Map(snapshot.games.map(state => [state.id,state.official]))
  assert.equal(scores.size, 49)
  assert.deepEqual(snapshot.seeds, Object.fromEntries(tournamentTables(config, plan, scores).seeds))
  await control('archive')
  await actor('anon')
  assert.equal((await read()).state, 'archived')
  console.log('49 Spiele abgeschlossen. Rollen, Versionen, QR-PIN, Zusatzpunkt, Freigabe, Qualifikation und Archiv geprüft.')
} catch (error) {
  console.error(error.message, error.detail ?? '', error.where ?? '')
  process.exitCode = 1
} finally {
  await db.close()
}
