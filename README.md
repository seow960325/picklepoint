# PicklePoint

Pickleball tournament scoring. Six courts scored on six phones, one live board.

## Run it now (no backend needed)

```
npm install
npm run dev
```

Windows PowerShell, from the unzipped folder:

```powershell
npm install; npm run dev -- --host
```

Open the app, click **open the demo competition** (code `PICKLE`). The demo
backend lives in `localStorage` and fans changes out over `BroadcastChannel`,
so open the live board in one tab and `/c/PICKLE/court/1` in another and you
get the real multi-device behaviour. Court PIN = court number, zero-padded
(`0001` … `0006`).

## Setting up a real competition

**+ NEW COMPETITION** on the home screen opens the setup page. Two formats:

**Round Robin** — the default. Competition name, venue, date, event/category;
winning score, win-by, hard cap and switch-ends (presets for 11 / 15 / 21, or
any number by hand — an unreachable cap is refused); how many courts, each
court's 4-digit scorer PIN, and the admin PIN; team names one per line, split
into 1–4 pools. Generates a circle-method draw inside each pool, spread across
the courts so no team is ever booked on two at once.

**Team Battle** — two sides face off (countries, companies, colors — anything),
e.g. the Cambodia vs Malaysia format: every court hosts a pod of 2 teams from
each side, playing the 4 cross-games where each side's team meets the other
side's team once (nobody plays a teammate). Each game's winner scores one point
for their **side**, not their team — the final result is total games won,
summed across every pod, with total points scored as the tiebreak. Both sides
must have equal, even squad sizes (2 teams per pod). More pods than courts just
queues extra pods on the same court.

Either way it hands you the join code, the admin PIN and every court PIN on
one screen.

Everything stays editable afterwards from **Settings** on the live board (admin PIN):

| Tab | What you can change |
|---|---|
| Competition | name, venue; shows the join code and admin PIN |
| Scoring | event name, winning score, win-by, cap, switch-ends, and (Team Battle) the two side names — applies to matches already in progress |
| Teams | rename, re-pool or re-side, add, remove (a team with a finished match is protected) |
| Courts | scorer PINs; changing one signs out the device currently scoring that court |
| Schedule | regenerate the draw — locked once any point has been scored |

## Wire it to Supabase

1. Create a project, then run the migrations in `supabase/migrations/` **in
   order** (0001 → 0004) in the SQL editor.
2. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
3. Optional — seed a demo competition instead of using the setup page:
   `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run seed`
4. `npm run dev`. The demo backend switches itself off as soon as real env vars exist.

## How access works

- **Competition code** (6 chars) — anyone with it sees the schedule and live scores. Read-only.
- **Court PIN** (4 digits, one per court) — unlocks the tap-to-score screen for that court only.
- **Admin PIN** — score overrides, written to `audit_log`.

No accounts, no passwords. All writes go through `SECURITY DEFINER` RPCs;
there are no anon write policies on any table.

## The scoring screen

Landscape only — a top-down court fills the screen and the two court halves
**are** the buttons. The referee taps the side of the court the point was won
on, exactly as they are looking at it. Portrait shows a rotate prompt (with an
escape hatch) because the halves get too small to hit reliably.

- Tap the left or right half — one tap, one point, to the team **physically on that side**.
- **UNDO** reverts the last point. Deliberately not double-tap: a fast referee
  double-taps a real point and the score silently goes backwards.
- At `switch_at` (8 for a game to 15) a full-screen **SWITCH ENDS** banner appears
  and the button-to-team mapping inverts, because the players have physically
  swapped. Undoing back below 8 puts the ends back.
- Game ends at `target_score` with `win_by`, or at the `cap`. The result is not
  saved until someone hits **CONFIRM** on the both-teams check screen.
- Screen Wake Lock is held while scoring. Haptic + click on every tap.
- The live board shows the same court graphic per court, six up in a 3x2 grid,
  so a glance at the TV reads like looking at the venue.

## Offline

Court WiFi drops. Every mutation carries a `client_event_id`, is applied
optimistically, and is queued in `localStorage` if the request fails. The queue
flushes on `online` and every 5s. The server ignores duplicate
`client_event_id`s, so replay is idempotent. The header shows `⚠ n queued`
whenever anything is unsent.

## Tests

```
npm test
```

Covers the parts that are easy to get wrong: side-to-team mapping, the single
switch at the halfway score, win-by-2, the cap, undo restoring orientation, the
round-robin draw generator (everyone plays everyone once, nobody is
double-booked in a round, pools stay separate, byes are dropped), and the Team
Battle draw + tally (every cross-pairing exactly once, no same-side games,
pods queue correctly onto fewer courts than pods, games-won tallies per side
with points as the tiebreak).

The SQL side has its own suites — run them against any Postgres with all four
migrations applied:

```
psql -f supabase/tests/rpc_test.sql      # scoring, switch ends, undo, idempotent replay
psql -f supabase/tests/admin_test.sql    # setup, admin edits, and every guard
```

(Team Battle's SQL path reuses `create_competition` / `admin_update_event` /
`admin_upsert_team` — covered by the same two suites plus `tests/duel.test.mjs`
on the JS side.)

## Not built yet

Knockout brackets (`next_match_id` / `next_slot` are in the schema and
`confirm_match` already propagates the winner — only the bracket builder UI is
missing), player check-in, CSV export, multi-event UI, EN/BM/中文.
