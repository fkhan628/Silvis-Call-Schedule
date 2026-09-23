#!/usr/bin/env node
// Silvis - the day editor from the command line (Prompt 12 item BK, 2026-09-23;
// first use: Burchett takes BACKUP on 10/9, 10/15, 10/20, 10/22 - Faraz 9/23 morning).
//
//   node scripts/day-edit.js --set <day>:<role>=<id|OPEN|ext:label> [--set ...]
//                            --by "<name>"                     updated_by of every written row + audit actor_name
//                            [--by-name "<display name>"]       signs the notice PREVIEW (default: the text of --by before ' (')
//                            [--expect <day>:<role>=<id|OPEN>]  the holder the caller saw; the CAS refuses if the live row differs
//                                                               (an --expect without a matching --set is refused at parse time)
//                            [--lock | --no-lock]               default --lock: the edited role is locked (Faraz: LOCKED manual edits)
//                            [--note "<text>"]                  replaces the day's note (the editor's note field); default: the note is kept
//                            [--override]                       save over a HARD eligibility failure (the editor's "Override" confirm)
//                            [--availability-from-seed]         evaluate eligibility with docs/silvis-seed.json's availability rows too
//                            [--dry-run | --apply --workdir <linked supabase dir>] [--out <sql path>] [--seed <path>]
//
// Mirrors the app's ONLY manual schedule mutation path, index-source.html
// saveDayEdit (lines 1799-1845) and the DayEditor it serves (5639-5790), SERVER
// SIDE through the linked Supabase CLI (as postgres), the way scripts/publish-preview.js
// mirrors Accept & Publish. Parity, line by line:
//   - eligibility: DayEditor.evalRole (5676-5700) asks rules.eligibility(ctx, day, role, id)
//     for every roster member with the ctx built from the DRAFT day
//     ({ ...draft, source: "manual" }, 5660) - at pick time the role is unlocked
//     (the select is disabled while locked; the scheduler unticks "Lock" first) and
//     an outside surgeon is asked with { manual: true }, a pool surgeon who holds the
//     other two Fri-Sun days in the role with { asBlockMember: true } (5672-5679).
//     A hard reason makes the pick "pending" and the editor asks Override (pick,
//     5706-5720; confirmOverride 5721-5731). A check that THROWS fails closed
//     (evalBroken, 5703): Save is disabled, never overridable. Here: the same evaluation
//     per edit, printed hard / soft; a hard reason prints the editor's override
//     warning and the write proceeds ONLY with --override (exit 2 otherwise); a thrown
//     check is refused even with --override.
//     A BATCH IS GATED AS SEQUENTIAL EDITOR SAVES (review 9/23): the app saves one day at a
//     time and the next pick sees the earlier save, so day n of a multi-day batch is
//     evaluated on live + the `after` of every earlier plan day (date order), its own edited
//     roles cleared and unlocked. A hard rule two edits create together (Khan Fri-Sun + Mon =
//     max-consecutive) is therefore seen and refused / tagged on the day that trips it.
//   - a role LOCKED to someone else: the editor cannot re-assign it without unticking Lock
//     first (the select is disabled while locked; clearRole refuses 'unlock it first'). The
//     tool does the untick-pick-retick in one step, prints 'replacing LOCKED holder <name>
//     (<role>)' per such role in the plan, pins that holder in the CAS guard and records it as
//     replacedLockedHolders in the schedule.day_edit detail (the net lock flag is unchanged,
//     so no schedule.lock row - the same as the editor's untick + retick).
//   - the row after (saveDayEdit 1801-1823): primary and backup must differ (1803);
//     a roster primary replaces an external cover (1804); the note is stripped of an
//     old '[override: ...]' tag and, with overrides, prefixed with
//     '[override: <Name> <role>: <reasons>]' (1807-1812); source = 'manual-external'
//     when either holder is an outside surgeon, else the row's own claim / trade source
//     while a held role keeps its holder, else 'manual' for the WHOLE row (1815-1822)
//     - so a backup edit on an import / generated row turns the row's source to
//     'manual' (this tool does the same and says so). An edit that changes nothing
//     writes nothing (sameAssignment, 1823). Primary columns are untouched by a backup
//     edit: only the role's id + lock, source, note, version, updated_by, updated_at move.
//   - the lock: DayEditor locks a pick automatically ONLY for an outside surgeon
//     (5713, 5727); a pool pick keeps the role's flag until the scheduler ticks
//     "Lock <role>" (toggleLock 5736). Faraz asked for LOCKED edits, so --lock is the
//     default here; --no-lock keeps the live flag. A cleared role (OPEN) is never locked.
//   - the write: the autosave's days leg, syncScheduleDays -> patchDayRow (1123-1131):
//     PATCH schedule_days?day=eq.<day>&version=eq.<seen> with the whole row body +
//     version <seen>+1, updated_by, updated_at; zero rows back = conflict. Here: one
//     UPDATE per day guarded by day + version + the expected current holder of every
//     edited role (`<role>_id is not distinct from <expected>`), GET DIAGNOSTICS + RAISE
//     'DAY_EDIT_CAS_MISMATCH' on anything but one row -> the whole transaction rolls back.
//   - the snapshot: saveDayEdit takes NO snapshot (pushUndo, 1824, is an in-memory undo
//     point; snapshots.capture runs before clear / generate / import / reset only). Faraz
//     asked for one, so the SQL captures FIRST, with the publish tool's statement (the
//     same jsonb_build_object shape as config.js snapshots.capture and importer.js),
//     reason 'day_edit' (its own string, so Settings -> restore can tell it apart),
//     created_by the --by tag; a failed capture RAISEs and nothing is written (exit 4).
//   - the audit (logAudit 784-796: actor_id, actor_name, action, detail { summary, ...}):
//     'schedule.day_edit' with { day, before, after (helpers.assignmentToDayRow rows),
//     overrides } and the summary fmtMD(day) + ": " + the change lines
//     (helpers.diffScheduleDays / formatDayChange, 1826-1830); 'schedule.override' when
//     overrides were confirmed (1831); 'schedule.lock' when a lock flag changed (1834-1835).
//     Here: the same rows, actor_id null, actor_name the --by tag, plus
//     mode: "command-line", tool and the snapshot id, written AFTER the UPDATEs inside
//     the same transaction.
//   - NOT mirrored, on purpose: the notifications row of type manual_edit
//     (addNotification, 1841) and the e-mail to every holder before / after
//     (sendEmailNotif manual_edit, 1842). The tool PRINTS what the editor would have
//     queued (type, message, recipients) and writes neither - Faraz decides. The preview is
//     signed the app's way (a display name: --by-name, else the text of --by before ' ('),
//     not with the whole tag.
//
// --dry-run (default): reads the live rows with the PUBLIC anon key (the seven
//   sources scripts/preview-generate.js reads, through scripts/publish-preview.js
//   fetchLive), builds the plan, evaluates eligibility on the live ctx (and, with
//   --availability-from-seed, again with the seed's availability rows in place of the
//   live table - the dry run says which one gates), prints before / after per day,
//   the notifications preview, writes the SQL to --out and exits. Nothing is written
//   to the database.
// --apply: same, then runs the SQL through
//   supabase db query --linked --workdir <dir> -f <abs sql path>
//   (service role, server side), re-reads schedule_days and VERIFIES every planned row
//   (body, version + 1, the tag), every row outside the plan unchanged and a fresh plan
//   reading zero rows; prints the four rows before / after.
//
// Exit codes: 0 ok / 1 error or not verified (also --apply without --workdir, an --expect
// with no --set: both refused in parseArgs before any read or file write) / 2 refused (a
// hard eligibility failure without --override, a thrown check, primary = backup, no live
// row) / 3 CAS mismatch (--expect differs from the live row, a row without a numeric
// version, or the batch raised DAY_EDIT_CAS_MISMATCH) / 4 snapshot failure (the batch
// raised DAY_EDIT_ABORT: snapshot). The 3 / 4 classification reads the RAISE text of the
// CLI's output whether or not `supabase db query` exits non-zero (never observed live for a
// failed statement in a multi-statement file); if the text carries no RAISE and the rows
// still did not move, the post-apply re-read reports NOT VERIFIED (exit 1) - the DO block
// rolled back in every one of those cases, nothing persists. process.exitCode, not
// process.exit(): let the event loop drain after fetch() (see scripts/import-seed.js header).
// No email address or phone number is ever read, printed or written here.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const H = require(path.join(ROOT, "helpers.js"));
const R = require(path.join(ROOT, "rules.js"));
const IMP = require(path.join(ROOT, "importer.js"));
const PUB = require(path.join(ROOT, "scripts", "publish-preview.js"));

