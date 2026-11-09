// Generates supabase/seeds/mc_create.sql: creates MCMD (Men's Doubles) and
// MCXD (Mixed Doubles) with 32 placeholder country teams each, random groups,
// the single round robin in shared-queue order, the empty 16-team bracket and
// the 0026 opt-ins. Run:  node --experimental-strip-types scripts/mc-seed.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { drawGroups, buildBracketSkeleton } from '../src/lib/draw.ts'
import { buildPoolSchedule } from '../src/lib/pool.ts'

import { FLAGS, flagUrl, COUNTRIES } from './flags.mjs'

// ------------------------------------------------------------ payloads
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const homes = {}
function payload(code, category) {
  const teams = drawGroups(COUNTRIES, 4)
  const games = buildPoolSchedule(teams, 3, 1)
  homes[code] = games.map(g => [g.sequence, g.homeCourt + 1])
  const bracket = buildBracketSkeleton(16, 3, games.length + 1, true)
  return {
    code, name: `MC Pickleball Championship · ${category}`, venue: '', event_date: today, admin_pin: '0000',
    event: {
      name: category, format: 'groups_ko', target_score: 15, win_by: 1, cap: 15, switch_at: 0,
      serve_mode: 'winner', group_size: 4, advance_per_group: 2, third_place: true,
    },
    courts: [1, 2, 3].map(n => ({ number: n, label: `Court ${n}`, scorer_pin: `000${n}` })),
    teams: teams.map(t => ({ name: t.name, pool: t.pool })),
    matches: games.map(m => ({ a: m.aIdx, b: m.bIdx, court: m.courtIdx, sequence: m.sequence, round: m.label })),
    bracket: bracket.map(m => ({
      key: m.key, round: m.round, sequence: m.sequence,
      next_key: m.nextKey, next_slot: m.nextSlot,
      loser_next_key: m.loserNextKey, loser_next_slot: m.loserNextSlot,
    })),
  }
}
const q = s => `'${s.replace(/'/g, "''")}'`
const opts = partner => `legs = 1, tiebreak = 'diff', ko_target_score = 21, ko_win_by = 1, ko_cap = 21, ko_switch_at = 0, play_clock = true, court_dispatch = 'pool', bracket_preview = true, tv_partner = '${partner}'`
const evOf = code => `(select e.id from events e join competitions c on c.id = e.competition_id where c.code = '${code}')`

const homeSql = code => `update matches m set home_court = c.id
from (values ${homes[code].map(([q, n]) => `(${q}, ${n})`).join(', ')}) as v(seq, n)
join courts c on c.number = v.n and c.competition_id = (select id from competitions where code = '${code}')
where m.event_id = ${evOf(code)} and m.sequence = v.seq;`

const sql = `-- MCMD (Men's Doubles) + MCXD (Mixed Doubles). Run AFTER migration 0026.
-- Admin PIN 0000 · court PINs 0001 / 0002 / 0003 (both codes).
-- 32 placeholder country teams each, random groups of 4, single round robin.
-- Each group has a home court; a team uses at most 2 courts all day.
-- Safe to re-run: it first removes any earlier MCMD / MCXD (test data only).
-- Uploaded photo logos are saved and put back (same team names only).

-- Keep uploaded photo logos across re-runs (matched by competition code + team name).
create table if not exists mc_logo_keep (code text, name text, logo text, primary key (code, name));
alter table mc_logo_keep enable row level security;
delete from mc_logo_keep where code in ('MCMD', 'MCXD');
insert into mc_logo_keep (code, name, logo)
select c.code, t.name, t.logo
from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id
where c.code in ('MCMD', 'MCXD') and t.logo is not null and t.logo not like 'data:image/svg%';

delete from competitions where code in ('MCMD', 'MCXD');

select create_competition_v3(${q(JSON.stringify(payload('MCMD', "Men's Doubles")))}::jsonb) ->> 'code' as created;

select create_competition_v3(${q(JSON.stringify(payload('MCXD', 'Mixed Doubles')))}::jsonb) ->> 'code' as created;

update events set ${opts('MCXD')} where id = ${evOf('MCMD')};

update events set ${opts('MCMD')} where id = ${evOf('MCXD')};

${homeSql('MCMD')}

${homeSql('MCXD')}

update teams t set logo = v.logo
from (values
${COUNTRIES.map(n => `  (${q(n)}, ${q(flagUrl(n))})`).join(',\n')}
) as v(name, logo)
where t.name = v.name and t.event_id in (${evOf('MCMD')}, ${evOf('MCXD')});

update teams t set logo = k.logo
from mc_logo_keep k, events e, competitions c
where e.id = t.event_id and c.id = e.competition_id and c.code = k.code and t.name = k.name
  and c.code in ('MCMD', 'MCXD');

select c.code, e.name, e.legs, e.tiebreak, e.court_dispatch, e.ko_target_score,
       (select count(*) from teams t where t.event_id = e.id) as teams,
       (select count(*) from teams t where t.event_id = e.id and t.logo is not null) as logos,
       (select count(*) from matches m where m.event_id = e.id and m.bracket_key is null) as group_games,
       (select count(*) from matches m where m.event_id = e.id and m.status = 'live') as live_now,
       (select count(*) from matches m where m.event_id = e.id and m.home_court is not null) as with_home_court
from competitions c join events e on e.competition_id = c.id
where c.code in ('MCMD', 'MCXD') order by c.code;
`
mkdirSync('supabase/seeds', { recursive: true })
writeFileSync('supabase/seeds/mc_create.sql', sql)
writeFileSync('/tmp/mc_flags.html', `<body style="background:#222;display:grid;grid-template-columns:repeat(8,1fr);gap:12px;padding:16px;font:12px sans-serif;color:#eee">${COUNTRIES.map(n => `<div><img src="${flagUrl(n)}" style="width:100%;border:1px solid #444"><div>${n}</div></div>`).join('')}</body>`)
console.log('wrote supabase/seeds/mc_create.sql', sql.length, 'bytes')
