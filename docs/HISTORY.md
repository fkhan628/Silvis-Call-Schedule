# History documents (kept in the private folder)

*B10, 2026-09-23. The build's working papers - prompts, reviews, status reports, one-off reports and the 9/23 preview
record - were moved out of the public repo so a new reader does not mistake them for current documentation. They are
kept in the private OneDrive folder under `docs/history/` (not tracked; Faraz's archive). What is current lives in
`docs/SILVIS-BUILD-GUIDE.md` (architecture), `docs/SILVIS-CALL-RULES.md` (the rules), `docs/silvis-seed.json` (the
data), `docs/SCHEMA-REVIEW.md` (every applied migration with its observed probe), `docs/ONBOARDING.md` (users) and
`edge-functions/README.md` (deploys and cron jobs). `docs/PUBLISH-2026-09-23.md` stays in the repo as the audit trail of
the 9/23 publish.*

| Document | Date | One line | Where |
|---|---|---|---|
| `ORIENTATION-2026-09-21.md` | 2026-09-21 | The orientation for the build: reuse map against Davenport, the defaults taken for every unanswered question (its section 3), scope of the regression harness. | kept in the private folder |
| `CLAUDE-CODE-PROMPTS.md` | 2026-09-21 | The build sequence, prompt by prompt (0A-11), that produced the app. | kept in the private folder |
| `PROMPT-12-PREPUBLISH-FIXES.md` | 2026-09-22/23 | Prompt 12: the pre-publish review items (A-AC, the audit letters) and their delivery notes. | kept in the private folder |
| `PROMPT-13-OPEN-SHIFTS.md` | 2026-09-22 | Prompt 13: the open-shifts board, self-claim and the Monday e-mail (the live parts are guide section 16). | kept in the private folder |
| `PROMPT-14-OFFER-PERIODS.md` | 2026-09-22/23 | Prompt 14: offers and periods, design v2 in six parts (the live parts are guide section 17). | kept in the private folder |
| `PROMPT-15-EAST-VACATIONS.md` | 2026-09-23 | Prompt 15: East vacations reviewed away / home, with its delivery note (the live parts are guide section 18). | kept in the private folder |
| `REVIEW-2026-09-22.md` | 2026-09-22 | The 9/22 review: RLS findings, the edge functions' dryRun proofs, the trade-guard gap (answered by the 9/22 trade-guards migration). | kept in the private folder |
| `STATUS-2026-09-22.md` | 2026-09-22 | Status report 9/22: first deploys, secrets set by name, the two cron jobs, the audit-action lists. | kept in the private folder |
| `STATUS-2026-09-23.md` | 2026-09-23 | Status report 9/23: the two periods, Burchett's 2027 vacation, the 10/24 note, three decision notes. | kept in the private folder |
| `REPORT-BURCHETT-OCTOBER-2026-09-23.md` | 2026-09-23 | The day-edit CLI's first use: Burchett takes backup 10/9, 10/15, 10/20, 10/22 on the live rows. | kept in the private folder |
| `REPORT-BURCHETT-DECEMBER-2026-09-23.md` | 2026-09-23 | Burchett's December flip: his list governs both roles; nothing regenerated. | kept in the private folder |
| `REPORT-NOV-BACKUPS-2026-09-23.md` | 2026-09-23 | Why November's generated backups landed where they did - the analysis behind the water-filled share. | kept in the private folder |
| `REPORT-WATER-FILL-2026-09-23.md` | 2026-09-23 | The water-filled share what-if against the published rows (the mutant runs `test/water-fill.test.js` restates). | kept in the private folder |
| `PREVIEW-2026-11-02-to-2027-01-03.md` | 2026-09-23 | The milestone preview that was published on 9/23 (seed 7, bestOf 200), rendered. | kept in the private folder |
| `PREVIEW-2026-11-02-to-2027-01-03.json` | 2026-09-23 | The same preview as data - the input of the 9/23 publish; `test/fixtures/publish-preview-2026-09-23.json` is its copy for `test/publish.test.js`. | kept in the private folder |
| `PREVIEW-DIFF-2026-09-22.md` | 2026-09-22 | The 9/22 preview-to-preview diff (`scripts/preview-diff.js`). | kept in the private folder |
| `EDGE-FUNCTIONS-REVIEW.md` | 2026-09-22 | The review of the four edge functions retargeted from Davenport and what changed in each. | kept in the private folder |
| `STATUS-2026-09-24.md` | 2026-09-23/25 | Status report of the Prompt 16 pre-launch and week-one fixes, updated through the launch night and the next day: what was live, what Faraz had to do, the UI items, Give a day away (Prompt 19) shipped, Followers (Prompt 20) built and held. | kept in the private folder |
| `HANDOFF-2026-09-24.md` | 2026-09-23/24 | The launch-night handoff / primer for the next conversation: live state, what happened that night, open items, working rules; superseded by HANDOFF-2026-09-25. | kept in the private folder |
| `HANDOFF-2026-09-25.md` | 2026-09-25 | The primer at the end of the 9/21-9/25 build-and-launch conversation: live state, what shipped 9/24-9/25, the scheduled 24-hour gate, next tasks; superseded by HANDOFF-2026-09-27. | kept in the private folder |
| `REPORT-P21-STEP4-RETURN-REPRESENTATION-2026-09-27.md` | 2026-09-26/27 | Prompt 21 step 4: every other client write that asks for `return=representation` checked against the row-security rules - `audit_log` was the only trap (report, no fix). | kept in the private folder |
| `GATE-REPORT-2026-09-27.md` | 2026-09-27 | The 24-hour gate, run by hand: heartbeats, the two held migrations applied, verify-rls, send-notification v8 and daily-reminder v6 deployed - passed. | kept in the private folder |
| `HANDOFF-2026-09-27.md` | 2026-09-27 | The primer at the end of the 9/25-9/27 conversation (Prompt 21, E2-E4, the 24-hour gate, the seed notes): live state, what shipped, next tasks, lessons. | kept in the private folder |
| `APP-REVIEW-2026-09-27.md` | 2026-09-27 | The whole-app review for efficiency and everyday use: 53 verified findings, a ranked do-first list, scheduler-only proposals, what was checked and is not a problem, and a one-task-per-branch sequence. | **in the repo**: `docs/APP-REVIEW-2026-09-27.md` (the sessions that fix these items need it) |
| `REPORT-QUEUE-2026-10-01.md` | 2026-10-01 | Cowork's 7-task queue of 9/30 - 10/1, consolidated: what shipped, gates and reviews, what waits for Faraz, the follow-ups. | kept in the private folder |
| `REPORT-AUTONOMOUS-2026-10-01.md` | 2026-10-01 | The running report of the autonomous run while Faraz was away, updated through the run: the tasks it took on (the vacation-guard apply script, Prompt 28, the 10/1 follow-ups, the app-review do-first items) with their builds, smoke counts, review findings and what waits for Faraz - its status table says which were reached. | kept in the private folder |

Citations of these files elsewhere (SQL migration headers, seed revision entries, test comments) name the design document
they came from; the document is in the private folder, not in this repo. The one exception is
`docs/APP-REVIEW-2026-09-27.md` (2026-09-27): it lives in the repo because the sessions that fix its items need it.