const SNAPSHOT_REASON = "day_edit";
const AUDIT_ACTION = "schedule.day_edit";          // index-source.html:1828 logAudit("schedule.day_edit", ...)
const AUDIT_OVERRIDE_ACTION = "schedule.override"; // index-source.html:1831
const AUDIT_LOCK_ACTION = "schedule.lock";         // index-source.html:1835
const EXIT = { OK: 0, ERROR: 1, REFUSED: 2, CAS: 3, SNAPSHOT: 4 };
const ROLES = ["primary", "backup"];
const DEFAULT_SEED = path.join(ROOT, "docs", "silvis-seed.json");

const S = IMP.impSqlStr, B = IMP.impSqlBool, J = IMP.impSqlJson;

/* ------------------------------------------------------------- specs */

function isIso(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

function parseSpec(spec, flag) {
  const m = /^([^:]+):([^=]+)=(.*)$/.exec(String(spec || ""));
  if (!m) throw new Error(flag + " expects <day>:<role>=<id|OPEN" + (flag === "--set" ? "|ext:label" : "") + ">, got '" + spec + "'");
  const day = m[1], role = m[2], raw = m[3].trim();
  if (!isIso(day)) throw new Error(flag + ": the day must be ISO YYYY-MM-DD, got '" + day + "'");
  if (role !== "primary" && role !== "backup") throw new Error(flag + ": the role must be primary or backup, got '" + role + "'");
  if (!raw) throw new Error(flag + " expects a value after '=' (an id, OPEN or ext:<label>)");
  return { day, role, raw };
}

// parseSet("2026-10-09:backup=s2") -> { day, role, value }; OPEN -> null; ext:<label> kept as is (primary only, checked in the plan).
function parseSet(spec) {
  const p = parseSpec(spec, "--set");
  return { day: p.day, role: p.role, value: /^open$/i.test(p.raw) ? null : p.raw };
}

// parseExpect("2026-10-09:backup=s1") -> { day, role, holder } (OPEN -> null).
function parseExpect(spec) {
  const p = parseSpec(spec, "--expect");
  return { day: p.day, role: p.role, holder: /^open$/i.test(p.raw) ? null : p.raw };
}

// signerOf("Faraz (day-edit CLI, 2026-09-23)") -> "Faraz": the name the notice preview is signed with (the app signs
// with userProfile.display_name || nameOf(mySurgeon), index-source.html:1840 - never with a tag). --by-name overrides.
function signerOf(by) {
  const s = String(by || "").trim();
  const i = s.indexOf(" (");
  return (i > 0 ? s.slice(0, i) : s).trim() || s;
}

function parseArgs(argv) {
  const a = { sets: [], expects: [], by: null, byName: null, lock: true, note: undefined, override: false, availabilityFromSeed: false,
    mode: "dry-run", workdir: process.env.SILVIS_SUPABASE_WORKDIR || null, out: null, seed: DEFAULT_SEED };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--set") a.sets.push(parseSet(argv[++i]));
    else if (t === "--expect") a.expects.push(parseExpect(argv[++i]));
    else if (t === "--by") a.by = argv[++i];
    else if (t === "--by-name") a.byName = argv[++i];
    else if (t === "--lock") a.lock = true;
    else if (t === "--no-lock") a.lock = false;
    else if (t === "--note") a.note = argv[++i];
    else if (t === "--override") a.override = true;
    else if (t === "--availability-from-seed") a.availabilityFromSeed = true;
    else if (t === "--dry-run") a.mode = "dry-run";
    else if (t === "--apply") a.mode = "apply";
    else if (t === "--workdir") a.workdir = argv[++i];
    else if (t === "--out") a.out = path.resolve(argv[++i]);
    else if (t === "--seed") a.seed = path.resolve(argv[++i]);
    else if (t === "-h" || t === "--help") { usage(); process.exit(0); }
    else throw new Error("unknown argument: " + t);
  }
  if (!a.sets.length) throw new Error("at least one --set <day>:<role>=<value> is required");
  if (!a.by || !String(a.by).trim()) throw new Error("--by \"<name>\" is required (updated_by of the rows and the audit actor)");
  // review 9/23: refused HERE, before any read and before the SQL file is written (the earlier draft refused after both)
  if (a.mode === "apply" && !a.workdir) throw new Error("--apply needs --workdir <linked supabase dir> (or SILVIS_SUPABASE_WORKDIR)");
  // review 9/23: an --expect that no --set consumes would protect nothing (a typo in the guard) - refuse it
  a.expects.forEach((x) => {
    if (!a.sets.some((s) => s.day === x.day && s.role === x.role)) throw new Error("--expect " + x.day + ":" + x.role + " has no --set for that day and role - a guard nothing consumes protects nothing (typo?)");
  });
  const scratchDir = a.workdir ? path.dirname(path.resolve(a.workdir)) : os.tmpdir();
  if (!a.out) a.out = path.join(scratchDir, a.workdir ? "day-edit.sql" : "silvis-day-edit.sql");
  return a;
}

