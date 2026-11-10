// Generates the SQL for the Christmas Outreach Pickleball Fundraiser
// (14 Nov 2026), exactly as the organiser's latest plan:
//   MCMD Men's Doubles  15 teams, 5 pools of 3, double round robin, Courts 1-3
//                       (even slots: Courts 1-2, Court 3 rests),
//                       QF W1vR3 W4vW5 W3vR1 W2vR2 (5 winners + 3 best runners-up)
//   MCXD Mixed Doubles  24 teams, 6 pools of 4, single round robin, Courts 4-6,
//                       QF W1vR2 W4vW5 W3vW6 W2vR1 (6 winners + 2 best runners-up)
// Group games and quarter-finals to 15 (sudden death); semi-finals, 3rd place
// and Final to 21 (sudden death). Courts follow the printed slots (0039).
// Outputs: supabase/seeds/xmas_create.sql   both categories from scratch
//          supabase/seeds/xmas_md15.sql     rebuild MCMD only (keeps registered
//                                           teams), printed slots for MCXD
// Run:  node --experimental-strip-types scripts/xmas-seed.mjs   (needs 0038 + 0039)
import { writeFileSync } from 'node:fs'
import { flagUrl, COUNTRIES } from './flags.mjs'

const MD_SLOTS = ['A12 B12 C12', 'D12 E12', 'A13 B13 C13', 'D13 E13', 'A23 B23 C23', 'D23 E23']
export const MD = {
  code: 'MCMD', category: "Men's Doubles", partner: 'MCXD', courts: [1, 2, 3], legs: 2,
  pools: { A: 3, B: 3, C: 3, D: 3, E: 3 },
  slots: [...MD_SLOTS, ...MD_SLOTS],
  // QF1-3 slot 13 on Courts 1/2/3, QF4 slot 14 behind QF1; SF/3rd/Final on Court 1
  koCourts: { 'KO-8-0': 1, 'KO-8-1': 2, 'KO-8-2': 3, 'KO-8-3': 1, 'KO-4-0': 1, 'KO-4-1': 1, 'KO-3P': 1, 'KO-2-0': 1 },
}
export const MX = {
  code: 'MCXD', category: 'Mixed Doubles', partner: 'MCMD', courts: [4, 5, 6], legs: 1,
  pools: { A: 4, B: 4, C: 4, D: 4, E: 4, F: 4 },
  slots: ['B12 D13 E23', 'A24 C13 D24', 'B13 E14 F24', 'A14 C23 D23', 'B34 E34 F23', 'A12 D12 E12',
          'A34 C24 F14', 'B23 D14 E24', 'A23 B14 C14', 'E13 F12 F34', 'A13 B24 D34', 'C12 C34 F13'],
  // QF1-3 slot 13 on Courts 4/5/6, QF4 slot 14 behind QF1; SF/3rd/Final on Court 4
  koCourts: { 'KO-8-0': 4, 'KO-8-1': 5, 'KO-8-2': 6, 'KO-8-3': 4, 'KO-4-0': 4, 'KO-4-1': 4, 'KO-3P': 4, 'KO-2-0': 4 },
}

/** Teams in pool order (A1, A2 … E3) and every group game in printed order. */
export function build(cfg, names) {
  const teams = []
  const at = {}
  for (const [pool, n] of Object.entries(cfg.pools)) for (let i = 1; i <= n; i++) {
    at[pool + i] = teams.length
    teams.push({ name: names[teams.length], pool })
  }
  const perLeg = cfg.slots.length / cfg.legs
  const games = []
  cfg.slots.forEach((slot, s) => slot.split(' ').forEach((g, c) => {
    const leg = Math.floor(s / perLeg) + 1
    const [x, y] = [at[g[0] + g[1]], at[g[0] + g[2]]]
    const [a, b] = leg % 2 ? [x, y] : [y, x]
    games.push({
      a, b, slot: s + 1, court: cfg.courts[c], sequence: games.length + 1,
      round: cfg.legs > 1 ? `Group ${g[0]} · Leg ${leg}` : `Group ${g[0]} · Round Robin`,
    })
  }))
  const seq = games.length + 1
  const ko = (key, round, sequence, nextKey, nextSlot, loserKey = null, loserSlot = null) =>
    ({ key, round, sequence, next_key: nextKey, next_slot: nextSlot, loser_next_key: loserKey, loser_next_slot: loserSlot })
  // play order on the knockout courts: QF1-4, SF1, SF2, 3rd place, Final
  const bracket = [
    ko('KO-8-0', 'Quarter-final', seq, 'KO-4-0', 'a'), ko('KO-8-1', 'Quarter-final', seq + 1, 'KO-4-0', 'b'),
    ko('KO-8-2', 'Quarter-final', seq + 2, 'KO-4-1', 'a'), ko('KO-8-3', 'Quarter-final', seq + 3, 'KO-4-1', 'b'),
    ko('KO-4-0', 'Semi-final', seq + 4, 'KO-2-0', 'a', 'KO-3P', 'a'), ko('KO-4-1', 'Semi-final', seq + 5, 'KO-2-0', 'b', 'KO-3P', 'b'),
    ko('KO-3P', 'Third place', seq + 6, null, null), ko('KO-2-0', 'Final', seq + 7, null, null),
  ]
  return { teams, games, bracket }
}

