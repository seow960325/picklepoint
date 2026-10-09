// Generates supabase/seeds/mc_create.sql: creates MCMD (Men's Doubles) and
// MCXD (Mixed Doubles) with 32 placeholder country teams each, random groups,
// the single round robin in shared-queue order, the empty 16-team bracket and
// the 0026 opt-ins. Run:  node --experimental-strip-types scripts/mc-seed.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { drawGroups, buildBracketSkeleton } from '../src/lib/draw.ts'
import { buildPoolSchedule } from '../src/lib/pool.ts'

// ------------------------------------------------------------ flags (28x20)
const star = (cx, cy, r, rot = -90) => {
  const p = []
  for (let i = 0; i < 10; i++) {
    const a = (rot + i * 36) * Math.PI / 180, rr = i % 2 ? r * 0.382 : r
    p.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`)
  }
  return `<polygon points="${p.join(' ')}"/>`
}
const H3 = (a, b, c) => `<rect width="28" height="20" fill="${b}"/><rect width="28" height="6.67" fill="${a}"/><rect y="13.33" width="28" height="6.67" fill="${c}"/>`
const V3 = (a, b, c) => `<rect width="28" height="20" fill="${b}"/><rect width="9.33" height="20" fill="${a}"/><rect x="18.67" width="9.33" height="20" fill="${c}"/>`
const NORDIC = (bg, cross, inner) => `<rect width="28" height="20" fill="${bg}"/><rect x="8" width="4" height="20" fill="${cross}"/><rect y="8" width="28" height="4" fill="${cross}"/>${inner ? `<rect x="9" width="2" height="20" fill="${inner}"/><rect y="9" width="28" height="2" fill="${inner}"/>` : ''}`

const FLAGS = {
  Malaysia: (() => {
    const h = 20 / 14
    let s = '<rect width="28" height="20" fill="#fff"/>'
    for (let i = 0; i < 14; i += 2) s += `<rect y="${(i * h).toFixed(3)}" width="28" height="${h.toFixed(3)}" fill="#cc0001"/>`
    return s + '<rect width="14" height="11.43" fill="#010066"/><circle cx="5.5" cy="5.7" r="3.3" fill="#ffcc00"/><circle cx="6.8" cy="5.7" r="2.8" fill="#010066"/><g fill="#ffcc00">' + star(10.9, 5.7, 2.2) + '</g>'
  })(),
  Cambodia: '<rect width="28" height="20" fill="#032ea1"/><rect y="5" width="28" height="10" fill="#e00025"/><g fill="#fff"><rect x="8.6" y="12.3" width="10.8" height="1.3"/><rect x="9.8" y="11.1" width="8.4" height="1.2"/><path d="M14 6 L15 9 L15 11 L13 11 L13 9 Z"/><path d="M10.8 8 L11.6 10 L11.6 11 L10 11 L10 10 Z"/><path d="M17.2 8 L18 10 L18 11 L16.4 11 L16.4 10 Z"/></g>',
  Singapore: '<rect width="28" height="20" fill="#fff"/><rect width="28" height="10" fill="#ef3340"/><circle cx="6" cy="5" r="3.4" fill="#fff"/><circle cx="7.3" cy="5" r="3.2" fill="#ef3340"/><g fill="#fff">' + [[9.2, 3.1], [11.1, 4.4], [10.4, 6.6], [8.0, 6.6], [7.3, 4.4]].map(([x, y]) => star(x, y, 0.75)).join('') + '</g>',
  Indonesia: '<rect width="28" height="20" fill="#fff"/><rect width="28" height="10" fill="#ce1126"/>',
  Thailand: '<rect width="28" height="20" fill="#a51931"/><rect y="3.33" width="28" height="13.33" fill="#f4f5f8"/><rect y="6.67" width="28" height="6.67" fill="#2d2a4a"/>',
  Vietnam: '<rect width="28" height="20" fill="#da251d"/><g fill="#ffcd00">' + star(14, 10.4, 6) + '</g>',
  Philippines: '<rect width="28" height="20" fill="#ce1126"/><rect width="28" height="10" fill="#0038a8"/><path d="M0 0 L17.3 10 L0 20 Z" fill="#fff"/><circle cx="5.6" cy="10" r="2.2" fill="#fcd116"/><g fill="#fcd116">' + star(1.8, 2.6, 0.9) + star(1.8, 17.4, 0.9) + star(14, 10, 0.9) + '</g>',
  Japan: '<rect width="28" height="20" fill="#fff"/><circle cx="14" cy="10" r="6" fill="#bc002d"/>',
  China: '<rect width="28" height="20" fill="#ee1c25"/><g fill="#ffff00">' + star(4.7, 5, 3) + star(9.3, 2, 1, -60) + star(11.2, 4, 1, -40) + star(11.2, 7, 1, -90) + star(9.3, 9, 1, -110) + '</g>',
  Laos: '<rect width="28" height="20" fill="#ce1126"/><rect y="5" width="28" height="10" fill="#002868"/><circle cx="14" cy="10" r="4" fill="#fff"/>',
  Myanmar: H3('#fecb00', '#34b233', '#ea2839') + '<g fill="#fff">' + star(14, 11, 7.2) + '</g>',
  Bangladesh: '<rect width="28" height="20" fill="#006a4e"/><circle cx="12.6" cy="10" r="5" fill="#f42a41"/>',
  India: H3('#ff9933', '#fff', '#138808') + '<circle cx="14" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width="0.6"/><circle cx="14" cy="10" r="0.6" fill="#000080"/>',
  France: V3('#002395', '#fff', '#ed2939'),
  Italy: V3('#009246', '#fff', '#ce2b37'),
  Germany: H3('#000', '#dd0000', '#ffce00'),
  Netherlands: H3('#ae1c28', '#fff', '#21468b'),
  Belgium: V3('#000', '#fdda24', '#ef3340'),
  Ireland: V3('#169b62', '#fff', '#ff883e'),
  Austria: H3('#ed2939', '#fff', '#ed2939'),
  Poland: '<rect width="28" height="20" fill="#dc143c"/><rect width="28" height="10" fill="#fff"/>',
  Ukraine: '<rect width="28" height="20" fill="#ffd700"/><rect width="28" height="10" fill="#0057b7"/>',
  Sweden: NORDIC('#006aa7', '#fecc00'),
  Norway: NORDIC('#ba0c2f', '#fff', '#00205b'),
  Denmark: NORDIC('#c8102e', '#fff'),
  Finland: NORDIC('#fff', '#002f6c'),
  Switzerland: '<rect width="28" height="20" fill="#d52b1e"/><rect x="12" y="4" width="4" height="12" fill="#fff"/><rect x="8" y="8" width="12" height="4" fill="#fff"/>',
  Spain: '<rect width="28" height="20" fill="#aa151b"/><rect y="5" width="28" height="10" fill="#f1bf00"/>',
  Greece: (() => {
    let s = '<rect width="28" height="20" fill="#0d5eaf"/>'
    for (let i = 1; i < 9; i += 2) s += `<rect y="${(i * 20 / 9).toFixed(3)}" width="28" height="${(20 / 9).toFixed(3)}" fill="#fff"/>`
    return s + `<rect width="11.1" height="11.1" fill="#0d5eaf"/><rect x="4.44" width="2.22" height="11.1" fill="#fff"/><rect y="4.44" width="11.1" height="2.22" fill="#fff"/>`
  })(),
  Nigeria: V3('#008751', '#fff', '#008751'),
  Brazil: '<rect width="28" height="20" fill="#009c3b"/><path d="M14 2 L26 10 L14 18 L2 10 Z" fill="#ffdf00"/><circle cx="14" cy="10" r="4.3" fill="#002776"/>',
  Argentina: H3('#74acdf', '#fff', '#74acdf') + '<circle cx="14" cy="10" r="2" fill="#f6b40e"/>',
}

const flagUrl = name =>
  'data:image/svg+xml;base64,' + Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 20">${FLAGS[name]}</svg>`).toString('base64')

const COUNTRIES = Object.keys(FLAGS)
if (COUNTRIES.length !== 32) throw new Error(`need 32 flags, have ${COUNTRIES.length}`)

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