function usage() {
  console.log("usage: node scripts/day-edit.js --set <day>:<role>=<id|OPEN|ext:label> [--set ...] --by \"<name>\" [--by-name \"<display name>\"] [--expect <day>:<role>=<id|OPEN>] [--lock|--no-lock] [--note <text>] [--override] [--availability-from-seed] [--dry-run | --apply --workdir <linked dir>] [--out <sql>] [--seed <path>]");
}

/* --------------------------------------------------------------- plan */

function describeAssignment(a) {
  return "P " + (a.primary || (a.externalCover ? a.externalCover + " (external)" : "OPEN")) + (a.primaryLocked ? "*" : "") +
    " / B " + (a.backup || "OPEN") + (a.backupLocked ? "*" : "");
}

function stripOverrideTag(note) { return String(note || "").replace(/^\[override:[^\]]*\]\s*/, "").trim(); }

function nameOfFactory(roster) {
  return (id) => { const r = (roster || []).find((x) => x.id === id); return r ? r.name : (id == null ? "OPEN" : id); };
}

// scheduleFromRows(rows, base?) -> the in-memory map the app holds (helpers.dayRowToAssignment), over an optional base map.
function scheduleFromRows(rows, base) {
  const out = base ? JSON.parse(JSON.stringify(base)) : {};
  (rows || []).forEach((r) => { if (r && r.day) out[String(r.day).slice(0, 10)] = H.dayRowToAssignment(r); });
  return out;
}

// Recompute the derived fields of a plan day from its `after` assignment (used after an override changes the note).
function finishDay(d, nameOf) {
  d.afterRow = H.assignmentToDayRow(d.day, d.after);
  d.changedCols = Object.keys(d.afterRow).filter((k) => k !== "day" && JSON.stringify(d.afterRow[k]) !== JSON.stringify(d.beforeRow[k]));
  d.lockChanges = ROLES.filter((r) => !!d.before[r + "Locked"] !== !!d.after[r + "Locked"]).map((r) => ({ role: r, locked: !!d.after[r + "Locked"] }));
  d.lines = H.diffScheduleDays({ [d.day]: d.before }, { [d.day]: d.after }).map((c) => H.formatDayChange(c, nameOf));
  d.roleChanged = d.before.primary !== d.after.primary || d.before.backup !== d.after.backup || (d.before.externalCover || null) !== (d.after.externalCover || null);
  return d;
}

// planEdits(liveRows, edits, opts) -> { ok, problems[], exitCode, days[], skipped[] }
//   edits: [{ day, role, value }] (parseSet); opts: { lock (default true), note, by, roster, expects: [{day, role, holder}] }
//   days[]: { day, seenVersion, nextVersion, before, after, beforeRow, afterRow, changedCols, lockChanges, lines,
//            expected: { <role>: liveHolder }, editedRoles, edits, overrides: [], baseNote, roleChanged }
function planEdits(liveRows, edits, opts) {
  opts = opts || {};
  const lock = opts.lock !== false;
  const roster = opts.roster || [];
  const nameOf = nameOfFactory(roster);
  const isExternalId = (id) => !!(id && roster.find((s) => s.id === id && s.type === "external"));
  const live = {};
  (liveRows || []).forEach((r) => { if (r && r.day) live[String(r.day).slice(0, 10)] = r; });
  const byDay = {};
  (edits || []).forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
  const expects = {};
  (opts.expects || []).forEach((x) => { expects[x.day + "|" + x.role] = x; });
  const out = { ok: true, problems: [], exitCode: EXIT.OK, days: [], skipped: [], nameOf };
  let casProblem = false;

  Object.keys(byDay).sort().forEach((day) => {
    const L = live[day];
    if (!L) { out.problems.push(day + ": no live row - the tool edits published rows only (create the day in the app first)"); return; }
    if (typeof L.version !== "number") { out.problems.push(day + ": the live row has no numeric version - cannot compare-and-swap"); casProblem = true; return; }
    const before = H.dayRowToAssignment(L);
    const after = Object.assign(H.emptyDayAssignment(), before);
    const expected = {}, editedRoles = [], replacedLocked = [];
    byDay[day].forEach((e) => {
      const role = e.role;
      if (editedRoles.indexOf(role) < 0) editedRoles.push(role);
      expected[role] = before[role];
      // review 9/23: the editor cannot re-assign a LOCKED role without unticking Lock first (the select is disabled;
      // clearRole refuses 'unlock it first') - the tool does it in one step but says so in the plan and the audit detail
      if (before[role + "Locked"] && before[role] && before[role] !== (e.value || null) && !replacedLocked.some((x) => x.role === role)) replacedLocked.push({ role, holder: before[role] });
      const x = expects[day + "|" + role];
      if (x && x.holder !== before[role]) {
        out.problems.push(day + ": --expect says " + role + " " + (x.holder || "OPEN") + " but the live row holds " + role + " " + (before[role] || "OPEN") + " (live v" + L.version + ", live s" + "ource '" + (L.source || "") + "') - refusing before any SQL (exit 3)");
        casProblem = true;
        return;
      }
      if (typeof e.value === "string" && e.value.indexOf("ext:") === 0) {
        if (role !== "primary") { out.problems.push(day + ": an external cover applies to primary only (the editor's 'Outside cover' input)"); return; }
        after.primary = null;
        after.externalCover = e.value.slice(4).trim() || null;
        after.primaryLocked = after.externalCover ? (lock ? true : before.primaryLocked) : false;
        return;
      }
      after[role] = e.value || null;
      after[role + "Locked"] = e.value ? (lock ? true : !!before[role + "Locked"]) : false;   // a cleared role is never locked
      if (role === "primary" && e.value) after.externalCover = null;                          // saveDayEdit 1804
    });
    if (after.primary && after.primary === after.backup) { out.problems.push(day + ": primary and backup must be different people (the editor refuses the same pick; schedule_days_distinct_roles)"); return; }
    after.externalCover = (after.externalCover || "").trim() || null;
    const baseNote = stripOverrideTag(opts.note !== undefined && opts.note !== null ? opts.note : after.note);
    after.note = baseNote || null;
    // DayEditor.dirty (5657): an unchanged draft never reaches onSave - compared BEFORE the source is assigned
    // (saveDayEdit sets it afterwards), so a same-holder / same-lock / same-note edit writes nothing.
    if (H.sameDayAssignment(day, before, Object.assign({}, after, { source: before.source }))) { out.skipped.push(day); return; }
    // saveDayEdit 1815-1822: manual-external / the row's own claim-trade source / manual for the whole row
    const keepPersonSource = (before.source === "claim" || before.source === "trade") && ROLES.some((r) => !!before[r] && before[r] === after[r]);
    after.source = (isExternalId(after.primary) || isExternalId(after.backup)) ? "manual-external" : keepPersonSource ? before.source : "manual";
    const d = {
      day, seenVersion: L.version, nextVersion: L.version + 1, before, after,
      beforeRow: H.assignmentToDayRow(day, before), expected, editedRoles, replacedLocked,
      edits: byDay[day].map((e) => ({ role: e.role, from: before[e.role], to: e.value })), overrides: [], baseNote, updatedBy: opts.by || null
    };
    finishDay(d, nameOf);
    out.days.push(d);
  });
  if (out.problems.length) { out.ok = false; out.exitCode = casProblem ? EXIT.CAS : EXIT.REFUSED; out.days = []; }
  return out;
}

