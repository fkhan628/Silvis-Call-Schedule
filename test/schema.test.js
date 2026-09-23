// Silvis - static schema pins (Prompt 12 D: server-side trade guards).
// Plain Node asserts, no framework, no database: reads sql/ and checks that
//   - sql/schema.sql and sql/migrations/2026-09-22-trade-guards.sql both define
//     trade_insert_guard() + its BEFORE INSERT trigger on shift_trade_requests,
//   - apply_trade() raises the four TRADE_INELIGIBLE checks, in order, BEFORE its
//     first write to schedule_days,
//   - the migration's function bodies are byte-identical to schema.sql's (one
//     source of truth, applied live through the migration),
//   - sql/probes/trade-guards-probe.sql is a rolled-back probe (no BEGIN/COMMIT,
//     ends by raising PROBE_RESULTS),
//   - nothing under sql/ carries a contact-like value (the repo is public).
// Prompt 13 part 2 (claim_open_slot: a linked surgeon takes an OPEN slot):
//   - sql/schema.sql defines claim_open_slot(p_day date, p_role text) right after
//     apply_trade(): security definer + search_path = public, the nine CL001..CL009
//     refusals in order (the first four before the missing-row insert, all nine before
//     the first update), version + 1 / source 'claim', the 'schedule.claim' audit row,
//     the 'shift_claimed' notifications row, revoke from public/anon + grant to authenticated,
//   - sql/migrations/2026-09-22-claim-open-slot.sql is frozen as applied live 9/22 (sha256 of its body);
//     since Prompt 14 part 2c (sql/migrations/2026-09-23-claim-offer.sql, applied live 9/23 07:05Z) the
//     function ALSO upserts the claimer's call_offers row (a claim is an offer made on the spot; none for a
//     rules_only claimer; the audit detail carries offer true/false) and call_offers_guard() skips
//     OFFER_FROZEN while silvis.claim_in_progress is on - schema.sql mirrors both bodies from that file,
//   - sql/probes/claim-open-slot-probe.sql is a rolled-back probe (fixtures in 2030-04 plus
//     a 2020-01-01 lower bound, cases A..L) and scripts/verify-rls.sh section 7 grades it,
//     checks the anon REST refusal and counts leftovers.
// Audit 2026-09-23 (RLS-6, TRADE_PAST): apply_trade() refuses a non-scheduler applying a trade
//   whose day or return day is before today in America/Chicago (strict <, like CL003), and
//   trade_update_guard() refuses the same non-scheduler ACCEPT (decline / cancel stay open);
//   both live in sql/migrations/2026-09-23-trade-past-guard.sql, byte-identical to schema.sql;
//   the 2026-09-22 trade-guards migration is frozen as applied (sha256 pins); the probe covers
//   cases I..M on 2020-02 fixtures and verify-rls.sh section 5 grades them.
// Audit 2026-09-23 (RLS-2, live drift): schema.sql's header must record every file under
//   sql/migrations/, may name an unmerged migration only while that file does not exist (fail
//   closed once it lands), and every function a migration CREATE OR REPLACEs must be mirrored
//   in schema.sql byte-identically from the NEWEST migration touching it.
//   node test/schema.test.js

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(ROOT, "sql", "schema.sql");
const MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-22-trade-guards.sql");
const PROBE = path.join(ROOT, "sql", "probes", "trade-guards-probe.sql");
const VERIFY = path.join(ROOT, "scripts", "verify-rls.sh");

let N = 0;
let current = "(start)";
function step(name) { current = name; console.log("- " + name); }
function fail(msg) { console.error("FAIL [" + current + "]: " + msg); process.exit(1); }
function ok(cond, msg) { N++; if (!cond) fail(msg); }
function eq(a, b, msg) { N++; try { assert.deepStrictEqual(a, b); } catch (e) { fail((msg || "") + " expected " + JSON.stringify(b) + " got " + JSON.stringify(a)); } }
function read(p) {
  if (!fs.existsSync(p)) fail("missing file " + path.relative(ROOT, p));
  return fs.readFileSync(p, "utf8");
}
// The text of one `create or replace function public.<name>(...)` statement up to
// and including its closing `end $$;` (all our plpgsql bodies are $$-quoted).
function functionText(sql, name) {
  const re = new RegExp("create or replace function public\\." + name + "\\([^)]*\\)[\\s\\S]*?\\nend \\$\\$;", "");
  const m = sql.match(re);
  return m ? m[0] : null;
}

/* ------------------------------------------------------------ schema.sql */
// schema.sql is checked on its own FIRST, so a missing migration file never hides
// a missing definition in the schema itself.
step("schema.sql exists and is LF");
const schema = read(SCHEMA);
ok(!/\r/.test(schema), "schema.sql has CRLF line endings");

/* ------------------------------------------------- trade_insert_guard() */
function checkInsertGuard(n, s) {
  const fn = functionText(s, "trade_insert_guard");
  ok(fn, n + ": no `create or replace function public.trade_insert_guard()` ... `end $$;` block");
  ok(/returns trigger/.test(fn), n + ": trade_insert_guard must return trigger");
  ok(/TRADE_INELIGIBLE: a trade needs two different surgeons/.test(fn), n + ": from = to must raise TRADE_INELIGIBLE");
  ok(/TRADE_FORBIDDEN: your account is not linked to a roster entry/.test(fn), n + ": unlinked caller must raise TRADE_FORBIDDEN");
  ok(/new\.status\s*:=\s*'pending'/.test(fn), n + ": non-scheduler status forced to 'pending'");
  ok(/new\.from_surgeon_id\s*:=\s*me/.test(fn), n + ": non-scheduler from_surgeon_id forced to silvis_person_id()");
  ok(/new\.submitted_at\s*:=\s*now\(\)/.test(fn), n + ": non-scheduler submitted_at forced to now()");
  ok(/new\.decided_at\s*:=\s*null/.test(fn), n + ": non-scheduler decided_at forced to null");
  // The only way past the normalisation besides silvis_is_sched(): a server-side role with NO auth.uid().
  // Widening the list (e.g. 'authenticated') or dropping the auth.uid() half must fail here.
  ok(/server boolean := auth\.uid\(\) is null and current_user in \('postgres', 'supabase_admin', 'service_role'\);/.test(fn),
    n + ": server-side bypass must stay exactly `auth.uid() is null and current_user in ('postgres', 'supabase_admin', 'service_role')`");
  ok(/if not \(public\.silvis_is_sched\(\) or server\) then/.test(fn), n + ": normalisation must apply to everyone who is neither scheduler nor server");
  ok(/drop trigger if exists trade_insert_guard_trg on public\.shift_trade_requests;/.test(s), n + ": trigger drop-if-exists missing (idempotency)");
  ok(/create trigger trade_insert_guard_trg\s+before insert on public\.shift_trade_requests\s+for each row execute function public\.trade_insert_guard\(\);/.test(s),
    n + ": `create trigger trade_insert_guard_trg before insert on public.shift_trade_requests for each row execute function public.trade_insert_guard();` missing");
}
step("trade_insert_guard() + BEFORE INSERT trigger in schema.sql");
checkInsertGuard("schema.sql", schema);

/* --------------------------------------------------------- apply_trade() */
const CHECKS = [
  ["(a) roster fail-closed", "TRADE_INELIGIBLE: roster unavailable"],
  ["(a) active roster id", "is not an active roster surgeon"],
  ["(b) vacation", "is on vacation on"],
  ["(c) locked (non-scheduler)", "is locked; ask the scheduler"],
  ["(d) other role held", "already holds"],
];
// TRADE_PAST (audit RLS-6): one message in both functions, so the client shows one sentence.
const PAST_MSG = "TRADE_PAST: % is before today (%) in Central time; past days are changed by the scheduler only";
const TODAY_C = /today_c\s+date\s+:= \(now\(\) at time zone 'America\/Chicago'\)::date;/;
// `past` = true for schema.sql and the 2026-09-23 migration; false for the 2026-09-22 migration, frozen as applied.
function checkApplyTrade(n, s, past) {
  const fn = functionText(s, "apply_trade");
  ok(fn, n + ": no `create or replace function public.apply_trade(p_trade_id uuid)` block");
  ok(/security definer set search_path = public/.test(fn), n + ": apply_trade must stay security definer with search_path = public");
  const firstWrite = fn.indexOf("update public.schedule_days");
  ok(firstWrite > 0, n + ": apply_trade has no `update public.schedule_days`");
  if (past) {
    ok(TODAY_C.test(fn), n + ": apply_trade must compute today_c in America/Chicago (like claim_open_slot)");
    const cond = "if not sched and (t.day < today_c or (t.return_day is not null and t.return_day < today_c)) then";
    const pastAt = fn.indexOf(cond);
    ok(pastAt > 0, n + ": apply_trade lacks the TRADE_PAST condition `" + cond + "`");
    ok(pastAt > fn.indexOf("TRADE_NOT_ACCEPTED"), n + ": TRADE_PAST must come after the TRADE_NOT_ACCEPTED check");
    ok(pastAt < fn.indexOf("select * into d1 from public.schedule_days"), n + ": TRADE_PAST must come before the first row lock / any write");
    ok(fn.slice(pastAt, pastAt + 420).indexOf("raise exception '" + PAST_MSG + "'") > 0, n + ": TRADE_PAST must raise exactly `" + PAST_MSG + "`");
    ok(/using errcode = 'P0001'/.test(fn.slice(pastAt, pastAt + 420)), n + ": TRADE_PAST uses errcode P0001 like the other TRADE_* errors (CL codes are claim_open_slot's)");
    ok(!/<=\s*today_c|today_c\s*>=/.test(fn), n + ": TRADE_PAST must be a strict `<` (today's already-started 07:00 shift stays tradeable, matching claim_open_slot)");
    ok((fn.match(/TRADE_PAST/g) || []).length === 1, n + ": exactly one TRADE_PAST raise in apply_trade");
  } else {
    ok(!/TRADE_PAST|today_c/.test(fn), n + ": is frozen as applied on 2026-09-22 - TRADE_PAST belongs to sql/migrations/2026-09-23-trade-past-guard.sql");
  }
  let last = -1;
  CHECKS.forEach(([label, needle]) => {
    const at = fn.indexOf(needle);
    ok(at >= 0, n + ": apply_trade lacks the " + label + " check (`" + needle + "`)");
    ok(at < firstWrite, n + ": " + label + " check must come BEFORE the first schedule_days write");
    ok(at > last, n + ": " + label + " check is out of order (expected roster -> vacation -> locked -> other role)");
    last = at;
  });
  ok(/primary_locked = false/.test(fn) && /backup_locked = false/.test(fn), n + ": transfer must clear the transferred role's lock flag");
  // (a) uses the client's convention (rules.js / index-source / importer: `active !== false`): an entry with
  // no `active` key is ACTIVE. Fail-closed on a missing roster is the preceding 'roster unavailable' check.
  eq((fn.match(/coalesce\(r ->> 'active', 'true'\) <> 'false'/g) || []).length, 2,
    n + ": (a) must test `coalesce(r ->> 'active', 'true') <> 'false'` for both receivers (client convention: missing key = active);");
  ok(!/r ->> 'active' = 'true'/.test(fn), n + ": (a) must not treat a missing `active` key as inactive (`r ->> 'active' = 'true'`)");
  // (b) trailing edge, both legs: a PRIMARY leg the day before the receiver's vacation start is refused too
  // (SILVIS-CALL-RULES: a vacation day also blocks the day before it; the time_off trigger enforces the same, primary only).
  eq((fn.match(/starts a vacation on % \(primary the day before is blocked\)/g) || []).length, 2,
    n + ": (b) trailing-edge check (primary the day before a vacation start) must exist for both legs;");
  // The pre-existing contract is kept.
  ["TRADE_NOT_FOUND", "TRADE_FORBIDDEN: only a party or the scheduler", "TRADE_NOT_ACCEPTED", "TRADE_STALE", "version = version + 1", "source = 'trade'", "silvis.apply_trade", "'trade.apply'"].forEach((needle) => {
    ok(fn.indexOf(needle) >= 0, n + ": apply_trade lost `" + needle + "`");
  });
  ok(/revoke all on function public\.apply_trade\(uuid\) from public, anon;/.test(s), n + ": revoke on apply_trade missing");
  ok(/grant execute on function public\.apply_trade\(uuid\) to authenticated;/.test(s), n + ": grant on apply_trade missing");
}
step("apply_trade() eligibility checks, in order, before the first schedule_days write (schema.sql)");
checkApplyTrade("schema.sql", schema, true);

/* ---------------------------------------- trade_update_guard() (RLS-6) */
function checkUpdateGuard(n, s) {
  const fn = functionText(s, "trade_update_guard");
  ok(fn, n + ": no `create or replace function public.trade_update_guard()` ... `end $$;` block");
  ok(/returns trigger/.test(fn), n + ": trade_update_guard must return trigger");
  const bypass = fn.indexOf("if public.silvis_is_sched() then return new; end if;");
  ok(bypass > 0, n + ": the scheduler bypass must stay the first statement");
  ok(TODAY_C.test(fn), n + ": trade_update_guard must compute today_c in America/Chicago");
  const acc = fn.indexOf("if me = old.to_surgeon_id and new.status in ('accepted', 'declined') then");
  const cond = "if new.status = 'accepted' and (old.day < today_c or (old.return_day is not null and old.return_day < today_c)) then";
  const pastAt = fn.indexOf(cond);
  const cancel = fn.indexOf("if me = old.from_surgeon_id and new.status = 'cancelled' then return new; end if;");
  ok(acc > bypass, n + ": the counter-party accept/decline branch is missing");
  ok(pastAt > acc && pastAt < cancel, n + ": TRADE_PAST must sit inside the counter-party branch (accept only; decline and cancel stay open): `" + cond + "`");
  ok(fn.slice(pastAt, pastAt + 420).indexOf("raise exception '" + PAST_MSG + "'") > 0, n + ": trade_update_guard must raise exactly `" + PAST_MSG + "`");
  ok(/using errcode = 'P0001'/.test(fn.slice(pastAt, pastAt + 420)), n + ": TRADE_PAST uses errcode P0001");
  ok(!/<=\s*today_c|today_c\s*>=/.test(fn), n + ": TRADE_PAST must be a strict `<`");
  ok((fn.match(/TRADE_PAST/g) || []).length === 1, n + ": exactly one TRADE_PAST raise in trade_update_guard");
  ["TRADE_IMMUTABLE: only the scheduler may change the legs of a trade", "current_setting('silvis.apply_trade', true) = '1' and old.status = 'accepted' and new.status = 'applied'",
   "TRADE_NOT_PENDING: this trade is already %", "TRADE_FORBIDDEN: % may not set status % on this trade"].forEach((needle) => {
    ok(fn.indexOf(needle) >= 0, n + ": trade_update_guard lost `" + needle + "`");
  });
  ok(/drop trigger if exists trade_update_guard_trg on public\.shift_trade_requests;/.test(s), n + ": trade_update_guard_trg drop-if-exists missing (idempotency)");
  ok(/create trigger trade_update_guard_trg\s+before update on public\.shift_trade_requests\s+for each row execute function public\.trade_update_guard\(\);/.test(s),
    n + ": `create trigger trade_update_guard_trg before update on public.shift_trade_requests for each row execute function public.trade_update_guard();` missing");
}
step("trade_update_guard(): TRADE_PAST inside the counter-party ACCEPT branch, scheduler bypass first (schema.sql)");
checkUpdateGuard("schema.sql", schema);

