# PicklePoint — UI layout rules (master)

Read this before changing any screen. Every rule here fixed a real bug that
came back more than once. Then run the layout audit (bottom of this file)
before pushing.

Test every list with three kinds of names at once: one letter (`q`, `7` —
real YC2626 data), very long English (`Kelab Pickleball Seri Kembangan
United Elite`), and Chinese (`蒲种匹克球俱乐部精英队`).

## Rows that should line up (schedules, results, tables)

1. **Fixed grid tracks, never flex + flex-1 next to a variable cell.** If a
   row is `flex` with a `flex-1` names column and a status cell whose text
   changes ("0–0" vs "A · R1 · MD2"), the names column changes width every
   row and the names / "vs" drift sideways. Use CSS grid with a fixed width
   for every non-name column (`grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_auto]`).
   Admin schedule lists use `components/ScheduleRow.tsx` — reuse it.
2. **`minmax(0,1fr)`, never bare `1fr`, in arbitrary grid columns.** A bare
   `1fr` track grows to fit a long team name and pushes the score / "vs" off
   centre. Write `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`.
3. **Any cell that can hold a team name:** `min-w-0` on the cell and
   `truncate` on the text span.
4. **Phones (< 640 px):** when a row has names plus more than two small
   columns, move the secondary text (status, round) to a second line under
   the names instead of squeezing the names (see `ScheduleRow`).

## Buttons, tabs, pills, labels

5. Buttons, tabs, chips and pills get `whitespace-nowrap`, plus `shrink-0`
   inside flex rows. `Pill` already does this. Two buttons side by side on a
   phone: secondary `shrink-0`, primary `max-sm:flex-1`.
6. A user-named label next to fixed controls (court name + PIN + Save): the
   label column is `min-w-0 flex-1` with a `truncate` line, the controls are
   `shrink-0`. Never a fixed `w-24` for a name.
7. Card header "label … pill": `flex justify-between gap-2`, label
   `min-w-0 truncate whitespace-nowrap`.
8. Big display headings must fit a 360 px phone on one line
   (`text-2xl sm:text-3xl`), or the two-line break must be designed.
