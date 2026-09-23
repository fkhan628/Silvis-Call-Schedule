// Silvis - day-edit CLI tests (Prompt 12 item BK, 2026-09-23).
// Drives the PURE functions of scripts/day-edit.js ("the day editor from the
// command line") against a fixture of the LIVE schedule_days rows read at
// 2026-09-23 07:15 (anon GET) and a synthetic rules ctx built from
// docs/silvis-seed.json. No network, no database, nothing written.
// Plain Node asserts like the other suites; exits 1 on the first failure and
// prints 'ok <n> assertions' on success. Wired into `npm test` before the
// regression and into .github/workflows/build.yml.
//
// Sections
//   A  argument parsing: --set / --expect specs, defaults (--lock true, dry run)
//   B  the four-edit plan against the live fixture: before/after table pinned,
//      a backup edit never touches primary_* / external_cover, 10/15 primary
//      stays NULL, source 'manual' for the whole row (saveDayEdit), the note kept,
//      version + 1, the expected holder = the live holder, --expect mismatch
//   C  SQL pins: the snapshot statement precedes every UPDATE, reason 'day_edit',
//      CAS guard = day + version + expected holder, one RAISE per UPDATE, the
//      audit rows (schedule.day_edit + schedule.lock, the app's action names),
//      no notifications statement anywhere, no mail, tagged DO block, no bare $$
//   D  eligibility gating: a hard failure is refused (exit 2) without --override;
//      with --override the note gets the app's '[override: ...]' tag and a
//      schedule.override audit row; a clean pick passes; the ctx is evaluated
//      with the role unlocked (the editor's pick-time state); a batch is gated
//      as SEQUENTIAL editor saves (Khan Fri-Mon: the 4th day is max-consecutive)
//   E  verify-after-apply: the simulated post-apply rows verify; a tampered row,
//      a wrong version or a foreign tag is reported
//   F  notifications preview: type manual_edit to every holder before/after,
//      the day editor's message, and NOT in the SQL
//   G  exit-code decisions and the CLI failure classifier
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
let n = 0;
function ok(cond, msg) { n++; assert.ok(cond, msg); }
function eq(a, b, msg) { n++; assert.deepStrictEqual(a, b, msg); }
function step(name) { console.log("- " + name); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

const DE = require(path.join(REPO, "scripts", "day-edit.js"));
const H = require(path.join(REPO, "helpers.js"));
const R = require(path.join(REPO, "rules.js"));
const SA = require(path.join(__dirname, "seed-adapter.js"));
const seed = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "silvis-seed.json"), "utf8"));
const roster = seed.roster;
const nameOf = (id) => { const r = roster.find(x => x.id === id); return r ? r.name : (id == null ? "OPEN" : id); };