/* -------------------------------------------------------- eligibility */

function dayNum(s) { return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000); }
function fromDayNum(n) { return new Date(n * 86400000).toISOString().slice(0, 10); }
function addDays(s, k) { return fromDayNum(dayNum(s) + k); }
function dow(s) { return new Date(s + "T00:00:00Z").getUTCDay(); }   // 0 = Sun .. 6 = Sat, like the editor's parse(day).getDay()

// pickTimeSchedules(liveSchedule, plan) -> { day: scheduleMap } - the DayEditor's draft at pick time (5660): the day's
// row with every edited role cleared and unlocked, source 'manual', everything else as SAVED. "Saved" is a RUNNING
// schedule (review 9/23, major): the app saves one day at a time and the next pick sees the earlier save, so day n's
// draft is live + the `after` of every earlier plan day (plan.days are in date order). A hard rule two edits of one
// batch create together (Khan Fri-Sun + Mon = max-consecutive) is therefore seen, exactly as sequential editor saves
// would show it; the earlier days are folded in as saved rows (their after, locks included), never as drafts.
function pickTimeSchedules(liveSchedule, plan) {
  const out = {};
  const running = JSON.parse(JSON.stringify(liveSchedule || {}));
  (plan.days || []).slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).forEach((d) => {
    const sched = JSON.parse(JSON.stringify(running));
    const draft = Object.assign(H.emptyDayAssignment(), d.before);
    d.editedRoles.forEach((role) => { draft[role] = null; draft[role + "Locked"] = false; });
    draft.source = "manual";
    sched[d.day] = draft;
    out[d.day] = sched;
    running[d.day] = Object.assign(H.emptyDayAssignment(), d.after);   // landed: the next day is asked against it
  });
  return out;
}

// DayEditor.editorBlockDays / holdsOtherBlockDays (5665-5679): the Fri-Sun triple of the day (null Mon-Thu or when any
// of the three is a holiday-unit day); the candidate holds the OTHER two days of it in the role on the saved rows.
function holdsOtherBlockDays(ctx, liveSchedule, day, role, id) {
  const w = dow(day);
  const idx = w === 5 ? 0 : w === 6 ? 1 : w === 0 ? 2 : -1;
  if (idx < 0) return false;
  const fri = addDays(day, -idx);
  const days = [0, 1, 2].map((i) => addDays(fri, i));
  if (ctx && ctx.holidayByDay && days.some((x) => ctx.holidayByDay[x])) return false;
  return days.every((x) => x === day || !!(liveSchedule[x] && liveSchedule[x][role] === id));
}

// evaluateEdits(plan, liveSchedule, mkCtx) -> [{ day, role, id, ok, hard, soft, lockHolder, conflicts, error, asBlockMember, external }]
//   mkCtx(draftSchedule, day) -> a rules ctx built from that schedule (DayEditor.safeBuildContext). Roles set to OPEN or to an
//   external cover are not evaluated (nothing to ask). A thrown check fails closed with 'rules-error:<msg>' (evalRole 5688-5694).
//   Each day is evaluated on its running pick-time draft (earlier plan days landed - see pickTimeSchedules), the block-member
//   check included (holdsOtherBlockDays reads the OTHER days of the Fri-Sun triple from that same running state).
function evaluateEdits(plan, liveSchedule, mkCtx) {
  const drafts = pickTimeSchedules(liveSchedule, plan);
  const out = [];
  (plan.days || []).forEach((d) => {
    const ctx = mkCtx(drafts[d.day], d.day);
    d.editedRoles.forEach((role) => {
      const id = d.after[role];
      if (!id) return;
      const P = ctx && ctx.per ? ctx.per[id] : null;
      const external = !!(P && P.external);
      const asBlockMember = !external && holdsOtherBlockDays(ctx, drafts[d.day], d.day, role, id);
      let r;
      try { r = R.eligibility(ctx, d.day, role, id, external ? { manual: true } : (asBlockMember ? { asBlockMember: true } : undefined)); }
      catch (e) { const msg = String(e && e.message || e).slice(0, 120); r = { ok: false, hard: ["rules-error:" + msg], soft: [], error: msg }; }
      out.push({ day: d.day, role, id, ok: !!r.ok, hard: (r.hard || []).slice(), soft: (r.soft || []).slice(), lockHolder: !!r.lockHolder, conflicts: (r.conflicts || []).slice(), error: r.error || null, asBlockMember, external });
    });
  });
  return out;
}

// gate(plan, evals, { override, nameOf }) -> { refusals[], exitCode, overrides[] }. Mutates the plan days like the editor:
// with --override a hard failure is recorded ({ id, role, reasons }, confirmOverride 5721-5731) and the note gets
// saveDayEdit's tag (1809-1812); without it the day editor's override warning is a refusal (exit 2). A thrown check is
// refused either way (evalBroken 5703). Re-entrant: the note is rebuilt from the day's stripped base note each time.
function gate(plan, evals, opts) {
  opts = opts || {};
  const nameOf = opts.nameOf || (opts.roster ? nameOfFactory(opts.roster) : plan.nameOf) || nameOfFactory([]);
  const refusals = [], overrides = [];
  (plan.days || []).forEach((d) => { d.overrides = []; });
  (evals || []).forEach((e) => {
    if (e.ok) return;
    const d = (plan.days || []).find((x) => x.day === e.day);
    if (!d) return;
    if (e.error) { refusals.push(e.day + ": the eligibility check for " + nameOf(e.id) + " " + e.role + " THREW (" + e.error + ") - the editor disables Save until the rules evaluate again; not overridable"); return; }
    if (!opts.override) {
      refusals.push(e.day + ": " + nameOf(e.id) + " " + e.role + " - hard: " + e.hard.join(", ") + ". The day editor would ask \"Override?\" here - re-run with --override to save it anyway (the note gets the '[override: ...]' tag and a schedule.override audit row is written).");
      return;
    }
    d.overrides.push({ id: e.id, role: e.role, reasons: e.hard.slice() });
    overrides.push({ day: e.day, id: e.id, role: e.role, reasons: e.hard.slice() });
  });
  (plan.days || []).forEach((d) => {
    let note = d.baseNote || "";
    if (d.overrides.length) {
      const tag = "[override: " + d.overrides.map((o) => nameOf(o.id) + " " + o.role + ": " + o.reasons.join(", ")).join("; ") + "]";
      note = note ? tag + " " + note : tag;
    }
    d.after.note = note || null;
    finishDay(d, nameOf);
  });
  return { refusals, overrides, exitCode: refusals.length ? EXIT.REFUSED : EXIT.OK };
}