/* ------------------------------------------------- the migration file */
step("2026-09-22 migration file defines the same objects (apply_trade as applied, without TRADE_PAST)");
const migration = read(MIGRATION);
ok(!/\r/.test(migration), "migration has CRLF line endings");
checkInsertGuard("migration", migration);
checkApplyTrade("migration", migration, false);

step("2026-09-22 migration: trade_insert_guard byte-identical to schema.sql; both bodies frozen as applied live (sha256)");
(function frozen() {
  const a = functionText(schema, "trade_insert_guard"), b = functionText(migration, "trade_insert_guard");
  ok(a && b && a === b, "trade_insert_guard(): migration text differs from schema.sql (keep them identical; the migration is what ran live)");
  const sha = (t) => crypto.createHash("sha256").update(t || "").digest("hex");
  eq(sha(functionText(migration, "apply_trade")), "d9ec012b9265b8a7fe4f6db7242165e181709d58f824bdf72a793a7c9d908737",
    "2026-09-22-trade-guards.sql apply_trade() must stay byte-for-byte what was applied live on 2026-09-22 (a change belongs in a NEW migration);");
  eq(sha(b), "b2b5e23fe401765241523846131265825bdcca18bcfb41f1d328d54729357a5b",
    "2026-09-22-trade-guards.sql trade_insert_guard() must stay byte-for-byte what was applied live on 2026-09-22;");
})();

const PAST_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-trade-past-guard.sql");
step("2026-09-23 trade-past-guard migration: apply_trade + trade_update_guard, byte-identical to schema.sql, trigger re-created, grants re-run");
const pastMigration = read(PAST_MIGRATION);
ok(!/\r/.test(pastMigration), "trade-past migration has CRLF line endings");
checkApplyTrade("trade-past migration", pastMigration, true);
checkUpdateGuard("trade-past migration", pastMigration);
eq((pastMigration.match(/create or replace function/g) || []).length, 2, "the trade-past migration must define apply_trade and trade_update_guard and nothing else;");
ok(!/drop function|drop table|create table|drop policy|create policy/.test(pastMigration), "the trade-past migration must not drop or create anything besides the trigger re-create");
["apply_trade", "trade_update_guard"].forEach((name) => {
  const a = functionText(schema, name), b = functionText(pastMigration, name);
  ok(a && b && a === b, name + "(): trade-past migration text differs from schema.sql (keep them identical; the migration is what runs live)");
});
ok(/-- Revision 2026-09-23 e \(audit RLS-6, sql\/migrations\/2026-09-23-trade-past-guard\.sql\)/.test(schema), "schema.sql header must record revision e (TRADE_PAST)");