9. Short status lines that list several people ("Champion / Runner-up /
   3rd") are a label + value grid, not one sentence that wraps mid-phrase.

## Forms

10. Stepper grids: `grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]`. A
    Stepper is 136 px wide; `sm:grid-cols-4` squeezes it inside the Settings
    column on iPad.
11. Team-name fields use `GrowInput` (from `components/form.tsx`): it wraps a
    long name instead of hiding it; Enter finishes.

## Tap targets

12. Everything tappable is at least 30 px in both directions: tabs and chips
    `py-2`, arrow buttons `h-8 w-8`, icon buttons padded to `h-8 w-8 p-1.5`.
    Underlined secondary text links are the only exception.

## Multi-sport (YC2626)

13. Each sport keeps one colour everywhere (`SPORT_TONE` in
    `lib/multisport.ts`: blue = pickleball, green = badminton, matching the
    court art). Use it for sport-specific UI; don't hard-code lime.

## TV mode

14. On the TV/"big" display, never truncate a team name to a sliver — there's
    room to spare and the audience needs to read it. Use `line-clamp-2
    break-words` instead of `truncate`, and `items-start` (not
    `items-center`) on the row so a logo/badge sitting beside a two-line name
    aligns to its top line. Admin/compact views still truncate — this is a
    TV-only rule.

## The layout audit — run before every push that touches UI

`scripts/layout-audit/audit.mjs` opens every screen (lobby, quick play,
wizard, owner, board tabs, TV panes, scorer, match detail, every Settings
tab, multi-sport group → semis → final → champions) on 34 device profiles
(iPhone SE/15/Pro Max, Android small/Pixel, iPad mini/Air/Pro 11/Pro 13,
Android tablets, desktops 1024–1920, and the 639/640, 767/768, 1023/1024,
1279/1280 breakpoint edges; phones and tablets in portrait and landscape).

It reports page overflow, off-screen elements, short text that wrapped,
cut-off input values, names squeezed to nothing, **ragged columns** (rows
whose cells don't line up — rule 1), small tap targets and JS errors.

How Claude runs it (cloud sandbox, never on the live database, never on the
device repo):

1. Copy the repo source into a throwaway sandbox dir (never the device repo
   or the real working tree), `npm ci`,
   `npm i -D playwright @fontsource/barlow-condensed @fontsource/cinzel`.
2. In that throwaway copy only, add a small temporary patch so demo mode can
   render the YC2626 multi-sport fixtures at every stage:
   - `src/lib/mockmulti.ts` (sandbox-only file, hostile fixtures: one-letter
     names, 40+ char names, Chinese names) exporting `mockMulti(code)` for
     codes `YC2626` (group stage), `YCSF` (semis in progress), `YCFIN`
     (final live), `YCWIN` (champion decided).
   - In `src/lib/api.ts`, route `IS_DEMO && code.startsWith('YC')` to
     `mockMulti()` instead of the normal demo join. This is safe to test
     with because it's already nested inside `IS_DEMO` (no Supabase
     credentials configured) — a production build always has real
     credentials, so `IS_DEMO` is `false` and this branch can never run
     there regardless. Even so, **never commit this patch** — it exists
     only in the sandbox copy, for this one audit run, and gets discarded
     with the sandbox.
   - Then `npx vite build --outDir /tmp/auditdist` and
     `npx vite preview --outDir /tmp/auditdist --port 4600`.
3. `node scripts/layout-audit/audit.mjs --shots` → summary on stdout,
   `/tmp/audit/results.json`, screenshots in `/tmp/audit/shots/<profile>/`.
   `--only=yc-admin,pk-board` limits it to scenario prefixes.
4. Goal: zero overflow / wrap / ragged / squeezed / cut lines. Then look at
   the iPhone 15, iPad Air and desktop 1440 screenshots by eye — the
   detectors don't catch everything.
5. Throw the sandbox copy away. The only things that ever get copied back
   into the real repo are genuine fixes under `src/` (and this file /
   `scripts/layout-audit/audit.mjs`) — never `mockmulti.ts` or the
   `api.ts` mock-routing lines.

Chromium only: real-Safari quirks (dynamic toolbar, notch, font metrics) are
not proven by this run — eyeball one real iPhone after big layout changes.

Two things the detectors flag that are **not** bugs — don't chase them:
- `js | Failed to load resource: net::ERR_FAILED` on every scenario. The
  harness aborts every non-localhost request on purpose (no real network in
  the sandbox); this fires for anything the app tries to fetch outside the
  two font routes it fulfills. Harmless, always present, ignore it.
- A `wrap` finding inside a flowing `<p>` paragraph (e.g. a short trailing
  clause like "to confirm." landing on its own line). Paragraphs are
  supposed to wrap; the rule-5/rule-8 "wrap" bug is a *label, button, tab or
  heading* breaking mid-phrase when it was built to be one line. If the
  flagged element is a `<p>` of normal prose, leave it.

## Audit log

| Date | Change | Result |
|---|---|---|
| 2026-10-04 | First full audit (34 profiles × 57 screens). Fixed: ragged admin schedule rows (single + multi-sport), 31 bare `1fr` tracks, wizard Back/Create wrapping, LIVE pill wrapping, court names wrapping in Settings → Courts and court cards, stepper grids on iPad, knockout result line, long team names cut in Settings → Teams, "Rotate your phone" heading, tabs / arrows / scorer icons under 30 px. | see commit |
| 2026-10-05 | Re-audit after the 2026-10-04 fixes (34 profiles × 57 screens): ragged rows 5→0, cut inputs 1→0, short-text wrap 36→5, squeezed text 18→10, small tap targets 5039→2869. Fixed the rest found by the re-run: Settings → Competition "Admin PIN" label and the Access "Join code" row (Rule 6, label `min-w-0 truncate` + value `shrink-0`); TV group-standings header qualifier line wrapping on iPad landscape (Rule 5); TV group-standings team names squeezed to a few characters on iPad landscape — on the TV/"big" display, long names now wrap to 2 lines (`line-clamp-2`) instead of truncating, since nothing should be hidden on the big screen. Zero real findings left; remaining flags are harness noise / ordinary paragraph wrap (see above). | see commit |
| 2026-10-06 | MCMD / MCXD (migration 0026): new combined TV `/tv/MCMD+MCXD` (Live / Groups / Bracket / Auto), GroupTable with +/- and coin-toss tag, shared-queue Up next, game clock, fixed bracket preview, Settings random groups / knockout scoring / coin toss. Audited the 20 new `mc-` scenarios on all 34 profiles (+ pk- regression): fixed TV halves not fitting (absolute-fill Fit box), coin-toss tag squeezing names (moved under the name), lock-button wrap, TV control tap targets. Zero real findings left. | see commit |