/* ---------------------------------------------------------------- SQL */

function auditDetail(d, nameOf) {
  const detail = {
    summary: H.fmtMD(d.day) + ": " + (d.lines.join("; ") || "edited"),            // saveDayEdit 1828
    day: d.day, before: d.beforeRow, after: d.afterRow, overrides: d.overrides,
    mode: "command-line", tool: "scripts/day-edit.js", changedColumns: d.changedCols, seenVersion: d.seenVersion
  };
  if (d.replacedLocked && d.replacedLocked.length) detail.replacedLockedHolders = d.replacedLocked.slice();   // the editor's untick-pick-retick, done in one step
  return detail;
}

// dayEditSql(plan, { by, now }) -> the batch, or null when there is nothing to write.
function dayEditSql(plan, opts) {
  opts = opts || {};
  if (!plan || !plan.ok || !plan.days || !plan.days.length) return null;
  const by = opts.by || plan.days[0].updatedBy || "day-edit CLI";
  const nameOf = opts.nameOf || (opts.roster ? nameOfFactory(opts.roster) : plan.nameOf) || nameOfFactory([]);
  const now = opts.now || new Date().toISOString();
  const L = [];
  L.push("-- Silvis day-edit - generated " + now + " by scripts/day-edit.js");
  L.push("-- " + plan.days.length + " day(s): " + plan.days.map((d) => d.day + " (" + d.editedRoles.join("+") + ")").join(", ") + "; updated_by / actor " + by);
  L.push("-- Mirrors the app's day editor save (index-source.html saveDayEdit): CAS write per day, audit schedule.day_edit (+ schedule.lock / schedule.override).");
  L.push("-- Snapshot FIRST (reason 'day_edit'; the app's editor keeps an undo point instead - this is the publish tool's capture).");
  L.push("-- No notice row and no mail: the editor would queue a manual_edit notice to every holder - the dry run prints it; Faraz decides.");
  L.push("-- Atomic: one DO block - a snapshot failure or any CAS mismatch RAISEs and nothing persists.");
  L.push("-- The body uses a tagged dollar quote so a note or audit string containing a bare double-dollar cannot end it early.");
  L.push("begin;");
  L.push("do $de$");
  L.push("declare");
  L.push("  v_snap uuid;");
  L.push("  v_before bigint;");
  L.push("  v_after bigint;");
  L.push("  v_n integer;");
  L.push("  v_audit uuid;");
  L.push("begin");
  L.push("  -- 1. snapshot FIRST (the same data shape as snapshots.capture, importer.js and publish-preview.js)");
  L.push("  select count(*) into v_before from public.call_schedule_snapshots;");
  L.push("  insert into public.call_schedule_snapshots (reason, data, source_updated_at, created_by)");
  L.push("  select " + S(SNAPSHOT_REASON) + ",");
  L.push("         jsonb_build_object(");
  L.push("           'config',        (select data from public.call_schedule_data where id = 'main'),");
  L.push("           'schedule_days', (select coalesce(jsonb_agg(to_jsonb(s) order by s.day), '[]'::jsonb) from public.schedule_days s),");
  L.push("           'time_off',      (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.time_off t),");
  L.push("           'availability',  (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from public.availability a)),");
  L.push("         (select updated_at from public.call_schedule_data where id = 'main'),");
  L.push("         " + S(by));
  L.push("  returning id into v_snap;");
  L.push("  select count(*) into v_after from public.call_schedule_snapshots;");
  L.push("  if v_snap is null or v_after <> v_before + 1 then raise exception 'DAY_EDIT_ABORT: snapshot not captured (before %, after %)', v_before, v_after; end if;");
  L.push("");
  L.push("  -- 2. schedule_days: one compare-and-swap UPDATE per day - day + the version the dry run saw + the expected holder of every edited role");
  plan.days.forEach((d) => {
    const r = d.afterRow;
    const sets = [];
    d.editedRoles.forEach((role) => { sets.push(role + "_id = " + S(r[role + "_id"])); sets.push(role + "_locked = " + B(r[role + "_locked"])); });
    if (d.changedCols.indexOf("external_cover") >= 0) sets.push("external_cover = " + S(r.external_cover));
    sets.push("source = " + S(r.source));
    sets.push("note = " + S(r.note));
    const guards = d.editedRoles.map((role) => role + "_id is not distinct from " + S(d.expected[role]));
    L.push("  -- " + d.day + ": " + (d.lines.join("; ") || "edited"));
    L.push("  update public.schedule_days set");
    L.push("    " + sets.join(", ") + ",");
    L.push("    version = version + 1, updated_by = " + S(by) + ", updated_at = now()");
    L.push("  where day = " + S(d.day) + " and version = " + d.seenVersion + " and " + guards.join(" and ") + ";");
    L.push("  get diagnostics v_n = row_count;");
    L.push("  if v_n <> 1 then raise exception 'DAY_EDIT_CAS_MISMATCH: " + d.day + " expected version " + d.seenVersion + " and " + d.editedRoles.map((role) => role + " " + (d.expected[role] || "OPEN")).join(", ") + " - % row(s) matched; the row changed since the dry run', v_n; end if;");
  });
  L.push("");
  L.push("  -- 3. every planned row and nothing else carries this run's stamp (now() is the transaction's timestamp)");
  L.push("  select count(*) into v_n from public.schedule_days where updated_by = " + S(by) + " and updated_at = now();");
  L.push("  if v_n <> " + plan.days.length + " then raise exception 'DAY_EDIT_ABORT: expected % row(s) written by this run, found %', " + plan.days.length + ", v_n; end if;");
  L.push("");
  L.push("  -- 4. audit: the app's rows (logAudit) - actor_name = the --by tag, actor_id null");
  plan.days.forEach((d) => {
    L.push("  -- audit " + d.day);
    L.push("  insert into public.audit_log (actor_id, actor_name, action, detail)");
    L.push("  values (null, " + S(by) + ", " + S(AUDIT_ACTION) + ", " + J(auditDetail(d, nameOf)) + " || jsonb_build_object('snapshotId', v_snap))");
    L.push("  returning id into v_audit;");
    L.push("  if v_audit is null then raise exception 'DAY_EDIT_ABORT: audit row not written for " + d.day + "'; end if;");
    if (d.overrides.length) {
      const summary = "Override on " + H.fmtMD(d.day) + ": " + d.overrides.map((o) => nameOf(o.id) + " " + o.role + " despite " + o.reasons.join(", ")).join("; ");
      L.push("  insert into public.audit_log (actor_id, actor_name, action, detail)");
      L.push("  values (null, " + S(by) + ", " + S(AUDIT_OVERRIDE_ACTION) + ", " + J({ summary, day: d.day, overrides: d.overrides, mode: "command-line", tool: "scripts/day-edit.js" }) + ");");
    }
    if (d.lockChanges.length) {
      const summary = H.fmtMD(d.day) + ": " + d.lockChanges.map((c) => c.role + (c.locked ? " locked" : " unlocked")).join(", ");
      L.push("  insert into public.audit_log (actor_id, actor_name, action, detail)");
      L.push("  values (null, " + S(by) + ", " + S(AUDIT_LOCK_ACTION) + ", " + J({ summary, day: d.day, changes: d.lockChanges, mode: "command-line", tool: "scripts/day-edit.js" }) + ");");
    }
  });
  L.push("end $de$;");
  L.push("commit;");
  L.push("-- what --apply verifies (scoped to the LATEST run's stamp)");
  L.push("select");
  L.push("  (select id from public.call_schedule_snapshots where created_by = " + S(by) + " and reason = " + S(SNAPSHOT_REASON) + " order by created_at desc limit 1) as snapshot_id,");
  L.push("  (select count(*) from public.call_schedule_snapshots) as snapshots_after,");
  L.push("  (select count(*) from public.audit_log where actor_name = " + S(by) + " and created_at = (select created_at from public.call_schedule_snapshots where created_by = " + S(by) + " and reason = " + S(SNAPSHOT_REASON) + " order by created_at desc limit 1)) as audit_rows,");
  L.push("  (select max(updated_at) from public.schedule_days where updated_by = " + S(by) + ") as stamped_at,");
  L.push("  (select count(*) from public.schedule_days where updated_by = " + S(by) + " and updated_at = (select max(updated_at) from public.schedule_days where updated_by = " + S(by) + ")) as days_by_tool,");
  L.push("  (select count(*) from public.schedule_days) as schedule_days;");
  L.push("");
  return L.join("\n");
}