const PUB_TAG = "publish-preview (Faraz, 2026-09-23 overnight)";
const OFFICE_SRC ="seed: office-er-call-panels-2026-09-16";
const BY = "Faraz (day-edit CLI, 2026-09-23)";
// The LIVE rows 2026-10-07..2026-10-25 as read with the anon key on 2026-09-23 07:15 (the four edit days and their neighbours).
function row(day, p, pl, b, bl, source, version, by, note) {
  return { day, primary_id: p, backup_id: b, primary_locked: pl, backup_locked: bl, source, external_cover: null, note, version, updated_by: by, updated_at: "2026-09-23T06:32:29.422018+00:00" };
}
const LIVE = [
  row("2026-10-07", "s3", true, "s5", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-08", "s4", true, "s3", true, "import", 1, "seed", OFFICE_SRC),
  row("2026-10-09", "s3", true, "s1", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-10", "s3", true, "s1", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-11", "s3", true, "s1", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-12", "s5", true, "s2", true, "import", 1, "seed", "seed: burchett-email-2026-09-18"),
  row("2026-10-13", "s4", true, "s2", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-14", "s2", true, "s4", true, "import", 1, "seed", OFFICE_SRC),
  row("2026-10-15", null, false, "s1", false, "generated", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-16", "s4", true, "s2", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-17", "s3", true, "s4", true, "import", 1, "seed", OFFICE_SRC),
  row("2026-10-18", "s3", true, "s4", true, "import", 1, "seed", OFFICE_SRC),
  row("2026-10-19", "s3", true, "s4", true, "import", 1, "seed", OFFICE_SRC),
  row("2026-10-20", "s6", true, "s3", true, "import", 1, "seed", "seed: burchett-email-2026-09-17"),
  row("2026-10-21", "s3", true, "s5", false, "import", 2, PUB_TAG, OFFICE_SRC),
  row("2026-10-22", "s6", true, "s4", true, "import", 1, "seed", "seed: burchett-email-2026-09-17"),
  row("2026-10-23", "s3", true, "s5", false, "import", 2, PUB_TAG, "seed: burchett-email-2026-09-18"),
  row("2026-10-24", "s1", false, "s5", false, "generated", 3, PUB_TAG, "seed: faraz-2026-09-22-sarkar-two-days - open \u2014 Sarkar at two days per week from 9/22"),
  row("2026-10-25", "s2", true, "s5", false, "import", 2, PUB_TAG, "seed: burchett-email-2026-09-17")
];
const FOUR_SETS = ["2026-10-09:backup=s2", "2026-10-15:backup=s2", "2026-10-20:backup=s2", "2026-10-22:backup=s2"];
const FOUR_EXPECTS = ["2026-10-09:backup=s1", "2026-10-15:backup=s1", "2026-10-20:backup=s3", "2026-10-22:backup=s4"];

/* ------------------------------------------------------------------ A */
step("A: argument parsing");
{
  eq(DE.parseSet("2026-10-09:backup=s2"), { day: "2026-10-09", role: "backup", value: "s2" });
  eq(DE.parseSet("2026-10-15:primary=OPEN"), { day: "2026-10-15", role: "primary", value: null }, "OPEN clears the role");
  eq(DE.parseSet("2026-10-15:primary=ext:Atwell"), { day: "2026-10-15", role: "primary", value: "ext:Atwell" }, "an external label is carried as ext:<label>");
  assert.throws(() => DE.parseSet("2026-10-09:lead=s2"), /role/, "a bad role throws");
  assert.throws(() => DE.parseSet("10/9:backup=s2"), /ISO/, "a non-ISO day throws");
  assert.throws(() => DE.parseSet("2026-10-09:backup"), /--set/, "a missing value throws");
  eq(DE.parseExpect("2026-10-09:backup=s1"), { day: "2026-10-09", role: "backup", holder: "s1" });
  eq(DE.parseExpect("2026-10-15:primary=OPEN"), { day: "2026-10-15", role: "primary", holder: null });
  const a = DE.parseArgs(["--set", "2026-10-09:backup=s2", "--expect", "2026-10-09:backup=s1", "--by", BY]);
  eq(a.mode, "dry-run", "dry run by default");
  eq(a.lock, true, "--lock defaults to true (Faraz: LOCKED manual edits; the editor itself locks only an outside surgeon's pick)");
  eq(a.override, false); eq(a.availabilityFromSeed, false);
  eq(a.sets.length, 1); eq(a.expects.length, 1); eq(a.by, BY);
  const b = DE.parseArgs(["--set", "2026-10-09:backup=s2", "--by", BY, "--no-lock", "--override", "--availability-from-seed", "--note", "x", "--apply", "--workdir", "C:/x"]);
  eq(b.lock, false); eq(b.override, true); eq(b.availabilityFromSeed, true); eq(b.note, "x"); eq(b.mode, "apply"); eq(b.workdir, "C:/x");
  assert.throws(() => DE.parseArgs(["--set", "2026-10-09:backup=s2"]), /--by/, "--by is required (updated_by / audit actor)");
  assert.throws(() => DE.parseArgs(["--by", BY]), /--set/, "at least one --set is required");
  // review 9/23: --apply without --workdir is refused at parse time - before any read and before the SQL file is written
  const savedWd = process.env.SILVIS_SUPABASE_WORKDIR; delete process.env.SILVIS_SUPABASE_WORKDIR;
  try { assert.throws(() => DE.parseArgs(["--set", "2026-10-20:backup=s2", "--by", BY, "--apply"]), /--workdir/, "--apply needs --workdir, refused in parseArgs"); }
  finally { if (savedWd !== undefined) process.env.SILVIS_SUPABASE_WORKDIR = savedWd; }
  // review 9/23: an --expect that matches no --set protects nothing (a typo in the guard) -> refused
  assert.throws(() => DE.parseArgs(["--set", "2026-10-20:backup=s2", "--expect", "2026-10-21:backup=s3", "--by", BY]), /--expect 2026-10-21:backup has no --set/, "an unconsumed --expect is refused");
  assert.throws(() => DE.parseArgs(["--set", "2026-10-20:backup=s2", "--expect", "2026-10-20:primary=s6", "--by", BY]), /--expect 2026-10-20:primary has no --set/, "an --expect on the wrong role is refused too");
  // review 9/23: the notice is signed with a display name (the app: userProfile.display_name || nameOf(mySurgeon)), not the whole tag
  eq(DE.signerOf(BY), "Faraz", "the signer is the tag's leading name (text before ' (')");
  eq(DE.signerOf("the ER-panel author"), "the ER-panel author", "a plain name signs as is");
  const c = DE.parseArgs(["--set", "2026-10-20:backup=s2", "--by", BY, "--by-name", "Faraz Khan"]);
  eq(c.byName, "Faraz Khan", "--by-name overrides the derived signer");
  eq(DE.parseArgs(["--set", "2026-10-20:backup=s2", "--by", BY]).byName, null, "no --by-name -> derived from --by at run time");
}

/* ------------------------------------------------------------------ B */
step("B: the four-edit plan against the live fixture");
const edits = FOUR_SETS.map(DE.parseSet);
const expects = FOUR_EXPECTS.map(DE.parseExpect);
const plan = DE.planEdits(LIVE, edits, { lock: true, by: BY, roster, expects });
{
  ok(plan.ok, "plan ok: " + JSON.stringify(plan.problems));
  eq(plan.days.map(d => d.day), ["2026-10-09", "2026-10-15", "2026-10-20", "2026-10-22"]);
  const byDay = {}; plan.days.forEach(d => { byDay[d.day] = d; });
  // before / after table pinned (holder*, * = locked)
  const table = plan.days.map(d => d.day + " " + DE.describeAssignment(d.before) + " -> " + DE.describeAssignment(d.after));
  eq(table, [
    "2026-10-09 P s3* / B s1 -> P s3* / B s2*",
    "2026-10-15 P OPEN / B s1 -> P OPEN / B s2*",
    "2026-10-20 P s6* / B s3* -> P s6* / B s2*",
    "2026-10-22 P s6* / B s4* -> P s6* / B s2*"
  ], "before -> after: only the backup holder and its lock change");
  // a backup edit never touches primary_* / external_cover
  plan.days.forEach(d => {
    eq(d.afterRow.primary_id, d.beforeRow.primary_id, d.day + ": primary_id untouched");
    eq(d.afterRow.primary_locked, d.beforeRow.primary_locked, d.day + ": primary_locked untouched");
    eq(d.afterRow.external_cover, d.beforeRow.external_cover, d.day + ": external_cover untouched");
    ok(!d.changedCols.includes("primary_id") && !d.changedCols.includes("primary_locked") && !d.changedCols.includes("external_cover"), d.day + ": changed columns are backup_id, backup_locked, source" + JSON.stringify(d.changedCols));
    eq(d.afterRow.backup_id, "s2"); eq(d.afterRow.backup_locked, true);
    eq(d.afterRow.source, "manual", d.day + ": saveDayEdit sets source 'manual' for the whole row");
    eq(d.afterRow.note, d.beforeRow.note, d.day + ": the note is kept when no override and no --note");
    eq(d.expected.backup, d.beforeRow.backup_id, d.day + ": the CAS expects the live holder");
    eq(d.nextVersion, d.seenVersion + 1, d.day + ": version + 1");
  });
  eq(byDay["2026-10-15"].afterRow.primary_id, null, "10/15 primary stays NULL");
  eq(byDay["2026-10-15"].afterRow.primary_locked, false, "10/15 primary stays unlocked");
  eq(byDay["2026-10-09"].seenVersion, 2); eq(byDay["2026-10-15"].seenVersion, 2); eq(byDay["2026-10-20"].seenVersion, 1); eq(byDay["2026-10-22"].seenVersion, 1);
  // lock changes: 10/9 and 10/15 gain a backup lock (a schedule.lock audit row); 10/20 and 10/22 were already locked
  eq(byDay["2026-10-09"].lockChanges, [{ role: "backup", locked: true }]);
  eq(byDay["2026-10-15"].lockChanges, [{ role: "backup", locked: true }]);
  eq(byDay["2026-10-20"].lockChanges, []); eq(byDay["2026-10-22"].lockChanges, []);
  // change lines are the app's (helpers.formatDayChange)
  eq(byDay["2026-10-20"].lines.map(l => l.replace(/\s+/g, " ")), ["10/20 B Acton -> Burchett"], "the app's change line");
  ok(byDay["2026-10-09"].lines.some(l => /10\/9 lock primary locked -> both locked/.test(l)), "the lock change line is the app's: " + JSON.stringify(byDay["2026-10-09"].lines));
  // review 9/23: a role LOCKED to someone else is replaced only with an explicit line in the plan (the editor needs the
  // Lock untick first) and the audit detail names the replaced holder
  eq(byDay["2026-10-20"].replacedLocked, [{ role: "backup", holder: "s3" }], "10/20: the backup is locked to Acton - a locked holder is replaced");
  eq(byDay["2026-10-22"].replacedLocked, [{ role: "backup", holder: "s4" }], "10/22: the backup is locked to Philip");
  eq(byDay["2026-10-09"].replacedLocked, [], "10/9: Khan's backup was unlocked"); eq(byDay["2026-10-15"].replacedLocked, []);
  const planText = DE.renderPlan(plan, nameOf);
  ok(/replacing LOCKED holder Acton \(backup\)/.test(planText) && /replacing LOCKED holder Philip \(backup\)/.test(planText), "the plan names every locked holder it replaces: " + planText.split("\n").filter(l => /LOCKED/.test(l)).join(" | "));
  eq(planText.split("\n").filter(l => /replacing LOCKED holder/.test(l)).length, 2, "...and only those (10/9 and 10/15 were unlocked)");
  // --expect mismatch: the caller saw a different holder than the live row -> refused before any SQL (exit 3)
  const bad = DE.planEdits(LIVE, edits, { lock: true, by: BY, roster, expects: [DE.parseExpect("2026-10-20:backup=s5")] });
  ok(!bad.ok && bad.problems.some(p => /2026-10-20/.test(p) && /--expect says backup s5/.test(p) && /live row holds backup s3/.test(p) && /exit 3/.test(p)), "--expect mismatch is a plan problem: " + JSON.stringify(bad.problems));
  eq(bad.exitCode, DE.EXIT.CAS, "an --expect mismatch decides exit 3");
  // a day with no live row is refused (the tool edits published rows only)
  const none = DE.planEdits(LIVE, [DE.parseSet("2026-12-01:backup=s2")], { lock: true, by: BY, roster });
  ok(!none.ok && /no live row/.test(none.problems.join(" ")), "no live row -> refused");
  // primary == backup is refused like the editor
  const same = DE.planEdits(LIVE, [DE.parseSet("2026-10-20:backup=s6")], { lock: true, by: BY, roster });
  ok(!same.ok && /different people/.test(same.problems.join(" ")), "primary and backup must be different people");
  // nothing changes -> the day is skipped, not written (saveDayEdit: sameAssignment -> return true)
  const noop = DE.planEdits(LIVE, [DE.parseSet("2026-10-20:backup=s3")], { lock: true, by: BY, roster });
  ok(noop.ok && noop.days.length === 0 && noop.skipped.includes("2026-10-20"), "an identical edit writes nothing");
  // --no-lock keeps the role's live lock flag (10/9 backup stays unlocked)
  const nl = DE.planEdits(LIVE, [DE.parseSet("2026-10-09:backup=s2")], { lock: false, by: BY, roster });
  eq(nl.days[0].afterRow.backup_locked, false, "--no-lock keeps the live flag"); eq(nl.days[0].lockChanges, []);
  // OPEN clears the role and never leaves an open slot locked
  const op = DE.planEdits(LIVE, [DE.parseSet("2026-10-20:backup=OPEN")], { lock: true, by: BY, roster });
  eq(op.days[0].afterRow.backup_id, null); eq(op.days[0].afterRow.backup_locked, false, "an open slot is never locked");
  // a claim / trade row whose other held role is untouched keeps its source (saveDayEdit keepPersonSource)
  const claimLive = clone(LIVE); claimLive.find(r => r.day === "2026-10-21").source = "claim";
  const kp = DE.planEdits(claimLive, [DE.parseSet("2026-10-21:backup=s2")], { lock: true, by: BY, roster });
  eq(kp.days[0].afterRow.source, "claim", "a claim row keeps its source while the primary holder stays");
  // a roster primary replaces an external cover (saveDayEdit: after.externalCover = null)
  const extLive = clone(LIVE); Object.assign(extLive.find(r => r.day === "2026-10-15"), { external_cover: "Atwell" });
  const ex = DE.planEdits(extLive, [DE.parseSet("2026-10-15:primary=s3")], { lock: true, by: BY, roster });
  eq(ex.days[0].afterRow.external_cover, null); ok(ex.days[0].changedCols.includes("external_cover"));
  // --note replaces the note (the editor's note field)
  const nt = DE.planEdits(LIVE, [DE.parseSet("2026-10-09:backup=s2")], { lock: true, by: BY, roster, note: "backup per Burchett 9/23" });
  eq(nt.days[0].afterRow.note, "backup per Burchett 9/23");
}

/* ------------------------------------------------------------------ C */
step("C: SQL pins");
const sql = DE.dayEditSql(plan, { by: BY, now: "2026-09-23T13:00:00.000Z" });
{
  ok(typeof sql === "string" && sql.length > 500, "SQL generated");
  const iSnap = sql.indexOf("insert into public.call_schedule_snapshots");
  const updates = [...sql.matchAll(/update public\.schedule_days/g)].map(m => m.index);
  eq(updates.length, 4, "one UPDATE per day");
  ok(iSnap > 0 && updates.every(i => iSnap < i), "the snapshot insert precedes every UPDATE");
  ok(/'day_edit'/.test(sql), "snapshot reason 'day_edit' (the app's day editor takes no snapshot - this is the publish tool's capture with its own reason)");
  ok(/raise exception 'DAY_EDIT_ABORT: snapshot not captured/.test(sql), "a snapshot failure raises and aborts the block");
  ok(sql.indexOf("'" + BY + "'") > 0, "the --by tag is a literal");
  // the snapshot data shape is the importer's / publish tool's (same four keys, same aggregation)
  const IMP = require(path.join(REPO, "importer.js"));
  const impSql = IMP.importSql(IMP.importPlan(seed, { now: "2026-09-23T06:00:00.000Z" }));
  const shapeLines = (s) => s.split("\n").map(l => l.trim()).filter(l => /^'(config|schedule_days|time_off|availability)',\s+\(select /.test(l));
  eq(shapeLines(sql), shapeLines(impSql), "snapshot data = the importer's jsonb_build_object shape");
  // CAS guard: day + version + the expected current holder of the edited role
  plan.days.forEach(d => {
    const re = new RegExp("update public\\.schedule_days set[\\s\\S]*?where day = '" + d.day + "' and version = " + d.seenVersion + " and backup_id is not distinct from '" + d.expected.backup + "';");
    ok(re.test(sql), "CAS guard for " + d.day + ": day + version " + d.seenVersion + " + expected holder " + d.expected.backup);
    const stmt = sql.slice(sql.indexOf("-- " + d.day + ":"), sql.indexOf("get diagnostics", sql.indexOf("-- " + d.day + ":")));
    ok(/backup_id = 's2'/.test(stmt) && /backup_locked = true/.test(stmt) && /source = 'manual'/.test(stmt) && /version = version \+ 1/.test(stmt), d.day + ": sets backup_id, backup_locked, source, version + 1");
    ok(!/primary_id\s*=/.test(stmt) && !/primary_locked\s*=/.test(stmt) && !/external_cover\s*=/.test(stmt), d.day + ": a backup edit never SETs primary_id / primary_locked / external_cover");
    ok(new RegExp("updated_by = '" + BY.replace(/[()]/g, "\\$&") + "', updated_at = now\\(\\)").test(stmt), d.day + ": updated_by = the --by tag");
  });
  eq((sql.match(/get diagnostics v_n = row_count;/g) || []).length, 4, "one row_count guard per UPDATE");
  eq((sql.match(/raise exception 'DAY_EDIT_CAS_MISMATCH/g) || []).length, 4, "one CAS raise per UPDATE");
  // audit rows: the app's action names; day_edit carries before / after / overrides; lock rows for 10/9 and 10/15 only
  eq((sql.match(/'schedule\.day_edit'/g) || []).length, 4, "one schedule.day_edit audit row per day");
  eq((sql.match(/'schedule\.lock'/g) || []).length, 2, "schedule.lock rows for the two days whose backup lock changed");
  eq((sql.match(/'schedule\.override'/g) || []).length, 0, "no override rows for a clean plan");
  const audit1020 = sql.slice(sql.indexOf("'schedule.day_edit'", sql.indexOf("-- audit 2026-10-20")), sql.indexOf("returning id", sql.indexOf("-- audit 2026-10-20")));
  ok(/"summary": ?"10\/20: 10\/20 B Acton -> Burchett"/.test(audit1020), "the summary is the app's fmtMD + change lines: " + audit1020.slice(0, 160));
  ok(/"before": ?\{"day": ?"2026-10-20"/.test(audit1020) && /"after": ?\{"day": ?"2026-10-20"/.test(audit1020), "before / after rows in the detail");
  ok(/"backup_id": ?"s3"[\s\S]*"backup_id": ?"s2"/.test(audit1020), "before backup s3, after backup s2");
  ok(/"overrides": ?\[\]/.test(audit1020), "overrides: [] on a clean edit");
  ok(/"mode": ?"command-line"/.test(audit1020) && /"tool": ?"scripts\/day-edit\.js"/.test(audit1020), "the command-line marker (the app's row has none)");
  ok(/"replacedLockedHolders": ?\[\{"role": ?"backup", ?"holder": ?"s3"\}\]/.test(audit1020), "the 10/20 audit detail names the locked holder it replaced: " + audit1020.slice(0, 400));
  const audit1009 = sql.slice(sql.indexOf("'schedule.day_edit'", sql.indexOf("-- audit 2026-10-09")), sql.indexOf("returning id", sql.indexOf("-- audit 2026-10-09")));
  ok(!/replacedLockedHolders/.test(audit1009), "10/9 replaced an unlocked holder - no replacedLockedHolders key");
  ok(/insert into public\.audit_log \(actor_id, actor_name, action, detail\)\s*values \(null, '/.test(sql), "actor_id null, actor_name the --by tag (like publish-preview)");
  // the audit rows come AFTER every UPDATE (saveDayEdit logs after the state change)
  const lastUpdate = updates[updates.length - 1];
  ok(sql.indexOf("insert into public.audit_log") > lastUpdate, "audit rows follow the UPDATEs");
  // no notification, no mail
  ok(!/notifications/i.test(sql), "no notifications statement anywhere in the SQL");
  ok(!/send-notification|net\.http|pg_net|edge/i.test(sql), "no edge-function call, no mail");
  ok(/^do \$de\$/m.test(sql) && /^end \$de\$;/m.test(sql), "one DO block with a tagged quote");
  eq((sql.match(/\$de\$/g) || []).length, 2, "exactly one opening and one closing body tag");
  ok(!/\$\$/.test(sql), "no bare $$ anywhere");
  ok(/^begin;/m.test(sql) && /^commit;/m.test(sql), "explicit begin/commit like importer.js");
  ok(/select[\s\S]*as snapshot_id[\s\S]*as audit_rows[\s\S]*as days_by_tool/.test(sql), "the final select reports the snapshot id, the audit rows and the stamped days");
  // a note carrying $$ stays inside the body
  const liveD = clone(LIVE); liveD.find(r => r.day === "2026-10-20").note = "cost $$ note";
  const planD = DE.planEdits(liveD, [DE.parseSet("2026-10-20:backup=s2")], { lock: true, by: BY, roster });
  const sqlD = DE.dayEditSql(planD, { by: BY });
  eq((sqlD.match(/\$de\$/g) || []).length, 2, "a $$ in a note leaves exactly two body tags");
  ok(/note = 'cost \$\$ note'/.test(sqlD), "the $$ note is a plain literal inside the body");
  // an empty plan makes no SQL
  eq(DE.dayEditSql({ ok: true, days: [] }, { by: BY }), null, "nothing to write -> no SQL");
}

/* ------------------------------------------------------------------ D */
step("D: eligibility gating (synthetic ctx from the seed)");
{
  const EAST_COVER = { from: "2026-09-28", to: "2026-11-01" };
  const liveSchedule = DE.scheduleFromRows(LIVE, SA.seedToSchedule(seed));
  const mkCtx = (schedule) => R.buildContext(SA.seedToContextInput(seed, { eastDerived: [], eastFeedCoverage: EAST_COVER, eastBusyDays: {}, schedule }));
  // the editor evaluates a pick with the role UNLOCKED and cleared (pick-time draft) - a locked live holder must not read as slot-locked
  const drafts = DE.pickTimeSchedules(liveSchedule, plan);
  eq(drafts["2026-10-20"]["2026-10-20"], { primary: "s6", backup: null, primaryLocked: true, backupLocked: false, source: "manual", externalCover: null, note: "seed: burchett-email-2026-09-17" }, "pick-time draft: backup cleared and unlocked, source manual, the rest as live");
  const evals = DE.evaluateEdits(plan, liveSchedule, mkCtx);
  eq(evals.map(e => e.day + " " + e.role + " " + e.id), ["2026-10-09 backup s2", "2026-10-15 backup s2", "2026-10-20 backup s2", "2026-10-22 backup s2"]);
  evals.forEach(e => ok(e.ok, e.day + " backup Burchett is eligible on the seed ctx: hard " + JSON.stringify(e.hard)));
  ok(evals.every(e => !e.hard.some(h => /slot-locked/.test(h))), "no slot-locked reason (the pick-time draft unlocked the role)");
  eq(DE.gate(plan, evals, { override: false }).refusals, [], "a clean plan is not refused");
  eq(DE.gate(plan, evals, { override: false }).exitCode, DE.EXIT.OK);
  // a planted hard failure: Khan primary on Tue 10/20 (hard-never-weekday) - refused without --override
  const planK = DE.planEdits(LIVE, [DE.parseSet("2026-10-20:primary=s1")], { lock: true, by: BY, roster });
  const evK = DE.evaluateEdits(planK, liveSchedule, mkCtx);
  ok(!evK[0].ok && evK[0].hard.some(h => /hard-never-weekday/.test(h)), "Khan on a Tuesday is hard: " + JSON.stringify(evK[0].hard));
  const g1 = DE.gate(planK, evK, { override: false, roster });
  eq(g1.exitCode, DE.EXIT.REFUSED, "hard without --override -> exit 2");
  ok(g1.refusals.length === 1 && /Khan primary/.test(g1.refusals[0]) && /hard-never-weekday/.test(g1.refusals[0]) && /--override/.test(g1.refusals[0]), "the refusal reads like the editor's override warning: " + g1.refusals[0]);
  ok(planK.days[0].overrides.length === 0 && !/\[override:/.test(planK.days[0].afterRow.note || ""), "no override is recorded without the flag");
  // with --override: the app's note tag, overrides in the plan, a schedule.override audit row in the SQL
  const g2 = DE.gate(planK, evK, { override: true, roster });
  eq(g2.exitCode, DE.EXIT.OK); eq(g2.refusals, []);
  eq(planK.days[0].overrides, [{ id: "s1", role: "primary", reasons: evK[0].hard }], "the override is recorded like DayEditor.confirmOverride");
  ok(/^\[override: Khan primary: /.test(planK.days[0].afterRow.note) && / seed: burchett-email-2026-09-17$/.test(planK.days[0].afterRow.note), "the note gets the app's '[override: ...] ' prefix in front of the kept note: " + planK.days[0].afterRow.note);
  const sqlK = DE.dayEditSql(planK, { by: BY });
  eq((sqlK.match(/'schedule\.override'/g) || []).length, 1, "one schedule.override audit row");
  ok(/"overrides": ?\[\{"id": ?"s1", ?"role": ?"primary"/.test(sqlK), "the day_edit row carries the overrides");
  // an existing override tag is stripped before a new one is applied (saveDayEdit's replace)
  const liveO = clone(LIVE); liveO.find(r => r.day === "2026-10-20").note = "[override: Acton backup: x] seed: burchett-email-2026-09-17";
  const planO = DE.planEdits(liveO, [DE.parseSet("2026-10-20:backup=s2")], { lock: true, by: BY, roster });
  eq(planO.days[0].afterRow.note, "seed: burchett-email-2026-09-17", "an old override tag does not survive a clean edit");
  // an evaluation that THROWS fails closed (the editor disables Save): refused even with --override
  const evT = evK.map(e => Object.assign({}, e, { ok: false, hard: ["rules-error:boom"], error: "boom" }));
  eq(DE.gate(planK, evT, { override: true, roster }).exitCode, DE.EXIT.REFUSED, "a thrown check is never overridable");
  // asBlockMember mirrors the editor: a candidate holding the other two Fri-Sun days in the role is asked as a block member
  const fixtureBlock = clone(LIVE); fixtureBlock.find(r => r.day === "2026-10-10").backup_id = "s2"; fixtureBlock.find(r => r.day === "2026-10-11").backup_id = "s2";
  const schedB = DE.scheduleFromRows(fixtureBlock, SA.seedToSchedule(seed));
  const planB = DE.planEdits(fixtureBlock, [DE.parseSet("2026-10-09:backup=s2")], { lock: true, by: BY, roster });
  const evB = DE.evaluateEdits(planB, schedB, mkCtx);
  eq(evB[0].asBlockMember, true, "Fri 10/9 with Sat+Sun held -> block member");
  eq(evals.find(e => e.day === "2026-10-09").asBlockMember, false, "on the live fixture Khan holds Sat+Sun, so Burchett is not a block member");
  // review 9/23 (major): a batch is gated as SEQUENTIAL editor saves - day n's pick-time draft already holds days 1..n-1's
  // `after`, so a hard rule two edits of the same batch create together is seen (the app saves one day at a time)
  const d20 = drafts["2026-10-20"];
  eq([d20["2026-10-09"].backup, d20["2026-10-09"].backupLocked, d20["2026-10-15"].backup, d20["2026-10-15"].backupLocked], ["s2", true, "s2", true], "10/20's pick-time draft already holds the 10/9 and 10/15 edits");
  eq([drafts["2026-10-09"]["2026-10-15"].backup, drafts["2026-10-09"]["2026-10-20"].backup], ["s1", "s3"], "...while 10/9's draft sees the later days as live");
  eq(d20["2026-10-20"].backup, null, "the day's own edited role is still cleared in its draft");
  const NOV = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map(d => row(d, null, false, null, false, "generated", 1, "x", null));
  const schedN = DE.scheduleFromRows(NOV, SA.seedToSchedule(seed));
  const mkN = (schedule) => R.buildContext(SA.seedToContextInput(seed, { eastDerived: [], eastFeedCoverage: { from: "2026-09-28", to: "2026-12-31" }, eastBusyDays: {}, schedule }));
  const planN = DE.planEdits(NOV, NOV.map(r => DE.parseSet(r.day + ":primary=s1")), { lock: true, by: BY, roster });
  const evN = DE.evaluateEdits(planN, schedN, mkN);
  eq(evN.slice(0, 3).map(e => e.day + " " + (e.ok ? "ok" : "HARD " + e.hard.join(","))), ["2026-11-06 ok", "2026-11-07 ok", "2026-11-08 ok"], "Khan Fri-Sun 11/6-11/8 primary: the first three picks pass");
  ok(!evN[3].ok && evN[3].hard.some(h => /max-consecutive/.test(h)), "Khan's fourth day in a row (Mon 11/9) is HARD max-consecutive - visible only because the batch is gated sequentially: " + JSON.stringify({ ok: evN[3].ok, hard: evN[3].hard }));
  eq(DE.gate(planN, evN, { override: false, roster }).exitCode, DE.EXIT.REFUSED, "...so the four-day batch is refused without --override");
  eq(DE.gate(planN, evN, { override: true, roster }).exitCode, DE.EXIT.OK, "...and saved with --override, the 11/9 note tagged");
  ok(/^\[override: Khan primary: .*max-consecutive/.test(planN.days[3].afterRow.note || ""), "the override tag lands on 11/9 only: " + planN.days[3].afterRow.note);
  ok(!planN.days[2].afterRow.note, "11/8 carries no tag");
}

/* ------------------------------------------------------------------ E */
step("E: verify after apply");
{
  const after = DE.applyToLive(LIVE, plan, BY);
  const v = DE.verifyApplied(plan, after, BY);
  ok(v.ok, "the simulated post-apply rows verify: " + JSON.stringify(v.problems));
  const u = DE.verifyUntouched(LIVE, after, plan);
  ok(u.ok, "every row outside the plan is untouched: " + JSON.stringify(u.problems));
  eq(after.length, LIVE.length, "no row inserted or deleted");
  const a20 = after.find(r => r.day === "2026-10-20");
  eq([a20.primary_id, a20.primary_locked, a20.backup_id, a20.backup_locked, a20.source, a20.version, a20.updated_by, a20.note], ["s6", true, "s2", true, "manual", 2, BY, "seed: burchett-email-2026-09-17"], "10/20 after: only the backup, its lock, source, version, updated_by moved");
  const a15 = after.find(r => r.day === "2026-10-15");
  eq([a15.primary_id, a15.primary_locked, a15.backup_id, a15.backup_locked, a15.version], [null, false, "s2", true, 3], "10/15 after: primary still OPEN and unlocked");
  // tampered: a wrong holder, a wrong version, a foreign tag, a touched primary
  const t1 = clone(after); t1.find(r => r.day === "2026-10-09").backup_id = "s1";
  ok(!DE.verifyApplied(plan, t1, BY).ok, "a holder that did not move is reported");
  const t2 = clone(after); t2.find(r => r.day === "2026-10-22").version = 3;
  ok(DE.verifyApplied(plan, t2, BY).problems.some(p => /2026-10-22: version is 3, expected 2/.test(p)), "a wrong version is reported");
  const t3 = clone(after); t3.find(r => r.day === "2026-10-20").updated_by = "someone else";
  ok(DE.verifyApplied(plan, t3, BY).problems.some(p => /updated_by/.test(p)), "a foreign tag is reported");
  const t4 = clone(after); t4.find(r => r.day === "2026-10-15").primary_id = "s3";
  ok(DE.verifyApplied(plan, t4, BY).problems.some(p => /2026-10-15: primary_id/.test(p)), "a touched primary is reported");
  const t5 = clone(after); t5.find(r => r.day === "2026-10-13").backup_id = "s4";
  ok(!DE.verifyUntouched(LIVE, t5, plan).ok, "a change outside the plan is reported");
  // idempotence: planning the same edits against the post-apply rows writes nothing
  const re = DE.planEdits(after, edits, { lock: true, by: BY, roster });
  ok(re.ok && re.days.length === 0 && re.skipped.length === 4, "a fresh plan after apply skips all four days");
}

/* ------------------------------------------------------------------ F */
step("F: notifications preview (printed, never written)");
{
  const prev = DE.notificationsPreview(plan, nameOf, "Khan");
  eq(prev.map(p => p.day), ["2026-10-09", "2026-10-15", "2026-10-20", "2026-10-22"]);
  prev.forEach(p => { eq(p.type, "manual_edit"); eq(p.title, "Schedule changed"); });
  const p20 = prev.find(p => p.day === "2026-10-20");
  eq(p20.message, H.manualEditMsg(["10/20 B Acton -> Burchett"], "Khan"), "the app's manualEditMsg text");
  eq(p20.data, { surgeon_id: "s6", day: "2026-10-20", affected: ["s6", "s3", "s2"] }, "data: surgeon_id = after.primary, affected = every holder before and after");
  eq(p20.email, { type: "manual_edit", subject: "Schedule changed - 10/20", targetIds: ["s6", "s3", "s2"] });
  eq(prev.find(p => p.day === "2026-10-15").data.affected, ["s1", "s2"], "10/15: an open primary is not a recipient");
  eq(prev.find(p => p.day === "2026-10-15").data.surgeon_id, "s2", "10/15: surgeon_id falls through to after.backup");
  // a lock-only edit changes no role -> nothing would be queued (saveDayEdit: roleChanged false)
  const lockOnly = DE.planEdits(LIVE, [DE.parseSet("2026-10-09:backup=s1")], { lock: true, by: BY, roster });
  ok(lockOnly.days.length === 1 && lockOnly.days[0].lockChanges.length === 1, "a lock-only edit is a write");
  eq(DE.notificationsPreview(lockOnly, nameOf, "Khan"), [], "...but queues no notification");
  const text = DE.renderNotifications(prev, nameOf);
  ok(/NOT written/.test(text) && /manual_edit/.test(text) && /Sarkar, Acton, Burchett/.test(text), "the preview names type and recipients: " + text.split("\n")[0]);
  // review 9/23: the preview is signed like the app (display name), not with the whole --by tag
  const signed = DE.notificationsPreview(plan, nameOf, DE.signerOf(BY));
  eq(signed.find(p => p.day === "2026-10-20").message, "10/20 B Acton -> Burchett (by Faraz)", "signed '(by Faraz)', not '(by Faraz (day-edit CLI, 2026-09-23))'");
}

/* ------------------------------------------------------------------ G */
step("G: exit codes and the CLI failure classifier");
{
  eq(DE.EXIT, { OK: 0, ERROR: 1, REFUSED: 2, CAS: 3, SNAPSHOT: 4 });
  eq(DE.classifyCliFailure("ERROR: DAY_EDIT_ABORT: snapshot not captured (before 5, after 5)"), DE.EXIT.SNAPSHOT);
  eq(DE.classifyCliFailure("ERROR: DAY_EDIT_CAS_MISMATCH: 2026-10-20 expected version 1 and backup s3 - 0 row(s) matched"), DE.EXIT.CAS);
  eq(DE.classifyCliFailure("connection refused"), DE.EXIT.ERROR);
  eq(DE.classifyCliFailure("ERROR: DAY_EDIT_ABORT: audit row not written"), DE.EXIT.ERROR);
  // review 9/23: exit 3 / 4 must not depend on the CLI exiting non-zero - a RAISE the CLI reports with exit 0 is
  // classified from its text (0 = no RAISE seen; the rest is verifyApplied's job)
  eq(DE.detectBatchFailure("ERROR: DAY_EDIT_CAS_MISMATCH: 2026-10-20 expected version 1 and backup s3 - 0 row(s) matched"), DE.EXIT.CAS, "a CAS RAISE in a 0-exit output still decides exit 3");
  eq(DE.detectBatchFailure("ERROR: DAY_EDIT_ABORT: snapshot not captured (before 5, after 5)"), DE.EXIT.SNAPSHOT, "a snapshot RAISE in a 0-exit output still decides exit 4");
  eq(DE.detectBatchFailure("ERROR: DAY_EDIT_ABORT: audit row not written for 2026-10-20"), DE.EXIT.ERROR, "any other DAY_EDIT_ABORT is exit 1");
  eq(DE.detectBatchFailure("[{\"snapshot_id\":\"abc\",\"audit_rows\":6,\"days_by_tool\":4}]"), 0, "a clean output is not a failure");
  // the CAS is also refused when a plan day's version is missing
  const nov = clone(LIVE); delete nov.find(r => r.day === "2026-10-20").version;
  const pv = DE.planEdits(nov, [DE.parseSet("2026-10-20:backup=s2")], { lock: true, by: BY, roster });
  ok(!pv.ok && pv.exitCode === DE.EXIT.CAS && /no numeric version/.test(pv.problems.join(" ")), "no version -> cannot compare-and-swap (exit 3)");
}

console.log("ok " + n + " assertions");
