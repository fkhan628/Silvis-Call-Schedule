# Silvis-Call-Schedule — Project Context for Claude Code

*Created 2026-09-21. This file lives at the repo root so Claude Code reads it automatically. It holds conventions
and build rules only; the rules of the schedule itself are in `docs/SILVIS-CALL-RULES.md`, the architecture in
`docs/SILVIS-BUILD-GUIDE.md`, the data in `docs/silvis-seed.json`, and the build sequence in `docs/CLAUDE-CODE-PROMPTS.md`.*

Daily primary + backup trauma / acute-care surgery call schedule generator (React PWA) for the six-surgeon
**Silvis Surgical Care** group at MercyOne Genesis Medical Center – Silvis. Sibling of the Davenport app
(`github.com/fkhan628/Call-Schedule-App`, live at `fkhan628.github.io/Call-Schedule-App`) — same stack and pipeline,
different shift model. Frontend on GitHub Pages, backend on Supabase project `bzhsroegtagqhutbnsrp`
(`https://bzhsroegtagqhutbnsrp.supabase.co`). Faraz Khan (FAK, roster `s1`) is the scheduler, admin, sole
developer, one of the six surgeons, and the user you're working with. Live users once launched: 6 surgeons + 1 viewer
(the ER-panel author). Repo: `github.com/fkhan628/Silvis-Call-Schedule` (public); live: `fkhan628.github.io/Silvis-Call-Schedule`.

## Identity model — get this right

Roster entries are `{ id, name, code, fullName, active, roles }`; ids `s1`–`s6`; `name` is the surgeon's
**last name** (Khan, Burchett, Acton, Philip, Fierce, Sarkar); `code` is a 3-letter chip (FAK, MAB, BDA, AFP, NF, SRK).
**The schedule stores ids.** There is no Atwell. Roster entries carry **no email field**.
The Davenport app uses a different id namespace (FAK is `s6` there) — the East feed matches on `code`, never on id.

**No contact data in the repo — or in any anon-readable table (Faraz 9/21, guide §3.1):** emails and phone numbers never
appear in `docs/`, `sql/`, `config.js`, tests or any tracked file (the repo is public), and never in `call_schedule_data`,
`schedule_days`, `time_off`, `availability`, `east_feed` or `client_versions` (readable with the public anon key). They
exist only in the private `silvis-contacts.md` in the OneDrive folder (gitignored; Faraz uses it to invite users) and, in
Supabase, only in `user_profiles` (via Auth signup) and `office_contacts` (entered in Setup) — both authenticated-read.
Notes in anon-readable tables carry no reasons at all (not even category tokens); the rule itself is the only content -
since 9/22 (reasons live in `docs/SILVIS-CALL-RULES.md`). Surgeons are contacted at home addresses, never
MercyOne/MercyHealth work addresses.

## Shift model — the thing that differs from Davenport

One calendar day = one 24-hour shift (07:00 → 07:00). Two roles per day: `primary` (in Silvis) and `backup`.
In-memory schedule: `{ "YYYY-MM-DD": { primary, backup, primaryLocked, backupLocked, source, externalCover, note } }`.
Persisted one row per day in `schedule_days` with compare-and-swap on `version`. Fri/Sat/Sun form a *weekend unit*
(block / split / daily). Fairness is an **equal share per role** — of the open primary slots and, separately, of the open
backup slots — for every pool member, with per-surgeon caps and explicit targets on top (Prompt 12 J, 9/22). Fill primary
first, then backup.
One 24-h day = **one shift** — no partial or weighted shifts; totals are a running yearly tally. Time off is
**vacations only** (no no-call days), self-entered with **no approval**, refused over a day the surgeon is already on call
(DB trigger + client check — trade first). Holidays are the same six as Davenport, as **units** with one primary + one
backup sticking through the unit. There is **no compensation logic and no $ display** anywhere in this app (Faraz 9/21).
Carried over from Davenport on purpose: office notifications, calendar sync, refresh/version check, data management,
every safety feature, trades. Dropped: APPs, Fierce backup weeks, no-call days, vacation approvals, weighted accounting.

## Working locations

1. **Git clone: `<your clone>`** — the ONLY place to edit repo files. Git identity is
   configured repo-locally. The Davenport reference clone lives beside it at `..\davenport-ref` (read-only, fresh clone
   of `fkhan628/Call-Schedule-App`; `..\Call-Schedule-App` is Faraz's own Davenport working clone — never edit either
   from here).