/* ------------------------------------------------------ notifications */

// notificationsPreview(plan, nameOf, byName) -> what saveDayEdit 1836-1842 WOULD queue for each day whose holders changed:
// the notifications row (type manual_edit, title, message, data) and the e-mail (sendEmailNotif manual_edit to the holders
// before and after). Printed by the CLI, never written.
function notificationsPreview(plan, nameOf, byName) {
  const out = [];
  (plan.days || []).forEach((d) => {
    if (!d.roleChanged) return;
    const affected = [];
    [d.before.primary, d.before.backup, d.after.primary, d.after.backup].forEach((id) => { if (id && affected.indexOf(id) < 0) affected.push(id); });
    if (!affected.length) return;
    const msg = H.manualEditMsg(d.lines.filter((l) => / [PB] /.test(l)), byName);
    out.push({
      day: d.day, type: "manual_edit", title: "Schedule changed", message: msg,
      data: { surgeon_id: d.after.primary || d.after.backup || d.before.primary || d.before.backup, day: d.day, affected },
      email: { type: "manual_edit", subject: "Schedule changed - " + H.fmtMD(d.day), targetIds: affected.slice() }
    });
  });
  return out;
}

function renderNotifications(prev, nameOf) {
  const L = [];
  L.push("notifications the day editor WOULD queue (NOT written by this tool - Faraz decides): " + (prev.length || "none"));
  prev.forEach((p) => {
    L.push("  " + p.day + ": notifications row type " + p.type + " '" + p.title + "' -> \"" + p.message.replace(/\n/g, " / ") + "\" (data surgeon_id " + p.data.surgeon_id + ", affected " + p.data.affected.map(nameOf).join(", ") + ")");
    L.push("  " + p.day + ": e-mail " + p.email.type + " '" + p.email.subject + "' to " + p.email.targetIds.map(nameOf).join(", "));
  });
  return L.join("\n");
}

/* ------------------------------------------------------------- verify */

// applyToLive(liveRows, plan, by) -> the rows as they must read after --apply (the simulation the test and the
// post-apply verification share).
function applyToLive(liveRows, plan, by) {
  const ts = new Date().toISOString();
  return (liveRows || []).map((r) => {
    const d = (plan.days || []).find((x) => x.day === String(r.day).slice(0, 10));
    if (!d) return Object.assign({}, r);
    return Object.assign({}, r, d.afterRow, { version: d.nextVersion, updated_by: by, updated_at: ts });
  });
}

// verifyApplied(plan, afterRows, by) -> { ok, problems[] }: every planned day is on file with the planned body,
// version + 1 and the tag.
function verifyApplied(plan, afterRows, by) {
  const after = {};
  (afterRows || []).forEach((r) => { after[String(r.day).slice(0, 10)] = r; });
  const problems = [];
  (plan.days || []).forEach((d) => {
    const a = after[d.day];
    if (!a) { problems.push(d.day + ": no row after apply"); return; }
    const got = H.assignmentToDayRow(d.day, H.dayRowToAssignment(a));
    Object.keys(d.afterRow).forEach((k) => { if (JSON.stringify(d.afterRow[k]) !== JSON.stringify(got[k])) problems.push(d.day + ": " + k + " is " + JSON.stringify(got[k]) + ", planned " + JSON.stringify(d.afterRow[k])); });
    if (a.version !== d.nextVersion) problems.push(d.day + ": version is " + a.version + ", expected " + d.nextVersion);
    if (a.updated_by !== by) problems.push(d.day + ": updated_by is '" + a.updated_by + "', expected the --by tag");
  });
  return { ok: problems.length === 0, problems };
}

// verifyUntouched(beforeRows, afterRows, plan) -> publish-preview's check over the rows OUTSIDE the plan.
function verifyUntouched(beforeRows, afterRows, plan) {
  return PUB.verifyUntouched(beforeRows, afterRows, { rows: (plan.days || []).map((d) => ({ day: d.day, action: "update" })) });
}

// classifyCliFailure(text) -> the exit code for a failed `supabase db query` run, from the RAISE text.
function classifyCliFailure(text) {
  const s = String(text || "");
  if (/DAY_EDIT_ABORT: snapshot/.test(s)) return EXIT.SNAPSHOT;
  if (/DAY_EDIT_CAS_MISMATCH/.test(s)) return EXIT.CAS;
  return EXIT.ERROR;
}

// detectBatchFailure(text) -> 0 when the CLI's output carries no RAISE of ours, else the exit code for the RAISE it
// carries. Review 9/23: exit 3 / 4 must not depend on `supabase db query` exiting non-zero (its behaviour on a failed
// statement inside a multi-statement file was never observed live) - a 0-exit run whose text shows the DO block's
// RAISE is still classified as CAS (3) / snapshot (4) / other abort (1); the transaction rolled back either way.
function detectBatchFailure(text) {
  const s = String(text || "");
  if (!/DAY_EDIT_ABORT|DAY_EDIT_CAS_MISMATCH/.test(s)) return 0;
  return classifyCliFailure(s);
}

