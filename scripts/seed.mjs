/* Seed a demo competition into your Supabase project.
   Usage:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run seed        */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (service_role, not anon).')
  process.exit(1)
}
const sb = createClient(url, key, { auth: { persistSession: false } })

const TEAMS = [
  'Smash Bros', 'Dink Dynasty', 'Net Ninjas', 'Kitchen Kings',
  'Paddle Pop', 'Third Shot Heroes', 'Lob Squad', 'Volley Llamas',
  'Ernie & Bert', 'Backhand Bandits', 'Puchong Pickle', 'Selangor Slice',
]

const ins = async (table, rows) => {
  const { data, error } = await sb.from(table).insert(rows).select()
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

const [comp] = await ins('competitions', [{
  name: 'Puchong Open 2026', venue: 'IOI Mall Courts', status: 'live', admin_pin: '9999',
}])

const [ev] = await ins('events', [{
  competition_id: comp.id, name: 'Mixed Doubles', format: 'round_robin',
  target_score: 15, win_by: 2, cap: 17, switch_at: 8,
}])

const courts = await ins('courts', Array.from({ length: 6 }, (_, i) => ({
  competition_id: comp.id, number: i + 1, label: `Court ${i + 1}`,
  scorer_pin: String(i + 1).padStart(4, '0'),
})))

const teams = await ins('teams', TEAMS.map((name, i) => ({
  event_id: ev.id, name, pool: i < 6 ? 'A' : 'B',
})))

const matches = []
for (let i = 0; i < 6; i++) {
  matches.push({
    event_id: ev.id, court_id: courts[i].id, round: 'Group', sequence: i + 1,
    team_a_id: teams[i].id, team_b_id: teams[i + 6].id, status: 'live',
  })
}
for (let i = 0; i < 6; i++) {
  matches.push({
    event_id: ev.id, court_id: courts[i].id, round: 'Group', sequence: i + 7,
    team_a_id: teams[(i + 1) % 12].id, team_b_id: teams[(i + 5) % 12].id, status: 'scheduled',
  })
}
await ins('matches', matches)

console.log(`
Seeded.
  Join code   ${comp.code}
  Admin PIN   9999
  Court PINs  0001 … 0006 (court number, zero-padded)
`)
