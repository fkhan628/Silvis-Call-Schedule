#!/usr/bin/env node
// Silvis - seed import CLI (Prompt 5).
//
//   node scripts/import-seed.js [--seed docs/silvis-seed.json] [--dry-run | --apply]
//                               [--workdir <linked supabase dir>] [--out <sql path>] [--overwrite-blob] [--strict-blocked]
//
// --dry-run (default): builds the plan with importer.js, fetches the live rows
//   with the PUBLIC anon key from config.js (the four tables are anon-readable),
//   prints the plan diff + stats, writes the SQL next to the linked workdir
//   (<scratchpad>/import-seed.sql) and exits 0 (2 on a contact-data refusal).
// --apply: same, then runs the SQL through
//   supabase db query --linked --workdir <dir> -f <abs sql path>
//   (runs as postgres, bypasses RLS - the only write path until a scheduler JWT
//   exists), re-fetches, prints per-table counts and proves the applied part is
//   fully applied: a fresh plan reads 'Total changes: 0' - or 'Total changes: 0
//   (+N blocked)' when app-edited days were kept (next paragraph).
//
// App-edited days (IB, 9/23 overnight - the CLI agrees with the app's Apply): a plan
// day whose live row the app owns (source != 'import' or updated_by != 'seed', e.g.
// the 31 October/November days the server-side publish updated) and that differs
// from the seed is listed as BLOCKED by the dry run and KEPT by --apply, exactly as
// Setup -> Import -> Apply keeps such days ('kept (app-edited)', helpers.suSeedDayMerge):
// the SQL carries no statement for a kept day (importer.importSql excludeDays -
// neither insert/update nor the stale delete's key list), everything else applies,
// the report prints the blocked list as the dry run does plus 'kept N app-edited
// day(s)' in the summary. --strict-blocked restores the old fail-closed refusal
// (exit 3, nothing written) for anyone who wants it. availability / time_off keep
// their own ownership rules unchanged (importer.js header). Two edges to know:
//   - a row with source 'import' and a NULL updated_by is seed-owned to this CLI
//     (planDiff and the SQL guard coalesce NULL to 'seed') but app-edited to the
//     app's Apply (helpers.suSeedDayMerge reads NULL as not 'seed') - a pre-existing
//     divergence, left as is (aligning it changes which live rows a re-import may
//     touch: report-first). None of the 31 published rows has a NULL updated_by.
//   - kept days keep their live (generated) holders, so a seed vacation that
//     overlaps a kept day's holder is refused by the time_off ON_CALL_CONFLICT
//     trigger and rolls the WHOLE import back (one transaction; exit 1 with the
//     error text, nothing written) - trade or edit that day in the app first.
//   - when EVERY plan day is kept, no stale delete is emitted at all (an empty key
//     list is not valid SQL; an unlisted delete would be wipe-shaped) and planDiff
//     reports the stale seed-owned days as KEPT, so plan and SQL agree.
//
// Seed-owned live rows the seed no longer lists (availability source 'seed',
// time_off created_by 'seed', schedule_days source 'import' + updated_by 'seed')
// are reported as 'delete' in the diff and removed by the SQL (importer.js header).
//
// App-edited blob guard (RF2, 9/23; content-based since the RF2 review): fetchLive
// also reads updated_by / updated_at of call_schedule_data 'main'. importPlan stamps
// settings.seedCoreHash = importer.impCoreHash(blob) (the seed-owned keys: pool
// roster rows, surgeonRules, groupRules, holidays); the plan hashes the LIVE blob's
// same keys (importer.impBlobEditState) and, when a stamp is present and differs -
// or, on a row with no stamp yet, when updated_by is not the importer's tag 'seed' -
// prints
//   BLOB WAS EDITED IN THE APP at <ts> by <who>: a re-import would revert Setup edits
// and --apply REFUSES (exit 4) when the plan would change a CORE key (anything but
// settings), unless --overwrite-blob is given. updated_by alone is no verdict: the
// app's autosave re-stamps the person_id on any state change (a day edit, a trade,
// a realtime adopt), so 'blob last written by <who> at <ts>' is always printed as
// information. A settings-only plan never refuses (the settings merge is one level
// deep; nothing under Setup is reverted). schedule_days / availability / time_off
// are unaffected by this guard (they keep their own ownership rules above).
//
// Exit codes: 0 ok (app-edited days, if any, kept and listed - the applied part verified) /
// 1 error (incl. a rolled-back transaction) or not fully applied (or, under
// --strict-blocked, app-edited days that appeared during the run: 'APPLIED, but ...') /
// 2 refusal (contact data, or a denylist word left in
// the blob - see importer.js header "Rule-note scrub") /
// 3 refused to apply over app-edited days - --strict-blocked only (without the flag
// they are kept, see above) / 4 refused to apply over an app-edited blob (re-run with
// --overwrite-blob after mirroring the Setup edits into the seed).
// --dry-run also prints the scrub inventory (path -> drop): every note-like key
// of surgeonRules, groupRules and holidays is dropped from the blob - no category
// tokens since 9/22 late (Prompt 12 AA: reasons live in docs/SILVIS-CALL-RULES.md,
// the seed keeps its wording). Set through process.exitCode so the
// event loop drains (process.exit() right after fetch() trips a libuv assertion
// on Node 24 / Windows and exits 127).
//
// No email address or phone number is ever read, printed or written here.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const IMP = require(path.join(ROOT, "importer.js"));