/* ------------------------------------------------------------- render */

function renderPlan(plan, nameOf) {
  const L = [];
  if (!plan.ok) { L.push("PLAN REFUSED (" + plan.problems.length + "):"); plan.problems.forEach((p) => L.push("  " + p)); return L.join("\n"); }
  L.push("rows to write: " + plan.days.length + (plan.skipped.length ? "; unchanged (nothing to write): " + plan.skipped.join(", ") : ""));
  plan.days.forEach((d) => {
    L.push("  " + d.day + " v" + d.seenVersion + " -> v" + d.nextVersion + ": " + describeAssignment(d.before) + "  ->  " + describeAssignment(d.after));
    L.push("    before: " + JSON.stringify(d.beforeRow));
    L.push("    after:  " + JSON.stringify(d.afterRow) + " updated_by " + JSON.stringify(d.updatedBy));
    L.push("    changes: " + (d.lines.join("; ") || "none") + "; columns: " + d.changedCols.join(", ") + "; CAS expects " + d.editedRoles.map((r) => r + " " + (d.expected[r] || "OPEN")).join(", "));
    (d.replacedLocked || []).forEach((x) => L.push("    replacing LOCKED holder " + nameOf(x.holder) + " (" + x.role + ") - the app's editor needs the Lock untick first; the CAS pins that holder and the audit detail names it"));
    if (d.overrides.length) L.push("    OVERRIDE: " + d.overrides.map((o) => nameOf(o.id) + " " + o.role + " despite " + o.reasons.join(", ")).join("; "));
  });
  return L.join("\n");
}

function renderEvals(evals, nameOf, label) {
  const L = [];
  L.push("eligibility (" + label + "): " + evals.length + " check(s)");
  evals.forEach((e) => {
    L.push("  " + e.day + " " + e.role + " " + nameOf(e.id) + ": " + (e.ok ? "ok" : "HARD " + e.hard.join(", ")) +
      (e.soft.length ? "; soft " + e.soft.map((s) => s.reason + (typeof s.weight === "number" ? "(" + s.weight + ")" : "")).join(", ") : "") +
      (e.lockHolder ? "; lock holder" + (e.conflicts.length ? " breaks " + e.conflicts.join(", ") : "") : "") +
      (e.asBlockMember ? "; asked as a Fri-Sun block member" : "") + (e.error ? "; THREW " + e.error : ""));
  });
  return L.join("\n");
}

/* --------------------------------------------------------------- CLI */

