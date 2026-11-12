// Generates supabase/migrations/0051_yc26_timetable.sql: group games with printed slot, court and play order
// for the four YC26 pickleball / badminton categories (12 Nov 2026 plan). Run: node scripts/yc26-plan.mjs
import { writeFileSync } from 'node:fs'

let seed = 20261114
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

// ---- fixtures of one pool, two legs, in a play order with as few back-to-back games as possible
const ORDER4 = [[[1, 2], [3, 4], [1, 3], [2, 4], [1, 4], [2, 3]], [[1, 4], [2, 3], [1, 2], [3, 4], [2, 4], [1, 3]]]
const ORDER3 = [[[1, 2], [1, 3], [2, 3]], [[1, 3], [1, 2], [2, 3]]]
const pairsOf = size => (size === 4 ? ORDER4 : ORDER3).flat().map(p => p.slice())
const pool4 = ['A', 'B', 'C', 'D']

// one court per pool, one game per slot (pickleball; badminton mixed)
function oneCourtPerPool(code, sizes, courts, slots) {
  const rows = []
  sizes.forEach((sz, pi) => {
    pairsOf(sz).forEach(([i, j], k) => rows.push({ code, pool: pool4[pi], i, j, slot: slots[k], court: courts[pi] }))
  })
  return rows
}

// badminton men's: 4 + 4 + 3 + 3 teams on 4 courts, 9 slots of exactly 4 games, each pair twice
function badmintonMen(code, courts) {
  const sizes = [4, 4, 3, 3], SL = 9, PER = 4
  const games = []
  sizes.forEach((sz, pi) => {
    const pr = pairsOf(sz), half = pr.length / 2
    pr.forEach(([i, j], k) => games.push({ pool: pool4[pi], pi, i, j, leg: k < half ? 1 : 2, key: `${pool4[pi]}${i}${j}` }))
  })
  const team = (g, t) => `${g.pool}${t}`
  const slotOf = games.map((_, n) => Math.floor(n / PER))
  // start: any assignment filling every slot with 4 games, then anneal
  const order = games.map((_, n) => n).sort(() => rnd() - 0.5)
  order.forEach((g, n) => { slotOf[g] = Math.floor(n / PER) })
  const cost = () => {
    let c = 0
    const play = new Map()
    games.forEach((g, n) => { for (const t of [team(g, g.i), team(g, g.j)]) { if (!play.has(t)) play.set(t, []); play.get(t).push(slotOf[n]) } })
    for (const [, s] of play) {
      s.sort((x, y) => x - y)
      for (let k = 1; k < s.length; k++) { if (s[k] === s[k - 1]) c += 1000; else if (s[k] === s[k - 1] + 1) c += 20 }
      const gaps = s.slice(1).map((v, k) => v - s[k] - 1); const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
      c += gaps.reduce((a, g) => a + (g - mean) ** 2, 0) * 1
    }
    games.forEach((g, n) => { if (g.leg === 2) { const first = games.findIndex(x => x.key === g.key && x.leg === 1); if (slotOf[n] <= slotOf[first]) c += 400 } })
    return c
  }
  let cur = cost(), best = cur, bestSl = slotOf.slice()
  for (let it = 0, T = 25; it < 3000000; it++, T = Math.max(0.3, T * 0.999998)) {
    const a = Math.floor(rnd() * games.length), b = Math.floor(rnd() * games.length)
    if (slotOf[a] === slotOf[b]) continue
    ;[slotOf[a], slotOf[b]] = [slotOf[b], slotOf[a]]
    const nc = cost()
    if (nc <= cur || rnd() < Math.exp((cur - nc) / T)) { cur = nc; if (cur < best) { best = cur; bestSl.splice(0, bestSl.length, ...slotOf) } } else [slotOf[a], slotOf[b]] = [slotOf[b], slotOf[a]]
  }
  games.forEach((_, n) => { slotOf[n] = bestSl[n] })
  if (best >= 1000) throw new Error('no clean badminton schedule, cost ' + best)
  games.forEach((g, n) => { if (g.leg === 2) { const first = games.findIndex(x => x.key === g.key && x.leg === 1); if (slotOf[n] <= slotOf[first]) throw new Error('leg order ' + g.key) } })
  // courts: each pool prefers its own court, otherwise the next free one
  const rows = []
  for (let s = 0; s < SL; s++) {
    const inSlot = games.map((g, n) => ({ g, n })).filter(x => slotOf[x.n] === s).sort((x, y) => x.g.pi - y.g.pi)
    const free = courts.slice()
    for (const { g } of inSlot) {
      const want = courts[g.pi]
      const c = free.includes(want) ? want : free[0]
      free.splice(free.indexOf(c), 1)
      rows.push({ code, pool: g.pool, i: g.i, j: g.j, slot: s + 1, court: c, leg: g.leg })
    }
  }
  return rows
}