2. **OneDrive folder** `<the OneDrive folder>` — non-repo material (the ER-panel author's Word docs,
   email exports, backups), the private `silvis-contacts.md`, and the source copies of `CLAUDE.md`, `docs/` and `sql/`
   (identical to the repo's — both contact-free). Never edit app files there.
3. **Supabase** — schema in `sql/schema.sql` (applied by hand in the SQL editor). Edge-function sources live in the repo
   under `edge-functions/<slug>/index.ts` but are deployed by hand with the Supabase CLI (`--no-verify-jwt`), exactly
   like Davenport — a git push does NOT deploy functions.

## Deploy path — repo (the PWA)

- Edit **only** `index-source.html` (one `<script type="text/babel">` JSX block) and the plain-JS modules
  (`config.js`, `rules.js`, `generator.js`, `east-feed.js`, `helpers.js`, `app-styles.js`).
- **NEVER hand-edit `index.html` or `APP_VERSION`** — CI transpiles and bumps on push to `main`, commits back with
  `[skip ci]`, Pages redeploys.
- Before ANY push: `npm test && node build.js` (= every suite in package.json's test chain — rules, east-feed, data-layer,
  schema, importer, week-rows, exports, totals, holidays, publish, ci — then the generator regression, then the build);
  every gate must pass (one babel block, classic React runtime, zero injected imports, no jsx-runtime artifacts, no mojibake).
  For anything touching index-source.html also run `npm run smoke` (Playwright smoke harness, test/ui/smoke.mjs). `build.js`
  writes `index.html` locally as a byproduct — `git restore index.html` before committing (CI owns it).
- Branch + PR for anything touching destructive paths, sync/state, RLS, or many call sites. **A push to `main` is a live deploy.**
- localStorage keys are prefixed `silvis-` (Davenport uses `dsg-`) so both PWAs coexist in one browser.

## Data layer — key facts

- Two client auth paths in `config.js`: `dbReadHeaders()` (expiry-aware, anon fallback) for reads; `dbAuthHeaders()`
  (user JWT, sends even an expired token so a dead write fails loudly) for **every** mutation.
- **RLS:** anon-readable — `schedule_days`, `call_schedule_data`, `time_off`, `availability`, `east_feed`, `east_overrides`
  (day, roster id, busy flag, an operational note), `east_forecast` (week flags + busy probabilities) and `client_versions` (anon
  reads the `main` row only).
  An RLS-blocked read returns HTTP 200 + `[]` — **silent**. Reads must distinguish failure from empty (`db.query` throws on
  non-2xx; keep that). **The service-role key is server-side only — never in client code or a URL.** RLS changes apply to
  the live DB instantly — always report-first with blast radius.
- Data-loss safeguards (inherited from two Davenport wipe incidents): `payloadLooksWiped`, one-shot
  `intentionalScheduleWipeRef`, snapshots to `call_schedule_snapshots` before destructive actions (capture failure
  BLOCKS the action), scheduler restore UI in Settings. Preserve all of it.
- East feed (`east-feed.js`) reads the Davenport project's `schedule_weeks` **read-only** with its public anon key and
  caches into `east_feed`. Fetch failure keeps the cache and warns — never "no East call".

## Rules engine + generator contract

- `rules.js` is pure (no DOM/React); `eligibility(ctx, date, role, surgeonId)` is the **single chokepoint** — every
  assignment, repair, trade acceptance and manual edit consults it (manual edits may override with a visible warning).
- No surgeon-specific `if (name === ...)` in code: every rule is data in `call_schedule_data.data.surgeonRules` and
  editable in Setup. Fierce's derived weeks and Khan's East dependency are generic `eastFeed` features.
- `generator.js`: locks → weekend/day units → primary pass → backup pass → repair → target smoothing, wrapped in
  best-of-N; returns `{ schedule, diagnostics }` and **never silently leaves a slot empty** — open slots carry reasons.
- `test/generator-regression.js` re-states every hard rule independently and runs 50 seeds × 4 ranges (Oct with the
  imports, Nov–Dec, Jan–Mar, the milestone 11/2 → 1/3 on the even seeds) plus the fill-open-only October backfill runs
  and the fixture runs, all from `docs/silvis-seed.json` and `test/fixtures/`; CI runs it before the build. When a rule
  changes, update `docs/SILVIS-CALL-RULES.md`, the seed, and the test in the same PR.

## Session ground rules (non-negotiable)

- ONE task at a time; stop and wait for go-ahead between tasks. For **report-first** tasks (RLS, destructive paths,
  anything that touches published schedule rows), report findings and WAIT for approval before editing.
- Show every edit and every command before running it. No auto-accept.
- Verify by OBSERVING behavior (a passing test, a real row in Supabase, a green CI run, a byte-diff) — never by
  assuming success. Silent failures are this codebase family's signature bug class.
- Current milestone: **a published schedule through 2026-12-31** — **published 2026-09-23** from the committed preview
  (`docs/PUBLISH-2026-09-23.md`: 2026-10-07 → 2027-01-03 over the locks, which now run to 11/29). Generate's default range
  and its 3 / 6 / 9 / 12-month presets start at the first open slot on or after today (Prompt 12 AB); locks are never
  touched.
  Don't gold-plate exports or edge functions until the surgeons are on the live app.
- Pending inputs: who takes Thu 10/15 primary (group discussion — the 9/23 publish left it OPEN), Sarkar's home email,
  Philip's monthly cap (Khan as backup on ordinary Tue/Thu was answered 9/22: backup is open to everyone) — see
  `docs/SILVIS-CALL-RULES.md §8`. Treat those as unknowns, not assumptions to bake in. Every default
  taken for an unanswered question is data in `call_schedule_data.data.groupRules` / `surgeonRules` (listed in
  `docs/ORIENTATION-2026-09-21.md` §3), never a code branch.