const q = s => `'${s.replace(/'/g, "''")}'`
const evOf = code => `(select e.id from events e join competitions c on c.id = e.competition_id where c.code = '${code}')`

function category(cfg, names) {
  const { teams, games, bracket } = build(cfg, names)
  const placed = new Set()
  const payload = {
    code: cfg.code, name: `Christmas Outreach · ${cfg.category}`, venue: "The Kitch'n Club Kota Damansara",
    event_date: '2026-11-14', admin_pin: '0000',
    event: {
      name: cfg.category, format: 'groups_ko', target_score: 15, win_by: 1, cap: 15, switch_at: 0,
      serve_mode: 'winner', group_size: Math.max(...Object.values(cfg.pools)), advance_per_group: 2, third_place: true,
    },
    courts: cfg.courts.map(n => ({ number: n, label: `Court ${n}`, scorer_pin: String(n).padStart(4, '0') })),
    teams: teams.map(t => ({ name: t.name, pool: t.pool })),
    // first game of each court starts on it; the rest wait in the court's queue
    matches: games.map(g => {
      const first = !placed.has(g.court); placed.add(g.court)
      return { a: g.a, b: g.b, court: first ? cfg.courts.indexOf(g.court) : -1, sequence: g.sequence, round: g.round }
    }),
    bracket,
  }
  const opts = `legs = ${cfg.legs}, tiebreak = 'diff_only', ko_target_score = 21, ko_win_by = 1, ko_cap = 21, ko_switch_at = 0,
  ko_from_sf = true, ko_final_only = false, final_best_of = 1, play_clock = true, court_dispatch = 'pool', pool_strict = true,
  bracket_preview = true, tv_partner = '${cfg.partner}', ko_court_plan = ${q(JSON.stringify(cfg.koCourts))}::jsonb`
  const home = `update matches m set home_court = c.id, slot = v.slot
from (values ${games.map(g => `(${g.sequence}, ${g.court}, ${g.slot})`).join(', ')}) as v(seq, n, slot)
join courts c on c.number = v.n and c.competition_id = (select id from competitions where code = '${cfg.code}')
where m.event_id = ${evOf(cfg.code)} and m.sequence = v.seq;`
  return { cfg, teams, games, sql: {
    create: `select create_competition_v3(${q(JSON.stringify(payload))}::jsonb) ->> 'code' as created;`,
    opts: `update events set ${opts}\nwhere id = ${evOf(cfg.code)};`,
    home,
    // printed slots only (existing code, nothing else changes)
    slots: `update matches m set slot = v.slot
from (values ${games.map(g => `(${g.sequence}, ${g.slot})`).join(', ')}) as v(seq, slot)
where m.event_id = ${evOf(cfg.code)} and m.sequence = v.seq and m.bracket_key is null;`,
  } }
}

const md = category(MD, COUNTRIES.slice(0, 15))
const mx = category(MX, COUNTRIES.slice(8, 32))
const flags = (codes, names) => `update teams t set logo = v.logo
from (values
${names.map(n => `  (${q(n)}, ${q(flagUrl(n))})`).join(',\n')}
) as v(name, logo)
where t.name = v.name and t.logo is null and t.event_id in (${codes.map(evOf).join(', ')});`
const check = `select c.code, e.name, e.legs, e.tiebreak, e.court_dispatch, e.pool_strict, e.ko_from_sf, e.ko_target_score,
       (select count(*) from teams t where t.event_id = e.id) as teams,
       (select count(*) from matches m where m.event_id = e.id and m.bracket_key is null) as group_games,
       (select count(*) from matches m where m.event_id = e.id and m.bracket_key is not null) as ko_games,
       (select count(*) from matches m where m.event_id = e.id and m.slot is not null) as with_slot,
       (select count(*) from matches m where m.event_id = e.id and m.status = 'live') as live_now,
       (select string_agg(number::text, ',' order by number) from courts k where k.competition_id = c.id) as courts
from competitions c join events e on e.competition_id = c.id
where c.code in ('MCMD', 'MCXD') order by c.code;`