/* ------------------------------------------------------------- probe */
step("probe is self-rolling-back");
const probe = read(PROBE);
ok(!/\r/.test(probe), "probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(probe), "probe must not contain explicit BEGIN/COMMIT/ROLLBACK (it relies on the batch's implicit transaction)");
ok(/create temp table probe_results/.test(probe), "probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated/.test(probe), "probe must grant the temp table to authenticated");
const lastDo = probe.lastIndexOf("do $$");
ok(lastDo > 0, "probe has no DO block");
// The message ends with a ';END' sentinel so the reader can cut off whatever the CLI appends
// (' (SQLSTATE P0001)', a CONTEXT line, a closing JSON quote) instead of it leaking into the last case.
ok(/raise exception 'PROBE_RESULTS %;END'/.test(probe.slice(lastDo)), "probe's last DO block must raise 'PROBE_RESULTS %;END' (sentinel-terminated) so the batch rolls back");
ok(probe.indexOf("2030-03-") > 0, "probe fixtures must live in 2030-03");
["'A'", "'B'", "'C'", "'D'", "'E'"].forEach((k) => ok(probe.indexOf("values (" + k) >= 0, "probe lacks case " + k));
// Case A must observe every field the trigger normalises that the insert deliberately sets: status, from, decided_at.
ok(/' decided=' \|\| coalesce\(decided_at::text, 'null'\)/.test(probe), "probe case A must record decided_at (expected null after the fix, a timestamp before)");
ok(!/simple-protocol/.test(probe), "probe header must not claim a simple-protocol connection (the linked CLI goes through the Management API)");

/* ------------------------------------------------ verify-rls.sh reader */
step("verify-rls.sh reads the sentinel, checks for leftovers, cleans up 6a");
const vr = read(VERIFY);
ok(!/\r/.test(vr), "verify-rls.sh has CRLF line endings");
ok(/s\/;END\.\*\$\/\//.test(vr), "verify-rls.sh must cut the PROBE_RESULTS message at the ;END sentinel (s/;END.*$//)");
ok(!/PROBE_RESULTS \[\^"\]\*/.test(vr), "verify-rls.sh must not end the PROBE_RESULTS message at a double quote (CLI wrapper shape is not guaranteed)");
ok(/status=pending from=s2 decided=null/.test(vr), "verify-rls.sh probe A expectation must include decided=null");
ok(/as leftover/.test(vr) && /email like 'probe-%@example\.test'/.test(vr) && /detail like 'probe %'/.test(vr) && /note = 'probe'/.test(vr),
  "verify-rls.sh must count probe leftovers (schedule_days 2030-03 / trades / time_off / auth.users) after the probe and fail on non-zero");
ok(/delete from public\.shift_trade_requests where id = '\$tid' and detail = 'verify-rls\.sh 6a probe'/.test(vr),
  "verify-rls.sh 6a must delete its trade row through the linked CLI (PATCH cancelled is only the no-CLI fallback)");

/* ------------------------------------------ TRADE_PAST probe cases (RLS-6) */
step("probe covers TRADE_PAST cases I..M on 2020-02 fixtures; verify-rls.sh section 5 grades them and counts them as leftovers");
["'I'", "'J'", "'K'", "'L'", "'M'"].forEach((k) => ok(probe.indexOf("values (" + k) >= 0, "probe lacks case " + k));
ok(probe.indexOf("'2020-02-") > 0, "probe's past-day fixtures must live in 2020-02 (the claim probe owns 2020-01-01)");
ok(probe.indexOf("'2020-01-01'") < 0, "probe must not touch the claim probe's 2020-01-01 row");
ok(/TRADE_PAST/.test(probe.slice(0, probe.indexOf("create temp table probe_results"))), "probe header must list the TRADE_PAST expectations (I, K refused; J, L as scheduler; M decline stays open)");
ok(/'probe I'|'probe J'|'probe K'|'probe L'|'probe M'/.test(probe), "probe's past-day trade rows must carry detail 'probe <case>' (the leftover count keys on `detail like 'probe %'`)");
const s5 = vr.slice(vr.indexOf('echo "== 5.'), vr.indexOf('echo "== 6.'));
ok(s5.length > 0, "verify-rls.sh section 5 could not be sliced out");
["I", "J", "K", "L", "M"].forEach((k) => ok(new RegExp("expect_(eq|past)\\s+" + k + "\\s").test(s5), "verify-rls.sh section 5 does not grade probe case " + k));
ok(/expect_past\(\)/.test(s5) && /TRADE_PAST/.test(s5), "verify-rls.sh section 5 needs an expect_past helper that checks for TRADE_PAST + the day (today's date varies)");
ok(/day between '2020-02-01' and '2020-02-29' and source = 'probe'/.test(s5), "verify-rls.sh section 5 leftover count must include the 2020-02 schedule_days fixtures");
ok((s5.match(/day between '2020-02-01' and '2020-02-29'/g) || []).length >= 2, "verify-rls.sh section 5 cleanup statements must also name the 2020-02 fixtures");

/* ------------------------------------ claim_open_slot() (Prompt 13 part 2) */
const CLAIM_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-22-claim-open-slot.sql");
const CLAIM_PROBE = path.join(ROOT, "sql", "probes", "claim-open-slot-probe.sql");
// The nine refusals, in the order the function evaluates them. Each is one `raise exception
// '<TOKEN>: ...' using errcode = '<CODE>'` statement; CL001-CL004 run before the missing-row
// insert (they need no row), CL005-CL009 after the row is locked and before the first update.
const CLAIM_CODES = [
  ["CL001", "CLAIM_NOT_LINKED"],
  ["CL002", "CLAIM_BAD_ROLE"],
  ["CL003", "CLAIM_PAST"],
  ["CL004", "CLAIM_OUTSIDE_RANGE"],
  ["CL005", "CLAIM_HELD"],
  ["CL006", "CLAIM_EXTERNAL"],
  ["CL007", "CLAIM_LOCKED"],
  ["CL008", "CLAIM_OTHER_ROLE"],
  ["CL009", "CLAIM_VACATION"],
];
function checkClaim(n, s) {
  const fn = functionText(s, "claim_open_slot");
  ok(fn, n + ": no `create or replace function public.claim_open_slot(p_day date, p_role text)` ... `end $$;` block");
  ok(/^create or replace function public\.claim_open_slot\(p_day date, p_role text\) returns jsonb\nlanguage plpgsql security definer set search_path = public as \$\$/.test(fn),
    n + ": claim_open_slot must be `returns jsonb`, `language plpgsql security definer set search_path = public`");
  const rowInsert = fn.indexOf("insert into public.schedule_days");
  const firstUpdate = fn.indexOf("update public.schedule_days");
  ok(rowInsert > 0, n + ": claim_open_slot has no missing-row `insert into public.schedule_days`");
  ok(firstUpdate > rowInsert, n + ": claim_open_slot's first `update public.schedule_days` must come after the missing-row insert");
  let last = -1;
  CLAIM_CODES.forEach(([code, token], i) => {
    // one raise carries both the token (message prefix) and the code
    const re = new RegExp("raise exception '" + token + ": [^']*'[^;]*using errcode = '" + code + "';");
    const m = fn.match(re);
    ok(m, n + ": claim_open_slot lacks `raise exception '" + token + ": ...' using errcode = '" + code + "'`");
    const at = m ? fn.indexOf(m[0]) : -1;
    ok(at > last, n + ": " + token + " (" + code + ") is out of order (expected " + CLAIM_CODES.map((c) => c[0]).join(" -> ") + ")");
    if (i < 4) ok(at < rowInsert, n + ": " + token + " must be checked BEFORE the missing-row insert");
    ok(at < firstUpdate, n + ": " + token + " must be checked BEFORE the first schedule_days update");
    last = at;
  });
  eq((fn.match(/using errcode = 'CL0/g) || []).length, 9, n + ": exactly nine CL0xx errcodes expected;");
  ok(/auth\.uid\(\) is null or me is null/.test(fn), n + ": CL001 must fire for anon (auth.uid() null) AND for an unlinked account (silvis_person_id() null)");
  ok(/today_c\s+date := \(now\(\) at time zone 'America\/Chicago'\)::date;/.test(fn), n + ": 'today' must be computed in America/Chicago");
  ok(/select min\(day\), max\(day\) into lo, hi from public\.schedule_days;/.test(fn), n + ": the published range must be min(day)..max(day) of schedule_days");
  ok(/select \* into d from public\.schedule_days where day = p_day for update;/.test(fn), n + ": the day's row must be locked (`for update`)");
  ok(/values \(p_day, 'claim', 1, me, now\(\)\)\s+on conflict \(day\) do nothing;/.test(fn), n + ": a missing row inside the range must be inserted with source 'claim', version 1");
  ok(/coalesce\(d\.external_cover, ''\) <> ''/.test(fn), n + ": CL006 must treat an empty external_cover as unset");
  // vacation window: the day itself for both roles, plus the NEXT day for primary (the time_off trigger's trailing edge, mirrored)
  ok(/start_date <= \(case when p_role = 'primary' then p_day \+ 1 else p_day end\)\s+and end_date\s+>= p_day/.test(fn),
    n + ": CL009 must test time_off overlap with p_day, extended to p_day + 1 for a PRIMARY claim");
  eq((fn.match(/version = version \+ 1, source = 'claim', updated_by = me, updated_at = now\(\)/g) || []).length, 2,
    n + ": both role updates must set version + 1, source 'claim', updated_by = caller, updated_at = now();");
  ok(!/_locked = /.test(fn), n + ": a claim must never touch a lock flag");
  ok(/values \(me, my_name, 'schedule\.claim', jsonb_build_object\('day', p_day, 'role', p_role, 'person', me, 'version', new_ver(, 'offer', wrote_offer)?\)\);/.test(fn),
    n + ": audit row 'schedule.claim' {day, role, person, version[, offer]} missing");
  ok(/values \('shift_claimed',\s+my_name \|\| ' took ' \|\| to_char\(p_day, 'FMMM\/FMDD'\) \|\| ' ' \|\| p_role,/.test(fn),
    n + ": notifications row type 'shift_claimed' with title `<Name> took <M/D> <role>` missing");
  ok(/jsonb_build_object\('day', p_day, 'role', p_role, 'surgeon_id', me, 'person_id', me\)\);/.test(fn),
    n + ": notifications data must be {day, role, surgeon_id, person_id} (the feed filter reads data.surgeon_id)");
  ok(/return jsonb_build_object\('ok', true, 'day', p_day, 'role', p_role, 'person_id', me, 'version', new_ver\);/.test(fn),
    n + ": return shape must be {ok, day, role, person_id, version}");
  ok(/revoke all on function public\.claim_open_slot\(date, text\) from public, anon;/.test(s), n + ": revoke on claim_open_slot missing");
  ok(/grant execute on function public\.claim_open_slot\(date, text\) to authenticated;/.test(s), n + ": grant on claim_open_slot missing");
}
step("claim_open_slot() in schema.sql: placement, nine refusals in order, writes, audit + feed rows, grants");
checkClaim("schema.sql", schema);
(function placement() {
  const afterTrade = schema.indexOf("grant execute on function public.apply_trade(uuid) to authenticated;");
  const claimAt = schema.indexOf("create or replace function public.claim_open_slot(");
  const notifAt = schema.indexOf("create table if not exists public.notifications (");
  ok(claimAt > afterTrade, "claim_open_slot must be defined AFTER apply_trade's grant line");
  ok(claimAt < notifAt, "claim_open_slot must be defined BEFORE the notifications table (the section right after apply_trade)");
  ok(/-- Revision 2026-09-22 c \(Prompt 13 part 2, sql\/migrations\/2026-09-22-claim-open-slot\.sql\)/.test(schema), "schema.sql header must record revision c (claim_open_slot)");
  ok(/source\s+text,\s+-- import \| generated \| manual \| east-derived \| trade \| claim\b/.test(schema), "schedule_days.source column comment must list the sixth value 'claim' (the function writes it)");
})();

step("claim migration (9/22) frozen as applied; schema.sql's claim_open_slot = the claim-offer migration (9/23, the newest)");
const claimMigration = read(CLAIM_MIGRATION);
ok(!/\r/.test(claimMigration), "claim migration has CRLF line endings");
checkClaim("claim migration", claimMigration);
eq((claimMigration.match(/create or replace function/g) || []).length, 1, "the claim migration must define claim_open_slot and nothing else;");
ok(!/drop function/.test(claimMigration), "the claim migration must not drop anything");
// The 9/22 file is what ran live on 9/22 - frozen by sha256 (audit RLS-2 rule: an applied file is never edited).
// Prompt 14 part 2c re-created the function on 9/23 07:05Z from sql/migrations/2026-09-23-claim-offer.sql (the
// same body plus the call_offers upsert and the audit detail 'offer'); schema.sql mirrors THAT one.
const CLAIM_OFFER_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-claim-offer.sql");
(function frozenAndMirrored() {
  const sha = (x) => require("crypto").createHash("sha256").update(x || "").digest("hex");
  const base = functionText(claimMigration, "claim_open_slot");
  eq(sha(base), "88ae39e5b2d14ec956a012532aeda897636f8efb49d472456d1b1ec0d987dd1b", "2026-09-22-claim-open-slot.sql: claim_open_slot() body sha256 changed - the applied 9/22 file is frozen; a new body goes in a new migration");
  const claimOffer = read(CLAIM_OFFER_MIGRATION);
  ok(!/\r/.test(claimOffer), "claim-offer migration has CRLF line endings");
  const a = functionText(schema, "claim_open_slot"), b = functionText(claimOffer, "claim_open_slot");
  ok(a && b && a === b, "claim_open_slot(): schema.sql differs from sql/migrations/2026-09-23-claim-offer.sql (the newest migration touching it, live since 9/23 07:05Z; keep them identical)");
  ok(/insert into public\.call_offers \(person_id, day, role_pref, note, entered_by, source\)/.test(a) && /set_config\('silvis\.claim_in_progress', 'on', true\)/.test(a), "schema.sql: claim_open_slot must upsert the call_offers row under the silvis.claim_in_progress flag (claim-as-offer)");
  ok(/rules_only_ids \? me/.test(a), "schema.sql: claim_open_slot writes no offer row for a claimer listed in the period's rules_only_ids");
  ok(/'offer', wrote_offer/.test(a), "schema.sql: the schedule.claim audit detail must carry offer true/false");
  ok(a.indexOf("insert into public.call_offers") < a.indexOf("'schedule.claim'"), "schema.sql: the call_offers upsert comes before the audit row");
})();

step("claim probe is self-rolling-back, lives in 2030-04 (+ 2020-01-01), covers cases A..L");
const claimProbe = read(CLAIM_PROBE);
ok(!/\r/.test(claimProbe), "claim probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(claimProbe), "claim probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(claimProbe), "claim probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated/.test(claimProbe), "claim probe must grant the temp table to authenticated");
const claimLastDo = claimProbe.lastIndexOf("do $$");
ok(claimLastDo > 0, "claim probe has no DO block");
ok(/raise exception 'PROBE_RESULTS %;END'/.test(claimProbe.slice(claimLastDo)), "claim probe's last DO block must raise 'PROBE_RESULTS %;END'");
ok(claimProbe.indexOf("'2030-04-") > 0, "claim probe fixtures must live in 2030-04");
ok(claimProbe.indexOf("'2020-01-01'") > 0, "claim probe must insert the 2020-01-01 lower-bound row (case E: CL003 fires before the range check)");
ok(claimProbe.indexOf("'2030-03-") < 0, "claim probe must not touch the trade probe's 2030-03 fixtures");
["'A'", "'B'", "'C'", "'D'", "'E'", "'F'", "'G'", "'H'", "'I'", "'I2'", "'J'", "'K'", "'L'"].forEach((k) => ok(claimProbe.indexOf("values (" + k) >= 0, "claim probe lacks case " + k));
ok(/'probe-claim-' \|\| u::text \|\| '@example\.test'/.test(claimProbe), "claim probe's throwaway auth users must be probe-claim-<uuid>@example.test");
ok(/'probe-claim'/.test(claimProbe), "claim probe's time_off rows must carry note 'probe-claim' (the leftover count keys on it)");
ok(/set person_id = 's3', role = 'surgeon'/.test(claimProbe) && /set person_id = 's1', role = 'scheduler'/.test(claimProbe), "claim probe must link its throwaway surgeon to s3 and its scheduler to s1");
ok(/set local role anon/.test(claimProbe), "claim probe case A must act as anon (role anon, no jwt claims)");
ok(/'ERR ' \|\| sqlstate \|\| ' ' \|\| sqlerrm/.test(claimProbe), "claim probe must record the SQLSTATE with each error (the CL codes are graded)");
ok(/took 4\/7 backup/.test(claimProbe), "claim probe header must state the expected feed title 'Acton took 4/7 backup'");
ok(!/simple-protocol/.test(claimProbe), "claim probe header must not claim a simple-protocol connection");

step("verify-rls.sh section 7 grades the claim probe, checks the anon REST refusal, counts leftovers");
ok(/^echo "== 7\. claim_open_slot/m.test(vr), "verify-rls.sh has no section 7 (claim_open_slot)");
ok(/rest\/v1\/rpc\/claim_open_slot/.test(vr), "verify-rls.sh must POST rest/v1/rpc/claim_open_slot");
ok(/"HTTP 401"\|"HTTP 403"\|"HTTP 404"\) ok "anon rpc claim_open_slot refused/.test(vr), "verify-rls.sh 7a must accept 401/403/404 for the anon rpc call (404 before the migration, 401/403 after)");
ok(/claim-open-slot-probe\.sql/.test(vr), "verify-rls.sh must run sql/probes/claim-open-slot-probe.sql");
// Grade against SECTION 7 ONLY: section 5 already has `expect_eq A ...` .. `expect_eq H ...` for the trade probe,
// so a whole-file search would let a section 7 that forgot cases A-H pass.
const s7 = vr.slice(vr.indexOf('echo "== 7.'));
ok(s7.length > 0 && s7.length < vr.length, "verify-rls.sh section 7 could not be sliced out (no 'echo \"== 7.' line)");
["A", "B", "C", "D", "E", "F", "G", "H", "I", "I2", "J", "K", "L"].forEach((k) => ok(new RegExp("expect_(code|eq|ok)\\s+" + k + "\\s").test(s7), "verify-rls.sh section 7 does not grade probe case " + k));
["CL003", "CL004", "CL005", "CL006", "CL007", "CL008", "CL009"].forEach((c) => ok(s7.indexOf(c) > 0, "verify-rls.sh section 7 must expect " + c));
// 7e's 2030-04-20 fixture: if the REST claim ever SUCCEEDED (the failure 7e exists to catch) the row's source becomes
// 'claim', so the cleanup must delete by day alone, and the delete must be verified (a stray row would widen the
// published range min(day)..max(day) that claim_open_slot and the board use).
ok(!/day = '2030-04-20' and source = 'verify-rls'/.test(s7), "verify-rls.sh 7e must delete the 2030-04-20 fixture by day alone (a successful claim rewrites source to 'claim')");
ok((s7.match(/delete from public\.schedule_days where day = '2030-04-20';/g) || []).length >= 2, "verify-rls.sh 7e must delete the 2030-04-20 fixture by day before and after the check");
ok(/7e cleanup delete failed/.test(s7), "verify-rls.sh 7e must verify its cleanup delete and report a failure (bad ...) instead of an unconditional 'cleanup done'");
ok(/day between '2030-04-01' and '2030-04-30'/.test(vr) && /day = '2020-01-01'/.test(vr) && /note = 'probe-claim'/.test(vr) && /email like 'probe-claim-%@example\.test'/.test(vr),
  "verify-rls.sh section 7 must count claim-probe leftovers (schedule_days 2030-04 + 2020-01-01 / time_off 'probe-claim' / auth.users probe-claim-) and fail on non-zero");
ok(/SILVIS_SURGEON_JWT/.test(vr.slice(vr.indexOf('echo "== 7.'))), "verify-rls.sh section 7 REST variants must be gated on SILVIS_SURGEON_JWT (SKIP when unset)");

/* ------------------------------ east_vacation_reviews (Prompt 15 part 2) */
// The review table for the mirrored East vacations: dates + decision only, authenticated-read
// (NO anon policy), writes own rows or scheduler. The migration is what runs live; schema.sql
// carries the byte-identical table + policy text; the probe rolls itself back; verify-rls.sh
// section 9 grades it. "end" is a reserved word and must stay quoted.
const EV_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-east-vacation-reviews.sql");
const EV_PROBE = path.join(ROOT, "sql", "probes", "east-vacation-reviews-probe.sql");
const EV_INDEX = 'create index if not exists east_vacation_reviews_person_idx on public.east_vacation_reviews(person_id, "start");';
const EV_LAST_POLICY = "create policy east_vacation_reviews_self_delete on public.east_vacation_reviews for delete to authenticated\n  using (person_id = public.silvis_person_id() or public.silvis_is_sched());";
function sliceBetween(s, from, endMarker) {
  const i = s.indexOf(from);
  if (i < 0) return null;
  const j = s.indexOf(endMarker, i);
  return j < 0 ? null : s.slice(i, j + endMarker.length);
}
const evTableText = (s) => sliceBetween(s, "create table if not exists public.east_vacation_reviews (", EV_INDEX);
const evPolicyText = (s) => sliceBetween(s, "drop policy if exists east_vacation_reviews_read on public.east_vacation_reviews;", EV_LAST_POLICY);
const OWN_OR_SCHED = "person_id = public.silvis_person_id() or public.silvis_is_sched()";
function checkEastVacationReviews(n, s) {
  const t = evTableText(s);
  ok(t, n + ": no `create table if not exists public.east_vacation_reviews (` ... person index block");
  ok(/id\s+uuid primary key default gen_random_uuid\(\),/.test(t), n + ": id uuid primary key default gen_random_uuid()");
  ok(/person_id\s+text not null,/.test(t), n + ": person_id text not null");
  ok(/"start"\s+date not null,/.test(t), n + ': "start" date not null (quoted, like "end")');
  ok(/"end"\s+date not null,/.test(t), n + ': "end" date not null - a reserved word, it must stay quoted');
  ok(!/[^"]\bend\s+date/.test(t), n + ': an unquoted `end date` column would not parse');
  ok(/decision\s+text not null check \(decision in \('away', 'home'\)\),/.test(t), n + ": decision text not null check in ('away', 'home')");
  ok(/decided_at\s+timestamptz not null default now\(\),/.test(t), n + ": decided_at timestamptz not null default now()");
  ok(/decided_by\s+text,/.test(t), n + ": decided_by text");
  ok(/check \("end" >= "start"\),/.test(t), n + ': check ("end" >= "start")');
  ok(/unique \(person_id, "start", "end"\)/.test(t), n + ': unique (person_id, "start", "end")');
  ok(!/\b(note|reason|email|phone)\b/.test(t), n + ": the table carries dates and a decision only - no note, reason or contact column");
  ok(/alter table public\.east_vacation_reviews\s+enable row level security;/.test(s), n + ": enable row level security missing");
  const p = evPolicyText(s);
  ok(p, n + ": no policy block (drop policy if exists east_vacation_reviews_read ... self_delete)");
  ok(/create policy east_vacation_reviews_read on public\.east_vacation_reviews for select to authenticated using \(true\);/.test(p), n + ": read policy must be `for select to authenticated using (true)`");
  ok(!/on public\.east_vacation_reviews for select using \(true\)/.test(s), n + ": there must be NO anon-readable select policy on east_vacation_reviews");
  ok(!/on public\.east_vacation_reviews for all/.test(s), n + ": no blanket `for all` policy (the four verbs are spelled out)");
  ok(new RegExp("create policy east_vacation_reviews_self_insert on public\\.east_vacation_reviews for insert to authenticated\\s+with check \\(" + OWN_OR_SCHED.replace(/[()]/g, "\\$&") + "\\);").test(p), n + ": insert policy (own rows or scheduler) missing");
  ok(new RegExp("create policy east_vacation_reviews_self_update on public\\.east_vacation_reviews for update to authenticated\\s+using \\(" + OWN_OR_SCHED.replace(/[()]/g, "\\$&") + "\\)\\s+with check \\(" + OWN_OR_SCHED.replace(/[()]/g, "\\$&") + "\\);").test(p), n + ": update policy (own rows or scheduler, using + with check) missing");
  ok(new RegExp("create policy east_vacation_reviews_self_delete on public\\.east_vacation_reviews for delete to authenticated\\s+using \\(" + OWN_OR_SCHED.replace(/[()]/g, "\\$&") + "\\);").test(p), n + ": delete policy (own rows or scheduler) missing");
  eq((p.match(new RegExp(OWN_OR_SCHED.replace(/[()]/g, "\\$&"), "g")) || []).length, 4, n + ": exactly four own-or-scheduler predicates (insert, update using, update with check, delete);");
  eq((p.match(/drop policy if exists/g) || []).length, 4, n + ": four drop-if-exists lines (idempotency);");
}
step("east_vacation_reviews in schema.sql: table, constraints, RLS, placement, header revision");
checkEastVacationReviews("schema.sql", schema);
(function placement() {
  const forecastAt = schema.indexOf("create table if not exists public.east_forecast (");
  const evAt = schema.indexOf("create table if not exists public.east_vacation_reviews (");
  const tradesAt = schema.indexOf("create table if not exists public.shift_trade_requests (");
  ok(evAt > forecastAt && evAt < tradesAt, "east_vacation_reviews must be defined right after east_forecast (the East block) and before shift_trade_requests");
  const loop = schema.match(/foreach t in array array\[[^\]]*\]/);
  ok(loop && !loop[0].includes("east_vacation_reviews"), "east_vacation_reviews must NOT be in the anon-readable table loop");
  ok(/-- Revision 2026-09-23 d \(Prompt 15 part 2, sql\/migrations\/2026-09-23-east-vacation-reviews\.sql\)/.test(schema), "schema.sql header must record revision d (east_vacation_reviews)");
})();

step("east_vacation_reviews migration defines the same table and policies, byte-identical");
const evMigration = read(EV_MIGRATION);
ok(!/\r/.test(evMigration), "east_vacation_reviews migration has CRLF line endings");
checkEastVacationReviews("eastvac migration", evMigration);
eq((evMigration.match(/create table/g) || []).length, 1, "the migration must create east_vacation_reviews and nothing else;");
ok(!/drop table|drop function|create or replace function|alter table [^\n]*(add|drop|alter) column/.test(evMigration), "the migration must not drop or alter anything existing");
ok(!/schedule_days|time_off|call_schedule_data|east_feed\b/.test(evMigration.replace(/--[^\n]*/g, "")), "the migration's statements touch no existing table (comments aside)");
(function identical() {
  const a = evTableText(schema), b = evTableText(evMigration);
  ok(a && b && a === b, "east_vacation_reviews table text: migration differs from schema.sql (keep them identical; the migration is what runs live)");
  const pa = evPolicyText(schema), pb = evPolicyText(evMigration);
  ok(pa && pb && pa === pb, "east_vacation_reviews policy text: migration differs from schema.sql");
})();

step("east_vacation_reviews probe is self-rolling-back, lives in 2030-05, covers cases A1..J");
const evProbe = read(EV_PROBE);
ok(!/\r/.test(evProbe), "eastvac probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(evProbe), "eastvac probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(evProbe), "eastvac probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated/.test(evProbe), "eastvac probe must grant the temp table to authenticated");
const evLastDo = evProbe.lastIndexOf("do $$");
ok(evLastDo > 0, "eastvac probe has no DO block");
ok(/raise exception 'PROBE_RESULTS %;END'/.test(evProbe.slice(evLastDo)), "eastvac probe's last DO block must raise 'PROBE_RESULTS %;END'");
ok(evProbe.indexOf("'2030-05-") > 0, "eastvac probe fixtures must live in 2030-05");
ok(evProbe.indexOf("'2030-03-") < 0 && evProbe.indexOf("'2030-04-") < 0, "eastvac probe must not touch the trade / claim probes' fixtures");
["'A1'", "'A2'", "'B'", "'C'", "'D'", "'E'", "'F'", "'G'", "'H'", "'I'", "'J'"].forEach((k) => ok(evProbe.indexOf("values (" + k) >= 0, "eastvac probe lacks case " + k));
ok(/'probe-eastvac-' \|\| u::text \|\| '@example\.test'/.test(evProbe), "eastvac probe's throwaway auth users must be probe-eastvac-<uuid>@example.test");
ok(/'probe-eastvac'\)/.test(evProbe), "eastvac probe rows must carry decided_by 'probe-eastvac' (the leftover count keys on it)");
ok(/set person_id = 's3', role = 'surgeon'/.test(evProbe) && /set person_id = 's1', role = 'scheduler'/.test(evProbe), "eastvac probe must link its throwaway surgeon to s3 and its scheduler to s1");
ok(/set local role anon/.test(evProbe), "eastvac probe cases A1/A2 must act as anon (role anon, no jwt sub)");
ok(/'ERR ' \|\| sqlstate \|\| ' ' \|\| sqlerrm/.test(evProbe), "eastvac probe must record the SQLSTATE with each error (42501 / 23514 / 23505 are graded)");
ok(/get diagnostics n = row_count;/.test(evProbe), "eastvac probe must observe UPDATE / DELETE row counts (RLS filters silently)");
ok(!/schedule_days|time_off|call_schedule_data/.test(evProbe.replace(/--[^\n]*/g, "")), "eastvac probe statements touch only east_vacation_reviews, user_profiles links and auth.users");
ok(!/simple-protocol/.test(evProbe), "eastvac probe header must not claim a simple-protocol connection");

step("verify-rls.sh section 9 checks the anon 200 + [] read, the anon write, grades the probe, counts leftovers, reads as a surgeon");
ok(/^echo "== 9\. east_vacation_reviews/m.test(vr), "verify-rls.sh has no section 9 (east_vacation_reviews)");
// bounded at section 10 (Prompt 16 A1): the 9d read-only pin below must judge 9d, not the next section's anon rpc POST
const s9 = vr.slice(vr.indexOf('echo "== 9.'), vr.indexOf('echo "== 10.') > 0 ? vr.indexOf('echo "== 10.') : vr.length);
ok(s9.length > 0 && s9.length < vr.length, "verify-rls.sh section 9 could not be sliced out");
ok(/rest\/v1\/east_vacation_reviews\?select=person_id,start,end,decision/.test(s9), "verify-rls.sh 9a must GET rest/v1/east_vacation_reviews");
ok(/\[ "\$body9a" = "\[\]" \]/.test(s9), "verify-rls.sh 9a must require an EMPTY array body on 200 (a row in the anon body is a FAIL)");
ok(/"HTTP 404"\) ok "east_vacation_reviews not created yet/.test(s9), "verify-rls.sh 9a must name a 404 as 'before the migration'");
ok(/-X POST "\$URL\/rest\/v1\/east_vacation_reviews"/.test(s9) && /"HTTP 401"\|"HTTP 403"\|"HTTP 404"\) ok "anon write to east_vacation_reviews blocked/.test(s9), "verify-rls.sh 9b must POST as anon and accept 401/403 (404 before the migration)");
ok(/east-vacation-reviews-probe\.sql/.test(s9), "verify-rls.sh 9c must run sql/probes/east-vacation-reviews-probe.sql");
["A1", "A2", "B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((k) => ok(new RegExp("expect_(code|eq)\\s+" + k + "\\s").test(s9), "verify-rls.sh section 9 does not grade probe case " + k));
["42501", "23514", "23505", "rows=0", "ok visible=3", "updated=0 decision=home", "deleted=0", "updated=1 decision=home", "updated=1 decision=away deleted=1"].forEach((c) => ok(s9.indexOf(c) > 0, "verify-rls.sh section 9 must expect " + c));
ok(/decided_by = 'probe-eastvac'/.test(s9) && /email like 'probe-eastvac-%@example\.test'/.test(s9), "verify-rls.sh section 9 must count eastvac-probe leftovers (probe-eastvac rows / auth.users) and fail on non-zero");
ok(/LEFT ROWS BEHIND/.test(s9), "verify-rls.sh section 9 must report leftovers as a failure with the cleanup statements");
ok(/SILVIS_SURGEON_JWT/.test(s9), "verify-rls.sh 9d must be gated on SILVIS_SURGEON_JWT (SKIP when unset)");
const s9d = s9.slice(s9.indexOf("# 9d."));
ok(s9d.length > 0 && !/-X (POST|PATCH|DELETE|PUT)/.test(s9d), "verify-rls.sh 9d must be read-only over REST (a REST write would be a real, persisted decision)");

/* -------------------------- migrations vs schema.sql (RLS-2 recurrence guard) */
// Every function a migration CREATE OR REPLACEs must read in schema.sql exactly as in the NEWEST
// migration touching it - otherwise a wholesale re-run of schema.sql would silently revert a live
// body. Files order by their date prefix; two SAME-DAY migrations redefining one function are never
// ordered by file name (an alphabetical guess could pick the wrong body silently): the file applied
// later must declare it with a header line `-- supersedes: sql/migrations/<the earlier file>`, else
// the suite fails closed. An already-applied file is never renamed - the apply record cites its name.
step("every function a migration CREATE OR REPLACEs is mirrored in schema.sql from the newest migration touching it");
const MIG_DIR = path.join(ROOT, "sql", "migrations");
const migFiles = fs.readdirSync(MIG_DIR).filter((f) => /\.sql$/.test(f)).sort();
ok(migFiles.length >= 4, "expected at least the four migrations under sql/migrations/ (2026-09-22 x2, 2026-09-23 x2; found " + migFiles.length + ")");
const migText = {};
migFiles.forEach((f) => { migText[f] = read(path.join(MIG_DIR, f)); });
const supersedes = (later, earlier) => new RegExp("^--\\s*supersedes:?\\s+sql/migrations/" + earlier.replace(/\./g, "\\.") + "\\s*$", "m").test(migText[later]);
const newest = {};
migFiles.forEach((f) => {
  Array.from(migText[f].matchAll(/^create or replace function public\.([a-z_]+)\(/gm)).map((m) => m[1]).forEach((name) => {
    const prev = newest[name];
    if (prev && prev.slice(0, 10) === f.slice(0, 10)) {
      if (supersedes(prev, f)) return;   // the file sorting first was applied later - it stays the newest
      if (!supersedes(f, prev)) fail(name + "() is redefined by two migrations dated the same day (" + prev + ", " + f + ") and neither declares the order: add `-- supersedes: sql/migrations/<the earlier one>` to the header of the file applied later");
    }
    newest[name] = f;
  });
});
["apply_trade", "trade_insert_guard", "trade_update_guard", "claim_open_slot"].forEach((n) => ok(newest[n], "no migration under sql/migrations/ defines " + n + "()"));
Object.keys(newest).forEach((name) => {
  const f = newest[name];
  const migSql = read(path.join(MIG_DIR, f));
  // a `language sql` body (offer_status) ends at `$$;` with no `end`: slicing it to the next `end $$;` would
  // compare the NEIGHBOURING plpgsql function instead (found rebasing Prompt 14 onto this guard, 9/23)
  const isSql = new RegExp("create or replace function public\\." + name + "\\([^)]*\\)[^$]*\\blanguage sql\\b").test(migSql);
  const slice = isSql ? sqlFunctionText : functionText;
  const a = slice(schema, name), b = slice(migSql, name);
  ok(a, "schema.sql has no `create or replace function public." + name + "(` but sql/migrations/" + f + " creates it - mirror it");
  ok(b, "sql/migrations/" + f + " " + name + "(): body could not be sliced (expected a $$-quoted " + (isSql ? "sql body ending in `$$;`" : "plpgsql body ending in `end $$;`") + ")");
  ok(a === b, name + "(): schema.sql differs from the NEWEST migration touching it (sql/migrations/" + f + ") - mirror that body into schema.sql, or a wholesale re-run reverts the live function");
});

step("schema.sql header records every migration file; an unmerged migration may be named only while its file is absent");
const header = schema.slice(0, schema.indexOf("create extension if not exists pgcrypto;"));
ok(header.length > 0, "schema.sql header (everything before `create extension if not exists pgcrypto;`) could not be sliced");
const namedInHeader = Array.from(header.matchAll(/sql\/migrations\/([A-Za-z0-9._-]+\.sql)/g)).map((m) => m[1]);
migFiles.forEach((f) => ok(namedInHeader.includes(f), "sql/migrations/" + f + " is not recorded in schema.sql's header (add a Revision line naming it)"));
header.split("\n").forEach((line) => {
  Array.from(line.matchAll(/sql\/migrations\/([A-Za-z0-9._-]+\.sql)/g)).forEach((m) => {
    const exists = fs.existsSync(path.join(MIG_DIR, m[1]));
    if (/not yet merged/.test(line)) {
      ok(!exists, "schema.sql header names sql/migrations/" + m[1] + " as 'not yet merged', but the file exists: the mirror landed - mirror its bodies into schema.sql (the newest-migration pin above enforces it), add its Revision line and drop the LIVE DIFFERS note");
    } else {
      ok(exists, "schema.sql header names sql/migrations/" + m[1] + " but no such file exists");
    }
  });
});
eq(/LIVE DIFFERS FROM THIS FILE/.test(header), header.split("\n").some((l) => /not yet merged/.test(l)), "the LIVE DIFFERS note and a 'not yet merged' migration line go together (both present or both gone);");
ok(!/^-- Paste into the SQL editor once\. Re-runnable \(IF NOT EXISTS \/ OR REPLACE\)\.\s*$/m.test(header), "schema.sql line 4 must not claim unconditional re-runnability");
// (comment lines wrap: join the `-- ` continuations before matching the sentence)
ok(/re-runnable only when every applied migration has been mirrored/i.test(header.replace(/\n-- /g, " ")), "schema.sql header must say it is re-runnable only when every applied migration has been mirrored below");

/* ----------------------------------------------------- no contact data */
step("no contact-like values under sql/");
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(^|[^0-9])\(?[0-9]{3}\)?[-. ][0-9]{3}[-. ][0-9]{4}([^0-9]|$)/;
(function walk(dir) {
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    const s = fs.readFileSync(p, "utf8");
    const emails = (s.match(EMAIL) || []).filter((e) => !/@example\.test$/.test(e));
    eq(emails, [], path.relative(ROOT, p) + ": email-like value");
    ok(!PHONE.test(s), path.relative(ROOT, p) + ": phone-like value");
  });
})(path.join(ROOT, "sql"));

// ---- Prompt 14 P1 (9/23) ----
// Offers + periods (docs/PROMPT-14-OFFER-PERIODS.md part 1). The 9/22 body was applied live by hand
// (docs/SCHEMA-REVIEW.md "Offers and periods"); the repo copy is pinned by sha256 so the file that ran
// is the file that is kept. offer_modes (Faraz 9/22 evening) is a separate, later migration.
const OFFERS_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-22-offers-periods.sql");
const OFFER_MODES_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-offer-modes.sql");
const OFFERS_PROBE = path.join(ROOT, "sql", "probes", "offers-probe.sql");
// sha256 of the applied file, observed 2026-09-22 (sha256sum of the scratchpad copy that ran through the linked CLI).
const OFFERS_APPLIED_SHA256 = "d2deac095ad18e2f245286eb6011ea49b0a3d89964ba5334e682978889c16458";
// The repo copy may carry ONE trailer line after the applied body; the body (everything before it) is what is hashed.
const OFFERS_TRAILER = "\n-- applied 2026-09-22 15:15 by hand";
const OFFER_POLICIES = ["call_offers_read", "call_offers_insert", "call_offers_update", "call_offers_delete", "call_periods_read", "call_periods_write"];
const OFFER_MODES_LINES = [
  "alter table public.call_periods add column if not exists offer_modes jsonb not null default '{}'::jsonb;",
  "alter table public.call_periods drop constraint if exists call_periods_offer_modes_object;",
  "alter table public.call_periods add constraint call_periods_offer_modes_object check (jsonb_typeof(offer_modes) = 'object');",
  "comment on column public.call_periods.offer_modes is '{person_id: ''exhaustive'' | ''preferred''}; absent = ''preferred'' (the default, Faraz 9/22 evening); offer_status() is unchanged';",
];
// A `language sql` function ends with `\n$$;` (no `end`), unlike the plpgsql bodies functionText() reads.
function sqlFunctionText(sql, name) {
  const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([^)]*\\)[\\s\\S]*?\\n\\$\\$;", ""));
  return m ? m[0] : null;
}
function policyText(sql, name) {
  const m = sql.match(new RegExp("create policy " + name + " on public\\.[a-z_]+[\\s\\S]*?;", ""));
  return m ? m[0] : null;
}
function triggerText(sql, name) {
  const m = sql.match(new RegExp("create trigger " + name + "\\s[\\s\\S]*?;", ""));
  return m ? m[0] : null;
}
function checkOffersDDL(n, s) {
  ok(/create table if not exists public\.call_periods \(/.test(s), n + ": `create table if not exists public.call_periods (` missing");
  ok(/create table if not exists public\.call_offers \(/.test(s), n + ": `create table if not exists public.call_offers (` missing");
  ok(/status\s+text not null default 'upcoming' check \(status in \('upcoming','closed','generated','published'\)\)/.test(s), n + ": call_periods.status check list");
  ok(/check \(jsonb_typeof\(rules_only_ids\) = 'array'\)/.test(s), n + ": call_periods.rules_only_ids must be checked as a jsonb array");
  ok(/check \(offers_close_at <= start_day\)/.test(s), n + ": call_periods must check offers_close_at <= start_day");
  ok(/role_pref\s+text not null check \(role_pref in \('primary','backup','either'\)\)/.test(s), n + ": call_offers.role_pref check list");
  ok(/source\s+text not null default 'app' check \(source in \('app','email-relay','import'\)\)/.test(s), n + ": call_offers.source check list");
  ok(/unique \(person_id, day\)/.test(s), n + ": call_offers needs unique (person_id, day)");
  // the three refusals, each with its stable token AND its errcode (the client matches on both)
  ok(/raise exception 'OFFER_PAST: % is before today \(%\) in Central time', new\.day, today_c using errcode = 'OF001';/.test(s), n + ": OFFER_PAST / OF001");
  ok(/raise exception 'OFFER_ON_VACATION: % is inside a vacation of %', new\.day, new\.person_id using errcode = 'OF002';/.test(s), n + ": OFFER_ON_VACATION / OF002");
  eq((s.match(/raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen\.label, frozen\.offers_close_at using errcode = 'OF003';/g) || []).length, 2,
    n + ": OFFER_FROZEN / OF003 must be raised by BOTH the insert/update guard and the delete guard;");
  ok(/today_c date := \(now\(\) at time zone 'America\/Chicago'\)::date;/.test(s), n + ": 'today' must be the Central date");
  ok(/if not public\.silvis_is_sched\(\) then/.test(s), n + ": the freeze must exempt the scheduler (silvis_is_sched())");
  // triggers (drop-if-exists first: idempotency)
  ok(/drop trigger if exists call_offers_guard_trg on public\.call_offers;/.test(s), n + ": drop trigger if exists call_offers_guard_trg");
  ok(/create trigger call_offers_guard_trg\s+before insert or update on public\.call_offers\s+for each row execute function public\.call_offers_guard\(\);/.test(s), n + ": call_offers_guard_trg before insert or update");
  ok(/drop trigger if exists call_offers_delete_guard_trg on public\.call_offers;/.test(s), n + ": drop trigger if exists call_offers_delete_guard_trg");
  ok(/create trigger call_offers_delete_guard_trg\s+before delete on public\.call_offers\s+for each row execute function public\.call_offers_delete_guard\(\);/.test(s), n + ": call_offers_delete_guard_trg before delete");
  // derived status
  const os = sqlFunctionText(s, "offer_status");
  ok(os, n + ": no `create or replace function public.offer_status(p_period uuid, p_person text)` ... `$$;` block");
  ok(/language sql stable security invoker/.test(os), n + ": offer_status must be language sql stable security invoker (it runs under the caller's RLS)");
  ["'submitted'", "'rules_only'", "'not_started'"].forEach((v) => ok(os.indexOf(v) >= 0, n + ": offer_status must return " + v));
  ok(/o\.day between p\.start_day and p\.end_day/.test(os), n + ": 'submitted' = an offer INSIDE the period's days");
  ok(/jsonb_array_elements_text\(p\.rules_only_ids\)/.test(os), n + ": 'rules_only' reads call_periods.rules_only_ids");
  // RLS: on, authenticated-only reads (NOT anon), own rows or scheduler for writes, scheduler for periods
  ok(/alter table public\.call_offers\s+enable row level security;/.test(s), n + ": RLS must be enabled on call_offers");
  ok(/alter table public\.call_periods\s+enable row level security;/.test(s), n + ": RLS must be enabled on call_periods");
  OFFER_POLICIES.forEach((p) => {
    ok(new RegExp("drop policy if exists " + p + " on public\\.").test(s), n + ": drop policy if exists " + p);
    ok(policyText(s, p), n + ": create policy " + p);
  });
  ok(/create policy call_offers_read on public\.call_offers for select to authenticated using \(true\);/.test(s), n + ": call_offers_read = every signed-in user, never anon");
  ok(/create policy call_periods_read on public\.call_periods for select to authenticated using \(true\);/.test(s), n + ": call_periods_read = every signed-in user, never anon");
  ok(/create policy call_offers_insert on public\.call_offers for insert to authenticated\s+with check \(person_id = public\.silvis_person_id\(\) or public\.silvis_is_sched\(\)\);/.test(s), n + ": call_offers_insert = own row or scheduler");
  ok(/create policy call_offers_update on public\.call_offers for update to authenticated\s+using \(person_id = public\.silvis_person_id\(\) or public\.silvis_is_sched\(\)\)\s+with check \(person_id = public\.silvis_person_id\(\) or public\.silvis_is_sched\(\)\);/.test(s), n + ": call_offers_update = own row or scheduler, using AND with check");
  ok(/create policy call_offers_delete on public\.call_offers for delete to authenticated\s+using \(person_id = public\.silvis_person_id\(\) or public\.silvis_is_sched\(\)\);/.test(s), n + ": call_offers_delete = own row or scheduler");
  ok(/create policy call_periods_write on public\.call_periods for all to authenticated\s+using \(public\.silvis_is_sched\(\)\) with check \(public\.silvis_is_sched\(\)\);/.test(s), n + ": call_periods_write = scheduler/admin only");
}
function checkOfferModes(n, s) {
  OFFER_MODES_LINES.forEach((line) => ok(s.indexOf(line) >= 0, n + ": missing exact line `" + line + "`"));
}

step("P14 P1: schema.sql declares call_offers + call_periods, OF001/OF002/OF003, triggers, offer_status, RLS");
checkOffersDDL("schema.sql", schema);
// The anon read_all loop must never list the two tables (offers carry person ids + free-text notes).
const anonLoop = schema.match(/foreach t in array array\[[^\]]*\]/);
ok(anonLoop && !/call_offers|call_periods/.test(anonLoop[0]), "schema.sql: call_offers / call_periods must NOT be in the anon read_all loop");
ok(!/create policy [a-z_]+ on public\.call_(offers|periods) for select using \(true\)/.test(schema), "schema.sql: no anon (role-less) select policy on call_offers / call_periods");

step("P14 P1: schema.sql carries offer_modes (column, object check, comment)");
checkOfferModes("schema.sql", schema);
ok(/offer_modes\s+jsonb not null default '\{\}'::jsonb/.test(schema), "schema.sql: create table call_periods should declare offer_modes inline too (fresh apply) - the alter is the no-op for the live table");

step("P14 P1: migration 2026-09-22-offers-periods.sql = the applied file (sha256 of the body) + the same objects as schema.sql");
const offersBuf = fs.existsSync(OFFERS_MIGRATION) ? fs.readFileSync(OFFERS_MIGRATION) : null;
ok(offersBuf, "missing file " + path.relative(ROOT, OFFERS_MIGRATION));
const offersMig = offersBuf.toString("utf8");
ok(!/\r/.test(offersMig), "offers migration has CRLF line endings");
const trailerAt = offersBuf.indexOf(OFFERS_TRAILER);
const offersBody = trailerAt >= 0 ? offersBuf.slice(0, trailerAt + 1) : offersBuf;   // keep the body's final newline
ok(trailerAt < 0 || offersBuf.slice(trailerAt + 1).toString("utf8").split("\n").filter((l) => l.length).length === 1,
  "offers migration: at most ONE trailer line after the applied body");
eq(require("crypto").createHash("sha256").update(offersBody).digest("hex"), OFFERS_APPLIED_SHA256,
  "offers migration body sha256 must equal the applied file's (strip nothing; annotate only in the trailer line);");
checkOffersDDL("offers migration", offersMig);
ok(offersMig.indexOf("offer_modes") < 0, "offers migration is the 9/22 body: offer_modes belongs to 2026-09-23-offer-modes.sql");
// Both guards were re-created by the pre-launch migration (Prompt 16 A1, sql/migrations/2026-09-24-prelaunch-rls.sql:
// freeze by status + OF004) - schema.sql mirrors the NEWEST of each, i.e. that file. The 9/22 offers migration keeps
// the applied delete-guard base; the 9/23 claim-offer migration keeps the applied call_offers_guard base
// (OFFER_FROZEN skipped while silvis.claim_in_progress is on) - both frozen, neither mirrored any more.
const PRELAUNCH_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-prelaunch-rls.sql");
(function guardsMirrored() {
  const prelaunch = read(PRELAUNCH_MIGRATION);
  const a = functionText(schema, "call_offers_delete_guard"), b = functionText(prelaunch, "call_offers_delete_guard");
  ok(a && b && a === b, "call_offers_delete_guard(): schema.sql differs from sql/migrations/2026-09-24-prelaunch-rls.sql (the newest migration touching it)");
  const base0 = functionText(offersMig, "call_offers_delete_guard");
  ok(base0 && /OF003/.test(base0) && !/p\.status/.test(base0), "offers migration: the 9/22 call_offers_delete_guard is the applied base (OF003 by close date only)");
  const claimOffer = read(CLAIM_OFFER_MIGRATION);
  const g = functionText(schema, "call_offers_guard"), h = functionText(prelaunch, "call_offers_guard");
  ok(g && h && g === h, "call_offers_guard(): schema.sql differs from sql/migrations/2026-09-24-prelaunch-rls.sql (the newest migration touching it)");
  ok(/current_setting\('silvis\.claim_in_progress', true\)/.test(g), "schema.sql: call_offers_guard must skip OFFER_FROZEN only while silvis.claim_in_progress is on");
  const claimBase = functionText(claimOffer, "call_offers_guard");
  ok(claimBase && /current_setting\('silvis\.claim_in_progress', true\)/.test(claimBase) && !/OF004|p\.status/.test(claimBase), "claim-offer migration: its call_offers_guard is the applied 9/23 base (claim flag, no OF004, no status freeze)");
  const base = functionText(offersMig, "call_offers_guard");
  ok(base && /OF001/.test(base) && /OF002/.test(base) && /OF003/.test(base), "offers migration: the 9/22 call_offers_guard raises OF001 / OF002 / OF003");
})();
ok(sqlFunctionText(schema, "offer_status") === sqlFunctionText(offersMig, "offer_status"), "offer_status(): migration text differs from schema.sql");
OFFER_POLICIES.forEach((p) => ok(policyText(schema, p) === policyText(offersMig, p), "policy " + p + ": migration text differs from schema.sql"));
["call_offers_guard_trg", "call_offers_delete_guard_trg"].forEach((t) => ok(triggerText(schema, t) === triggerText(offersMig, t), "trigger " + t + ": migration text differs from schema.sql"));

step("P14 P1: migration 2026-09-23-offer-modes.sql (applied live 2026-09-23 07:05Z)");
const modesMig = read(OFFER_MODES_MIGRATION);
ok(!/\r/.test(modesMig), "offer_modes migration has CRLF line endings");
checkOfferModes("offer_modes migration", modesMig);
ok(!/create or replace function/.test(modesMig), "offer_modes migration must not redefine any function (offer_status() is unchanged)");
ok(!/create table/.test(modesMig), "offer_modes migration must not create tables (additive column only)");

step("P14 P1: offers probe is self-rolling-back, granted to authenticated AND anon, covers A-J + offer_modes K");
const oprobe = read(OFFERS_PROBE);
ok(!/\r/.test(oprobe), "offers probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(oprobe), "offers probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(oprobe), "offers probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated;/.test(oprobe), "offers probe must grant the temp table to authenticated");
ok(/grant insert, select on probe_results to anon;/.test(oprobe), "offers probe must grant the temp table to anon (case I runs as anon)");
const oLastDo = oprobe.lastIndexOf("do $$");
ok(oLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(oprobe.slice(oLastDo)), "offers probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
["'A'", "'B'", "'C'", "'D'", "'E'", "'F'", "'G'", "'H'", "'I-read'", "'I-insert'", "'J'", "'K-set'", "'K-type'", "'K-default'"].forEach((k) => ok(oprobe.indexOf("values (" + k) >= 0, "offers probe lacks case " + k));
ok(/'probe frozen', '2030-05-01', '2030-05-31', '2026-09-01'/.test(oprobe), "offers probe fixture: the frozen period is 2030-05 with offers_close_at 2026-09-01");
ok(/'probe modes'/.test(oprobe), "offers probe K must use a second period labelled 'probe modes'");
ok(/jsonb_typeof|offer_modes/.test(oprobe.slice(oprobe.indexOf("'K-type'") - 600, oprobe.indexOf("'K-type'"))), "offers probe K-type must insert a non-object offer_modes and expect the check to refuse it");
ok(/probe-offers-' \|\| [a-z]+ \|\| '@example\.test'/.test(oprobe), "offers probe users must be probe-offers-<uuid>@example.test (the leftover count keys on it)");
ok(!/simple-protocol/.test(oprobe), "offers probe header must not claim a simple-protocol connection");

step("P14 P1: verify-rls.sh section 8 (anon count=exact 0 on both tables, anon insert refused, JWT own-row insert + cleanup, probe + leftovers)");
ok(/^echo "== 8\. /m.test(vr), "verify-rls.sh has no section 8");
const s8 = vr.slice(vr.indexOf('echo "== 8. '));
ok(/for t in call_offers call_periods; do/.test(s8) && /rest\/v1\/\$t\?select=id&limit=1/.test(s8), "section 8 must GET both call_offers and call_periods as anon (the `for t in call_offers call_periods` loop)");
eq((s8.match(/Prefer: count=exact/g) || []).length >= 2, true, "section 8 must ask for count=exact on both anon reads (an RLS-blocked read is 200 + [], so the count is what is asserted)");
ok(/\*\/0/.test(s8), "section 8 must assert Content-Range */0 (zero rows visible to anon)");
ok(/-X POST "\$URL\/rest\/v1\/call_offers"/.test(s8), "section 8 must POST call_offers as anon and expect 401/403");
ok(/SILVIS_JWT/.test(s8) && /-X DELETE "\$URL\/rest\/v1\/call_offers\?id=eq\./.test(s8), "section 8 must insert an own row with SILVIS_JWT and DELETE it by id afterwards");
ok(/offers-probe\.sql/.test(s8) && /probe-offers-%@example\.test/.test(s8) && /label in \('probe frozen', 'probe modes'\)/.test(s8), "section 8 must run sql/probes/offers-probe.sql through the linked CLI and count leftovers (offers 2030-05/06, both probe periods, probe-offers users)");
// 9/23 Fix stage: the alternation was (eq|err); expect_ok8 was added for K-set (substring grading, reviewer finding 2).
["A", "B", "C", "D", "E", "F", "G", "H", "I-read", "I-insert", "J", "K-set", "K-type", "K-default"].forEach((k) => ok(new RegExp("expect_(eq|err|ok)8\\s+" + k.replace("-", "\\-") + "\\s").test(s8), "section 8 must grade probe case " + k + " (expect_eq8 / expect_err8 / expect_ok8)"));

step("P14 P1: docs/SCHEMA-REVIEW.md quotes the 9/22 observed probe and leaves the offer_modes observation to the orchestrator");
const review = read(path.join(ROOT, "docs", "SCHEMA-REVIEW.md"));
ok(/## Offers and periods \(Prompt 14 part 1\) - applied 2026-09-22/.test(review), "SCHEMA-REVIEW.md lacks the 'Offers and periods (Prompt 14 part 1) - applied 2026-09-22' block");
ok(/PROBE_RESULTS A=ERR OF001 OFFER_PAST: 2020-01-01 is before today \(2026-09-22\) in Central time;B=ERR OF002/.test(review), "SCHEMA-REVIEW.md must quote the observed PROBE_RESULTS string verbatim");
ok(/offer_modes[\s\S]*observed: /.test(review), "SCHEMA-REVIEW.md must carry an 'observed:' line for the offer_modes migration (placeholder until the orchestrator fills it)");

// ---- Prompt 14 P1 Fix stage (9/23) - reviewer minors ----
step("P14 P1 fix: 8c's fixture day lies outside the probe's leftover window (2030-05-01..2030-06-30)");
const m8c = s8.match(/\\"day\\":\\"(\d{4}-\d{2}-\d{2})\\"[^\n]*verify-rls\.sh 8c probe/);
ok(!!m8c, "section 8c must insert the own row with note 'verify-rls.sh 8c probe'");
ok(m8c && !/^2030-0[56]-/.test(m8c[1]), "8c's day (" + (m8c && m8c[1]) + ") must not fall inside the 8e leftover window 2030-05-01..2030-06-30, or a failed 8c DELETE reads as 'the probe did not roll back'");
step("P14 P1 fix: K-set is graded on quote-free substrings (a CLI that escapes quotes must not fail a working column)");
ok(/expect_ok8\s+K-set\s+["']modes=\{["']\s+["']s2=exhaustive s3=absent["']/.test(s8), "K-set must be graded with expect_ok8 on 'modes={' and 's2=exhaustive s3=absent'");
ok(!/expect_eq8\s+K-set\s/.test(s8), "K-set must not be graded on the exact jsonb text (expect_eq8)");
ok(/expect_ok8\(\)\s*\{[^\n]*\^ok /.test(s8), "expect_ok8 must require the value to start with 'ok '");
step("P14 P1 fix: SCHEMA-REVIEW.md tables (a) and (b) carry call_offers and call_periods");
const secA = review.slice(review.indexOf("## (a) "), review.indexOf("## (b) "));
const secB = review.slice(review.indexOf("## (b) "), review.indexOf("## (c) "));
ok(/^\| `call_offers` \|/m.test(secA), "table (a) lacks a call_offers row");
ok(/^\| `call_periods` \|/m.test(secA), "table (a) lacks a call_periods row");
ok(/^\| `call_offers` \| authenticated \|/m.test(secB), "table (b) lacks a call_offers row (read: authenticated)");
ok(/^\| `call_periods` \| authenticated \|/m.test(secB), "table (b) lacks a call_periods row (read: authenticated)");
ok(!/anon/i.test(secA.split("\n").filter((l) => /`call_(offers|periods)`/.test(l)).join("\n")), "the (a) rows for call_offers / call_periods must not say anon (they are authenticated-only)");

// ---- Prompt 14 P3a (9/23, U3a) - the offer painter's two RPCs ----
// sql/migrations/2026-09-23-offer-mode-rpc.sql (NOT yet applied live as of 9/23; the orchestrator runs it) defines
// set_offer_mode() (security definer: ONE person's key on ONE period - a surgeon cannot write call_periods) and
// save_offers() (security invoker: the painter's one Save as ONE transaction, RLS + OF001-OF003 per row). schema.sql
// mirrors both byte for byte; sql/probes/offer-rpcs-probe.sql rolls itself back (cases A..K-anon).
const RPC_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-offer-mode-rpc.sql");
const RPC_PROBE = path.join(ROOT, "sql", "probes", "offer-rpcs-probe.sql");
const MODE_CODES = [["OM001", "MODE_NOT_LINKED"], ["OM002", "MODE_NOT_YOURS"], ["OM003", "MODE_BAD_MODE"], ["OM004", "MODE_NO_PERIOD"], ["OM005", "MODE_FROZEN"], ["OM006", "MODE_HAS_OFFERS"]];
const SAVE_CODES = [["OS001", "OFFERS_NOT_LINKED"], ["OS002", "OFFERS_NOT_YOURS"], ["OS003", "OFFERS_BAD_ROW"]];
// one raise carries the token (message prefix; '' = an escaped quote inside it) and the errcode
const raiseRe = (token, code) => new RegExp("raise exception '" + token + ": (?:[^']|'')*'[^;]*using errcode = '" + code + "';");
function checkOfferRpcs(n, s) {
  const mode = functionText(s, "set_offer_mode");
  ok(mode, n + ": no `create or replace function public.set_offer_mode(p_period uuid, p_mode text, p_person text default null)` ... `end $$;` block");
  if (mode) {
    ok(/^create or replace function public\.set_offer_mode\(p_period uuid, p_mode text, p_person text default null\) returns jsonb\nlanguage plpgsql security definer set search_path = public as \$\$/.test(mode),
      n + ": set_offer_mode must be `returns jsonb`, `language plpgsql security definer set search_path = public` (a surgeon cannot write call_periods)");
    const firstUpdate = mode.indexOf("update public.call_periods");
    ok(firstUpdate > 0, n + ": set_offer_mode has no `update public.call_periods`");
    let last = -1;
    MODE_CODES.forEach(([code, token]) => {
      const m = mode.match(raiseRe(token, code));
      ok(m, n + ": set_offer_mode lacks `raise exception '" + token + ": ...' using errcode = '" + code + "'`");
      const at = m ? mode.indexOf(m[0]) : -1;
      ok(at > last, n + ": " + token + " (" + code + ") is out of order (expected " + MODE_CODES.map((c) => c[0]).join(" -> ") + ")");
      ok(at < firstUpdate, n + ": " + token + " must be checked BEFORE the first call_periods update");
      last = at;
    });
    eq((mode.match(/using errcode = 'OM0/g) || []).length, 7, n + ": seven OM0xx raises expected (OM001 twice: anon / unlinked, and no person named);");
    ok(/auth\.uid\(\) is null or \(me is null and not sched\)/.test(mode), n + ": OM001 must fire for anon (auth.uid() null) and for an unlinked non-scheduler");
    ok(/who := coalesce\(nullif\(btrim\(p_person\), ''\), me\);/.test(mode), n + ": the person defaults to the caller's own roster id (p_person is the scheduler's relay path)");
    ok(/if who <> coalesce\(me, ''\) and not sched then/.test(mode), n + ": OM002 - a non-scheduler may only speak for silvis_person_id()");
    ok(/today_c\s+date := \(now\(\) at time zone 'America\/Chicago'\)::date;/.test(mode), n + ": 'today' must be the Central date");
    ok(/select \* into p from public\.call_periods where id = p_period for update;/.test(mode), n + ": the period row must be locked (`for update`)");
    ok(/if not sched and \(p\.status <> 'upcoming' or p\.offers_close_at <= today_c\) then/.test(mode), n + ": OM005 - the freeze exempts the scheduler, like OF003");
    ok(/o\.day between p\.start_day and p\.end_day;/.test(mode) && /if n_offers > 0 then/.test(mode), n + ": OM006 must count the person's offers INSIDE the period before rules_only");
    ok(/offer_modes\s+= offer_modes - who,/.test(mode), n + ": rules_only must drop the person's offer_modes key");
    ok(/from \(select jsonb_array_elements_text\(rules_only_ids\) as x union all select who\) s\)/.test(mode) && /jsonb_agg\(distinct x\)/.test(mode), n + ": rules_only must add the person to rules_only_ids exactly once (distinct)");
    ok(/offer_modes\s+= offer_modes \|\| jsonb_build_object\(who, p_mode\),/.test(mode), n + ": exhaustive / preferred must write offer_modes[person] = mode and nothing else in the map");
    ok(/from jsonb_array_elements_text\(rules_only_ids\) as x where x <> who\),/.test(mode), n + ": exhaustive / preferred must take the person OFF rules_only_ids");
    eq((mode.match(/updated_at\s+= now\(\)/g) || []).length, 2, n + ": both branches must stamp updated_at;");
    ok(!/\b(label|start_day|end_day|offers_close_at|publish_by|status)\s+= /.test(mode), n + ": set_offer_mode must never write a period column other than rules_only_ids / offer_modes / updated_at");
    ok(!/(insert into|update|delete from) public\.call_offers/.test(mode), n + ": set_offer_mode must not write call_offers (it only counts them)");
    ok(/return jsonb_build_object\('ok', true, 'period_id', p\.id, 'label', p\.label, 'person_id', who, 'mode', p_mode,\s+'rules_only_ids', p\.rules_only_ids, 'offer_modes', p\.offer_modes, 'by', coalesce\(me, 'scheduler'\)\);/.test(mode),
      n + ": return shape must be {ok, period_id, label, person_id, mode, rules_only_ids, offer_modes, by}");
    ok(!/audit_log|notifications/.test(mode), n + ": set_offer_mode writes no audit / feed row (the client's offers.save is the one audit row)");
  }
  ok(/revoke all on function public\.set_offer_mode\(uuid, text, text\) from public;\nrevoke all on function public\.set_offer_mode\(uuid, text, text\) from anon;\ngrant execute on function public\.set_offer_mode\(uuid, text, text\) to authenticated;/.test(s),
    n + ": set_offer_mode grants: revoke from public and anon, grant execute to authenticated");

  const save = functionText(s, "save_offers");
  ok(save, n + ": no `create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[])` ... `end $$;` block");
  if (save) {
    ok(/^create or replace function public\.save_offers\(p_person text, p_rows jsonb, p_clear date\[\], p_period uuid default null, p_mode text default null\) returns jsonb\nlanguage plpgsql security invoker set search_path = public as \$\$/.test(save),
      n + ": save_offers must be `returns jsonb`, `language plpgsql security invoker set search_path = public` with the optional p_period / p_mode (the combined days + mode Save; RLS + OF001-OF003 apply per row)");
    ok(!/security definer/.test(save), n + ": save_offers must NOT be security definer (nothing bypassed)");
    const firstWrite = save.indexOf("delete from public.call_offers");
    const insertAt = save.indexOf("insert into public.call_offers");
    ok(firstWrite > 0 && insertAt > firstWrite, n + ": save_offers must delete (p_clear) then upsert (p_rows) inside the one transaction");
    let last = -1;
    SAVE_CODES.forEach(([code, token]) => {
      const m = save.match(raiseRe(token, code));
      ok(m, n + ": save_offers lacks `raise exception '" + token + ": ...' using errcode = '" + code + "'`");
      const at = m ? save.indexOf(m[0]) : -1;
      ok(at > last, n + ": " + token + " (" + code + ") is out of order (expected " + SAVE_CODES.map((c) => c[0]).join(" -> ") + ")");
      ok(at < firstWrite, n + ": " + token + " must be checked BEFORE the first call_offers write (fail closed: a bad batch writes nothing)");
      last = at;
    });
    eq((save.match(/using errcode = 'OS0/g) || []).length, 5, n + ": five OS0xx raises expected (OS001 x2, OS002, OS003 x2: not an array / a bad row);");
    ok(save.indexOf("where r->>'day' !~ '^\\d{4}-\\d{2}-\\d{2}$' or r->>'role_pref' is null or r->>'role_pref' not in ('primary', 'backup', 'either');") > 0 && save.indexOf("where r->>'day' !~") < firstWrite,
      n + ": every row's day (YYYY-MM-DD) and role_pref (primary / backup / either) must be validated BEFORE any write");
    ok(/if me is not null and who = me then v_by := me; v_src := 'app'; else v_by := 'scheduler'; v_src := 'email-relay'; end if;/.test(save),
      n + ": entered_by / source must be derived from the caller (own id / 'app', else 'scheduler' / 'email-relay')");
    ok(/select who, \(r->>'day'\)::date, r->>'role_pref', nullif\(btrim\(r->>'note'\), ''\), v_by, v_src/.test(save), n + ": the insert must take entered_by / source from v_by / v_src, never from the row");
    ok(!/r->>'entered_by'|r->>'source'|r->>'person_id'/.test(save), n + ": save_offers must never read entered_by / source / person_id from the client rows");
    ok(/delete from public\.call_offers where person_id = who and day = any\(p_clear\);/.test(save), n + ": the clears must be scoped to the person and the named days");
    ok(/on conflict \(person_id, day\) do update\s+set role_pref = excluded\.role_pref, note = coalesce\(excluded\.note, call_offers\.note\), entered_by = excluded\.entered_by, source = excluded\.source, updated_at = now\(\);/.test(save),
      n + ": the upsert must key on (person_id, day), refresh role_pref / entered_by / source / updated_at and KEEP the row's note when the client sends none (coalesce(excluded.note, call_offers.note) - the importer's 'seed: <tag>' survives a repaint)");
    ok(!/schedule_days|time_off|call_periods|audit_log|notifications/.test(save), n + ": save_offers touches call_offers only (the mode goes through set_offer_mode; the audit row is the client's)");
    const modeAt = save.indexOf("perform public.set_offer_mode(p_period, p_mode, who);");
    ok(modeAt > insertAt && /if p_mode is not null then\s+perform public\.set_offer_mode\(p_period, p_mode, who\);\s+end if;/.test(save),
      n + ": when p_mode is given the mode must be set THROUGH set_offer_mode inside the same transaction, after the rows (a refused mode rolls the rows back - days + mode are one commit or nothing)");
    ok(/return jsonb_build_object\('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by, 'source', v_src, 'mode', p_mode\);/.test(save),
      n + ": return shape must be {ok, person_id, upserted, deleted, entered_by, source, mode}");
  }
  ok(/revoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) from public;\nrevoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) from anon;\ngrant execute on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) to authenticated;/.test(s),
    n + ": save_offers grants (five-argument signature): revoke from public and anon, grant execute to authenticated");
  ok(!/save_offers\(text, jsonb, date\[\]\)\s+(from|to)\b/.test(s), n + ": no grant / revoke may still name the three-argument save_offers (it does not exist)");
}
step("P14 P3a: schema.sql carries set_offer_mode() + save_offers() (placement after the call_offers guards, header revision line)");
checkOfferRpcs("schema.sql", schema);
(function placement() {
  const guardTrg = schema.indexOf("for each row execute function public.call_offers_delete_guard();");
  const modeAt = schema.indexOf("create or replace function public.set_offer_mode(");
  const saveAt = schema.indexOf("create or replace function public.save_offers(");
  const notifAt = schema.indexOf("create table if not exists public.notifications (");
  ok(modeAt > guardTrg && saveAt > modeAt, "set_offer_mode then save_offers must follow the call_offers delete-guard trigger (the offers section)");
  ok(saveAt < notifAt, "the two RPCs must be defined BEFORE the notifications table");
  ok(/-- Revision 2026-09-23 i \(Prompt 14 part 3a, sql\/migrations\/2026-09-23-offer-mode-rpc\.sql, NOT yet applied\)/.test(schema), "schema.sql header must record revision 2026-09-23 i (the two RPCs, not yet applied)");
})();

step("P14 P3a: migration 2026-09-23-offer-mode-rpc.sql defines the two functions and nothing else, byte-identical to schema.sql");
const rpcMig = read(RPC_MIGRATION);
ok(!/\r/.test(rpcMig), "offer-mode-rpc migration has CRLF line endings");
checkOfferRpcs("rpc migration", rpcMig);
eq((rpcMig.match(/create or replace function/g) || []).length, 2, "the rpc migration must define set_offer_mode and save_offers and nothing else;");
ok(!/drop table|create table|alter table|create policy|drop policy|create trigger/.test(rpcMig), "the rpc migration must be additive (no table / policy / trigger changes)");
// the ONE drop allowed: save_offers' earlier three-argument draft (never applied live) - so no second overload can
// ever leave PostgREST unable to resolve rpc/save_offers
eq((rpcMig.match(/drop function/g) || []).length, 1, "the rpc migration may drop exactly one function (the never-applied three-argument save_offers);");
ok(/^drop function if exists public\.save_offers\(text, jsonb, date\[\]\);\ncreate or replace function public\.save_offers\(/m.test(rpcMig), "the drop must be `drop function if exists public.save_offers(text, jsonb, date[]);` right before the create");
ok(!/drop function/.test(schema.slice(schema.indexOf("create or replace function public.set_offer_mode("), schema.indexOf("create table if not exists public.notifications ("))), "schema.sql's offers-RPC section carries no drop (a from-scratch schema has nothing to drop)");
["set_offer_mode", "save_offers"].forEach((name) => {
  const a = functionText(schema, name), b = functionText(rpcMig, name);
  ok(a && b && a === b, name + "(): migration text differs from schema.sql (keep them identical; the migration is what runs live)");
});
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-23-offer-mode-rpc\.sql/.test(rpcMig), "the rpc migration header must carry the CLI apply line for the orchestrator");

step("P14 P3a: offer-rpcs probe is self-rolling-back, acts as a surgeon (s3) / the scheduler (s1) / anon, covers A..K-anon + L / M");
const rpcProbe = read(RPC_PROBE);
ok(!/\r/.test(rpcProbe), "offer-rpcs probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(rpcProbe), "offer-rpcs probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(rpcProbe), "offer-rpcs probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated;/.test(rpcProbe) && /grant insert, select on probe_results to anon;/.test(rpcProbe), "offer-rpcs probe must grant the temp table to authenticated AND anon (K-anon)");
const rLastDo = rpcProbe.lastIndexOf("do $$");
ok(rLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(rpcProbe.slice(rLastDo)), "offer-rpcs probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
["'A'", "'B'", "'C'", "'D'", "'E'", "'F'", "'G'", "'H'", "'L'", "'M'", "'I'", "'J-mode'", "'J-save'", "'K-mode'", "'K-anon'"].forEach((k) => ok(rpcProbe.indexOf("values (" + k) >= 0, "offer-rpcs probe lacks case " + k));
// the review's two additions: the note survives a note-less repaint (A seeds 'seed: probe' on 6/3, E repaints 6/3 without a
// note and s3_rows() prints note=), and the combined days + mode call (L: a bad mode rolls the row back; M: ok in one call)
ok(/"day":"2030-06-03","role_pref":"either","note":"seed: probe"/.test(rpcProbe), "case A must seed the 6/3 row with note 'seed: probe' (E proves the note survives the repaint)");
ok(/\|\| ' note=' \|\| coalesce\(min\(note\) filter \(where day = '2030-06-03'\), ''\)/.test(rpcProbe), "s3_rows() must print the 6/3 row's note (note=...) so E / L / M are graded on it");
ok(/public\.save_offers\('s3', '\[\{"day":"2030-06-20","role_pref":"either"\}\]'::jsonb, null, o, 'x'\)/.test(rpcProbe), "case L must save a row + mode 'x' in ONE call (expect OM003 and the row rolled back)");
ok(/public\.save_offers\('s3', '\[\{"day":"2030-06-20","role_pref":"either"\}\]'::jsonb, null, o, 'exhaustive'\)/.test(rpcProbe), "case M must save a row + mode exhaustive in ONE call");
ok(/note=seed: probe/.test(rpcProbe) && /rows=0 note=/.test(rpcProbe), "the probe header must state the note / rollback expectations (E note=seed: probe; L rows=0)");
ok(/'probe rpc open',\s+'2030-06-01', '2030-06-30', '2030-04-20'/.test(rpcProbe) && /'probe rpc frozen', '2030-05-01', '2030-05-31', '2026-09-01'/.test(rpcProbe), "offer-rpcs probe fixtures: 'probe rpc open' (2030-06, close 2030-04-20) and 'probe rpc frozen' (2030-05, close 2026-09-01)");
ok(!/'probe frozen'|'probe modes'/.test(rpcProbe), "offer-rpcs probe must not reuse the offers probe's period labels");
ok(rpcProbe.indexOf("'2030-03-") < 0, "offer-rpcs probe must not touch the trade probe's 2030-03 fixtures");
ok(/'probe-offers-' \|\| [a-z]+ \|\| '@example\.test'/.test(rpcProbe), "offer-rpcs probe users must be probe-offers-<uuid>@example.test (section 8's leftover count keys on it)");
ok(/'probe offers'/.test(rpcProbe), "offer-rpcs probe's time_off row must carry note 'probe offers' (section 8's leftover count keys on it)");
ok(/set person_id = 's3', role = 'surgeon'/.test(rpcProbe) && /set person_id = 's1', role = 'scheduler'/.test(rpcProbe), "offer-rpcs probe must link its throwaway surgeon to s3 and its scheduler to s1");
ok(/set local role anon/.test(rpcProbe), "offer-rpcs probe K-anon must act as anon");
ok(/'ERR ' \|\| sqlstate \|\| ' '/.test(rpcProbe), "offer-rpcs probe must record the SQLSTATE with each error (the OM / OS / OF codes are graded)");
ok(/public\.set_offer_mode\(f, 'preferred', 's3'\)/.test(rpcProbe), "case J must set s3's mode on the FROZEN period as the scheduler (the relay path)");
ok(!/simple-protocol/.test(rpcProbe), "offer-rpcs probe header must not claim a simple-protocol connection");

step("P14 P3a: docs/SCHEMA-REVIEW.md carries the rpc section with an 'observed:' placeholder for the orchestrator");
ok(/### set_offer_mode\(\) \+ save_offers\(\) \(2026-09-23; `sql\/migrations\/2026-09-23-offer-mode-rpc\.sql`\)/.test(review), "SCHEMA-REVIEW.md lacks the set_offer_mode() + save_offers() section");
ok(/offer-mode-rpc[\s\S]*observed: /.test(review.slice(review.indexOf("### set_offer_mode()"))), "SCHEMA-REVIEW.md's rpc section must carry an 'observed:' line (placeholder until the orchestrator fills it)");

// ---- Prompt 16 A1 (2026-09-24) - pre-launch RLS: close the door before anyone is invited ----
// sql/migrations/2026-09-24-prelaunch-rls.sql (report-first; the orchestrator applies after Faraz's go) re-creates six
// policies (user_profiles_read own row + scheduler/admin rows; user_profiles_self_update pins email; contacts_read
// scheduler/admin; notif_insert + audit_insert linked persons or schedulers, the audit row's actor_id = the caller;
// notif_delete_sched), re-creates the two call_offers guards (freeze by STATUS as well as by date; OF004 OFFER_IMMUTABLE:
// a non-scheduler UPDATE may not move an offer's day or person) and revokes offer_status() from public / anon.
// schema.sql mirrors every text byte for byte; sql/probes/prelaunch-rls-probe.sql rolls itself back (fixtures in 2030-07,
// leftovers keyed on 'probe-prelaunch'); scripts/verify-rls.sh section 10 grades it; the client reads of a) / b) are
// pinned here so the policy change can never turn one of them into a silent 200 + [].
const PRELAUNCH_PROBE = path.join(ROOT, "sql", "probes", "prelaunch-rls-probe.sql");
const PRELAUNCH_POLICIES = {
  user_profiles_read: "create policy user_profiles_read on public.user_profiles for select to authenticated\n  using (id = auth.uid() or public.silvis_is_sched() or role in ('admin','scheduler'));",
  user_profiles_self_update: "create policy user_profiles_self_update on public.user_profiles for update to authenticated\n  using (id = auth.uid())\n  with check (id = auth.uid()\n    and role = (select role from public.user_profiles p where p.id = auth.uid())\n    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())\n    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid()));",
  contacts_read: "create policy contacts_read on public.office_contacts for select to authenticated using (public.silvis_is_sched());",
  notif_insert: "create policy notif_insert on public.notifications for insert to authenticated\n  with check (public.silvis_is_sched() or public.silvis_person_id() is not null);",
  notif_delete_sched: "create policy notif_delete_sched on public.notifications for delete to authenticated using (public.silvis_is_sched());",
  audit_insert: "create policy audit_insert on public.audit_log for insert to authenticated\n  with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()));",
};
const PRELAUNCH_TABLE_OF = { user_profiles_read: "user_profiles", user_profiles_self_update: "user_profiles", contacts_read: "office_contacts", notif_insert: "notifications", notif_delete_sched: "notifications", audit_insert: "audit_log" };
const FREEZE_WHERE = "(p.offers_close_at <= today_c or p.status <> 'upcoming')";
const OF004_LINE = "if tg_op = 'UPDATE' and not public.silvis_is_sched() and (new.day <> old.day or new.person_id <> old.person_id) then";
const OF004_RAISE = "raise exception 'OFFER_IMMUTABLE: an offer keeps its day and person (% %) - clear it and offer the other day instead', old.person_id, old.day using errcode = 'OF004';";
const OFFER_STATUS_GRANTS = "revoke execute on function public.offer_status(uuid, text) from public;\nrevoke execute on function public.offer_status(uuid, text) from anon;\ngrant execute on function public.offer_status(uuid, text) to authenticated;\ngrant execute on function public.offer_status(uuid, text) to service_role;";
const PRELAUNCH_CASES = ["S1", "S2", "S3", "S4", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11", "L12", "L13", "L14", "L15", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "N1"];
function checkPrelaunchPolicies(n, s) {
  Object.keys(PRELAUNCH_POLICIES).forEach((p) => {
    ok(s.indexOf("drop policy if exists " + p + " on public." + PRELAUNCH_TABLE_OF[p] + ";") >= 0, n + ": `drop policy if exists " + p + " on public." + PRELAUNCH_TABLE_OF[p] + ";` missing (idempotency)");
    ok(s.indexOf(PRELAUNCH_POLICIES[p]) >= 0, n + ": policy " + p + " must read exactly:\n" + PRELAUNCH_POLICIES[p]);
    eq((s.match(new RegExp("create policy " + p + " on public\\.", "g")) || []).length, 1, n + ": policy " + p + " must be created exactly once;");
  });
  ok(!/create policy [a-z_]+ on public\.(user_profiles|office_contacts|notifications|audit_log) for [a-z]+ using \(true\)/.test(s), n + ": no role-less (anon) policy on user_profiles / office_contacts / notifications / audit_log");
  ok(!/create policy (user_profiles_read|contacts_read|notif_insert|audit_insert)[^;]*\((true)\)/.test(s), n + ": user_profiles_read / contacts_read / notif_insert / audit_insert must no longer be using/with check (true)");
}
function checkPrelaunchGuards(n, s) {
  const g = functionText(s, "call_offers_guard");
  ok(g, n + ": no `create or replace function public.call_offers_guard()` ... `end $$;` block");
  const d = functionText(s, "call_offers_delete_guard");
  ok(d, n + ": no `create or replace function public.call_offers_delete_guard()` ... `end $$;` block");
  if (!g || !d) return;
  eq((g.match(/OF004/g) || []).length, 1, n + ": call_offers_guard must raise OF004 exactly once;");
  ok(g.indexOf(OF004_LINE) > 0, n + ": call_offers_guard lacks the OF004 condition `" + OF004_LINE + "` (UPDATE only, non-scheduler only, day OR person moved)");
  ok(g.indexOf(OF004_RAISE) > 0, n + ": call_offers_guard must raise exactly `" + OF004_RAISE + "`");
  ok(g.indexOf("OF002") < g.indexOf(OF004_LINE) && g.indexOf(OF004_LINE) < g.indexOf("silvis.claim_in_progress"), n + ": OF004 must sit after OF002 and before the freeze check");
  ok(g.indexOf(FREEZE_WHERE) > 0, n + ": call_offers_guard's freeze must test `" + FREEZE_WHERE + "` (by status as well as by close date)");
  ok(d.indexOf(FREEZE_WHERE) > 0, n + ": call_offers_delete_guard's freeze must test `" + FREEZE_WHERE + "`");
  ok(!/p\.offers_close_at <= today_c\s*\n/.test(g + d), n + ": no guard may still freeze by close date alone");
  ok(!/OF004/.test(d), n + ": the delete guard has no OF004 (a delete moves nothing)");
  ok(/if not public\.silvis_is_sched\(\) then/.test(d), n + ": the delete guard keeps the scheduler exemption as its first test");
  ok(/if not public\.silvis_is_sched\(\) and coalesce\(current_setting\('silvis\.claim_in_progress', true\), ''\) <> 'on' then/.test(g), n + ": call_offers_guard keeps the scheduler exemption + the claim-in-progress skip on the freeze");
  ok(/new\.updated_at := now\(\);\s+return new;/.test(g), n + ": call_offers_guard still stamps updated_at and returns new");
  ok(/return old;/.test(d), n + ": the delete guard still returns old");
}
step("P16 A1: the pre-launch migration file - six policies, two guards, the offer_status grants, nothing else");
const prelaunchMig = read(PRELAUNCH_MIGRATION);
ok(!/\r/.test(prelaunchMig), "prelaunch migration has CRLF line endings");
checkPrelaunchPolicies("prelaunch migration", prelaunchMig);
checkPrelaunchGuards("prelaunch migration", prelaunchMig);
eq((prelaunchMig.match(/^create policy /gm) || []).length, 6, "the prelaunch migration must create exactly the six policies;");
eq((prelaunchMig.match(/^drop policy if exists /gm) || []).length, 6, "the prelaunch migration must drop-if-exists exactly the six policies;");
eq((prelaunchMig.match(/create or replace function/g) || []).length, 2, "the prelaunch migration must re-create call_offers_guard and call_offers_delete_guard and nothing else;");
ok(!/create table|drop table|alter table|drop function|drop policy if exists user_profiles_admin|create policy user_profiles_admin/.test(prelaunchMig), "the prelaunch migration must not create / drop / alter a table, drop a function or touch user_profiles_admin");
ok(!/set_offer_mode\(|save_offers\(|claim_open_slot\(|apply_trade\(/.test(prelaunchMig.replace(/--[^\n]*/g, "")), "the prelaunch migration must not redefine set_offer_mode / save_offers / claim_open_slot / apply_trade (set_offer_mode already freezes by status: OM005)");
ok(prelaunchMig.indexOf(OFFER_STATUS_GRANTS) >= 0, "the prelaunch migration must carry exactly:\n" + OFFER_STATUS_GRANTS);
ok(!/create or replace function public\.offer_status/.test(prelaunchMig), "the prelaunch migration must not redefine offer_status() (grants only)");
ok(/drop trigger if exists call_offers_guard_trg on public\.call_offers;/.test(prelaunchMig) && /drop trigger if exists call_offers_delete_guard_trg on public\.call_offers;/.test(prelaunchMig), "the prelaunch migration re-creates both triggers (drop if exists first)");
["call_offers_guard_trg", "call_offers_delete_guard_trg"].forEach((t) => ok(triggerText(prelaunchMig, t) === triggerText(schema, t), "trigger " + t + ": prelaunch migration text differs from schema.sql"));
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-prelaunch-rls\.sql/.test(prelaunchMig), "the prelaunch migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST|report-first/.test(prelaunchMig), "the prelaunch migration header must say it is report-first (RLS on the live database)");

step("P16 A1: schema.sql mirrors the six policies, both guards and the grants byte for byte; user_profiles_admin stays admin-only");
checkPrelaunchPolicies("schema.sql", schema);
checkPrelaunchGuards("schema.sql", schema);
Object.keys(PRELAUNCH_POLICIES).forEach((p) => ok(policyText(schema, p) === policyText(prelaunchMig, p), "policy " + p + ": schema.sql differs from the prelaunch migration"));
["call_offers_guard", "call_offers_delete_guard"].forEach((name) => ok(functionText(schema, name) === functionText(prelaunchMig, name), name + "(): schema.sql differs from the prelaunch migration"));
ok(schema.indexOf(OFFER_STATUS_GRANTS) >= 0, "schema.sql must carry the offer_status grants right after its definition");
ok(schema.indexOf(OFFER_STATUS_GRANTS) > schema.indexOf("create or replace function public.offer_status(") && schema.indexOf(OFFER_STATUS_GRANTS) < schema.indexOf("create or replace function public.call_offers_guard("), "the offer_status grants sit between offer_status() and call_offers_guard()");
ok(schema.indexOf("create policy user_profiles_admin on public.user_profiles for all to authenticated\n  using (public.silvis_role() = 'admin') with check (public.silvis_role() = 'admin');") > 0, "schema.sql: user_profiles_admin must stay admin-only (Setup -> Users is isAdmin-gated in the client; a scheduler-role account corrects nothing there)");
ok(schema.indexOf("create policy user_profiles_self_insert on public.user_profiles for insert to authenticated\n  with check (id = auth.uid() and role = 'viewer' and person_id is null);") > 0, "schema.sql: user_profiles_self_insert unchanged (viewer, unlinked)");
ok(/-- Revision 2026-09-24 j \(Prompt 16 A1, sql\/migrations\/2026-09-24-prelaunch-rls\.sql, report-first, NOT yet applied\)/.test(schema), "schema.sql header must record revision 2026-09-24 j (the pre-launch RLS migration, not yet applied)");
ok(!/create policy notif_delete/.test(offersMig) && !/notif_delete_sched/.test(claimMigration), "notif_delete_sched belongs to the prelaunch migration only");

step("P16 A1: the probe is self-rolling-back, acts as a stranger / a linked surgeon / an admin / anon, covers S1..N1 with BEFORE strings in its header");
const plProbe = read(PRELAUNCH_PROBE);
ok(!/\r/.test(plProbe), "prelaunch probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(plProbe), "prelaunch probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(plProbe), "prelaunch probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated;/.test(plProbe) && /grant insert, select on probe_results to anon;/.test(plProbe), "prelaunch probe must grant the temp table to authenticated AND anon (N1 runs as anon)");
const plLastDo = plProbe.lastIndexOf("do $$");
ok(plLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(plProbe.slice(plLastDo)), "prelaunch probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
PRELAUNCH_CASES.forEach((k) => ok(plProbe.indexOf("values ('" + k + "'") >= 0, "prelaunch probe lacks case " + k));
ok(plProbe.indexOf("'2030-07-") > 0, "prelaunch probe fixtures must live in 2030-07");
// every date literal outside 2030-07 must be one of the periods' close / publish-by dates (values, not rows): no fixture row
// may land in another probe's month (trade 2030-03, claim 2030-04, offers 2030-05/06, eastvac 2030-05, verify-rls 8d 2030-08/09)
eq([...new Set(plProbe.match(/'2030-\d\d-\d\d'/g) || [])].filter((d) => !/^'2030-07-/.test(d)).sort(), ["'2030-05-20'", "'2030-06-03'", "'2030-06-20'"],
  "prelaunch probe: date literals outside 2030-07 must be exactly the two offers_close_at values and the open period's publish_by;");
ok(plProbe.indexOf("'2030-07-21'") < 0, "prelaunch probe must not use 2030-07-21 (verify-rls.sh 8c's own-row fixture day)");
ok(/'probe-prelaunch-' \|\| [a-z]+ \|\| '@example\.test'/.test(plProbe), "prelaunch probe's throwaway auth users must be probe-prelaunch-<uuid>@example.test (the leftover count keys on it)");
ok(/'probe prelaunch open', '2030-07-01', '2030-07-15', '2030-05-20'/.test(plProbe) && /'probe prelaunch published', '2030-07-16', '2030-07-31', '2030-06-20'/.test(plProbe), "prelaunch probe periods: 'probe prelaunch open' (7/1-7/15, close 2030-05-20, upcoming) and 'probe prelaunch published' (7/16-7/31, close 2030-06-20 in the future, status published)");
ok(/set status = 'published' where label = 'probe prelaunch published'/.test(plProbe), "the published fixture period must be flipped to status published AFTER its fixture offer is inserted (the freeze-by-status hole is what L12 / L13 measure)");
ok(/values \('probe-prelaunch', 'probe-prelaunch@example\.test', 'probe', false\)/.test(plProbe), "the office_contacts fixture must be name 'probe-prelaunch', an @example.test address, active = false (never mailed even if left behind)");
ok(/title = 'probe-prelaunch'/.test(plProbe) && /'probe\.prelaunch'/.test(plProbe) && (plProbe.match(/'either', 'probe-prelaunch', /g) || []).length >= 6, "probe rows must carry title 'probe-prelaunch' (notifications), action 'probe.prelaunch' (audit_log) and note 'probe-prelaunch' on every call_offers insert (3 fixtures + L12 + L14 + A7) - the leftover keys");
ok(/set person_id = 's3', role = 'surgeon'/.test(plProbe) && /set person_id = 's1', role = 'admin'/.test(plProbe), "prelaunch probe must link its throwaway surgeon to s3 and its admin to s1 (admin, not scheduler: user_profiles_admin is the correction path)");
ok(/role = 'viewer' and person_id is null/.test(plProbe), "prelaunch probe must assert the stranger stays an unlinked viewer (handle_new_auth_user's default)");
ok(/set local role anon/.test(plProbe), "prelaunch probe N1 must act as anon");
ok(/'ERR ' \|\| sqlstate \|\| ' ' \|\| replace\(sqlerrm, ';', ','\)/.test(plProbe), "prelaunch probe must record the SQLSTATE with each error (42501 / OF003 / OF004 / OM005 are graded)");
ok(/get diagnostics n = row_count;/.test(plProbe), "prelaunch probe must observe UPDATE / DELETE row counts (RLS filters silently: L8 deleted=0)");
const plHeader = plProbe.slice(0, plProbe.indexOf("create temp table probe_results"));
ok(/BEFORE/.test(plHeader) && /inserted \(NO refusal\)/.test(plHeader) && /status=not_started/.test(plHeader), "prelaunch probe header must state the BEFORE strings (the holes: inserted (NO refusal), updated=1, deleted=1, status=not_started)");
["own=1 leak=0 sched_ok=t", "contacts=0", "ok deleted=3", "permission denied for function offer_status", "OFFER_IMMUTABLE", "closed on 2030-06-20"].forEach((s) => ok(plHeader.indexOf(s) > 0, "prelaunch probe header must state the AFTER string `" + s + "`"));
ok(!/simple-protocol/.test(plProbe), "prelaunch probe header must not claim a simple-protocol connection");

step("P16 A1: verify-rls.sh section 10 - anon rpc offer_status refused, the client gates, the probe graded case by case, leftovers counted");
ok(/^echo "== 10\. /m.test(vr), "verify-rls.sh has no section 10");
const s10 = vr.slice(vr.indexOf('echo "== 10. '));
ok(s10.length > 0 && s10.length < vr.length, "verify-rls.sh section 10 could not be sliced out");
ok(/-X POST "\$URL\/rest\/v1\/rpc\/offer_status"/.test(s10), "section 10 must POST rest/v1/rpc/offer_status as anon");
ok(/"HTTP 401"\|"HTTP 403"\) ok "anon rpc offer_status refused/.test(s10), "section 10a must accept 401/403 for the anon rpc call and name a 200 as the open grant");
ok(/prelaunch-rls-probe\.sql/.test(s10), "section 10 must run sql/probes/prelaunch-rls-probe.sql through the linked CLI");
PRELAUNCH_CASES.forEach((k) => ok(new RegExp("expect_(eq|err)10\\s+" + k + "\\s").test(s10), "section 10 does not grade probe case " + k));
["own=1 leak=0 sched_ok=t", "contacts=0", "contacts=1", "ok deleted=3", "deleted=0", "updated=1", "ok rows=1", "OF004", "OF003", "OM005", "42501", "permission denied for function offer_status", "own=1 sees_surgeon=1 sees_stranger=1"].forEach((c) => ok(s10.indexOf(c) > 0, "section 10 must expect " + c));
ok(/name = 'probe-prelaunch'/.test(s10) && /title = 'probe-prelaunch'/.test(s10) && /action = 'probe\.prelaunch'/.test(s10) && /note = 'probe-prelaunch'/.test(s10) && /label like 'probe prelaunch%'/.test(s10) && /email like 'probe-prelaunch-%@example\.test'/.test(s10),
  "section 10 must count leftovers over office_contacts / notifications / audit_log / call_offers / call_periods / auth.users and fail on non-zero");
ok(/LEFT ROWS BEHIND/.test(s10), "section 10 must report leftovers as a failure with the cleanup statements");
ok((s10.match(/index-source\.html:\d+/g) || []).length >= 6, "section 10 must list the client reads it checked for a) / b) as index-source.html:<line>");
ok(/office_contacts\?select/.test(s10) && /isScheduler/.test(s10) && /isAdmin/.test(s10), "section 10 must check the office_contacts / Users reads are behind their role gates");
const s10write = s10.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
ok(!/-X (PATCH|DELETE|PUT)/.test(s10write) && (s10write.match(/-X POST/g) || []).length === 1, "section 10 must write nothing over REST (one anon POST to the rpc, which cannot persist anything)");

step("P16 A1: the client reads of a) / b) are role-gated where the new policies would otherwise 200 + [] them");
const client = fs.readFileSync(path.join(ROOT, "index-source.html"), "utf8");
const contactsAt = client.indexOf("rest/v1/office_contacts?select=*");
ok(contactsAt > 0, "index-source.html must read office_contacts once (Setup -> Office contacts)");
ok(client.slice(contactsAt - 400, contactsAt).indexOf("if (!loaded || !isScheduler) return;") > 0, "the office_contacts load effect must return before the fetch unless isScheduler (contacts_read is scheduler/admin only after A1)");
eq((client.match(/rest\/v1\/office_contacts\?select/g) || []).length, 1, "exactly one office_contacts read in the client;");
const fullProfileReads = client.match(/rest\/v1\/user_profiles\?select=\*[^`]*`/g) || [];
eq(fullProfileReads.length, 2, "exactly two whole-table user_profiles reads (loadClientVersions, loadAllProfilesLoud);");
ok(/if \(view === "settings" && isScheduler\) \{ loadAudit\(\); loadSnapshots\(\); loadClientVersions\(\); \}/.test(client), "loadClientVersions (user_profiles?select=*) runs only for a scheduler on the Settings view");
ok(/if \(view === "setup" && isAdmin\) loadAllProfilesLoud\(\);/.test(client), "loadAllProfilesLoud (user_profiles?select=*) runs only for the admin on Setup");
ok(/rest\/v1\/user_profiles\?select=person_id,role&role=in\.\(scheduler,admin\)&person_id=not\.is\.null/.test(client), "schedulerIdsLoud reads scheduler/admin rows only - the rows user_profiles_read keeps readable for every signed-in user");
ok(/rest\/v1\/user_profiles\?id=eq\.\$\{encodeURIComponent\(userId\)\}&select=\*/.test(client), "fetchProfile reads the own row only");
ok(/actor_id: userProfile\?\.person_id \|\| authUser\?\.id \|\| null,/.test(client), "logAudit writes actor_id = the caller's person_id (audit_insert requires it for a non-scheduler)");

step("P16 A1: docs - SCHEMA-REVIEW.md PREPARED block with the before / after table + 'observed:' placeholder; guide 4.3 table, one row per change");
const plReview = review.slice(review.indexOf("## 2026-09-24 - pre-launch RLS (Prompt 16 A1)"));
ok(plReview.length > 0 && plReview.length < review.length, "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - pre-launch RLS (Prompt 16 A1)' section");
ok(/PREPARED/.test(plReview.slice(0, 200)), "the A1 section must be marked PREPARED (not applied)");
ok(/observed: <to be filled by the orchestrator>/.test(plReview), "the A1 section must carry 'observed: <to be filled by the orchestrator>'");
Object.keys(PRELAUNCH_POLICIES).forEach((p) => ok(new RegExp("^\\| `" + p + "`", "m").test(plReview), "the A1 before / after table lacks a row for " + p));
["call_offers_guard", "call_offers_delete_guard", "offer_status"].forEach((p) => ok(new RegExp("^\\| `" + p + "`", "m").test(plReview), "the A1 before / after table lacks a row for " + p));
ok(/probe before -> migration -> probe after -> verify-rls -> record|probe BEFORE/.test(plReview) && /sql\/migrations\/2026-09-24-prelaunch-rls\.sql/.test(plReview) && /sql\/probes\/prelaunch-rls-probe\.sql/.test(plReview), "the A1 section must give the orchestrator's commands in order (probe before, migration, probe after, verify-rls, record)");
const guide = fs.readFileSync(path.join(ROOT, "docs", "SILVIS-BUILD-GUIDE.md"), "utf8");
const g43 = guide.slice(guide.indexOf("### 4.3 RLS posture"), guide.indexOf("### 4.4 Data-loss safeguards"));
ok(g43.length > 0, "guide section 4.3 could not be sliced out");
Object.keys(PRELAUNCH_POLICIES).concat(["call_offers_guard", "offer_status"]).forEach((p) => ok(new RegExp("^\\| `" + p + "`", "m").test(g43), "guide 4.3's pre-launch table lacks a row for " + p));
ok(/Prompt 16 A1/.test(g43) && /prelaunch-rls/.test(g43), "guide 4.3 must name Prompt 16 A1 and the migration file");

step("P16 A1 review fixes: the email pin's GoTrue residual, the importer as a non-scheduler, the rollback recipe, the record step, no review phrasing, N1 anon claims");
const plMigHeader = prelaunchMig.slice(0, prelaunchMig.indexOf("drop policy if exists"));
ok(/handle_new_auth_user/.test(plMigHeader) && /PUT \/auth\/v1\/user/.test(plMigHeader), "the migration header d) must state the residual: the email pin closes the REST PATCH only - GoTrue's self-service email change (PUT /auth/v1/user) still re-syncs user_profiles.email through handle_new_auth_user (security definer)");
ok(/handle_new_auth_user/.test(plReview) && /PUT \/auth\/v1\/user/.test(plReview), "SCHEMA-REVIEW's A1 section must state the GoTrue / handle_new_auth_user residual of the email pin and offer the hardening as a decision");
ok(/handle_new_auth_user/.test(g43), "guide 4.3's user_profiles_self_update row must name the handle_new_auth_user residual");
ok(/import-seed\.js/.test(plReview) && /import-seed/.test(g43), "SCHEMA-REVIEW 'What could break' and guide 4.3 must name the CLI importer (postgres, no JWT = a non-scheduler to the guards): an offers import into a non-upcoming period is refused with OF003");
ok(/drop policy if exists notif_delete_sched on public\.notifications;/.test(plReview), "the rollback recipe must drop notif_delete_sched (a new policy with no predecessor in 9809015)");
ok(/to anon and to public|to public and to anon/.test(plReview), "the rollback recipe must restore the offer_status EXECUTE grant to public as well as to anon (the before-state)");
ok(/Revision 2026-09-24 j/.test(plReview) && /test\/schema\.test\.js/.test(plReview) && /Revision 2026-09-23 i/.test(plReview), "the record step must name the schema.sql header revision j (and the stale revision i) 'NOT yet applied' wording + its test pin as part of the apply record");
ok(!/directory of the six|home addresses|self-made account =/.test(prelaunchMig + plReview + g43), "no review phrasing in the repo: state the policy fact (every signed-in account could read every profile row, email included)");
ok(!/set_config\('request\.jwt\.claims', '', true\)/.test(plProbe) && /set_config\('request\.jwt\.claims', '\{"role":"anon"\}', true\)/.test(plProbe), "prelaunch probe N1 must set request.jwt.claims to '{\"role\":\"anon\"}' (auth.uid() can parse it), not ''");

console.log("schema.test.js: " + N + " assertions passed");
