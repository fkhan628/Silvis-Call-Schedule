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
//   - sql/migrations/2026-09-22-claim-open-slot.sql carries the byte-identical function,
//   - sql/probes/claim-open-slot-probe.sql is a rolled-back probe (fixtures in 2030-04 plus
//     a 2020-01-01 lower bound, cases A..L) and scripts/verify-rls.sh section 7 grades it,
//     checks the anon REST refusal and counts leftovers.
//   node test/schema.test.js

"use strict";

const assert = require("assert");
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
function checkApplyTrade(n, s) {
  const fn = functionText(s, "apply_trade");
  ok(fn, n + ": no `create or replace function public.apply_trade(p_trade_id uuid)` block");
  ok(/security definer set search_path = public/.test(fn), n + ": apply_trade must stay security definer with search_path = public");
  const firstWrite = fn.indexOf("update public.schedule_days");
  ok(firstWrite > 0, n + ": apply_trade has no `update public.schedule_days`");
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
checkApplyTrade("schema.sql", schema);

/* ------------------------------------------------- the migration file */
step("migration file defines the same objects");
const migration = read(MIGRATION);
ok(!/\r/.test(migration), "migration has CRLF line endings");
checkInsertGuard("migration", migration);
checkApplyTrade("migration", migration);

step("migration function bodies are byte-identical to schema.sql");
["trade_insert_guard", "apply_trade"].forEach((name) => {
  const a = functionText(schema, name), b = functionText(migration, name);
  ok(a && b && a === b, name + "(): migration text differs from schema.sql (keep them identical; the migration is what runs live)");
});

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
  ok(/values \(me, my_name, 'schedule\.claim', jsonb_build_object\('day', p_day, 'role', p_role, 'person', me, 'version', new_ver\)\);/.test(fn),
    n + ": audit row 'schedule.claim' {day, role, person, version} missing");
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

step("claim migration defines the same function, byte-identical");
const claimMigration = read(CLAIM_MIGRATION);
ok(!/\r/.test(claimMigration), "claim migration has CRLF line endings");
checkClaim("claim migration", claimMigration);
eq((claimMigration.match(/create or replace function/g) || []).length, 1, "the claim migration must define claim_open_slot and nothing else;");
ok(!/drop function/.test(claimMigration), "the claim migration must not drop anything");
(function identical() {
  const a = functionText(schema, "claim_open_slot"), b = functionText(claimMigration, "claim_open_slot");
  ok(a && b && a === b, "claim_open_slot(): migration text differs from schema.sql (keep them identical; the migration is what runs live)");
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

console.log("schema.test.js: " + N + " assertions passed");