/* ------------------------------------------------------------- args */

function parseArgs(argv) {
  const a = { seed: path.join(ROOT, "docs", "silvis-seed.json"), mode: "dry-run", workdir: process.env.SILVIS_SUPABASE_WORKDIR || null, out: null, overwriteBlob: false, strictBlocked: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--dry-run") a.mode = "dry-run";
    else if (t === "--apply") a.mode = "apply";
    else if (t === "--overwrite-blob") a.overwriteBlob = true;
    else if (t === "--strict-blocked") a.strictBlocked = true;
    else if (t === "--seed") a.seed = path.resolve(argv[++i]);
    else if (t === "--workdir") a.workdir = argv[++i];
    else if (t === "--out") a.out = path.resolve(argv[++i]);
    else if (t === "-h" || t === "--help") { usage(); process.exit(0); }
    else { console.error("unknown argument: " + t); usage(); process.exit(1); }
  }
  if (!a.out) a.out = a.workdir ? path.join(path.dirname(path.resolve(a.workdir)), "import-seed.sql") : path.join(os.tmpdir(), "silvis-import-seed.sql");
  return a;
}

function usage() {
  console.log("usage: node scripts/import-seed.js [--seed docs/silvis-seed.json] [--dry-run | --apply] [--workdir <linked dir>] [--out <sql path>] [--overwrite-blob] [--strict-blocked]");
}

/* ------------------------------------------------------------- config */