const sched = [
  ...oneCourtPerPool('PBMD', [4, 4], [2, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  ...oneCourtPerPool('PBXD', [4], [1], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  ...badmintonMen('BMMD', [2, 3, 4, 5]),
  // mixed: 3 + 3 teams, courts 6 and 7, six games each spread over the same 9 slots (rest after every second game)
  ...oneCourtPerPool('BMXD', [3, 3], [6, 7], [1, 2, 4, 5, 7, 8]),
]
// play order: by slot, then court
const seqs = new Map()
sched.sort((a, b) => a.code.localeCompare(b.code) || a.slot - b.slot || a.court - b.court)
sched.forEach(r => { const n = (seqs.get(r.code) ?? 0) + 1; seqs.set(r.code, n); r.seq = n })

// ---- checks: nobody twice in a slot; counts; second meeting after the first
for (const code of ['PBMD', 'PBXD', 'BMMD', 'BMXD']) {
  const rs = sched.filter(r => r.code === code)
  const bySlot = new Map()
  for (const r of rs) for (const t of [`${r.pool}${r.i}`, `${r.pool}${r.j}`]) {
    const k = `${r.slot}:${t}`; if (bySlot.has(k)) throw new Error(`${code} team ${t} twice in slot ${r.slot}`); bySlot.set(k, 1)
  }
  const courtSlot = new Set(); for (const r of rs) { const k = `${r.slot}/${r.court}`; if (courtSlot.has(k)) throw new Error(`${code} court clash ${k}`); courtSlot.add(k) }
  let b2b = 0; const per = new Map()
  for (const r of rs) for (const t of [`${r.pool}${r.i}`, `${r.pool}${r.j}`]) { if (!per.has(t)) per.set(t, []); per.get(t).push(r.slot) }
  for (const [, s] of per) { s.sort((a, b) => a - b); for (let k = 1; k < s.length; k++) if (s[k] === s[k - 1] + 1) b2b++ }
  console.log(code, rs.length, 'games, last slot', Math.max(...rs.map(r => r.slot)), 'back-to-back', b2b)
}

// ---- SQL
const CODES = ['BMMD', 'BMXD', 'PBMD', 'PBXD']
const guards = { PBMD: 'A:4,B:4', PBXD: 'A:4', BMMD: 'A:4,B:4,C:3,D:3', BMXD: 'A:3,B:3' }
const kos = {
  BMMD: { 'Quarter-final': [2, 3, 4, 5], Playoff: [2, 3], 'Semi-final': [2, 3], 'Third place': [2], Final: [2] },
  BMXD: { 'Quarter-final': [6, 7], Playoff: [6, 7], 'Semi-final': [6, 7], 'Third place': [6], Final: [6] },
  PBMD: { 'Semi-final': [2, 3], 'Third place': [2], Final: [2] },
  PBXD: { 'Third place': [1], Final: [1] },
}
const courtsOf = { BMMD: [2, 3, 4, 5], BMXD: [6, 7], PBMD: [2, 3], PBXD: [1] }
const sportOf = { BMMD: 'badminton', BMXD: 'badminton', PBMD: 'pickleball', PBXD: 'pickleball' }
const inList = `('${CODES.join("','")}')`
const L = []
L.push(`-- =====================================================================
-- PicklePoint 0051: YC26 printed timetable (12 Nov 2026 plan).
--  * courts get the real venue numbers (badminton men's 2-5, mixed 6-7; pickleball men's 2-3, mixed 1)
--  * group games are played twice, with a printed slot, court and play order (scripts/yc26-plan.mjs)
--  * Captain Ball court is shown as Court 2
-- Run BEFORE any group game is played. It stops with an error (and changes nothing) if a
-- category does not have the group sizes below. After this, do NOT press "Regenerate schedule":
-- use the random group draw (fixtures and times stay).
-- =====================================================================
begin;
`)
for (const c of CODES) {
  L.push(`-- guard ${c}: group sizes must be ${guards[c]}
select 1 / (case when (select string_agg(pool || ':' || n, ',' order by pool) from (select t.pool, count(*) n from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code = '${c}' group by t.pool) q) = '${guards[c]}' then 1 else 0 end) as group_sizes_ok_${c};`)
}
L.push(`
-- old group games first (courts are renumbered next), then courts: real numbers
delete from matches m using events e, competitions c
 where m.event_id = e.id and e.competition_id = c.id and c.code in ${inList} and m.bracket_key is null and m.status = 'scheduled';
update courts set number = number + 100 where competition_id in (select id from competitions where code in ${inList});`)
for (const c of CODES) {
  const cs = courtsOf[c]
  L.push(`update courts x set number = q.n, label = 'Court ' || q.n, sport = '${sportOf[c]}'
  from (select id, (array[${cs.join(',')}])[row_number() over (order by number)] as n from courts
         where competition_id = (select id from competitions where code = '${c}')) q
 where x.id = q.id and q.n is not null;
delete from courts where competition_id = (select id from competitions where code = '${c}') and number >= 100;
insert into courts (competition_id, number, label, sport)
select (select id from competitions where code = '${c}'), n, 'Court ' || n, '${sportOf[c]}' from unnest(array[${cs.join(',')}]) as n
 where not exists (select 1 from courts where competition_id = (select id from competitions where code = '${c}') and number = n);`)
}
L.push(`update courts set scorer_pin = case sport when 'badminton' then '0001' else '0003' end, scorer_fail_count = 0, scorer_locked_until = null
 where competition_id in (select id from competitions where code in ${inList});
update courts set label = 'Court 2' where sport = 'captainball' and competition_id in (select id from competitions where code = 'YC26');

-- events: pairs meet twice, shared queue in printed order
update events set legs = 2, court_dispatch = 'pool', pool_strict = true
 where format = 'groups_ko' and competition_id in (select id from competitions where code in ${inList});

`)
L.push(`-- group games: printed slot / court / order\nwith sched(code, pool, i, j, slot, court, seq) as (values
${sched.map(r => `  ('${r.code}','${r.pool}',${r.i},${r.j},${r.slot},${r.court},${r.seq})`).join(',\n')}
), pos as (
  select t.id, t.event_id, c.code, t.pool, row_number() over (partition by t.event_id, t.pool order by t.id) as p
    from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code in ${inList}
)
insert into matches (event_id, round, sequence, team_a_id, team_b_id, status, home_court, slot)
select a.event_id, 'Group ' || s.pool || ' · Round robin', s.seq, a.id, b.id, 'scheduled', ct.id, s.slot
  from sched s
  join pos a on a.code = s.code and a.pool = s.pool and a.p = s.i
  join pos b on b.code = s.code and b.pool = s.pool and b.p = s.j
  join courts ct on ct.competition_id = (select id from competitions where code = s.code) and ct.number = s.court;
`)
const plan = []
for (const [c, rs] of Object.entries(kos)) for (const [r, cs] of Object.entries(rs)) cs.forEach((n, i) => plan.push(`  ('${c}','${r}',${i},${n})`))
L.push(`-- knockout courts by round (bracket keys are looked up from the bracket itself)
with plan(code, rnd, idx, court) as (values
${plan.join(',\n')}
), rk as (
  select m.event_id, c.code, m.bracket_key, m.round,
         row_number() over (partition by m.event_id, m.round order by m.sequence) - 1 as idx
    from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
   where m.bracket_key is not null and c.code in ${inList}
), j as (
  select rk.event_id, rk.bracket_key, p.court from rk join plan p on p.code = rk.code and p.rnd = rk.round and p.idx = rk.idx
)
update events e set ko_court_plan = (select jsonb_object_agg(j.bracket_key, j.court) from j where j.event_id = e.id)
 where e.id in (select event_id from j);

-- first games on court
select _pool_dispatch(e.id) from events e join competitions c on c.id = e.competition_id where c.code in ${inList} and e.court_dispatch = 'pool';

commit;

-- check: expected games 24 / 12 / 36 / 12
select c.code, count(*) filter (where m.bracket_key is null) as group_games, count(distinct m.slot) as slots
  from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
 where c.code in ${inList} group by c.code order by c.code;`)
writeFileSync('supabase/migrations/0051_yc26_timetable.sql', L.join('\n') + '\n')
console.log('written', L.join('\n').length, 'chars')