const keepLogos = codes => `create table if not exists mc_logo_keep (code text, name text, logo text, primary key (code, name));
alter table mc_logo_keep enable row level security;
delete from mc_logo_keep where code in (${codes.map(q).join(', ')});
insert into mc_logo_keep (code, name, logo)
select c.code, t.name, t.logo
from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id
where c.code in (${codes.map(q).join(', ')}) and t.logo is not null and t.logo not like 'data:image/svg%';`
const putLogos = codes => `update teams t set logo = k.logo
from mc_logo_keep k, events e, competitions c
where e.id = t.event_id and c.id = e.competition_id and c.code = k.code and t.name = k.name
  and c.code in (${codes.map(q).join(', ')});`

const create = `-- Christmas Outreach Pickleball Fundraiser, 14 Nov 2026 (generated by scripts/xmas-seed.mjs)
-- Run AFTER migrations 0038 and 0039. Front page for everyone: /c/MC26 (referees: /c/MC26/referee).
--   MCMD Men's Doubles  15 teams, 5 pools of 3, double round robin, Courts 1-3 (PIN 0001-0003)
--   MCXD Mixed Doubles  24 teams, 6 pools of 4, single round robin, Courts 4-6 (PIN 0004-0006)
-- Admin PIN 0000 (both). Groups + quarter-finals to 15, semi-finals / 3rd / Final to 21 (sudden death).
-- Ranking: wins, then point difference, then coin toss. Courts follow the printed slots.
-- Safe to re-run BEFORE the event: it removes the earlier MCMD / MCXD (all their teams, codes and results).

${keepLogos(['MCMD', 'MCXD'])}

delete from competitions where code in ('MCMD', 'MCXD');

${md.sql.create}

${mx.sql.create}

${md.sql.opts}

${mx.sql.opts}

${md.sql.home}

${mx.sql.home}

${flags(['MCMD', 'MCXD'], [...new Set([...md.teams, ...mx.teams].map(t => t.name))])}

${putLogos(['MCMD', 'MCXD'])}

${check}
`

// MCMD rebuilt for 15 teams; teams that already registered (have players)
// are put back, in registration order, into the new team slots.
const md15 = `-- Men's Doubles is now 15 teams in 5 pools of 3 (plan of 10 Nov 2026). Run AFTER 0038 and 0039.
-- Rebuilds MCMD only (registered teams are kept: name, players, picture; their 4-digit team codes
-- must be generated again in Settings -> Teams). MCXD keeps everything and only gets its printed slots.

create table if not exists mc_reg_keep (n int primary key, name text, player1 text, player2 text, logo text);
alter table mc_reg_keep enable row level security;
delete from mc_reg_keep;
insert into mc_reg_keep (n, name, player1, player2, logo)
select row_number() over (order by t.pool, t.id), t.name, t.player1, t.player2, t.logo
from teams t where t.event_id = ${evOf('MCMD')} and t.player1 is not null;

delete from competitions where code = 'MCMD';

${md.sql.create}

${md.sql.opts}

${md.sql.home}

update teams t set name = k.name, player1 = k.player1, player2 = k.player2, logo = k.logo
from (select id, row_number() over (order by pool, id) as n from teams where event_id = ${evOf('MCMD')}) s,
     mc_reg_keep k
where t.id = s.id and s.n = k.n;

${flags(['MCMD'], md.teams.map(t => t.name))}

${mx.sql.slots}

${check}
`
if (process.argv[1]?.endsWith('xmas-seed.mjs')) {
  writeFileSync('supabase/seeds/xmas_create.sql', create)
  writeFileSync('supabase/seeds/xmas_md15.sql', md15)
  console.log('wrote supabase/seeds/xmas_create.sql', create.length, 'and xmas_md15.sql', md15.length)
}