function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const url = (src.match(/const\s+SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
  const key = (src.match(/const\s+SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error("could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js");
  return { url, key };
}

function q(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

// Runs the batch through the linked CLI; returns { rows, text }. Throws with the CLI's text on a non-zero exit.
function runSupabase(workdir, sqlPath) {
  const cmd = ["supabase", "db", "query", "--linked", "--workdir", q(workdir), "-o", "json", "-f", q(sqlPath)].join(" ");
  console.log("\n$ " + cmd);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const outText = (r.stdout || "") + (r.stderr || "");
  const cleaned = outText.split(/\r?\n/).filter((l) => !/new version of Supabase CLI|recommend updating regularly/.test(l)).join("\n");
  console.log(cleaned.trim());
  if (r.status !== 0) { const e = new Error("supabase db query exited with status " + r.status); e.cliText = outText; throw e; }
  const rows = PUB.parseCliRows(r.stdout || "");
  if (!rows) console.error("could not parse the CLI's final select; the trailing stdout was:\n" + (r.stdout || "").slice(-400));
  return { rows, text: outText };
}

function monthSpan(days) {
  const first = days[0].slice(0, 7) + "-01";
  const last = days[days.length - 1];
  const y = +last.slice(0, 4), m = +last.slice(5, 7);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: first, end };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); usage(); return EXIT.ERROR; }
  const cfg = readConfig();
  console.log("Silvis day-edit - " + args.mode + " - " + args.sets.length + " edit(s), by " + JSON.stringify(args.by) + ", lock " + args.lock + (args.override ? ", OVERRIDE" : "") + (args.availabilityFromSeed ? ", availability from the seed" : ""));
  console.log("project " + cfg.url + " (anon read)");

  const live = await PUB.fetchLive(cfg);
  const roster = live.blob.roster || [];
  const nameOf = nameOfFactory(roster);
  console.log("live rows: schedule_days " + live.dayRows.length + ", time_off " + live.timeOffRows.length + ", availability " + live.availabilityRows.length + ", east_feed " + live.feedRows.length + ", east_forecast " + live.forecastRows.length + ", east_overrides " + live.overrideRows.length + "; blob updated " + live.blobUpdatedAt);

  const plan = planEdits(live.dayRows, args.sets, { lock: args.lock, note: args.note, by: args.by, roster, expects: args.expects });
  console.log("\n--- plan ---");
  console.log(renderPlan(plan, nameOf));
  if (!plan.ok) { console.error("\nrefused (exit " + plan.exitCode + ")"); return plan.exitCode; }
  if (!plan.days.length) { console.log("\nnothing to write - the live rows already hold these edits."); return EXIT.OK; }

  // eligibility, the editor's way: one ctx per day from the pick-time draft
  const liveSchedule = scheduleFromRows(live.dayRows);
  const range = monthSpan(plan.days.map((d) => d.day));
  const drafts = pickTimeSchedules(liveSchedule, plan);
  const variants = [{ label: "live availability rows", live }];
  if (args.availabilityFromSeed) {
    const seed = JSON.parse(fs.readFileSync(args.seed, "utf8"));
    const rows = IMP.impSeedAvailabilityRows(seed, { collapse: false });
    variants.push({ label: "the seed's availability rows (" + path.relative(ROOT, args.seed).replace(/\\/g, "/") + ", " + rows.length + " dated statements)", live: Object.assign({}, live, { availabilityRows: rows }) });
  }
  let gating = null;
  console.log("\n--- eligibility (rules.eligibility on the pick-time draft: the edited role cleared and unlocked, source manual) ---");
  for (const v of variants) {
    const ctxByDay = {}, notes = [];
    for (const d of plan.days) {
      const built = await PUB.buildLiveContext(v.live, drafts[d.day], range);
      ctxByDay[d.day] = built.ctx;
      built.notes.forEach((x) => { if (notes.indexOf(x) < 0) notes.push(x); });
    }
    if (notes.length) { console.error("ctx INCOMPLETE (" + v.label + "): " + notes.join("; ") + " - an incomplete ctx proves nothing; refusing."); return EXIT.ERROR; }
    const evals = evaluateEdits(plan, liveSchedule, (sched, day) => ctxByDay[day]);
    console.log(renderEvals(evals, nameOf, v.label));
    gating = { label: v.label, evals };   // the LAST variant gates: live by default, the seed's rows when --availability-from-seed says they are about to land
  }
  console.log("gating on: " + gating.label);
  const g = gate(plan, gating.evals, { override: args.override, nameOf });
  if (g.refusals.length) {
    console.error("\nDAY EDITOR OVERRIDE WARNING - not saved:");
    g.refusals.forEach((r) => console.error("  " + r));
    console.error("refused (exit " + g.exitCode + ")");
    return g.exitCode;
  }
  if (g.overrides.length) { console.log("\nOVERRIDE confirmed (--override) - the note carries the tag, a schedule.override audit row is written:"); g.overrides.forEach((o) => console.log("  " + o.day + " " + nameOf(o.id) + " " + o.role + " despite " + o.reasons.join(", "))); }

  console.log("\n--- rows (final) ---");
  console.log(renderPlan(plan, nameOf));
  const signer = args.byName || signerOf(args.by);   // the app signs with a display name (1840), never a tag
  const prev = notificationsPreview(plan, nameOf, signer);
  console.log("\n" + renderNotifications(prev, nameOf) + "\n  (signed '(by " + signer + ")' - the app's display-name signature; --by-name changes it)");

  const sql = dayEditSql(plan, { by: args.by, nameOf });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, sql, "utf8");
  console.log("\nSQL written: " + args.out + " (" + sql.length + " bytes) - snapshot 'day_edit' first, " + plan.days.length + " CAS update(s), audit rows; no notifications statement");

  if (args.mode !== "apply") { console.log("\ndry-run: " + plan.days.length + " row(s) would be written. Nothing was written."); return EXIT.OK; }
  if (!args.workdir) { console.error("--apply needs --workdir <linked supabase dir> (or SILVIS_SUPABASE_WORKDIR)"); return EXIT.ERROR; }   // unreachable: parseArgs refuses first

  let result;
  try { result = runSupabase(path.resolve(args.workdir), args.out); }
  catch (e) {
    const code = classifyCliFailure(e.cliText || e.message);
    console.error("\nBATCH FAILED - nothing persisted (the DO block rolled back): " + (code === EXIT.SNAPSHOT ? "snapshot not captured (exit 4)" : code === EXIT.CAS ? "CAS mismatch - a row changed since the dry run; re-run the dry run (exit 3)" : e.message + " (exit 1)"));
    return code;
  }
  // review 9/23: a RAISE the CLI reported with exit 0 is still a rolled-back batch - classify it from the text
  const raised = detectBatchFailure(result.text);
  if (raised) {
    console.error("\nBATCH FAILED - the CLI exited 0 but its output carries the DO block's RAISE; nothing persisted (the transaction rolled back): " + (raised === EXIT.SNAPSHOT ? "snapshot not captured (exit 4)" : raised === EXIT.CAS ? "CAS mismatch - a row changed since the dry run; re-run the dry run (exit 3)" : "aborted (exit 1)"));
    return raised;
  }
  const row = (result.rows && result.rows[0]) || null;
  const problems = [];
  if (!row) problems.push("could not parse the CLI's final select - snapshot / audit ids unverified (run the final SELECT of " + args.out + " by hand)");
  else {
    if (!row.snapshot_id) problems.push("snapshot_id is empty");
    if (Number(row.days_by_tool) !== plan.days.length) problems.push("rows stamped by the tool: " + row.days_by_tool + ", planned " + plan.days.length);
    const expectedAudit = plan.days.reduce((s, d) => s + 1 + (d.overrides.length ? 1 : 0) + (d.lockChanges.length ? 1 : 0), 0);
    if (Number(row.audit_rows) !== expectedAudit) problems.push("audit rows at the run's timestamp: " + row.audit_rows + ", expected " + expectedAudit);
  }
  let after;
  try {
    after = await PUB.fetchLive(cfg);
  } catch (e) {
    console.error("\nPOST-APPLY RE-READ FAILED (the batch was sent and may have committed): " + (e && e.message || e) + " - re-run the dry run, it must read 'nothing to write'");
    return EXIT.ERROR;
  }
  const v = verifyApplied(plan, after.dayRows, args.by);
  const u = verifyUntouched(live.dayRows, after.dayRows, plan);
  const replan = planEdits(after.dayRows, args.sets, { lock: args.lock, note: args.note, by: args.by, roster });
  v.problems.forEach((p) => problems.push(p));
  u.problems.forEach((p) => problems.push(p));
  if (!replan.ok) problems.push("re-plan refused: " + replan.problems.join("; "));
  else if (replan.days.length) problems.push("a fresh plan still wants " + replan.days.length + " row(s): " + replan.days.map((d) => d.day).join(", "));

  console.log("\n--- verification ---");
  console.log("snapshot id " + ((row && row.snapshot_id) || "?") + "; snapshots after " + ((row && row.snapshots_after) || "?") + "; audit rows " + ((row && row.audit_rows) || "?") + "; rows stamped at " + ((row && row.stamped_at) || "?") + ": " + ((row && row.days_by_tool) || "?") + "/" + plan.days.length);
  console.log("re-read: " + (v.ok ? "every planned row on file, versions incremented, tag present" : "PROBLEMS") + "; outside the plan: " + (u.ok ? "untouched, total " + after.dayRows.length : "PROBLEMS") + "; fresh plan: " + (replan.ok ? replan.days.length + " row(s)" : "refused"));
  console.log("\nrows before -> after (observed):");
  const afterMap = {}; after.dayRows.forEach((r) => { afterMap[String(r.day).slice(0, 10)] = r; });
  plan.days.forEach((d) => {
    const a = afterMap[d.day];
    console.log("  " + d.day + ": " + describeAssignment(d.before) + " v" + d.seenVersion + " " + (live.dayRows.find((r) => String(r.day).slice(0, 10) === d.day) || {}).source + "  ->  " + (a ? describeAssignment(H.dayRowToAssignment(a)) + " v" + a.version + " " + a.source + " by " + JSON.stringify(a.updated_by) : "MISSING"));
  });
  if (problems.length) { console.error("\nNOT VERIFIED:"); problems.forEach((p) => console.error("  " + p)); return EXIT.ERROR; }
  console.log("\nVERIFIED: " + plan.days.length + " row(s) edited. No notification was queued and no mail was sent - see the preview above.");
  return EXIT.OK;
}

module.exports = {
  EXIT, SNAPSHOT_REASON, AUDIT_ACTION, AUDIT_OVERRIDE_ACTION, AUDIT_LOCK_ACTION,
  parseSet, parseExpect, parseArgs, signerOf, describeAssignment, scheduleFromRows,
  planEdits, pickTimeSchedules, holdsOtherBlockDays, evaluateEdits, gate,
  dayEditSql, auditDetail, notificationsPreview, renderNotifications,
  applyToLive, verifyApplied, verifyUntouched, classifyCliFailure, detectBatchFailure, renderPlan, renderEvals
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code || 0; }, (e) => { console.error("ERROR: " + (e && e.stack || e)); process.exitCode = EXIT.ERROR; });
}