// config.js is a browser script (no module export): read the two public
// constants out of its source. The anon key is public by design.
function readConfig() {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const url = (src.match(/const\s+SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
  const key = (src.match(/const\s+SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
  if (!url || !key) throw new Error("could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js");
  return { url, key };
}

/* ------------------------------------------------------------- REST */

// Every read distinguishes failure from empty: a non-2xx throws. Pages by 1000
// (PostgREST's default max rows) so a multi-year schedule is read completely.
async function fetchAll(cfg, table, query) {
  const page = 1000;
  let out = [];
  for (let offset = 0; ; offset += page) {
    const url = cfg.url + "/rest/v1/" + table + "?" + query + "&limit=" + page + "&offset=" + offset;
    const res = await fetch(url, { headers: { apikey: cfg.key, Authorization: "Bearer " + cfg.key } });
    if (!res.ok) throw new Error("REST " + res.status + " reading " + table + ": " + (await res.text()).slice(0, 300));
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("REST read of " + table + " did not return an array");
    out = out.concat(rows);
    if (rows.length < page) break;
  }
  return out;
}

async function fetchLive(cfg) {
  const [blobRows, availability, timeOff, scheduleDays] = await Promise.all([
    fetchAll(cfg, "call_schedule_data", "id=eq.main&select=data,updated_at,updated_by"),
    fetchAll(cfg, "availability", "select=person_id,kind,role,start_date,end_date,note,source&order=person_id,start_date"),
    fetchAll(cfg, "time_off", "select=person_id,start_date,end_date,note,created_by&order=person_id,start_date"),
    fetchAll(cfg, "schedule_days", "select=day,primary_id,backup_id,primary_locked,backup_locked,source,external_cover,note,version,updated_by&order=day")
  ]);
  return {
    blob: (blobRows[0] && blobRows[0].data) || {},
    blobUpdatedAt: blobRows[0] ? blobRows[0].updated_at : null,
    blobUpdatedBy: blobRows[0] ? (blobRows[0].updated_by || null) : null,
    availability,
    time_off: timeOff,
    schedule_days: scheduleDays
  };
}

function counts(live) {
  return {
    call_schedule_data: Object.keys(live.blob || {}).length ? 1 : 0,
    schedule_days: live.schedule_days.length,
    availability: live.availability.length,
    time_off: live.time_off.length
  };
}

/* ------------------------------------------------------------- CLI */

function q(s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }

function runSupabase(workdir, sqlPath) {
  const cmd = ["supabase", "db", "query", "--linked", "--workdir", q(workdir), "-o", "json", "-f", q(sqlPath)].join(" ");
  console.log("\n$ " + cmd);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const outText = (r.stdout || "") + (r.stderr || "");
  const cleaned = outText.split(/\r?\n/).filter((l) => !/new version of Supabase CLI|recommend updating regularly/.test(l)).join("\n");
  console.log(cleaned.trim());
  if (r.status !== 0) throw new Error("supabase db query exited with status " + r.status);
  const m = (r.stdout || "").match(/\{[\s\S]*\}\s*$/);
  if (m) {
    try { const j = JSON.parse(m[0]); return j.rows || null; } catch (e) { /* not JSON */ }
  }
  return null;
}

function printStats(plan) {
  const s = plan.stats;
  console.log("plan: schedule_days " + s.schedule_days + " (primary locked " + s.scheduleDays.primaryLocked + ", backup locked " + s.scheduleDays.backupLocked +
    ", external cover " + s.scheduleDays.externalCover + ", open primary " + s.scheduleDays.openPrimary + ", open backup " + s.scheduleDays.openBackup + ")");
  console.log("      availability " + s.availability + " " + JSON.stringify(s.availabilityByKindRole));
  Object.keys(s.availabilityByPerson).forEach((id) => console.log("        " + id + " " + JSON.stringify(s.availabilityByPerson[id])));
  console.log("      time_off " + s.time_off + "; call_schedule_data 'main' keys " + Object.keys(plan.blob).join(", "));
}

// Dry run only: the rule-note scrub inventory, sorted by path, printed once.
// Paths and actions only - never the seed's wording (and, since Prompt 12 AA,
// no category tokens exist to print).
function printNoteScrub(plan) {
  const ns = plan.noteScrub || { inventory: [], counts: { drop: 0 } };
  console.log("\nrule notes dropped before the blob (importer.js, guide 3.1; no reasons, no category tokens - reasons live in docs/SILVIS-CALL-RULES.md): " +
    ns.counts.drop + " note-like key(s) dropped (every surgeonRules, groupRules and holidays note); the seed keeps its wording; " +
    (ns.counts.timeOffPublic || 0) + " public vacation note(s) written to time_off as stated (public: true)");
  ns.inventory.forEach((e) => console.log("  " + e.path + " -> " + e.action));
}

/* ------------------------------------------------ decisions (pure; exported for test/importer.test.js) */

// keptSummary(diff) -> "kept N app-edited day(s): <ISO days> (M blocked slot change(s))", or "" when nothing is blocked.
function keptSummary(diff) {
  const days = (diff && diff.blockedDays) || [];
  if (!days.length) return "";
  return "kept " + days.length + " app-edited day(s): " + days.join(", ") + " (" + diff.blocked.length + " blocked slot change(s))";
}

// decideApply(diff, owner, coreWouldChange, args) -> { code, proceed, lines }: what --apply does BEFORE any SQL runs,
// in the order the refusals always had. The caller prints lines (stderr on a refusal).
//   3  blocked days AND --strict-blocked: the old fail-closed refusal, nothing written
//   4  RF2: the blob was edited in the app and a core key would change, without --overwrite-blob (untouched by IB)
//   1  no --workdir
//   0  proceed: true - the SQL runs; blocked days, if any, are kept and the KEPT block lists them as the dry run does
//      proceed: false - nothing to apply: the applied part already matches the plan
function decideApply(diff, owner, coreWouldChange, args) {
  const lines = [];
  const blobKeys = (diff.tables && diff.tables.call_schedule_data && diff.tables.call_schedule_data.keys) || {};
  if (diff.blocked.length && args.strictBlocked) {
    lines.push("REFUSING TO APPLY (--strict-blocked): " + diff.blocked.length + " schedule_days change(s) on app-edited day(s) (source != 'import' or updated_by != 'seed') differ from the seed:");
    diff.blocked.forEach((l) => lines.push("  " + l));
    lines.push("Resolve them in the app (or update the seed) and re-run - or re-run without --strict-blocked to keep them and apply everything else, as the app's Apply does.");
    return { code: 3, proceed: false, lines };
  }
  if (owner.hasRow && owner.appEdited && coreWouldChange && !args.overwriteBlob) {
    lines.push("REFUSING TO APPLY: the shared setup (call_schedule_data) was last saved in the app at " + owner.at + " by " + owner.by +
      " (" + (owner.basis === "seedCoreHash" ? "its seed-owned keys no longer match the seedCoreHash stamp of the last import" : "no seedCoreHash stamp yet: judged by updated_by") + ")" +
      " - applying would revert the Setup edits under " + Object.keys(blobKeys).filter((k) => k !== "settings" && blobKeys[k] !== "unchanged").join(", ") + ".");
    lines.push("Mirror the Setup edits into docs/silvis-seed.json first, then re-run with --overwrite-blob (rows are unaffected by this guard - it is the blob alone).");
    return { code: 4, proceed: false, lines };
  }
  if (!args.workdir) { lines.push("--apply needs --workdir <linked supabase dir> (or SILVIS_SUPABASE_WORKDIR)"); return { code: 1, proceed: false, lines }; }
  if (diff.blocked.length) {
    lines.push("KEPT (app-edited, not written - as the app's Apply keeps them): " + diff.blockedDays.length + " schedule_days row(s); the SQL carries no statement for them:");
    diff.blocked.forEach((l) => lines.push("  " + l));
  }
  if (diff.totalChanges === 0) {
    lines.push("nothing to apply - the live tables already match the plan" + (diff.blocked.length ? "; " + keptSummary(diff) : "") + ".");
    return { code: 0, proceed: false, lines };
  }
  return { code: 0, proceed: true, lines };
}

// verifyOutcome(verify, keptDays, strict) -> { ok, lines }: the post-apply proof over a fresh planDiff. ok when no
// applied change is left - 'Total changes: 0', or 'Total changes: 0 (+N blocked)' when app-edited days were kept (they
// were not written, so they still differ; the applied part is what is compared). Under --strict-blocked nothing may be
// kept, so a blocked day after the apply fails. A kept set that changed while the run ran (a concurrent app edit) is
// noted, never failed.
function verifyOutcome(verify, keptDays, strict) {
  const lines = [];
  const after = verify.blockedDays || [];
  const kept = keptDays || [];
  const ok = verify.totalChanges === 0 && (!strict || !after.length);
  if (!ok) {
    // strict: the SQL only ever ran with nothing blocked, so a blocked day now APPEARED during the run (a concurrent app
    // edit) - every applied change landed; say so rather than blame the apply. Still a failure: nothing may be kept.
    lines.push(verify.totalChanges === 0 && strict && after.length
      ? "APPLIED, but app-edited day(s) appeared during the run (--strict-blocked): " + after.join(", ") + " - they were not written and nothing may be kept under the flag; remaining diff:"
      : "NOT FULLY APPLIED - remaining diff:");
    lines.push(verify.text);
    return { ok, lines };
  }
  if (!after.length && !kept.length) { lines.push("VERIFIED: plan fully applied - a re-run would change nothing."); return { ok, lines }; }
  const summary = keptSummary(verify);
  lines.push("VERIFIED: the applied part is fully applied - a fresh plan reads '" + verify.lines[verify.lines.length - 1] + "'" + (summary ? "; " + summary : "") + ".");
  const newly = after.filter((d) => kept.indexOf(d) < 0), gone = kept.filter((d) => after.indexOf(d) < 0);
  if (newly.length || gone.length) {
    lines.push("NOTE: the app-edited set changed while this ran (a concurrent app edit?): " +
      [newly.length ? "newly blocked " + newly.join(", ") : "", gone.length ? "no longer blocked " + gone.join(", ") : ""].filter(Boolean).join("; ") + " - the applied part is unaffected.");
  }
  return { ok, lines };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seed = JSON.parse(fs.readFileSync(args.seed, "utf8"));

  let plan;
  try {
    plan = IMP.importPlan(seed, { now: new Date().toISOString() });
  } catch (e) {
    if (/^(CONTACT_DATA_REFUSED|NOTE_DENYLIST)/.test(e.message)) { console.error("REFUSED: " + e.message); return 2; }
    throw e;
  }

  const cfg = readConfig();
  console.log("Silvis seed import - " + args.mode + " - seed " + path.relative(ROOT, args.seed) + " (generatedOn " + plan.blob.settings.seedGeneratedOn + ")");
  console.log("project " + cfg.url + " (anon read)");
  printStats(plan);
  if (args.mode !== "apply") printNoteScrub(plan);
  if (plan.infoDeltas.length) {
    console.log("\npendingDeltas (informational - already applied inside existingAssignments):");
    plan.infoDeltas.forEach((l) => console.log("  " + l));
  }

  const live = await fetchLive(cfg);
  console.log("\nlive rows before: " + JSON.stringify(counts(live)));
  const fresh = !live.schedule_days.length && !live.availability.length && !live.time_off.length && !Object.keys(live.blob || {}).length;
  if (fresh) console.log("fresh install: all four tables are empty - the pre-import snapshot will be skipped");

  const diff = IMP.planDiff(plan, live);
  console.log("\n--- plan diff ---");
  console.log(diff.text);

  // RF2 (review fix 9/23): has the app changed a seed-owned blob key since the last import? CONTENT-based - the live
  // blob's pool roster / surgeonRules / groupRules / holidays hashed the way importPlan stamped settings.seedCoreHash
  // (updated_by is information only: the autosave re-stamps the person_id on any state change; it is the fallback
  // only while the live row carries no stamp yet). --apply refuses below only when the plan would change a CORE key -
  // a settings-only plan (importedAt / seedRevisionCount drift) reverts nothing, the settings merge is one level deep.
  // schedule_days / availability / time_off rows are unaffected by this guard.
  const owner = IMP.impBlobEditState(live);
  const blobKeys = (diff.tables && diff.tables.call_schedule_data && diff.tables.call_schedule_data.keys) || {};
  const coreWouldChange = Object.keys(blobKeys).some((k) => k !== "settings" && blobKeys[k] !== "unchanged");
  const blobWouldChange = Object.keys(blobKeys).some((k) => blobKeys[k] !== "unchanged");
  if (owner.hasRow) {
    console.log("\nblob last written by " + owner.by + " at " + owner.at + (owner.basis === "seedCoreHash"
      ? " (seedCoreHash " + (owner.appEdited ? "differs from the live seed-owned keys: edited in the app" : "matches the live seed-owned keys: no Setup edit since the last import") + ")"
      : " (no seedCoreHash stamp on the live row yet - " + (owner.importerOwned ? "importer-owned" : "app-written") + " by updated_by; this import writes the stamp)"));
  }
  if (owner.hasRow && owner.appEdited) {
    console.log("BLOB WAS EDITED IN THE APP at " + owner.at + " by " + owner.by + ": a re-import would revert Setup edits (surgeonRules, groupRules, holidays and the pool roster rows are replaced wholesale by the seed's copy)." +
      (coreWouldChange ? " --apply refuses unless --overwrite-blob is given; schedule_days / availability / time_off rows are unaffected by this guard."
        : blobWouldChange ? " This plan changes settings keys only - nothing under Setup is reverted, so the guard does not apply to this run."
        : " The plan changes no blob key, so the guard does not apply to this run."));
  }

  // IB (9/23 overnight): the app-edited days planDiff lists as BLOCKED are kept out of the SQL altogether - dry run and
  // apply alike, so the file on disk never carries a statement for them. --strict-blocked changes the exit decision
  // below only (decideApply), never the SQL.
  const keptDays = diff.blockedDays || [];
  const sql = IMP.importSql(plan, { excludeDays: keptDays });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, sql, "utf8");
  console.log("\nSQL written: " + args.out + " (" + sql.length + " bytes" + (keptDays.length ? "; no schedule_days statement for the " + keptDays.length + " app-edited day(s) listed as BLOCKED" : "") + ")");

  if (diff.kept && diff.kept.length) console.log("\nNOTE: " + diff.kept.length + " seed-owned live row(s) kept because the plan has no rows for that table (listed above).");

  if (args.mode !== "apply") {
    console.log(diff.totalChanges === 0 && !diff.blocked.length ? "dry-run: nothing to apply." : "dry-run: " + diff.totalChanges + " change(s) would be applied" +
      (diff.totalDeletes ? " (incl. " + diff.totalDeletes + " delete(s) of seed-owned rows)" : "") +
      (keptDays.length ? "; " + keptSummary(diff) + " - not in the SQL; --apply keeps them as the app's Apply does, --strict-blocked would refuse (exit 3)" : "") + ".");
    return 0;
  }

  const decision = decideApply(diff, owner, coreWouldChange, args);
  decision.lines.forEach((l, i) => (decision.code ? console.error(i ? l : "\n" + l) : console.log(i ? l : "\n" + l)));
  if (!decision.proceed) return decision.code;

  const rows = runSupabase(path.resolve(args.workdir), args.out);
  if (rows && rows[0]) console.log("post-commit counts (from the SQL): " + JSON.stringify(rows[0]));

  const after = await fetchLive(cfg);
  console.log("\nlive rows after: " + JSON.stringify(counts(after)));
  const verify = IMP.planDiff(plan, after);
  const outcome = verifyOutcome(verify, keptDays, args.strictBlocked);
  outcome.lines.forEach((l, i) => (outcome.ok ? console.log(l) : console.error(i ? l : "\n" + l)));
  return outcome.ok ? 0 : 1;
}

module.exports = { parseArgs, decideApply, verifyOutcome, keptSummary };

// Entry point only (IB: test/importer.test.js requires this file for the pure helpers above and must not trigger a
// live fetch). process.exitCode, not process.exit(): let the event loop drain after fetch() (see header) so the
// documented exit code actually reaches the caller.
if (require.main === module) {
  main().then((code) => { process.exitCode = code || 0; }, (e) => { console.error("ERROR: " + (e && e.stack || e)); process.exitCode = 1; });
}
