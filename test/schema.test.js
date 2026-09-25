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
// Prompt 16 B6 (2026-09-24, review 9/23 section 3 - sql/migrations/2026-09-24-definer-locks.sql):
//   - apply_trade() and claim_open_slot() take `lock table public.time_off in share mode` BEFORE the
//     schedule_days row locks and before the vacation checks: every INSERT / UPDATE / DELETE on time_off
//     holds ROW EXCLUSIVE, which conflicts with SHARE, so a vacation written concurrently (inserted OR
//     edited) waits for the swap and its trigger then sees it, or the function waits and its own check
//     sees the new row (lock order documented in both headers; the probes observe the relation lock in
//     pg_locks after a case whose subtransaction committed - trade E2, claim B2),
//   - trade_insert_guard() writes from_surgeon_name / to_surgeon_name from the roster for every
//     insert, after the id normalisation (probe case N),
//   - the superseded bodies (9/22 trade_insert_guard, 9/23 trade-past apply_trade, 9/23 claim-offer
//     claim_open_slot) are frozen by sha256; schema.sql mirrors the three from the 9/24 file.
// Prompt 16 follow-up 5b (2026-09-24, Faraz - sql/migrations/2026-09-24-trade-audit-names.sql, REPORT-FIRST, not applied):
//   - apply_trade()'s audit row carries actor_name (the caller's user_profiles.display_name, else the roster name for his
//     roster id, else the id) and detail.summary in the client's trade.accept wording with ROSTER names by id
//     ("Trade applied: <to> takes <Role> <Dy Mon D> (from <from>, one-way)" / "... (from <from>; <from> takes ... in return)"),
//   - claim_open_slot()'s audit detail gains the same summary key (its feed title "<Name> took <M/D> <role>"),
//   - nothing else in either body moves (the body with the audit change undone equals B6's byte for byte); the file declares
//     `-- supersedes:` B6; B6's two bodies are frozen by sha256; the probes gain trade E3 / F2 and claim B3.
// Prompt 19 give a day (2026-09-24, Faraz - sql/migrations/2026-09-24-give-kind.sql, REPORT-FIRST, not applied):
//   - shift_trade_requests.kind text not null default 'trade' ('trade' | 'give', shift_trade_requests_kind_check) and
//     shift_trade_requests_give_one_way (a give never carries a return leg, for any writer),
//   - trade_insert_guard(): a member may insert a 'give' with no return day / role; a 'give' with a return leg is refused for
//     every caller; the rest is B6's byte for byte. The member return-leg refusal (a member 'trade' without return_day AND
//     return_role) is NOT in this file: old installed builds send a whole-unit trade's tail rows without a return leg, so it is
//     the PREPARED follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql (report-first, NOT applied; after a
//     client_versions min_version bump and a day for old builds to drain) - schema.sql does NOT mirror that file until its apply
//     is recorded (the one file exempt from the newest-migration mirror pin, by name); its body is S1's (f9ad08f), pinned by sha256,
//   - trade_update_guard(): kind joins the TRADE_IMMUTABLE leg list; the rest is the 9/23 trade-past body byte for byte,
//   - apply_trade() untouched (the receiver already applies a one-way row as a party); the file declares `-- supersedes:` B6;
//     B6's trade_insert_guard and the 9/23 trade_update_guard are frozen by sha256; the probe gains GIVE_SETUP and O..U.
//   node test/schema.test.js

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(ROOT, "sql", "schema.sql");
const MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-22-trade-guards.sql");
const LOCKS_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-definer-locks.sql");   // Prompt 16 B6 (5b superseded its apply_trade / claim_open_slot, Prompt 19 its trade_insert_guard)
const GIVE_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-give-kind.sql");   // Prompt 19: the newest MIRRORED for trade_insert_guard + trade_update_guard (report-first, not applied)
const RETURN_LEG_FILE = "2026-09-25-member-trade-return-leg.sql";   // Prompt 19 follow-up: PREPARED, NOT applied, NOT mirrored in schema.sql
const RETURN_LEG_MIGRATION = path.join(ROOT, "sql", "migrations", RETURN_LEG_FILE);
// sha256 of S1's trade_insert_guard body (git show f9ad08f:sql/migrations/2026-09-24-give-kind.sql) - the follow-up re-creates it
const S1_INSERT_GUARD_SHA256 = "0866c8228ef8e8b209c7c0d5925f27f901e909ef409675046ae73fac7da3dbbd";
const AUDIT_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-trade-audit-names.sql");   // Prompt 16 follow-up 5b: the newest for apply_trade + claim_open_slot (report-first, not applied)
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
// `names` = true for schema.sql and the 2026-09-24 definer-locks migration (roster names); false for the
// 2026-09-22 migration, frozen as applied. `give` (Prompt 19) = true for schema.sql, the give-kind migration and its follow-up;
// `needsReturn` = true ONLY for the prepared follow-up 2026-09-25-member-trade-return-leg.sql (the member return-leg refusal,
// deferred out of the give-kind file for the old installed builds' unit tails) - schema.sql and give-kind must NOT carry it.
const GIVE_NEEDS_RETURN_IF = "if new.kind is distinct from 'give' and (new.return_day is null or new.return_role is null) then";
const GIVE_NEEDS_RETURN_RAISE = "raise exception 'TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead' using errcode = 'P0001';";
const GIVE_ONE_WAY_IF = "if new.kind = 'give' and (new.return_day is not null or new.return_role is not null) then";
const GIVE_ONE_WAY_RAISE = "raise exception 'TRADE_INELIGIBLE: a give is one-way - it carries no return shift' using errcode = 'P0001';";
const KIND_IMMUTABLE = "     or new.return_day is distinct from old.return_day or new.return_role is distinct from old.return_role\n     or new.kind is distinct from old.kind then\n    raise exception 'TRADE_IMMUTABLE: only the scheduler may change the legs of a trade' using errcode = 'P0001';";
function checkInsertGuard(n, s, names, give, needsReturn) {
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
  // Prompt 16 B6 (review 9/23 section 3): the display names come from the roster, never from the client - for EVERY
  // insert (no scheduler / server branch), looked up AFTER from_surgeon_id is final; an unknown id or a missing /
  // malformed roster degrades to the id (a name is display data, never a reason to refuse the insert).
  const ROSTER_READ = "select d.data -> 'roster' into roster from public.call_schedule_data d where d.id = 'main';";
  if (names) {
    const rosterAt = fn.indexOf(ROSTER_READ);
    const norm = fn.indexOf("new.from_surgeon_id := me;");
    const same = fn.indexOf("TRADE_INELIGIBLE: a trade needs two different surgeons");
    const fr = fn.indexOf("new.from_surgeon_name := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.from_surgeon_id limit 1), ''), new.from_surgeon_id);");
    const to = fn.indexOf("new.to_surgeon_name   := coalesce(nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = new.to_surgeon_id limit 1), ''), new.to_surgeon_id);");
    ok(/\n  roster jsonb;\n/.test(fn), n + ": trade_insert_guard must declare `roster jsonb`");
    ok(rosterAt > 0, n + ": trade_insert_guard must read the roster with `" + ROSTER_READ + "`");
    ok(rosterAt > norm && rosterAt > same, n + ": the roster lookup must come AFTER the from_surgeon_id normalisation and the from = to check (the name follows the FINAL id)");
    ok(fn.indexOf("if roster is null or jsonb_typeof(roster) <> 'array' then roster := '[]'::jsonb; end if;") > rosterAt, n + ": a missing or malformed roster must degrade to '[]' (the names fall back to the ids), never fail the insert");
    ok(fr > rosterAt && to > fr && to < fn.lastIndexOf("return new;"), n + ": from_surgeon_name then to_surgeon_name must be set from the roster (coalesce(nullif(name, ''), id)) before `return new`");
    eq((fn.match(/surgeon_name\s*:=/g) || []).length, 2, n + ": exactly two name assignments (from, to), outside every branch;");
    ok(!/if .*surgeon_name|surgeon_name.*then/.test(fn), n + ": the name assignments must not be conditional on the caller");
  } else {
    ok(!/surgeon_name/.test(fn), n + ": is frozen as applied on 2026-09-22 - the roster names belong to sql/migrations/2026-09-24-definer-locks.sql");
  }
  // Prompt 19 (give a day): `give` = true for schema.sql and sql/migrations/2026-09-24-give-kind.sql; false for the frozen files.
  if (give) {
    const norm = fn.indexOf("new.decided_at      := null;");
    const branchEnd = fn.indexOf("\n  end if;\n", norm);
    const needs = fn.indexOf(GIVE_NEEDS_RETURN_IF), needsRaise = fn.indexOf(GIVE_NEEDS_RETURN_RAISE);
    const oneWay = fn.indexOf(GIVE_ONE_WAY_IF), oneWayRaise = fn.indexOf(GIVE_ONE_WAY_RAISE);
    const same = fn.indexOf("TRADE_INELIGIBLE: a trade needs two different surgeons");
    if (needsReturn) {
      ok(needs > norm && needsRaise > needs && needsRaise < branchEnd, n + ": a member 'trade' without a return leg must be refused INSIDE the member branch, after the normalisation: `" + GIVE_NEEDS_RETURN_IF + "` -> `" + GIVE_NEEDS_RETURN_RAISE + "`");
    } else {
      // Prompt 19 split (2026-09-24): the member return-leg refusal would refuse the unit-tail rows OLD installed builds send
      // (rows 2..n of a whole-unit trade with one return day carry no return leg) - deferred to the prepared follow-up.
      ok(needs < 0 && needsRaise < 0 && !/a trade needs a return shift/.test(fn) && !/kind is distinct from 'give'/.test(fn), n + ": must NOT carry the member return-leg refusal (`" + GIVE_NEEDS_RETURN_IF + "`) - it is deferred to sql/migrations/" + RETURN_LEG_FILE + " (old installed builds send unit-tail rows without a return leg)");
    }
    ok(oneWay > branchEnd && oneWayRaise > oneWay && oneWayRaise < same, n + ": a 'give' with a return leg must be refused for EVERY caller (outside the member branch, before the same-surgeon check): `" + GIVE_ONE_WAY_IF + "` -> `" + GIVE_ONE_WAY_RAISE + "`");
    eq((fn.match(/TRADE_INELIGIBLE/g) || []).length, needsReturn ? 3 : 2, n + ": trade_insert_guard raises TRADE_INELIGIBLE exactly " + (needsReturn ? "three times (trade without a return, give with one, same surgeon);" : "twice (give with a return, same surgeon - the member return-leg refusal is the follow-up's);"));
    ok(!/kind\s*:=/.test(fn), n + ": the insert guard never rewrites kind (a member chooses 'trade' or 'give'; the checks decide)");
  } else {
    ok(!/\bkind\b/.test(fn), n + ": is frozen as applied - the give / trade kind rules belong to sql/migrations/2026-09-24-give-kind.sql");
  }
  ok(/drop trigger if exists trade_insert_guard_trg on public\.shift_trade_requests;/.test(s), n + ": trigger drop-if-exists missing (idempotency)");
  ok(/create trigger trade_insert_guard_trg\s+before insert on public\.shift_trade_requests\s+for each row execute function public\.trade_insert_guard\(\);/.test(s),
    n + ": `create trigger trade_insert_guard_trg before insert on public.shift_trade_requests for each row execute function public.trade_insert_guard();` missing");
}
step("trade_insert_guard() + BEFORE INSERT trigger in schema.sql");
checkInsertGuard("schema.sql", schema, true, true, false);

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
// `past` = true for schema.sql and the 2026-09-23 / 2026-09-24 migrations; false for the 2026-09-22 migration, frozen as applied.
// `locks` (Prompt 16 B6) = true for schema.sql and the 2026-09-24 definer-locks migration; false for the two frozen files.
// The table lock (review of B6): a row-level FOR SHARE cannot cover a vacation row INSERTED concurrently (no predicate
// locks under read committed), so both functions take SHARE on the relation instead - every INSERT / UPDATE / DELETE on
// time_off holds ROW EXCLUSIVE, which conflicts with SHARE; a time_off writer's trigger reads schedule_days without
// locking, so it never waits on anything these functions hold (no cycle); SHARE is not self-conflicting (concurrent
// applies / claims do not serialise). The definer function runs as the table owner, so the privilege check passes.
const LOCK_TABLE = "lock table public.time_off in share mode;";
function checkApplyTrade(n, s, past, locks) {
  const fn = functionText(s, "apply_trade");
  ok(fn, n + ": no `create or replace function public.apply_trade(p_trade_id uuid)` block");
  ok(/security definer set search_path = public/.test(fn), n + ": apply_trade must stay security definer with search_path = public");
  const firstWrite = fn.indexOf("update public.schedule_days");
  ok(firstWrite > 0, n + ": apply_trade has no `update public.schedule_days`");
  if (locks) {
    const l1 = fn.indexOf(LOCK_TABLE), d1 = fn.indexOf("select * into d1 from public.schedule_days");
    ok(l1 > 0, n + ": apply_trade must take `" + LOCK_TABLE + "` (SHARE conflicts with every time_off writer's ROW EXCLUSIVE: a vacation inserted or edited concurrently waits for the swap, or the function waits and its check sees the new row)");
    ok(l1 > fn.indexOf("TRADE_PAST"), n + ": the table lock comes AFTER the past-day refusal (a refused apply locks nothing)");
    ok(d1 > 0 && l1 < d1, n + ": the table lock comes BEFORE the first schedule_days row lock (lock order: trade row -> time_off table (share) -> day rows (update); a time_off writer never waits on a day row, so no cycle)");
    ok(l1 < fn.indexOf("is on vacation on"), n + ": the table lock comes BEFORE the vacation check (b)");
    eq((fn.match(/lock table/g) || []).length, 1, n + ": exactly one `lock table` statement in apply_trade (unconditional: one relation lock covers both receivers);");
    ok(!/for share/.test(fn), n + ": no row-level `for share` in apply_trade (it could not cover a concurrently INSERTED row; the table lock replaced it)");
  } else {
    ok(!/lock table|for share/.test(fn), n + ": is frozen as applied - the time_off table lock belongs to sql/migrations/2026-09-24-definer-locks.sql");
  }
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
checkApplyTrade("schema.sql", schema, true, true);

/* ---------------------------------------- trade_update_guard() (RLS-6) */
// `give` (Prompt 19) = true for schema.sql and the give-kind migration (kind joins the TRADE_IMMUTABLE legs); false for the
// 9/23 trade-past file, frozen as applied.
function checkUpdateGuard(n, s, give) {
  const fn = functionText(s, "trade_update_guard");
  ok(fn, n + ": no `create or replace function public.trade_update_guard()` ... `end $$;` block");
  if (give) {
    ok(fn.includes(KIND_IMMUTABLE), n + ": kind must join the TRADE_IMMUTABLE leg list (a non-scheduler may not change it, on his own row either): `" + KIND_IMMUTABLE.replace(/\n\s*/g, " ") + "`");
    ok(fn.indexOf(KIND_IMMUTABLE) < fn.indexOf("current_setting('silvis.apply_trade', true)"), n + ": the leg check (with kind) stays before the apply_trade hand-off and the status transitions");
    eq((fn.match(/\bkind\b/g) || []).length, 2, n + ": trade_update_guard names kind only in the immutability test (new.kind / old.kind);");
  } else {
    ok(!/\bkind\b/.test(fn), n + ": is frozen as applied - kind belongs to sql/migrations/2026-09-24-give-kind.sql");
  }
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
checkUpdateGuard("schema.sql", schema, true);

/* ------------------------------------------------- the migration file */
step("2026-09-22 migration file defines the same objects (apply_trade as applied, without TRADE_PAST)");
const migration = read(MIGRATION);
ok(!/\r/.test(migration), "migration has CRLF line endings");
checkInsertGuard("migration", migration, false, false);
checkApplyTrade("migration", migration, false, false);

step("2026-09-22 migration: both bodies frozen as applied live (sha256); schema.sql's trade_insert_guard = the 2026-09-24 give-kind migration (Prompt 19, the newest touching it)");
(function frozen() {
  const sha = (t) => crypto.createHash("sha256").update(t || "").digest("hex");
  eq(sha(functionText(migration, "apply_trade")), "d9ec012b9265b8a7fe4f6db7242165e181709d58f824bdf72a793a7c9d908737",
    "2026-09-22-trade-guards.sql apply_trade() must stay byte-for-byte what was applied live on 2026-09-22 (a change belongs in a NEW migration);");
  eq(sha(functionText(migration, "trade_insert_guard")), "b2b5e23fe401765241523846131265825bdcca18bcfb41f1d328d54729357a5b",
    "2026-09-22-trade-guards.sql trade_insert_guard() must stay byte-for-byte what was applied live on 2026-09-22 (the roster names went into the 2026-09-24 migration);");
  const a = functionText(schema, "trade_insert_guard"), b = functionText(read(GIVE_MIGRATION), "trade_insert_guard");
  ok(a && b && a === b, "trade_insert_guard(): schema.sql differs from sql/migrations/2026-09-24-give-kind.sql (the newest migration touching it; keep them identical)");
})();

const PAST_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-trade-past-guard.sql");
step("2026-09-23 trade-past-guard migration: apply_trade (frozen as applied) + trade_update_guard (byte-identical to schema.sql), trigger re-created, grants re-run");
const pastMigration = read(PAST_MIGRATION);
ok(!/\r/.test(pastMigration), "trade-past migration has CRLF line endings");
checkApplyTrade("trade-past migration", pastMigration, true, false);
checkUpdateGuard("trade-past migration", pastMigration, false);
eq((pastMigration.match(/create or replace function/g) || []).length, 2, "the trade-past migration must define apply_trade and trade_update_guard and nothing else;");
ok(!/drop function|drop table|create table|drop policy|create policy/.test(pastMigration), "the trade-past migration must not drop or create anything besides the trigger re-create");
// Applied 2026-09-23 ~16:00 UTC (docs/SCHEMA-REVIEW.md). Its apply_trade is superseded by the 2026-09-24 definer-locks
// migration and its trade_update_guard by the 2026-09-24 give-kind migration (Prompt 19, report-first), so both bodies are
// frozen by sha256 here; schema.sql mirrors trade_update_guard from the give-kind file.
(function pastFrozen() {
  const sha = (t) => crypto.createHash("sha256").update(t || "").digest("hex");
  eq(sha(functionText(pastMigration, "apply_trade")), "ba433b008cbb6e8ff9cbd750a5f37fab65a7edfeb9f200375eb1de9754648ae6",
    "2026-09-23-trade-past-guard.sql apply_trade() must stay byte-for-byte what was applied live on 2026-09-23 (the share locks went into the 2026-09-24 migration);");
  eq(sha(functionText(pastMigration, "trade_update_guard")), "61964f85e58847427e8dc69517051aebe99d022900f9893f14784d0db2697045",
    "2026-09-23-trade-past-guard.sql trade_update_guard() must stay byte-for-byte what was applied live on 2026-09-23 (a change belongs in a NEW migration);");
  const a = functionText(schema, "trade_update_guard"), b = functionText(read(GIVE_MIGRATION), "trade_update_guard");
  ok(a && b && a === b, "trade_update_guard(): schema.sql differs from sql/migrations/2026-09-24-give-kind.sql (the newest migration touching it; keep them identical)");
})();
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
// `locks` (Prompt 16 B6) = true for schema.sql and the 2026-09-24 definer-locks migration; false for the frozen 9/22 file.
function checkClaim(n, s, locks) {
  const fn = functionText(s, "claim_open_slot");
  ok(fn, n + ": no `create or replace function public.claim_open_slot(p_day date, p_role text)` ... `end $$;` block");
  if (locks) {
    const at = fn.indexOf(LOCK_TABLE);
    ok(at > 0, n + ": claim_open_slot must take `" + LOCK_TABLE + "` (same reasoning as apply_trade: a concurrent vacation insert or edit waits, or the claim waits and CL009 sees the new row)");
    ok(at > fn.indexOf("CLAIM_OUTSIDE_RANGE"), n + ": the table lock comes AFTER the four row-less refusals (CL001-CL004 lock nothing)");
    ok(at < fn.indexOf("select * into d from public.schedule_days where day = p_day for update;"), n + ": the table lock comes BEFORE the day row is locked (lock order: time_off table (share) -> the day row (update); a time_off writer never waits on a day row, so no cycle)");
    eq((fn.match(/lock table/g) || []).length, 1, n + ": exactly one `lock table` statement in claim_open_slot;");
    ok(!/for share/.test(fn), n + ": no row-level `for share` in claim_open_slot (the table lock replaced it)");
  } else {
    ok(!/lock table|for share/.test(fn), n + ": is frozen as applied - the time_off table lock belongs to sql/migrations/2026-09-24-definer-locks.sql");
  }
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
  ok(/values \(me, my_name, 'schedule\.claim', jsonb_build_object\(('summary', summary, )?'day', p_day, 'role', p_role, 'person', me, 'version', new_ver(, 'offer', wrote_offer)?\)\);/.test(fn),
    n + ": audit row 'schedule.claim' {[summary, ]day, role, person, version[, offer]} missing");
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
checkClaim("schema.sql", schema, true);
(function placement() {
  const afterTrade = schema.indexOf("grant execute on function public.apply_trade(uuid) to authenticated;");
  const claimAt = schema.indexOf("create or replace function public.claim_open_slot(");
  const notifAt = schema.indexOf("create table if not exists public.notifications (");
  ok(claimAt > afterTrade, "claim_open_slot must be defined AFTER apply_trade's grant line");
  ok(claimAt < notifAt, "claim_open_slot must be defined BEFORE the notifications table (the section right after apply_trade)");
  ok(/-- Revision 2026-09-22 c \(Prompt 13 part 2, sql\/migrations\/2026-09-22-claim-open-slot\.sql\)/.test(schema), "schema.sql header must record revision c (claim_open_slot)");
  ok(/source\s+text,\s+-- import \| generated \| manual \| east-derived \| trade \| claim\b/.test(schema), "schedule_days.source column comment must list the sixth value 'claim' (the function writes it)");
})();

step("claim migration (9/22) and claim-offer migration (9/23) frozen as applied; schema.sql's claim_open_slot = the trade-audit-names migration (9/24 follow-up 5b, the newest)");
const claimMigration = read(CLAIM_MIGRATION);
ok(!/\r/.test(claimMigration), "claim migration has CRLF line endings");
checkClaim("claim migration", claimMigration, false);
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
  // Prompt 16 B6: the 9/23 claim-offer body (live since 9/23 07:05Z) is superseded by the 2026-09-24 definer-locks
  // migration - frozen by sha256 here. Follow-up 5b (2026-09-24, report-first): the definer-locks body is superseded in turn by
  // sql/migrations/2026-09-24-trade-audit-names.sql (the audit detail's summary) - frozen by sha256 in the 5b block below;
  // schema.sql mirrors the 5b body (which keeps every claim-as-offer line below).
  eq(sha(functionText(claimOffer, "claim_open_slot")), "e490227c247bfed5c3e5ae54e22025c3fafb4da9bc672cd1251faa7ef2aee9bf", "2026-09-23-claim-offer.sql: claim_open_slot() body sha256 changed - the applied 9/23 file is frozen; a new body goes in a new migration");
  const a = functionText(schema, "claim_open_slot"), b = functionText(read(AUDIT_MIGRATION), "claim_open_slot");
  ok(a && b && a === b, "claim_open_slot(): schema.sql differs from sql/migrations/2026-09-24-trade-audit-names.sql (the newest migration touching it; keep them identical)");
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
// Prompt 19 split (2026-09-24): ONE prepared file is exempt from the mirror, by name - the member return-leg follow-up
// (report-first, NOT applied: it must wait for a client_versions min_version bump and for old installed builds to drain, so
// schema.sql mirrors what the NEXT apply makes live, the give-kind body). The exemption holds only while the file says it is
// not applied and schema.sql's header records it as NOT MIRRORED; the commit that records its apply mirrors the body, adds
// Revision 2026-09-25 p and empties this list (the pin below then compares schema.sql with it like any other file).
const PREPARED_NOT_MIRRORED = [RETURN_LEG_FILE];
PREPARED_NOT_MIRRORED.forEach((f) => {
  ok(migFiles.includes(f), "sql/migrations/" + f + " is listed as PREPARED_NOT_MIRRORED but does not exist");
  ok(/^-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED\. NOT MIRRORED in sql\/schema\.sql until its apply is recorded\.$/m.test(migText[f] || ""), "sql/migrations/" + f + " is exempt from the schema.sql mirror only while its header reads `-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED. NOT MIRRORED in sql/schema.sql until its apply is recorded.`");
  ok(schema.slice(0, schema.indexOf("create extension if not exists pgcrypto;")).split("\n").some((l) => l.includes("sql/migrations/" + f) && /PREPARED FOLLOW-UP, NOT MIRRORED/.test(l)), "schema.sql's header must record sql/migrations/" + f + " on a `PREPARED FOLLOW-UP, NOT MIRRORED` line while it is exempt from the mirror");
});
const newest = {};
migFiles.filter((f) => !PREPARED_NOT_MIRRORED.includes(f)).forEach((f) => {
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
  // Prompt 16 A7 adds 'office-relay' (schema.sql's inline check + the constraint re-creation); the applied 2026-09-22 file keeps the original list
  ok((n === "schema.sql" ? /source\s+text not null default 'app' check \(source in \('app','email-relay','import','office-relay'\)\)/ : /source\s+text not null default 'app' check \(source in \('app','email-relay','import'\)\)/).test(s), n + ": call_offers.source check list");
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
  // Prompt 16 A7: schema.sql's three write policies carry the coordinator clause (exact texts pinned in the A7 block below);
  // the applied 2026-09-22 file keeps "own row or scheduler"
  const ownOrSched = n === "schema.sql" ? "person_id = public\\.silvis_person_id\\(\\) or public\\.silvis_is_sched\\(\\) or \\(public\\.silvis_is_coord\\(\\) and coalesce\\(current_setting\\('silvis\\.office_relay', true\\), ''\\) = 'on'\\)" : "person_id = public\\.silvis_person_id\\(\\) or public\\.silvis_is_sched\\(\\)";
  ok(new RegExp("create policy call_offers_insert on public\\.call_offers for insert to authenticated\\s+with check \\(" + ownOrSched + "\\);").test(s), n + ": call_offers_insert = own row or scheduler" + (n === "schema.sql" ? " (or a coordinator under the office-relay flag)" : ""));
  ok(new RegExp("create policy call_offers_update on public\\.call_offers for update to authenticated\\s+using \\(" + ownOrSched + "\\)\\s+with check \\(" + ownOrSched + "\\);").test(s), n + ": call_offers_update = own row or scheduler, using AND with check");
  ok(new RegExp("create policy call_offers_delete on public\\.call_offers for delete to authenticated\\s+using \\(" + ownOrSched + "\\);").test(s), n + ": call_offers_delete = own row or scheduler");
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
// the three call_offers write policies were re-created by Prompt 16 A7 (the coordinator clause): schema.sql mirrors that file (A7 block below)
OFFER_POLICIES.filter((p) => !/^call_offers_(insert|update|delete)$/.test(p)).forEach((p) => ok(policyText(schema, p) === policyText(offersMig, p), "policy " + p + ": migration text differs from schema.sql"));
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
// sql/migrations/2026-09-23-offer-mode-rpc.sql (applied live 2026-09-23 ~12:45 Central) defines
// set_offer_mode() (security definer: ONE person's key on ONE period - a surgeon cannot write call_periods) and
// save_offers() (security invoker: the painter's one Save as ONE transaction, RLS + OF001-OF003 per row). schema.sql
// mirrors both byte for byte; sql/probes/offer-rpcs-probe.sql rolls itself back (cases A..K-anon).
const RPC_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-23-offer-mode-rpc.sql");
const RPC_PROBE = path.join(ROOT, "sql", "probes", "offer-rpcs-probe.sql");
const MODE_CODES = [["OM001", "MODE_NOT_LINKED"], ["OM002", "MODE_NOT_YOURS"], ["OM003", "MODE_BAD_MODE"], ["OM004", "MODE_NO_PERIOD"], ["OM005", "MODE_FROZEN"], ["OM006", "MODE_HAS_OFFERS"]];
const SAVE_CODES = [["OS001", "OFFERS_NOT_LINKED"], ["OS002", "OFFERS_NOT_YOURS"], ["OS003", "OFFERS_BAD_ROW"]];
// Prompt 16 A7 review: a coordinator's relay is refused for an id that is not on the roster (OM007 / OS004, checked right after
// OM002 / OS002 and before any write); the scheduler's relay stays as it was (the check is gated on `coord`).
const MODE_CODES_COORD = [MODE_CODES[0], MODE_CODES[1], ["OM007", "MODE_UNKNOWN_PERSON"], ...MODE_CODES.slice(2)];
const SAVE_CODES_COORD = [SAVE_CODES[0], SAVE_CODES[1], ["OS004", "OFFERS_UNKNOWN_PERSON"], ...SAVE_CODES.slice(2)];
const COORD_ROSTER_CHECK = "not exists (select 1 from public.call_schedule_data d, jsonb_array_elements(case when jsonb_typeof(d.data -> 'roster') = 'array' then d.data -> 'roster' else '[]'::jsonb end) r where d.id = 'main' and r ->> 'id' = who)";
// one raise carries the token (message prefix; '' = an escaped quote inside it) and the errcode
const raiseRe = (token, code) => new RegExp("raise exception '" + token + ": (?:[^']|'')*'[^;]*using errcode = '" + code + "';");
function checkOfferRpcs(n, s, coord) {
  // coord = the Prompt 16 A7 texts (a coordinator may relay for another person; the 2026-09-23 rpc migration keeps the older texts)
  const mode = functionText(s, "set_offer_mode");
  ok(mode, n + ": no `create or replace function public.set_offer_mode(p_period uuid, p_mode text, p_person text default null)` ... `end $$;` block");
  if (mode) {
    ok(/^create or replace function public\.set_offer_mode\(p_period uuid, p_mode text, p_person text default null\) returns jsonb\nlanguage plpgsql security definer set search_path = public as \$\$/.test(mode),
      n + ": set_offer_mode must be `returns jsonb`, `language plpgsql security definer set search_path = public` (a surgeon cannot write call_periods)");
    const firstUpdate = mode.indexOf("update public.call_periods");
    ok(firstUpdate > 0, n + ": set_offer_mode has no `update public.call_periods`");
    let last = -1;
    const modeCodes = coord ? MODE_CODES_COORD : MODE_CODES;
    modeCodes.forEach(([code, token]) => {
      const m = mode.match(raiseRe(token, code));
      ok(m, n + ": set_offer_mode lacks `raise exception '" + token + ": ...' using errcode = '" + code + "'`");
      const at = m ? mode.indexOf(m[0]) : -1;
      ok(at > last, n + ": " + token + " (" + code + ") is out of order (expected " + modeCodes.map((c) => c[0]).join(" -> ") + ")");
      ok(at < firstUpdate, n + ": " + token + " must be checked BEFORE the first call_periods update");
      last = at;
    });
    eq((mode.match(/using errcode = 'OM0/g) || []).length, coord ? 8 : 7, n + ": " + (coord ? "eight" : "seven") + " OM0xx raises expected (OM001 twice: anon / unlinked, and no person named" + (coord ? "; OM007 the roster check for a coordinator" : "") + ");");
    ok(coord ? mode.indexOf("  if coord and " + COORD_ROSTER_CHECK + " then\n    raise exception 'MODE_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OM007';\n  end if;") > 0 : !/UNKNOWN_PERSON|OM007/.test(mode),
      n + (coord ? ": OM007 - a coordinator may relay only for an id on the roster in call_schedule_data 'main' (gated on coord: the scheduler's relay is unchanged)" : ": the applied 2026-09-23 text carries no OM007"));
    ok((coord ? /auth\.uid\(\) is null or \(me is null and not sched and not coord\)/ : /auth\.uid\(\) is null or \(me is null and not sched\)/).test(mode), n + ": OM001 must fire for anon (auth.uid() null) and for an unlinked non-scheduler" + (coord ? " who is not a coordinator" : ""));
    ok(/who := coalesce\(nullif\(btrim\(p_person\), ''\), me\);/.test(mode), n + ": the person defaults to the caller's own roster id (p_person is the scheduler's relay path)");
    ok((coord ? /if who <> coalesce\(me, ''\) and not sched and not coord then/ : /if who <> coalesce\(me, ''\) and not sched then/).test(mode), n + ": OM002 - a non-scheduler may only speak for silvis_person_id()" + (coord ? " (a coordinator for anyone)" : ""));
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
    ok((coord ? /return jsonb_build_object\('ok', true, 'period_id', p\.id, 'label', p\.label, 'person_id', who, 'mode', p_mode,\s+'rules_only_ids', p\.rules_only_ids, 'offer_modes', p\.offer_modes, 'by', coalesce\(me, case when sched then 'scheduler' else auth\.uid\(\)::text end\)\);/ : /return jsonb_build_object\('ok', true, 'period_id', p\.id, 'label', p\.label, 'person_id', who, 'mode', p_mode,\s+'rules_only_ids', p\.rules_only_ids, 'offer_modes', p\.offer_modes, 'by', coalesce\(me, 'scheduler'\)\);/).test(mode),
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
    const saveCodes = coord ? SAVE_CODES_COORD : SAVE_CODES;
    saveCodes.forEach(([code, token]) => {
      const m = save.match(raiseRe(token, code));
      ok(m, n + ": save_offers lacks `raise exception '" + token + ": ...' using errcode = '" + code + "'`");
      const at = m ? save.indexOf(m[0]) : -1;
      ok(at > last, n + ": " + token + " (" + code + ") is out of order (expected " + saveCodes.map((c) => c[0]).join(" -> ") + ")");
      ok(at < firstWrite, n + ": " + token + " must be checked BEFORE the first call_offers write (fail closed: a bad batch writes nothing)");
      last = at;
    });
    eq((save.match(/using errcode = 'OS0/g) || []).length, coord ? 6 : 5, n + ": " + (coord ? "six" : "five") + " OS0xx raises expected (OS001 x2, OS002, OS003 x2: not an array / a bad row" + (coord ? "; OS004 the roster check for a coordinator" : "") + ");");
    ok(coord ? save.indexOf("  if coord and " + COORD_ROSTER_CHECK + " then\n    raise exception 'OFFERS_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'OS004';\n  end if;") > 0 && save.indexOf("OS004") < firstWrite : !/UNKNOWN_PERSON|OS004/.test(save),
      n + (coord ? ": OS004 - a coordinator may save offers only for an id on the roster in call_schedule_data 'main', checked before any write (gated on coord: the scheduler's relay is unchanged)" : ": the applied 2026-09-23 text carries no OS004"));
    ok(save.indexOf("where r->>'day' !~ '^\\d{4}-\\d{2}-\\d{2}$' or r->>'role_pref' is null or r->>'role_pref' not in ('primary', 'backup', 'either');") > 0 && save.indexOf("where r->>'day' !~") < firstWrite,
      n + ": every row's day (YYYY-MM-DD) and role_pref (primary / backup / either) must be validated BEFORE any write");
    ok((coord ? /if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth\.uid\(\)::text; v_src := 'office-relay'; end if;/ : /if me is not null and who = me then v_by := me; v_src := 'app'; else v_by := 'scheduler'; v_src := 'email-relay'; end if;/).test(save),
      n + ": entered_by / source must be derived from the caller (own id / 'app', else 'scheduler' / 'email-relay'" + (coord ? ", else the coordinator's profile id / 'office-relay'" : "") + ")");
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
checkOfferRpcs("schema.sql", schema, true);   // Prompt 16 A7: schema.sql mirrors the coordinator migration's texts
(function placement() {
  const guardTrg = schema.indexOf("for each row execute function public.call_offers_delete_guard();");
  const modeAt = schema.indexOf("create or replace function public.set_offer_mode(");
  const saveAt = schema.indexOf("create or replace function public.save_offers(");
  const notifAt = schema.indexOf("create table if not exists public.notifications (");
  ok(modeAt > guardTrg && saveAt > modeAt, "set_offer_mode then save_offers must follow the call_offers delete-guard trigger (the offers section)");
  ok(saveAt < notifAt, "the two RPCs must be defined BEFORE the notifications table");
ok(/-- Revision 2026-09-23 i \(Prompt 14 part 3a, sql\/migrations\/2026-09-23-offer-mode-rpc\.sql, applied 2026-09-23[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-23 i (the two RPCs, applied 2026-09-23)");
})();

step("P14 P3a: migration 2026-09-23-offer-mode-rpc.sql defines the two functions and nothing else, byte-identical to schema.sql");
const rpcMig = read(RPC_MIGRATION);
ok(!/\r/.test(rpcMig), "offer-mode-rpc migration has CRLF line endings");
checkOfferRpcs("rpc migration", rpcMig, false);
eq((rpcMig.match(/create or replace function/g) || []).length, 2, "the rpc migration must define set_offer_mode and save_offers and nothing else;");
ok(!/drop table|create table|alter table|create policy|drop policy|create trigger/.test(rpcMig), "the rpc migration must be additive (no table / policy / trigger changes)");
// the ONE drop allowed: save_offers' earlier three-argument draft (never applied live) - so no second overload can
// ever leave PostgREST unable to resolve rpc/save_offers
eq((rpcMig.match(/drop function/g) || []).length, 1, "the rpc migration may drop exactly one function (the never-applied three-argument save_offers);");
ok(/^drop function if exists public\.save_offers\(text, jsonb, date\[\]\);\ncreate or replace function public\.save_offers\(/m.test(rpcMig), "the drop must be `drop function if exists public.save_offers(text, jsonb, date[]);` right before the create");
ok(!/drop function/.test(schema.slice(schema.indexOf("create or replace function public.set_offer_mode("), schema.indexOf("create table if not exists public.notifications ("))), "schema.sql's offers-RPC section carries no drop (a from-scratch schema has nothing to drop)");
// Prompt 16 A7 (2026-09-24-coordinator-role.sql) redefines both RPCs: schema.sql mirrors THAT file (the newest-migration pin
// above enforces it); the 2026-09-23 file stays frozen as applied live 9/23 and is self-consistent (checkOfferRpcs above).
["set_offer_mode", "save_offers"].forEach((name) => {
  const a = functionText(rpcMig, name);
  ok(a && a.indexOf("coord") < 0, name + "(): the 2026-09-23 rpc migration must stay the applied (pre-coordinator) text");
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
// Prompt 16 A7 re-creates notif_insert + audit_insert with the coordinator clause: schema.sql mirrors the A7 texts for those
// two (pinned in the A7 block below); the A1 migration file keeps its own texts.
const PRELAUNCH_SUPERSEDED_BY_A7 = ["notif_insert", "audit_insert"];
// Prompt 20 F1 (2026-09-24-followers.sql) re-creates user_profiles_self_update with the follows pin: schema.sql mirrors the F1
// text for it (pinned in the F1 block below); the A1 migration file keeps its own text.
const PRELAUNCH_SUPERSEDED = PRELAUNCH_SUPERSEDED_BY_A7.concat(["user_profiles_self_update"]);
function checkPrelaunchPolicies(n, s, superseded) {
  Object.keys(PRELAUNCH_POLICIES).forEach((p) => {
    ok(s.indexOf("drop policy if exists " + p + " on public." + PRELAUNCH_TABLE_OF[p] + ";") >= 0, n + ": `drop policy if exists " + p + " on public." + PRELAUNCH_TABLE_OF[p] + ";` missing (idempotency)");
    if (!(superseded || []).includes(p)) ok(s.indexOf(PRELAUNCH_POLICIES[p]) >= 0, n + ": policy " + p + " must read exactly:\n" + PRELAUNCH_POLICIES[p]);
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
checkPrelaunchPolicies("schema.sql", schema, PRELAUNCH_SUPERSEDED);
checkPrelaunchGuards("schema.sql", schema);
Object.keys(PRELAUNCH_POLICIES).filter((p) => !PRELAUNCH_SUPERSEDED.includes(p)).forEach((p) => ok(policyText(schema, p) === policyText(prelaunchMig, p), "policy " + p + ": schema.sql differs from the prelaunch migration"));
["call_offers_guard", "call_offers_delete_guard"].forEach((name) => ok(functionText(schema, name) === functionText(prelaunchMig, name), name + "(): schema.sql differs from the prelaunch migration"));
ok(schema.indexOf(OFFER_STATUS_GRANTS) >= 0, "schema.sql must carry the offer_status grants right after its definition");
ok(schema.indexOf(OFFER_STATUS_GRANTS) > schema.indexOf("create or replace function public.offer_status(") && schema.indexOf(OFFER_STATUS_GRANTS) < schema.indexOf("create or replace function public.call_offers_guard("), "the offer_status grants sit between offer_status() and call_offers_guard()");
ok(schema.indexOf("create policy user_profiles_admin on public.user_profiles for all to authenticated\n  using (public.silvis_role() = 'admin') with check (public.silvis_role() = 'admin');") > 0, "schema.sql: user_profiles_admin must stay admin-only (Setup -> Users is isAdmin-gated in the client; a scheduler-role account corrects nothing there)");
ok(schema.indexOf("create policy user_profiles_self_insert on public.user_profiles for insert to authenticated\n  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb);") > 0, "schema.sql: user_profiles_self_insert lands as viewer, unlinked and (Prompt 20 F1) following nobody");
ok(/-- Revision 2026-09-24 j \(Prompt 16 A1, sql\/migrations\/2026-09-24-prelaunch-rls\.sql, applied 2026-09-23[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 j (the pre-launch RLS migration, applied 2026-09-23)");
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

step("P16 A1: docs - SCHEMA-REVIEW.md APPLIED block with the before / after table + the 'observed:' line; guide 4.3 table, one row per change");
const plReview = review.slice(review.indexOf("## 2026-09-24 - pre-launch RLS (Prompt 16 A1)"));
ok(plReview.length > 0 && plReview.length < review.length, "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - pre-launch RLS (Prompt 16 A1)' section");
ok(/APPLIED/.test(plReview.slice(0, 200)) && !/PREPARED/.test(plReview.slice(0, 200)), "the A1 section must be marked APPLIED (live since 2026-09-23 ~18:35 Central; the observed line holds the probe strings)");
ok(/observed: applied 2026-09-23[^\r\n]{0,600}PROBE_RESULTS A1=own=1/.test(plReview), "the A1 section must carry the observed line (applied + the AFTER probe string)");
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
ok(/handle_new_auth_user/.test(plReview) && /PUT \/auth\/v1\/user/.test(plReview), "SCHEMA-REVIEW's A1 section must state the GoTrue / handle_new_auth_user residual of the email pin (the analysis stays as the record)");
ok(/The email pin's residual[^]*?CLOSED 2026-09-24[^]*?Secure email change[^]*?(NOT|not) planned/.test(plReview), "9-24: the residual paragraph must carry Faraz's decision - CLOSED 2026-09-24, handled in the dashboard (Secure email change ON), the handle_new_auth_user on-conflict migration NOT planned");
ok(/handle_new_auth_user/.test(g43), "guide 4.3's user_profiles_self_update row must name the handle_new_auth_user residual");
ok(/import-seed\.js/.test(plReview) && /import-seed/.test(g43), "SCHEMA-REVIEW 'What could break' and guide 4.3 must name the CLI importer (postgres, no JWT = a non-scheduler to the guards): an offers import into a non-upcoming period is refused with OF003");
ok(/drop policy if exists notif_delete_sched on public\.notifications;/.test(plReview), "the rollback recipe must drop notif_delete_sched (a new policy with no predecessor in 9809015)");
ok(/to anon and to public|to public and to anon/.test(plReview), "the rollback recipe must restore the offer_status EXECUTE grant to public as well as to anon (the before-state)");
ok(/Revision 2026-09-24 j/.test(plReview) && /test\/schema\.test\.js/.test(plReview) && /Revision 2026-09-23 i/.test(plReview), "the record step must name the schema.sql header revision j (and the stale revision i) 'NOT yet applied' wording + its test pin as part of the apply record");
ok(!/directory of the six|home addresses|self-made account =/.test(prelaunchMig + plReview + g43), "no review phrasing in the repo: state the policy fact (every signed-in account could read every profile row, email included)");
ok(!/set_config\('request\.jwt\.claims', '', true\)/.test(plProbe) && /set_config\('request\.jwt\.claims', '\{"role":"anon"\}', true\)/.test(plProbe), "prelaunch probe N1 must set request.jwt.claims to '{\"role\":\"anon\"}' (auth.uid() can parse it), not ''");

// ---- Prompt 16 A7 (2026-09-24) - the coordinator role (office users) ----
// sql/migrations/2026-09-24-coordinator-role.sql (report-first; the orchestrator applies it AFTER A1): user_profiles.role
// gains 'coordinator' (+ the unlinked check), silvis_is_coord() beside silvis_is_sched(), the time_off write policies and a
// new availability policy admit a coordinator for any person_id, the call_offers policies admit a coordinator only under
// the transaction-local silvis.office_relay flag that save_offers sets (direct REST writes stay refused), save_offers /
// set_offer_mode accept a coordinator relaying for another person (entered_by = its profile id, source 'office-relay'),
// notif_insert / audit_insert gain the coordinator clause (actor_id = auth.uid()::text), audit_read_coord lets it read
// its own vacation / offer / availability rows. schema.sql mirrors every text; sql/probes/coordinator-probe.sql rolls
// itself back (fixtures in 2030-08 keyed 'probe-coord'); scripts/verify-rls.sh section 11 grades it.
const COORD_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-coordinator-role.sql");
const COORD_PROBE = path.join(ROOT, "sql", "probes", "coordinator-probe.sql");
const COORD_CLAUSE = "(public.silvis_is_coord() and coalesce(current_setting('silvis.office_relay', true), '') = 'on')";
const COORD_POLICIES = {
  time_off_self_insert: "create policy time_off_self_insert on public.time_off for insert to authenticated\n  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());",
  time_off_self_update: "create policy time_off_self_update on public.time_off for update to authenticated\n  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord())\n  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());",
  time_off_self_delete: "create policy time_off_self_delete on public.time_off for delete to authenticated\n  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or public.silvis_is_coord());",
  availability_write_coord: "create policy availability_write_coord on public.availability for all to authenticated\n  using (public.silvis_is_coord()) with check (public.silvis_is_coord());",
  call_offers_insert: "create policy call_offers_insert on public.call_offers for insert to authenticated\n  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or " + COORD_CLAUSE + ");",
  call_offers_update: "create policy call_offers_update on public.call_offers for update to authenticated\n  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or " + COORD_CLAUSE + ")\n  with check (person_id = public.silvis_person_id() or public.silvis_is_sched() or " + COORD_CLAUSE + ");",
  call_offers_delete: "create policy call_offers_delete on public.call_offers for delete to authenticated\n  using (person_id = public.silvis_person_id() or public.silvis_is_sched() or " + COORD_CLAUSE + ");",
  notif_insert: "create policy notif_insert on public.notifications for insert to authenticated\n  with check (public.silvis_is_sched() or public.silvis_person_id() is not null or public.silvis_is_coord());",
  audit_insert: "create policy audit_insert on public.audit_log for insert to authenticated\n  with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()) or (public.silvis_is_coord() and actor_id = auth.uid()::text));",
  audit_read_coord: "create policy audit_read_coord on public.audit_log for select to authenticated\n  using (public.silvis_is_coord() and actor_id = auth.uid()::text and (action like 'timeoff.%' or action like 'offers.%' or action like 'availability.%'));",
};
const COORD_TABLE_OF = { time_off_self_insert: "time_off", time_off_self_update: "time_off", time_off_self_delete: "time_off", availability_write_coord: "availability", call_offers_insert: "call_offers", call_offers_update: "call_offers", call_offers_delete: "call_offers", notif_insert: "notifications", audit_insert: "audit_log", audit_read_coord: "audit_log" };
const COORD_DDL = [
  "alter table public.user_profiles drop constraint if exists user_profiles_role_check;",
  "alter table public.user_profiles add constraint user_profiles_role_check\n  check (role in ('admin','scheduler','surgeon','viewer','coordinator'));",
  "alter table public.user_profiles drop constraint if exists user_profiles_coordinator_unlinked;",
  "alter table public.user_profiles add constraint user_profiles_coordinator_unlinked\n  check (role <> 'coordinator' or person_id is null);",
  "alter table public.call_offers drop constraint if exists call_offers_source_check;",
  "alter table public.call_offers add constraint call_offers_source_check\n  check (source in ('app','email-relay','import','office-relay'));",
];
const COORD_HELPER = "create or replace function public.silvis_is_coord() returns boolean\nlanguage sql stable security definer set search_path = public as $$\n  select public.silvis_role() = 'coordinator';\n$$;";
const COORD_FLAG_ON = "if coord then perform set_config('silvis.office_relay', 'on', true); end if;";
const COORD_FLAG_OFF = "if coord then perform set_config('silvis.office_relay', '', true); end if;";
const COORD_CASES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17", "C18", "C19", "C20", "C21", "C22", "C23", "C24", "C25", "C26", "C27", "L1", "L2", "L3", "A1", "A2", "A3"];
function checkCoordPolicies(n, s) {
  Object.keys(COORD_POLICIES).forEach((p) => {
    ok(s.indexOf("drop policy if exists " + p + " on public." + COORD_TABLE_OF[p] + ";") >= 0, n + ": `drop policy if exists " + p + " on public." + COORD_TABLE_OF[p] + ";` missing (idempotency)");
    ok(s.indexOf(COORD_POLICIES[p]) >= 0, n + ": policy " + p + " must read exactly:\n" + COORD_POLICIES[p]);
    eq((s.match(new RegExp("create policy " + p + " on public\\.", "g")) || []).length, 1, n + ": policy " + p + " must be created exactly once;");
  });
  COORD_DDL.forEach((d) => ok(s.indexOf(d) >= 0, n + ": missing DDL line:\n" + d));
  ok(s.indexOf(COORD_HELPER) >= 0, n + ": silvis_is_coord() must read exactly (the sibling of silvis_is_sched):\n" + COORD_HELPER);
  ["user_profiles_read", "user_profiles_self_update", "user_profiles_admin", "contacts_read", "contacts_write", "notif_delete_sched", "audit_read", "snap_sched", "call_periods_write", "trade_insert", "trade_update", "east_vacation_reviews_self_insert", "east_overrides_write"].forEach((p) => {
    const t = policyText(s, p);
    if (t) ok(t.indexOf("silvis_is_coord") < 0, n + ": policy " + p + " must not name silvis_is_coord (unchanged for coordinators)");
  });
  ok(!/create policy [a-z_]+ on public\.(schedule_days|call_schedule_data|call_periods|shift_trade_requests|call_schedule_snapshots|office_contacts|east_vacation_reviews|east_overrides|east_feed|east_forecast)\b[^;]*silvis_is_coord/.test(s), n + ": no policy may admit a coordinator to schedule_days / call_schedule_data / call_periods / shift_trade_requests / snapshots / office_contacts / east tables");
  const save = functionText(s, "save_offers");
  ok(save && save.indexOf(COORD_FLAG_ON) > 0 && save.indexOf(COORD_FLAG_OFF) > save.indexOf(COORD_FLAG_ON), n + ": save_offers must set the office-relay flag (`" + COORD_FLAG_ON + "`) and clear it afterwards");
  if (save) {
    const on = save.indexOf(COORD_FLAG_ON), off = save.indexOf(COORD_FLAG_OFF), del = save.indexOf("delete from public.call_offers"), ins = save.indexOf("insert into public.call_offers"), mode = save.indexOf("perform public.set_offer_mode(");
    ok(on < del && del < ins && ins < off && off < mode, n + ": the flag must be on before the delete, still on through the upsert, and off before set_offer_mode");
    ok(on > save.lastIndexOf("using errcode = 'OS003'"), n + ": the flag is set only after every OS0xx check passed (a refused batch never turns it on)");
    ok(/coord\s+boolean := public\.silvis_is_coord\(\);/.test(save), n + ": save_offers declares coord := silvis_is_coord()");
    ok(!/security definer/.test(save), n + ": save_offers stays security invoker (RLS applies per row; the flag is what admits a coordinator's rows)");
  }
  const mode = functionText(s, "set_offer_mode");
  ok(mode && /coord\s+boolean := public\.silvis_is_coord\(\);/.test(mode), n + ": set_offer_mode declares coord := silvis_is_coord()");
  ok(mode && /if not sched and \(p\.status <> 'upcoming' or p\.offers_close_at <= today_c\) then/.test(mode), n + ": OM005 keeps freezing every non-scheduler - a coordinator included");
  ok(!/silvis\.office_relay/.test(mode || ""), n + ": set_offer_mode never touches the office-relay flag (it writes call_periods as definer, not call_offers)");
}
step("P16 A7: the coordinator migration file - the role check, the helper, ten policies, the two RPCs, nothing else");
const coordMig = read(COORD_MIGRATION);
ok(!/\r/.test(coordMig), "coordinator migration has CRLF line endings");
checkCoordPolicies("coordinator migration", coordMig);
checkOfferRpcs("coordinator migration", coordMig, true);
eq((coordMig.match(/^create policy /gm) || []).length, 10, "the coordinator migration must create exactly ten policies;");
eq((coordMig.match(/^drop policy if exists /gm) || []).length, 10, "the coordinator migration must drop-if-exists exactly ten policies;");
eq((coordMig.match(/create or replace function/g) || []).length, 3, "the coordinator migration must create silvis_is_coord, set_offer_mode and save_offers and nothing else;");
ok(!/create table|drop table|drop function|create trigger|drop trigger/.test(coordMig), "the coordinator migration must not create / drop a table, drop a function or touch a trigger");
ok(!/call_offers_guard|call_offers_delete_guard|time_off_no_call_conflict|claim_open_slot\(|apply_trade\(/.test(coordMig.replace(/--[^\n]*/g, "")), "the coordinator migration must not redefine the guards, the time_off trigger, claim_open_slot or apply_trade (a coordinator is a non-scheduler to all of them)");
ok(/^-- supersedes: sql\/migrations\/2026-09-24-prelaunch-rls\.sql$/m.test(coordMig), "the coordinator migration must declare `-- supersedes: sql/migrations/2026-09-24-prelaunch-rls.sql` (same day; it re-creates notif_insert / audit_insert after A1)");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-coordinator-role\.sql/.test(coordMig), "the coordinator migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST|report-first/.test(coordMig), "the coordinator migration header must say it is report-first (RLS on the live database)");
ok(!/directory of the six|home addresses/.test(coordMig), "no review phrasing in the migration");

step("P16 A7: schema.sql mirrors the coordinator migration byte for byte (policies, DDL, helper, both RPCs), the inline checks read the new lists, the header records revision k");
checkCoordPolicies("schema.sql", schema);
Object.keys(COORD_POLICIES).forEach((p) => ok(policyText(schema, p) === policyText(coordMig, p), "policy " + p + ": schema.sql differs from the coordinator migration"));
["set_offer_mode", "save_offers"].forEach((name) => ok(functionText(schema, name) === functionText(coordMig, name), name + "(): schema.sql differs from the coordinator migration (the newest migration touching it)"));
ok(sqlFunctionText(schema, "silvis_is_coord") === sqlFunctionText(coordMig, "silvis_is_coord"), "silvis_is_coord(): schema.sql differs from the coordinator migration");
ok(schema.indexOf(COORD_HELPER) > schema.indexOf("create or replace function public.silvis_is_sched()") && schema.indexOf(COORD_HELPER) < schema.indexOf("create table if not exists public.call_schedule_data ("), "silvis_is_coord() sits right after silvis_is_sched() in schema.sql");
ok(/role\s+text not null default 'viewer' check \(role in \('admin','scheduler','surgeon','viewer','coordinator'\)\),/.test(schema), "schema.sql's user_profiles inline role check must list coordinator (a from-scratch schema)");
ok(/source\s+text not null default 'app' check \(source in \('app','email-relay','import','office-relay'\)\),/.test(schema), "schema.sql's call_offers inline source check must list office-relay");
ok(schema.indexOf("alter table public.user_profiles add constraint user_profiles_coordinator_unlinked") < schema.indexOf("create or replace function public.handle_new_auth_user()"), "the user_profiles constraint re-creation sits right after the table (like schedule_days_distinct_roles)");
ok(/-- Revision 2026-09-24 k \(Prompt 16 A7, sql\/migrations\/2026-09-24-coordinator-role\.sql, applied 2026-09-23[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 k (the coordinator role, not yet applied)");
ok(policyText(schema, "audit_read") === "create policy audit_read on public.audit_log for select to authenticated using (public.silvis_is_sched());", "audit_read (scheduler / admin, every row) is unchanged");
ok(/create policy availability_write_coord/.test(schema.slice(schema.indexOf("-- time_off: anon-readable"), schema.indexOf("-- east_overrides: read all"))), "availability_write_coord is declared in the time_off / availability block (after the generated availability_write_sched)");

step("P16 A7: the probe is self-rolling-back, acts as a coordinator / a linked surgeon / an admin, covers C1..A3 with the BEFORE picture in its header");
const coProbe = read(COORD_PROBE);
ok(!/\r/.test(coProbe), "coordinator probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(coProbe), "coordinator probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(coProbe), "coordinator probe must collect into a temp table probe_results");
ok(/grant insert, select on probe_results to authenticated;/.test(coProbe), "coordinator probe must grant the temp table to authenticated");
const coLastDo = coProbe.lastIndexOf("do $$");
ok(coLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(coProbe.slice(coLastDo)), "coordinator probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
COORD_CASES.forEach((k) => ok(coProbe.indexOf("values ('" + k + "'") >= 0, "coordinator probe lacks case " + k));
ok(coProbe.indexOf("'2030-08-") > 0, "coordinator probe fixtures must live in 2030-08");
["'2030-05-", "'2030-04-", "'2030-03-"].forEach((d) => ok(coProbe.indexOf(d) < 0, "coordinator probe must not touch another probe's fixture month (" + d + ")"));
eq((coProbe.match(/'2030-0[67]-\d\d'/g) || []).sort().filter((v, i, a) => a.indexOf(v) === i), ["'2030-06-01'", "'2030-06-15'", "'2030-06-20'", "'2030-07-04'", "'2030-07-20'"], "coordinator probe: date literals outside 2030-08 must be exactly the two offers_close_at values, the two publish_by values and the rogue period's dates (C13);");
ok(/'probe-coord-' \|\| [a-z]+ \|\| '@example\.test'/.test(coProbe), "coordinator probe's throwaway auth users must be probe-coord-<uuid>@example.test (the leftover count keys on it)");
ok(/set role = 'coordinator', display_name = 'probe office' where id = coord;/.test(coProbe) && /exception when check_violation then/.test(coProbe) && /PROBE_SETUP: the role check refuses coordinator/.test(coProbe), "the coordinator fixture must be made through the role check, naming the refusal as the BEFORE picture (PROBE_SETUP)");
ok(/set person_id = 's3', role = 'surgeon'/.test(coProbe) && /set person_id = 's1', role = 'admin'/.test(coProbe), "coordinator probe must link its throwaway surgeon to s3 and its admin to s1");
ok(/insert into public\.schedule_days \(day, primary_id, backup_id, source, note\) values \('2030-08-10', 's3', null, 'probe-coord', 'probe-coord'\);/.test(coProbe), "the published-day fixture (C4: the trigger) must be 2030-08-10 primary s3 source 'probe-coord'");
ok(/'probe coord open', '2030-08-01', '2030-08-15', '2030-06-20'/.test(coProbe) && /'probe coord published', '2030-08-16', '2030-08-31', '2030-07-20'/.test(coProbe) && /set status = 'published' where label = 'probe coord published'/.test(coProbe), "coordinator probe periods: 'probe coord open' (8/1-8/15, close 2030-06-20) and 'probe coord published' (8/16-8/31, close 2030-07-20 in the future, flipped to published after its fixture offer)");
ok(/created_by = auth\.uid\(\)::text then 'self'/.test(coProbe) && /entered_by = auth\.uid\(\)::text then 'self'/.test(coProbe), "C1 / C6 must compare created_by / entered_by against auth.uid()::text (the coordinator's profile id)");
ok(/'ERR ' \|\| sqlstate \|\| ' ' \|\| replace\(sqlerrm, ';', ','\)/.test(coProbe), "coordinator probe must record the SQLSTATE with each error (42501 / P0001 / OF003 / OM005 / 23514 are graded)");
ok(/get diagnostics n = row_count;/.test(coProbe), "coordinator probe must observe UPDATE / DELETE row counts (RLS filters silently: C11 / C12 / C22 / C23)");
ok(/action like 'timeoff\.%'/.test(coordMig) && /'timeoff\.add', '\{"probe":"probe-coord"\}'::jsonb/.test(coProbe), "C21 must measure audit_read_coord with a family row (timeoff.add) beside a non-family row (probe.coord)");
ok(!/simple-protocol/.test(coProbe), "coordinator probe header must not claim a simple-protocol connection");
ok(!/set local role anon/.test(coProbe), "coordinator probe has no anon case (nothing anon changed in A7)");
["ok created_by=self", "ok entered_by=self source=office-relay", "own_family=1 others=0 own_other=0", "user_profiles_coordinator_unlinked", "TRADE_FORBIDDEN", "closed on 2030-07-20", "OS004 OFFERS_UNKNOWN_PERSON: zz is not a roster id", "OM007 MODE_UNKNOWN_PERSON: zz is not a roster id"].forEach((s) => ok(coProbe.slice(0, coProbe.indexOf("create temp table")).indexOf(s) > 0, "coordinator probe header must state the AFTER string `" + s + "`"));
ok(/save_offers\('zz', /.test(coProbe) && /set_offer_mode\(o::uuid, 'preferred', 'zz'\)/.test(coProbe), "C26 / C27 must relay for 'zz' (not a roster id) through save_offers and set_offer_mode as the coordinator");

step("P16 A7: verify-rls.sh section 11 - the client gates, the probe graded case by case, leftovers counted, nothing written over REST");
ok(/^echo "== 11\. /m.test(vr), "verify-rls.sh has no section 11");
const s11 = vr.slice(vr.indexOf('echo "== 11. '), vr.indexOf('echo "== 12. ') > vr.indexOf('echo "== 11. ') ? vr.indexOf('echo "== 12. ') : vr.length);   // section 12a' reads the live Pages client (Prompt 20 F1)
ok(s11.length > 0 && s11.length < vr.length, "verify-rls.sh section 11 could not be sliced out");
ok(/coordinator-probe\.sql/.test(s11), "section 11 must run sql/probes/coordinator-probe.sql through the linked CLI");
COORD_CASES.forEach((k) => ok(new RegExp("expect_(eq|err)11\\s+" + k + "\\s").test(s11), "section 11 does not grade probe case " + k));
["ok created_by=self", "ok entered_by=self source=office-relay", "ok entered_by=scheduler source=email-relay", "own_family=1 others=0 own_other=0", "own=1 leak=0 sched_ok=t", "ON_CALL_CONFLICT", "TRADE_FORBIDDEN", "MODE_FROZEN", "closed on 2030-07-20", "42501", "23514", "user_profiles_coordinator_unlinked", "updated=0", "deleted=0", "contacts=0", "visible=0", "OFFERS_UNKNOWN_PERSON", "MODE_UNKNOWN_PERSON"].forEach((c) => ok(s11.indexOf(c) > 0, "section 11 must expect " + c));
ok(/source = 'probe-coord'/.test(s11) && /note = 'probe-coord'/.test(s11) && /label like 'probe coord%'/.test(s11) && /action = 'probe\.coord' or detail ->> 'probe' = 'probe-coord'/.test(s11) && /title = 'probe-coord'/.test(s11) && /reason = 'probe-coord'/.test(s11) && /email like 'probe-coord-%@example\.test'/.test(s11),
  "section 11 must count leftovers over schedule_days / time_off / availability / call_offers / call_periods / audit_log / notifications / snapshots / auth.users and fail on non-zero");
ok(/LEFT ROWS BEHIND/.test(s11), "section 11 must report leftovers as a failure with the cleanup statements");
ok(/PROBE_SETUP: the role check refuses coordinator/.test(s11), "section 11 must name the BEFORE picture (the setup's PROBE_SETUP) as 'not applied'");
const s11write = s11.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
ok(!/-X (POST|PATCH|DELETE|PUT)/.test(s11write) && !/curl /.test(s11write), "section 11 must write nothing over REST (no curl at all)");
ok(/const isCoordinator = userProfile\?\.role === "coordinator";/.test(s11) && /isUnlinked && !isCoordinator/.test(s11), "section 11a must check the client's isCoordinator flag and the banner gate");

step("P16 A7: docs - ONBOARDING role table, guide roles line + 4.3 rows, edge README gate row");
const onboarding = fs.readFileSync(path.join(ROOT, "docs", "ONBOARDING.md"), "utf8");
ok(/^\| `coordinator` \(office users, Prompt 16 A7\) \|/m.test(onboarding) && /^\| `viewer` \|/m.test(onboarding) && /^\| `scheduler` \|/m.test(onboarding), "ONBOARDING.md must carry a role table with a `coordinator` row (beside viewer / scheduler)");
const coordRow = onboarding.split("\n").find((l) => /^\| `coordinator`/.test(l)) || "";
ok(/vacation/i.test(coordRow) && /offer/i.test(coordRow) && /Setup, Generate, the day editor/.test(coordRow), "the ONBOARDING coordinator row must say what it can do (vacations, offers) and what it cannot (Setup, Generate, the day editor, ...)");
ok(/`coordinator`/.test(guide.slice(guide.indexOf("## 3. Identity model"), guide.indexOf("## 4. Data model"))), "guide section 3 must list the coordinator role");
ok(/Prompt 16 A7/.test(g43) && /coordinator-role/.test(g43), "guide 4.3 must name Prompt 16 A7 and the migration file");
["time_off_self_insert", "availability_write_coord", "call_offers_insert", "save_offers", "notif_insert", "audit_insert", "audit_read_coord", "silvis_is_coord"].forEach((p) => ok(new RegExp("^\\| `" + p + "`", "m").test(g43), "guide 4.3's coordinator table lacks a row for " + p));
ok(/OS004/.test(g43) && /OM007/.test(g43), "guide 4.3's save_offers / set_offer_mode row must name the roster check (OS004 / OM007: the office relays for a roster id only)");
ok(/DB policy only; no UI yet/.test(guide.slice(guide.indexOf("## 3. Identity model"), guide.indexOf("## 4. Data model"))), "guide section 3 must say the coordinator's availability write is a DB policy only (no UI yet) - the three documents agree");
const efReadme = fs.readFileSync(path.join(ROOT, "edge-functions", "README.md"), "utf8");
const snRow = efReadme.split("\n").find((l) => /^\| send-notification \| OFF \|/.test(l)) || "";
ok(/coordinator/.test(snRow), "edge-functions/README.md: the send-notification gate row must name the coordinator refusal (403 like a viewer)");
ok(/Prompt 16 A7/.test(efReadme) && /coordinator/.test(efReadme.split("Prompt 16 A7")[1] || ""), "edge-functions/README.md must carry the Prompt 16 A7 paragraph (coordinator = viewer to send-notification)");
// ---- Prompt 16 B6 (2026-09-24): definer locks + roster names ----
// Review 2026-09-23 section 3 (security minors): apply_trade / claim_open_slot did not lock time_off rows (write skew
// with a simultaneous vacation edit); trade_insert_guard stored the client's from/to names. One migration, three
// functions, each already pinned above with locks / names = true; here: the file's shape, the header's lock-order
// sentences, the probes' new cases, verify-rls.sh's grading and the SCHEMA-REVIEW.md record.
step("B6: migration 2026-09-24-definer-locks.sql defines apply_trade, claim_open_slot and trade_insert_guard (nothing else), byte-identical to schema.sql, trigger re-created, grants re-run");
const locksMig = read(LOCKS_MIGRATION);
ok(!/\r/.test(locksMig), "definer-locks migration has CRLF line endings");
checkInsertGuard("definer-locks migration", locksMig, true, false);
checkApplyTrade("definer-locks migration", locksMig, true, true);
checkClaim("definer-locks migration", locksMig, true);
eq((locksMig.match(/create or replace function/g) || []).length, 3, "the definer-locks migration must define apply_trade, claim_open_slot and trade_insert_guard and nothing else;");
ok(!/drop function|drop table|create table|alter table|drop policy|create policy/.test(locksMig), "the definer-locks migration must not drop, create or alter anything besides the trigger re-create");
eq((locksMig.match(/create trigger/g) || []).length, 1, "the definer-locks migration re-creates exactly one trigger (trade_insert_guard_trg);");
ok(!/trade_update_guard|call_offers_guard|call_offers_delete_guard|time_off_no_call_conflict/.test(locksMig.replace(/--[^\n]*/g, "")), "the definer-locks migration's statements touch none of the A1 lane's guards nor the time_off trigger (comments may name them)");
ok(/revoke all on function public\.apply_trade\(uuid\) from public, anon;\ngrant execute on function public\.apply_trade\(uuid\) to authenticated;/.test(locksMig) && /revoke all on function public\.claim_open_slot\(date, text\) from public, anon;\ngrant execute on function public\.claim_open_slot\(date, text\) to authenticated;/.test(locksMig), "the definer-locks migration must re-run both revoke / grant pairs (create or replace keeps ACLs, the re-run is belt and braces)");
// Follow-up 5b (2026-09-24): apply_trade and claim_open_slot are superseded by sql/migrations/2026-09-24-trade-audit-names.sql
// - their B6 bodies are frozen by sha256 in the 5b block below. Prompt 19 (2026-09-24, report-first): trade_insert_guard is
// superseded by sql/migrations/2026-09-24-give-kind.sql - B6's body (live since 2026-09-23 ~19:27 Central) is frozen here.
eq(crypto.createHash("sha256").update(functionText(locksMig, "trade_insert_guard") || "").digest("hex"), "f7e3abd7b5789fe199a7cd22c364f7438fa0fd7d89b4bccd28b091b8598e64d8",
  "2026-09-24-definer-locks.sql trade_insert_guard() must stay byte-for-byte what was applied live on 2026-09-23 (the give / trade kind rules belong to 2026-09-24-give-kind.sql);");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-definer-locks\.sql/.test(locksMig), "the definer-locks migration header must carry the CLI apply line for the orchestrator");
ok(/-- Revision 2026-09-24 l \(Prompt 16 B6, sql\/migrations\/2026-09-24-definer-locks\.sql, applied 2026-09-23[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 l (definer locks + roster names, not yet applied)");
const ORDER_TRADE = "Lock order: trade row (update) -> time_off table (share) -> day rows (update)";
const ORDER_CLAIM = "Lock order: time_off table (share) -> the day row (update)";
[["schema.sql", schema], ["definer-locks migration", locksMig]].forEach(([n, s]) => {
  const applyAt = s.indexOf("create or replace function public.apply_trade("), claimAt = s.indexOf("create or replace function public.claim_open_slot(");
  ok(s.lastIndexOf(ORDER_TRADE, applyAt) > 0 && applyAt - s.lastIndexOf(ORDER_TRADE, applyAt) < 6000, n + ": apply_trade's header must document `" + ORDER_TRADE + "`");
  ok(s.lastIndexOf(ORDER_CLAIM, claimAt) > applyAt && claimAt - s.lastIndexOf(ORDER_CLAIM, claimAt) < 6000, n + ": claim_open_slot's header must document `" + ORDER_CLAIM + "`");
  const applyHdr = s.slice(Math.max(0, s.lastIndexOf(ORDER_TRADE, applyAt) - 3000), applyAt);
  ok(/ROW EXCLUSIVE/.test(applyHdr) && /inserted or edited/i.test(applyHdr), n + ": apply_trade's header must explain the table lock (every time_off writer holds ROW EXCLUSIVE, which conflicts with SHARE, so a vacation inserted or edited concurrently is covered)");
  ok(!/does NOT close/.test(applyHdr) && !/B6 report/.test(s), n + ": the INSERT side is closed by the table lock - nothing may record it as open or point at 'the B6 report' (an ephemeral artefact; the repo docs carry the reasoning)");
  ok(!/receivers' time_off rows \(share\)|caller's time_off rows \(share\)/.test(s), n + ": the old row-lock order sentences must be gone (they described the FOR SHARE version)");
  // Residual the migration does not close (trade_update_guard is not one of B6's three functions): a party's status
  // PATCH may still carry from_surgeon_name / to_surgeon_name. Both files must say so where a reader looks.
  const residual = /Residual[\s\S]{0,300}trade_update_guard[\s\S]{0,400}from_surgeon_name/;
  ok(residual.test(s.slice(0, s.indexOf("create or replace function public.trade_insert_guard("))), n + ": the header must state the UPDATE-path residual plainly (trade_update_guard does not pin the two name columns; the client renders roster names by id; the one-liner is queued in docs/SCHEMA-REVIEW.md)");
});

step("B6: trade probe cases E2 (the time_off SHARE lock seen in pg_locks after E committed) and N (roster names); claim probe case B2 (after B); verify-rls.sh grades them");
const probeHdr = probe.slice(0, probe.indexOf("create temp table probe_results"));
const claimHdr = claimProbe.slice(0, claimProbe.indexOf("create temp table probe_results"));
// A relation lock is first-class in pg_locks (unlike a row lock), but a lock taken inside an ABORTED subtransaction is
// released at its rollback - so the observation follows a case whose inner block committed: trade E (status=applied),
// claim B (ok). Trade B (refused) would read 0 both before and after; that is why the old B2 is gone from the trade probe.
const LOCK_OBS = "from pg_locks\n     where locktype = 'relation' and relation = 'public.time_off'::regclass\n       and pid = pg_backend_pid() and mode = 'ShareLock' and granted;";
["'E2'", "'N'"].forEach((k) => ok(probe.indexOf("values (" + k) >= 0, "trade probe lacks case " + k));
ok(claimProbe.indexOf("values ('B2'") >= 0, "claim probe lacks case 'B2'");
ok(!/values \('B2'/.test(probe), "trade probe must not carry a B2 any more (after the refused B a relation lock is already released - the observation moved to E2)");
ok(!/xmax/.test(probe) && !/xmax/.test(claimProbe), "the xmax observation is gone from both probes (it rested on heap internals; the relation lock is read from pg_locks)");
ok(probe.includes(LOCK_OBS) && claimProbe.includes(LOCK_OBS), "both probes must observe the lock through pg_locks: `" + LOCK_OBS.replace(/\n\s*/g, " ") + "` (this backend's granted ShareLock on time_off)");
ok(!/2030-03-21/.test(probe), "trade probe: the 3/21-3/22 fixture row existed only for the xmax reading - it must be gone");
ok(/'Mallory'/.test(probe) && /'Eve'/.test(probe), "case N must send client-chosen names (Mallory / Eve) that the trigger must replace");
ok(/'probe N'/.test(probe), "case N's row must carry detail 'probe N' (the leftover count keys on `detail like 'probe %'`)");
ok(/from_name=Burchett to_name=Acton/.test(probeHdr) && /from_name=Mallory to_name=Eve/.test(probeHdr), "trade probe header must state N's BEFORE (Mallory / Eve kept) and AFTER (roster names Burchett / Acton)");
ok(/E2=share_locks=1/.test(probeHdr) && /E2=share_locks=0/.test(probeHdr), "trade probe header must state E2's BEFORE (share_locks=0) and AFTER (share_locks=1)");
ok(/B2=share_locks=1/.test(claimHdr) && /B2=share_locks=0/.test(claimHdr), "claim probe header must state B2's BEFORE (share_locks=0) and AFTER (share_locks=1)");
ok(probe.indexOf("values ('E2'") > probe.indexOf("values ('E'") && probe.indexOf("values ('E2'") < probe.indexOf("values ('F'"), "trade probe E2 must run right after E (the first apply whose subtransaction COMMITS; an aborted one, like B, releases the relation lock) and before F");
ok(claimProbe.indexOf("values ('B2'") > claimProbe.indexOf("values ('B'") && claimProbe.indexOf("values ('B2'") < claimProbe.indexOf("values ('C'"), "claim probe B2 must run right after B (the first claim as s3, which commits its subtransaction) and before C");
["E2", "N"].forEach((k) => ok(new RegExp("expect_eq\\s+" + k + "\\s").test(s5), "verify-rls.sh section 5 does not grade probe case " + k));
ok(!/expect_eq\s+B2\s/.test(s5), "verify-rls.sh section 5 must not grade a trade probe B2 any more");
ok(/expect_eq\s+B2\s/.test(s7), "verify-rls.sh section 7 does not grade claim probe case B2");
ok(/expect_eq\s+E2\s+"share_locks=1"/.test(s5) && /expect_eq\s+N\s+"from_name=Burchett to_name=Acton"/.test(s5) && /expect_eq\s+B2\s+"share_locks=1"/.test(s7), "verify-rls.sh must expect the AFTER strings (share_locks=1; from_name=Burchett to_name=Acton)");
ok(!/locked=2 of=2/.test(s5 + s7), "verify-rls.sh must not expect the old xmax strings (locked=2 of=2) any more");

step("B6: docs/SCHEMA-REVIEW.md carries the definer-locks section with its 'observed:' line (filled 2026-09-23)");
ok(/## 2026-09-24 - definer locks \+ roster names \(Prompt 16 B6; `sql\/migrations\/2026-09-24-definer-locks\.sql`\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - definer locks + roster names' section");
const reviewB6 = review.slice(review.indexOf("## 2026-09-24 - definer locks"));
ok(/definer-locks[\s\S]*observed: /.test(reviewB6), "SCHEMA-REVIEW.md's definer-locks section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
ok(/lock table public\.time_off in share mode/.test(reviewB6) && /pg_locks/.test(reviewB6) && /share_locks=1/.test(reviewB6), "SCHEMA-REVIEW.md's definer-locks section must describe the table lock and the pg_locks observation (share_locks=1)");
ok(!/B6 report/.test(reviewB6) && !/xmax/.test(reviewB6), "SCHEMA-REVIEW.md must not point at 'the B6 report' nor describe the xmax reading");
ok(/trade_update_guard[\s\S]{0,600}from_surgeon_name/.test(reviewB6) && /tradeNamed/.test(reviewB6), "SCHEMA-REVIEW.md must record the UPDATE-path residual (trade_update_guard, the queued one-liner) and the client's tradeNamed change");
ok(/applyTablesUpsert/.test(reviewB6), "SCHEMA-REVIEW.md must record the backup-restore applier's note blanking (the second time_off note path)");

// ---- Prompt 16 follow-up 5b (2026-09-24): trade / claim audit rows carry actor_name + summary ----
// Faraz 9/24: apply_trade wrote its audit row as (actor_id, action, detail) - actor_name null, no detail.summary - so
// Settings > Activity log showed "?" for the actor and the raw action 'trade.apply' for the line (the client renders
// (en.detail && en.detail.summary) || en.action); claim_open_slot named its actor (my_name) but had no summary either.
// One migration, two functions, REPORT-FIRST (not applied; the orchestrator applies it after the go). Same-day order against
// B6 by its `-- supersedes:` line; B6's two bodies are frozen by sha256 here; schema.sql mirrors the 5b file. Pinned below:
// the file's shape, the byte identity, the header revision m line, the exact audit inserts and the summary format strings,
// that NOTHING else in either body moved (the body with the audit change undone equals B6's, byte for byte), the probes'
// new cases (trade E3 / F2, claim B3) with verify-rls.sh's expected strings, the SCHEMA-REVIEW.md record and the guide row.
step("5b: migration 2026-09-24-trade-audit-names.sql defines apply_trade and claim_open_slot (nothing else), supersedes B6, byte-identical to schema.sql, grants re-run, CLI apply line; B6's two bodies frozen");
const auditMig = read(AUDIT_MIGRATION);
const sha5b = (t) => crypto.createHash("sha256").update(t || "").digest("hex");
ok(!/\r/.test(auditMig), "trade-audit migration has CRLF line endings");
checkApplyTrade("trade-audit migration", auditMig, true, true);
checkClaim("trade-audit migration", auditMig, true);
eq((auditMig.match(/create or replace function/g) || []).length, 2, "the trade-audit migration must define apply_trade and claim_open_slot and nothing else;");
ok(!/drop function|drop table|create table|alter table|drop policy|create policy|create trigger|drop trigger/.test(auditMig), "the trade-audit migration must not drop, create or alter anything (no trigger either - only the two create or replace + the grants re-run)");
ok(!/trade_insert_guard|trade_update_guard|call_offers_guard|call_offers_delete_guard|time_off_no_call_conflict|handle_new_auth_user/.test(auditMig.replace(/--[^\n]*/g, "")), "the trade-audit migration's statements touch no other function (comments may name them)");
ok(/^-- supersedes: sql\/migrations\/2026-09-24-definer-locks\.sql$/m.test(auditMig), "the trade-audit migration must declare `-- supersedes: sql/migrations/2026-09-24-definer-locks.sql` (same day; it re-creates B6's apply_trade / claim_open_slot after B6)");
ok(/revoke all on function public\.apply_trade\(uuid\) from public, anon;\ngrant execute on function public\.apply_trade\(uuid\) to authenticated;/.test(auditMig) && /revoke all on function public\.claim_open_slot\(date, text\) from public, anon;\ngrant execute on function public\.claim_open_slot\(date, text\) to authenticated;/.test(auditMig), "the trade-audit migration must re-run both revoke / grant pairs");
["apply_trade", "claim_open_slot"].forEach((name) => {
  const a = functionText(schema, name), b = functionText(auditMig, name);
  ok(a && b && a === b, name + "(): schema.sql differs from sql/migrations/2026-09-24-trade-audit-names.sql (keep them identical; the migration is what runs live)");
});
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-trade-audit-names\.sql/.test(auditMig), "the trade-audit migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST/.test(auditMig) && /Blast radius/.test(auditMig), "the trade-audit migration header must say it is report-first and state the blast radius");
ok(/-- Revision 2026-09-24 m \(Prompt 16 follow-up 5b, sql\/migrations\/2026-09-24-trade-audit-names\.sql, applied 2026-09-24[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 m (trade / claim audit rows; report-first, NOT yet applied - the record step changes it to 'applied <timestamp>' with this pin)");
// B6's bodies (live since 2026-09-23 ~19:27 Central) are superseded by this file - frozen here (audit RLS-2 rule: an applied file is never edited).
eq(sha5b(functionText(locksMig, "apply_trade")), "cc13b436a10a0e523859a20ad15faecae873ef1c5586142b4f8d0217c04bb47c", "2026-09-24-definer-locks.sql apply_trade() must stay byte-for-byte what was applied live on 2026-09-23 (the audit change belongs to 2026-09-24-trade-audit-names.sql);");
eq(sha5b(functionText(locksMig, "claim_open_slot")), "909db3550c3bb5d37bf633475b1b3fe7ed1f8b95d1746a07f24e6811426c5549", "2026-09-24-definer-locks.sql claim_open_slot() must stay byte-for-byte what was applied live on 2026-09-23 (the audit change belongs to 2026-09-24-trade-audit-names.sql);");

step("5b: apply_trade's audit insert - actor_name from the caller's profile (display_name, else the roster name, else the id), detail.summary in the trade.accept wording family with roster names, every other key kept; the rest of the body is B6's byte for byte");
const ACTOR_LOOKUP_1 = "select nullif(p.display_name, '') into my_name from public.user_profiles p where p.id = auth.uid();";
const ACTOR_LOOKUP_2 = "my_name := coalesce(my_name, nullif((select r ->> 'name' from jsonb_array_elements(roster) r where r ->> 'id' = me limit 1), ''), me);";
const TRADE_AUDIT_INSERT = "insert into public.audit_log (actor_id, actor_name, action, detail)\n  values (me, my_name, 'trade.apply', jsonb_build_object('summary', summary, 'trade_id', p_trade_id, 'day', t.day, 'role', t.role, 'return_day', t.return_day, 'return_role', t.return_role, 'from', t.from_surgeon_id, 'to', t.to_surgeon_id));";
const TRADE_SUMMARY = [
  "summary := 'Trade applied: ' || to_name || ' takes ' || case when t.role = 'primary' then 'Primary' else 'Backup' end",
  "|| ' ' || to_char(t.day, 'Dy Mon FMDD') || ' (from ' || fr_name",
  "|| case when t.return_day is null then ', one-way)'",
  "else '; ' || fr_name || ' takes ' || case when t.return_role = 'primary' then 'Primary' else 'Backup' end",
  "|| ' ' || to_char(t.return_day, 'Dy Mon FMDD') || ' in return)' end;",
];
// undo the 5b change textually: the result must be B6's body (proves the writes, checks, locks, grants and every other line are untouched)
const undoTrade = (t) => t
  .replace("  my_name  text;\n  summary  text;\n", "")
  .replace(/  -- \(2026-09-24, follow-up 5b\)[\s\S]*?\n  insert into public\.audit_log \(actor_id, actor_name, action, detail\)\n  values \(me, my_name, 'trade\.apply', jsonb_build_object\('summary', summary, /, "  insert into public.audit_log (actor_id, action, detail)\n  values (me, 'trade.apply', jsonb_build_object(");
[["schema.sql", schema], ["trade-audit migration", auditMig]].forEach(([n, s]) => {
  const fn = functionText(s, "apply_trade");
  ok(fn.includes(ACTOR_LOOKUP_1), n + ": apply_trade must read the CALLER's display_name: `" + ACTOR_LOOKUP_1 + "`");
  ok(fn.includes(ACTOR_LOOKUP_2), n + ": apply_trade must fall back to the roster name for the caller's roster id, then the id: `" + ACTOR_LOOKUP_2 + "`");
  ok(fn.includes(TRADE_AUDIT_INSERT), n + ": apply_trade's audit insert must be exactly `" + TRADE_AUDIT_INSERT.replace(/\n\s*/g, " ") + "` (actor_name + summary first, every other key kept)");
  ok(!/insert into public\.audit_log \(actor_id, action, detail\)/.test(fn), n + ": the old three-column audit insert (actor_name null) must be gone from apply_trade");
  TRADE_SUMMARY.forEach((line) => ok(fn.includes(line), n + ": apply_trade's summary must carry `" + line + "` (Trade applied: <to> takes <Primary|Backup> <Dy Mon D> (from <from>, one-way) | (from <from>; <from> takes <Role> <Dy Mon D> in return))"));
  ok(!/t\.to_surgeon_name|t\.from_surgeon_name/.test(fn), n + ": the summary must use the roster names (to_name / fr_name), never the stored from_surgeon_name / to_surgeon_name (a status PATCH may rewrite them)");
  ok(/  fr_name  text;\n  my_name  text;\n  summary  text;\nbegin/.test(fn), n + ": apply_trade declares my_name and summary after fr_name");
  const at = fn.indexOf(TRADE_AUDIT_INSERT);
  ok(at > fn.indexOf("update public.shift_trade_requests set status = 'applied'") && at < fn.lastIndexOf("return jsonb_build_object('ok', true"), n + ": the audit insert stays the last write of the transaction (after the trade row's status update, before the return)");
  ok(fn.indexOf(ACTOR_LOOKUP_1) > fn.indexOf("update public.shift_trade_requests set status = 'applied'"), n + ": the actor lookup sits with the audit insert, after every row write (no new statement before the checks or the writes)");
  eq(undoTrade(fn), functionText(locksMig, "apply_trade"), n + ": with the 5b audit change undone textually, apply_trade must equal B6's applied body byte for byte (the writes, checks, locks and every other line are untouched);");
});

step("5b: claim_open_slot's audit detail gains summary = the feed title '<Name> took <M/D> <role>' (the short form); actor_name stays my_name; the rest of the body is B6's byte for byte");
const CLAIM_SUMMARY = "summary := my_name || ' took ' || to_char(p_day, 'FMMM/FMDD') || ' ' || p_role;";
const CLAIM_AUDIT_INSERT = "insert into public.audit_log (actor_id, actor_name, action, detail)\n  values (me, my_name, 'schedule.claim', jsonb_build_object('summary', summary, 'day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer));";
const undoClaim = (t) => t
  .replace("  summary   text;\n", "")
  .replace(/  -- \(2026-09-24, follow-up 5b\)[^\n]*\n  summary := my_name \|\| ' took ' \|\| to_char\(p_day, 'FMMM\/FMDD'\) \|\| ' ' \|\| p_role;\n/, "")
  .replace("jsonb_build_object('summary', summary, 'day', p_day", "jsonb_build_object('day', p_day");
[["schema.sql", schema], ["trade-audit migration", auditMig]].forEach(([n, s]) => {
  const fn = functionText(s, "claim_open_slot");
  ok(fn.includes(CLAIM_SUMMARY), n + ": claim_open_slot must set `" + CLAIM_SUMMARY + "` (the feed title's expression)");
  ok(fn.includes(CLAIM_AUDIT_INSERT), n + ": claim_open_slot's audit insert must be exactly `" + CLAIM_AUDIT_INSERT.replace(/\n\s*/g, " ") + "`");
  ok(fn.indexOf(CLAIM_SUMMARY) < fn.indexOf(CLAIM_AUDIT_INSERT) && fn.indexOf(CLAIM_AUDIT_INSERT) < fn.indexOf("insert into public.notifications"), n + ": summary is set right before the audit row, which still precedes the feed row");
  ok(!/\(07:00 to 07:00\)/.test(fn.slice(0, fn.indexOf("'schedule.claim'"))), n + ": the audit summary is the short title, not the notification sentence (that stays in the feed row only)");
  eq(undoClaim(fn), functionText(locksMig, "claim_open_slot"), n + ": with the 5b audit change undone textually, claim_open_slot must equal B6's applied body byte for byte;");
});
["2026-09-22-claim-open-slot.sql", "2026-09-23-claim-offer.sql", "2026-09-24-definer-locks.sql"].forEach((f) => ok(!/'summary'/.test(functionText(read(path.join(ROOT, "sql", "migrations", f)), "claim_open_slot")), f + ": the frozen claim_open_slot body must not carry the summary key (it belongs to the 5b file)"));

step("5b: trade probe E3 (after E2, before F) and F2 (after F, before G) read the audit rows apply_trade wrote; claim probe B3 (after B2, before C); the scheduler fixture gets display_name 'Probe Scheduler'; verify-rls.sh grades them and counts trade.apply audit leftovers");
const EXPECT_E3 = "actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)";
const EXPECT_F2 = "actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)";
const EXPECT_B3 = "actor=Acton summary=Acton took 4/7 backup";
const AUDIT_READ = "select a.actor_name, a.detail ->> 'summary' into an, sm";
ok(probe.indexOf("values ('E3'") > probe.indexOf("values ('E2'") && probe.indexOf("values ('E3'") < probe.indexOf("values ('F'"), "trade probe E3 must run right after E2 (E's two-way apply committed its subtransaction) and before F");
ok(probe.indexOf("values ('F2'") > probe.indexOf("values ('F'") && probe.indexOf("values ('F2'") < probe.indexOf("values ('G'"), "trade probe F2 must run right after F (the scheduler's one-way apply) and before G");
ok(claimProbe.indexOf("values ('B3'") > claimProbe.indexOf("values ('B2'") && claimProbe.indexOf("values ('B3'") < claimProbe.indexOf("values ('C'"), "claim probe B3 must run right after B2 (B's claim committed) and before C");
// Prompt 19 added a third reader (T2: the give's audit row) - pinned in the Prompt 19 block below.
eq((probe.match(new RegExp(AUDIT_READ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 3, "trade probe must read actor_name + detail ->> 'summary' three times (E3, F2 and Prompt 19's T2);");
ok(claimProbe.includes(AUDIT_READ), "claim probe must read actor_name + detail ->> 'summary' (B3)");
ok(/a\.action = 'trade\.apply' and a\.detail ->> 'trade_id' = '00000000-0000-4000-8000-00000000000e'/.test(probe) && /a\.action = 'trade\.apply' and a\.detail ->> 'trade_id' = '00000000-0000-4000-8000-00000000000f'/.test(probe), "E3 / F2 must read the rows by the fixture trade ids (E = ...0e, F = ...0f)");
ok(/a\.action = 'schedule\.claim' and a\.detail ->> 'day' = '2030-04-07'/.test(claimProbe), "B3 must read the schedule.claim row of 2030-04-07 (B's day)");
ok(/update public\.user_profiles set display_name = 'Probe Scheduler' where id = sched;/.test(probe), "trade probe must give its scheduler display_name 'Probe Scheduler' (F2 exercises the display_name branch; the surgeon keeps none, so E3 shows the roster fallback)");
ok(!/display_name/.test(claimProbe.replace(/--[^\n]*/g, "")), "claim probe sets no display_name (B3 shows the roster name Acton)");
ok(probeHdr.includes("E3=actor=null summary=null") && probeHdr.includes("E3=" + EXPECT_E3), "trade probe header must state E3's BEFORE (actor=null summary=null) and AFTER (`" + EXPECT_E3 + "`)");
ok(probeHdr.includes("F2=actor=null summary=null") && probeHdr.includes("F2=" + EXPECT_F2), "trade probe header must state F2's BEFORE and AFTER (`" + EXPECT_F2 + "`)");
ok(claimHdr.includes("B3=actor=Acton summary=null") && claimHdr.includes("B3=" + EXPECT_B3), "claim probe header must state B3's BEFORE (actor=Acton summary=null) and AFTER (`" + EXPECT_B3 + "`)");
ok(new RegExp("expect_eq\\s+E3\\s+\"" + EXPECT_E3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s5), "verify-rls.sh section 5 must grade E3 against `" + EXPECT_E3 + "` (';' flattened to a space by the probe's report)");
ok(new RegExp("expect_eq\\s+F2\\s+\"" + EXPECT_F2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s5), "verify-rls.sh section 5 must grade F2 against `" + EXPECT_F2 + "`");
ok(new RegExp("expect_eq\\s+B3\\s+\"" + EXPECT_B3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s7), "verify-rls.sh section 7 must grade B3 against `" + EXPECT_B3 + "`");
ok(/action = 'trade\.apply' and detail ->> 'trade_id' like '00000000-0000-4000-8000-0000000000%'/.test(s5), "verify-rls.sh section 5 leftover count must include the trade.apply audit rows of the fixture trades");

step("5b: docs/SCHEMA-REVIEW.md carries the APPLIED item 5b section (before / after, blast radius, probe cases, the observed line); guide 4.3 carries its row");
ok(/## 2026-09-24 - trade \/ claim audit rows carry actor_name \+ summary \(item 5b\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - trade / claim audit rows carry actor_name + summary (item 5b)' section");
const review5b = review.slice(review.indexOf("## 2026-09-24 - trade / claim audit rows"));
ok(/^\*\*Status: APPLIED 2026-09-24[^*]*\*\*$/.test(((review5b.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the item 5b section's status line (its first **Status:**) must read 'Status: APPLIED 2026-09-24 ...' (applied 22:21 UTC after Faraz's go)");
ok(/2026-09-24-trade-audit-names\.sql[\s\S]*observed: /.test(review5b), "the item 5b section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
ok(review5b.includes(TRADE_AUDIT_INSERT.replace(/\n  /g, "\n    ")) && review5b.includes(CLAIM_AUDIT_INSERT.replace(/\n  /g, "\n    ")), "the item 5b section must quote both AFTER audit inserts verbatim");
ok(/insert into public\.audit_log \(actor_id, action, detail\)/.test(review5b) && /jsonb_build_object\('day', p_day, 'role', p_role, 'person', me, 'version', new_ver, 'offer', wrote_offer\)\)/.test(review5b), "the item 5b section must quote both BEFORE audit inserts");
ok(/What could break/.test(review5b) && /Blast radius/.test(review5b) && /edge functions only INSERT audit rows/.test(review5b), "the item 5b section must state what could break and the blast radius (nothing reads detail.summary server-side; the edge functions do not read audit_log)");
[EXPECT_E3, EXPECT_F2, EXPECT_B3].forEach((e) => ok(review5b.includes(e), "the item 5b section must list the probe expectation `" + e + "`"));
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-trade-audit-names\.sql/.test(review5b), "the item 5b section must carry the CLI apply line");
ok(/supersedes: sql\/migrations\/2026-09-24-definer-locks\.sql/.test(review5b), "the item 5b section must record the same-day supersedes line");
const auditRow = review.split("\n").find((l) => /^\| `audit_log` \|/.test(l)) || "";
ok(/`schedule\.claim`/.test(auditRow) && /`openshifts\.notify`/.test(auditRow) && /actor_name/.test(auditRow) && /detail\.summary/.test(auditRow), "SCHEMA-REVIEW table (a) audit_log row must keep its action list and name actor_name + detail.summary");
// The two guide pins accept the record step's wording too (report-first, applied 2026-MM-DD / applied: 2026-MM-DD ...), so only the
// schema.sql revision-m regex and the SCHEMA-REVIEW Status regex move when the orchestrator records the apply.
ok(/2026-09-24-trade-audit-names\.sql/.test(g43) && /report-first, (NOT applied|applied 2026-)/.test(g43), "guide 4.3 must carry the item 5b migration row (prepared 2026-09-24, report-first, NOT applied - or 'applied 2026-MM-DD' after the record step)");
ok(/\| `apply_trade` audit row \|/.test(g43) && /\| `claim_open_slot` audit row \|/.test(g43), "guide 4.3's item 5b table must have one row per function (apply_trade / claim_open_slot audit row)");
ok(/E3/.test(g43) && /F2/.test(g43) && /B3/.test(g43) && /applied: (_to be filled by the orchestrator_|2026-)/.test(g43.slice(g43.indexOf("2026-09-24-trade-audit-names.sql"))), "guide 4.3's item 5b bullet must name the probe cases and the 'applied: _to be filled by the orchestrator_' placeholder (or 'applied: 2026-MM-DD ...' after the record step)");

// ---- Prompt 19 (2026-09-24): give a day - shift_trade_requests.kind 'trade' | 'give' ----
// Faraz 9/24: a member offers one of his days to a named colleague, nothing comes back; the colleague accepts or declines; on
// accept it is applied exactly like a trade (apply_trade, return_day null). REPORT-FIRST (not applied; the orchestrator applies
// it after the go). Split 2026-09-24 (S1 review, major; Faraz offline - the orchestrator took the report's option (b)): the member
// return-leg refusal is NOT in this file - it would refuse the unit-tail rows of OLD installed builds - and lives in the PREPARED
// follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql (pinned in its own block below). Same-day order against B6 by its `-- supersedes:` line; B6's trade_insert_guard and
// the 9/23 trade_update_guard are frozen by sha256 above; schema.sql mirrors this file (functions AND the table lines). Pinned
// below: the file's shape, the byte identity, header revision n, the table DDL, that nothing else in either trigger body
// moved (the body with the Prompt 19 lines undone equals the frozen one, byte for byte), apply_trade untouched, the probe's new
// cases with verify-rls.sh's expected strings, verify-rls 6a's return leg, the SCHEMA-REVIEW.md record and the guide row.
step("Prompt 19: migration 2026-09-24-give-kind.sql - the kind column + two checks, trade_insert_guard + trade_update_guard (nothing else), supersedes B6, byte-identical to schema.sql, both triggers re-created, CLI apply line");
const giveMig = read(GIVE_MIGRATION);
ok(!/\r/.test(giveMig), "give-kind migration has CRLF line endings");
checkInsertGuard("give-kind migration", giveMig, true, true, false);
checkUpdateGuard("give-kind migration", giveMig, true);
eq((giveMig.match(/create or replace function/g) || []).length, 2, "the give-kind migration must define trade_insert_guard and trade_update_guard and nothing else;");
eq(Array.from(giveMig.matchAll(/^create or replace function public\.([a-z_]+)\(/gm)).map((m) => m[1]), ["trade_update_guard", "trade_insert_guard"], "the give-kind migration's two functions, in order;");
ok(!/drop function|drop table|create table|drop policy|create policy|grant |revoke /.test(giveMig.replace(/--[^\n]*/g, "")), "the give-kind migration must not drop / create a function, table or policy, nor touch a grant");
ok(!/public\.apply_trade\(|claim_open_slot|call_offers_guard|time_off_no_call_conflict|handle_new_auth_user/.test(giveMig.replace(/--[^\n]*/g, "")), "the give-kind migration's statements touch no other function - apply_trade is NOT redefined (comments may name it)");
eq((giveMig.match(/^create trigger /gm) || []).length, 2, "the give-kind migration re-creates exactly its two triggers;");
ok(/^-- supersedes: sql\/migrations\/2026-09-24-definer-locks\.sql$/m.test(giveMig), "the give-kind migration must declare `-- supersedes: sql/migrations/2026-09-24-definer-locks.sql` (same day; it re-creates B6's trade_insert_guard after B6)");
["trade_insert_guard", "trade_update_guard"].forEach((name) => {
  const a = functionText(schema, name), b = functionText(giveMig, name);
  ok(a && b && a === b, name + "(): schema.sql differs from sql/migrations/2026-09-24-give-kind.sql (keep them identical; the migration is what runs live)");
});
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-give-kind\.sql/.test(giveMig), "the give-kind migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST/.test(giveMig) && /Blast radius/.test(giveMig) && /TAIL rows/.test(giveMig), "the give-kind migration header must say it is report-first and state the blast radius (incl. the live client's one-way unit-tail rows)");
ok(/DEFERRED to the follow-up sql\/migrations\/2026-09-25-member-trade-return-leg\.sql/.test(giveMig.slice(0, giveMig.indexOf("alter table public.shift_trade_requests add column"))), "the give-kind migration header must say the member return-leg refusal is DEFERRED to the follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql");
ok(/\nnotify pgrst, 'reload schema';\n$/.test(giveMig), "the give-kind migration ends with `notify pgrst, 'reload schema';` (the client may send kind right after the apply)");
ok(/-- Revision 2026-09-24 n \(Prompt 19 give a day, sql\/migrations\/2026-09-24-give-kind\.sql, (report-first, NOT yet applied|applied 2026-)[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 n (give a day; report-first, NOT yet applied - the record step changes it to 'applied <timestamp>')");
{
  const revN = header.slice(header.indexOf("-- Revision 2026-09-24 n ")).split("\n-- Revision ")[0].replace(/\n-- /g, " ");
  ok(/member return-leg refusal[^.]*DEFERRED to the follow-up/.test(revN) && !/refuses a member 'trade' without/.test(revN), "schema.sql's revision n text must say the member return-leg refusal is DEFERRED to the follow-up (and no longer claim the guard refuses a member 'trade' without one)");
  ok(!/^-- Revision 2026-09-25 p/m.test(header), "schema.sql must NOT carry a `-- Revision 2026-09-25 p` line yet - it is planned in the follow-up file and written by the commit that records the follow-up's apply");
}

step("Prompt 19: the kind column DDL - additive, defaulted, two named checks, byte-identical in schema.sql and the migration, after the trades table");
const KIND_DDL = [
  "alter table public.shift_trade_requests add column if not exists kind text not null default 'trade';",
  "alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_kind_check;",
  "alter table public.shift_trade_requests add constraint shift_trade_requests_kind_check check (kind in ('trade','give'));",
  "alter table public.shift_trade_requests drop constraint if exists shift_trade_requests_give_one_way;",
  "alter table public.shift_trade_requests add constraint shift_trade_requests_give_one_way check (kind = 'trade' or (return_day is null and return_role is null));",
].join("\n");
[["schema.sql", schema], ["give-kind migration", giveMig]].forEach(([n, s]) => {
  ok(s.includes(KIND_DDL + "\ncomment on column public.shift_trade_requests.kind is "), n + ": the kind column DDL must read exactly `" + KIND_DDL.replace(/\n/g, " ") + "` followed by its comment");
  eq((s.match(/alter table public\.shift_trade_requests (add|drop) /g) || []).length, 5, n + ": exactly the five kind add / drop statements alter shift_trade_requests;");
});
ok(schema.indexOf(KIND_DDL) > schema.indexOf("create index if not exists trade_day_idx") && schema.indexOf(KIND_DDL) < schema.indexOf("create or replace function public.trade_update_guard()"), "schema.sql: the kind DDL sits right after the trades table's indexes and before the trade guards");
ok(!/\bkind\b/.test(schema.slice(schema.indexOf("create table if not exists public.shift_trade_requests ("), schema.indexOf("create index if not exists trade_status_idx"))), "schema.sql: the create table stays as it was (an existing table never sees a create-table column; the alter adds it, like call_periods.offer_modes)");

step("Prompt 19: nothing else in either trigger body moved (the body with the Prompt 19 lines undone equals the frozen one, byte for byte); apply_trade untouched");
// the shipped body (schema.sql = give-kind) has ONE Prompt 19 block, after the member branch; the follow-up adds the member one back
const undoInsert = (t) => t.replace(/\n  end if;\n  -- \(2026-09-24, Prompt 19\)[^\n]*\n  if new\.kind = 'give'[\s\S]*?\n  end if;\n/, "\n  end if;\n");
const undoFollowUp = (t) => t.replace(/    -- \(2026-09-24, Prompt 19\)[\s\S]*?\n    end if;\n  end if;\n  -- \(2026-09-24, Prompt 19\)[^\n]*\n  if new\.kind = 'give'[\s\S]*?\n  end if;\n/, "  end if;\n");
const undoUpdate = (t) => t.replace("new.return_role is distinct from old.return_role\n     or new.kind is distinct from old.kind then", "new.return_role is distinct from old.return_role then");
[["schema.sql", schema], ["give-kind migration", giveMig]].forEach(([n, s]) => {
  eq(undoInsert(functionText(s, "trade_insert_guard")), functionText(locksMig, "trade_insert_guard"), n + ": with the Prompt 19 lines undone textually, trade_insert_guard must equal B6's applied body byte for byte (from := me, the same-surgeon refusal and the roster names untouched);");
  eq(undoUpdate(functionText(s, "trade_update_guard")), functionText(pastMigration, "trade_update_guard"), n + ": with the kind line undone textually, trade_update_guard must equal the 9/23 applied body byte for byte (the status transitions untouched);");
});
ok(functionText(schema, "apply_trade") === functionText(auditMig, "apply_trade"), "apply_trade(): schema.sql still equals the 5b file - Prompt 19 does not redefine it");
ok(/if not \(sched or me = t\.from_surgeon_id or me = t\.to_surgeon_id\) then/.test(functionText(schema, "apply_trade")), "apply_trade's caller check admits the RECEIVER (me = t.to_surgeon_id) - the reason Prompt 19 leaves it untouched");

step("Prompt 19: trade probe GIVE_SETUP and O..U3 (after N, before the report); A / G / H / N carry a return leg; verify-rls.sh grades every case and 6a posts a return leg");
const GIVE_CASES = {
  GIVE_SETUP: "ok",
  O: "status=pending from=s2 kind=give return=null",
  P: "status=pending from=s2 kind=give",
  P2: "ERR TRADE_STALE: 2030-03-03 primary is no longer held by s2",
  Q: "status=pending return=null",   // split 2026-09-24: the same before and after the give-kind apply (the refusal is the follow-up's)
  Q2: "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift",
  Q3: "status=pending return=2030-03-04 return_role=null",   // review follow-up: a half leg - stored before and after (split 2026-09-24)
  Q4: "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift",   // review follow-up: a give carrying only a return role
  R: "ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade",
  S: "rows=0 kind=trade",
  S2: "ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade",
  S3: "rows=1 status=accepted",   // review follow-up: the receiver ACCEPTS a pending give through the changed update guard
  T: "status=applied 03-25p=s2",
  T2: "actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 25 (from Acton, one-way)",
  U: "status=pending from=s3 return=null",
  U2: "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift",
  U3: "status=pending from=s3 kind=give",
};
const reportAt = probe.indexOf("-- ---------- report + ROLL BACK EVERYTHING");
let lastCase = probe.indexOf("insert into probe_results values ('N'");
Object.keys(GIVE_CASES).forEach((k) => {
  const at = probe.indexOf("insert into probe_results values ('" + k + "'");
  ok(at > lastCase && at < reportAt, "trade probe case " + k + " must run after N (and after the case before it) and before the report");
  lastCase = at;
  const hdrLine = k === "GIVE_SETUP" ? "AFTER: GIVE_SETUP=" + GIVE_CASES[k] : k + "=" + GIVE_CASES[k];
  ok(probeHdr.includes(hdrLine), "trade probe header must state " + k + "'s AFTER value (`" + hdrLine + "`)");
  ok(new RegExp("expect_eq\\s+" + k + "\\s+\"" + GIVE_CASES[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s5), "verify-rls.sh section 5 must grade " + k + " against `" + GIVE_CASES[k] + "`");
});
ok(/BEFORE and AFTER the give-kind apply: stored\s+-> Q3=status=pending return=2030-03-04 return_role=null/.test(probeHdr) && /BEFORE: rows=0 status=null \(no fixture\)\s+AFTER: S3=/.test(probeHdr), "trade probe header must state Q3's value before AND after the give-kind apply (a half leg is stored - the refusal is the follow-up's) and S3's BEFORE (no fixture: rows=0 status=null)");
const s3Block = probe.slice(probe.indexOf("-- ---------- S3:"), probe.indexOf("-- ---------- T:"));
ok(/set status = ''accepted'' where id = ''00000000-0000-4000-8000-000000000033''/.test(s3Block) && !/set kind/.test(s3Block), "S3 must PATCH status 'accepted' (only) on the pending give ...033 as the receiver - the accept path through the changed trade_update_guard");
const q3Block = probe.slice(probe.indexOf("-- ---------- Q3:"), probe.indexOf("-- ---------- Q4:"));
ok(/\(from_surgeon_id, to_surgeon_id, day, role, return_day, status, detail\)/.test(q3Block) && /'2030-03-04', 'pending', 'probe Q3'/.test(q3Block), "Q3 must insert a member 'trade' with a return DAY and no return role (the half leg)");
const q4Block = probe.slice(probe.indexOf("-- ---------- Q4:"), probe.indexOf("-- ---------- R:"));
ok(/\(kind, from_surgeon_id, to_surgeon_id, day, role, return_role, status, detail\)/.test(q4Block) && /'give', 's2', 's3', '2030-03-27', 'primary', 'backup', 'pending', 'probe Q4'/.test(q4Block), "Q4 must insert a member 'give' carrying only a return role");
ok(/BEFORE and AFTER the give-kind apply: stored\s+-> Q=status=pending return=null/.test(probeHdr) && /U=status=pending from=s3 return=null/.test(probeHdr), "trade probe header must state Q's value before AND after the give-kind apply (stored: only the client refuses a member one-way trade until the follow-up) and U (unchanged)");
const giveSetup = probe.slice(probe.indexOf("-- ---------- GIVE_SETUP"), probe.indexOf("-- ---------- O:"));
ok(/exception when others then\n    v := 'ERR ' \|\| sqlerrm;/.test(giveSetup) && /insert into probe_results values \('GIVE_SETUP', v\);/.test(giveSetup), "the give fixtures sit in their own guarded block (BEFORE the migration it reports the missing column and every other case still runs)");
["000000000030", "000000000031", "000000000032", "000000000033", "000000000034"].forEach((id) => ok(giveSetup.includes("'00000000-0000-4000-8000-" + id + "'"), "GIVE_SETUP lacks fixture trade ..." + id + " (the leftover count keys trade.apply audit rows on '00000000-0000-4000-8000-0000000000%')"));
["P2", "R", "S", "S2", "T"].forEach((k) => ok(giveSetup.includes("'probe " + k + "')"), "GIVE_SETUP's fixture for " + k + " must carry detail 'probe " + k + "' (the leftover count keys on `detail like 'probe %'`)"));
ok(/'2030-03-25', 's3', null, false, false, 'probe', 1\)/.test(giveSetup) && /'2030-03-27', 's2', null, false, false, 'probe', 1\)/.test(giveSetup), "GIVE_SETUP's schedule_days fixtures are 2030-03 source 'probe' rows (inside section 5's leftover count)");
ok(/a\.action = 'trade\.apply' and a\.detail ->> 'trade_id' = '00000000-0000-4000-8000-000000000034'/.test(probe), "T2 must read the audit row of fixture T (...034)");
["probe A", "probe G", "probe H", "probe N"].forEach((d) => {
  const at = probe.indexOf("'" + d + "') returning id into tid;");
  const stmt = probe.slice(probe.lastIndexOf("insert into public.shift_trade_requests (", at), at);
  ok(at > 0 && /return_day, return_role/.test(stmt) && /'2030-03-04', 'backup'/.test(stmt), "trade probe case " + d.slice(6) + " must insert WITH a return leg (return 2030-03-04 backup) - a member trade without one is refused once the follow-up is applied, and the case must keep testing what it tested");
});
ok(/"return_day":"2030-03-22","return_role":"backup"/.test(vr.slice(vr.indexOf('echo "== 6.'), vr.indexOf('echo "== 7.'))), "verify-rls.sh 6a must post a return leg (a member trade without one is refused once the follow-up is applied)");

step("Prompt 19: docs/SCHEMA-REVIEW.md carries the PREPARED give-a-day section (before / after, blast radius, probe table, apply order, observed placeholder); guide 4.3 carries its row");
ok(/## 2026-09-24 - give a day: shift_trade_requests\.kind \(Prompt 19\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - give a day: shift_trade_requests.kind (Prompt 19)' section");
// bounded at the next section (the follow-up's own section comes right after it)
const review19 = (() => { const at = review.indexOf("## 2026-09-24 - give a day: shift_trade_requests.kind"), end = review.indexOf("\n## ", at + 1); return review.slice(at, end < 0 ? review.length : end); })();
ok(/^\*\*Status: (PREPARED - report-first \(not applied\)|APPLIED 2026-)[^*]*\*\*$/.test(((review19.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the Prompt 19 section's status line must read 'Status: PREPARED - report-first (not applied).' (or 'APPLIED 2026-...' after the record step)");
ok(/observed: /.test(review19), "the Prompt 19 section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
ok(review19.includes(KIND_DDL.replace(/^/gm, "    ")), "the Prompt 19 section must quote the kind DDL verbatim");
ok(review19.includes("    " + GIVE_ONE_WAY_IF) && review19.includes("      " + GIVE_ONE_WAY_RAISE), "the Prompt 19 section must quote the shipped insert-guard hunk (the give-one-way refusal) verbatim");
ok(!review19.includes(GIVE_NEEDS_RETURN_IF), "the Prompt 19 section must NOT quote the member return-leg block as part of this file - it is the follow-up's (quoted in the follow-up's own section)");
ok(/\*\*Split \(2026-09-24/.test(review19) && /old installed builds/.test(review19) && /2026-09-25-member-trade-return-leg\.sql/.test(review19) && /min_version/.test(review19), "the Prompt 19 section must state the split: why (old installed builds), what ships now, and the follow-up file with its min_version gate");
ok(review19.includes("         or new.kind is distinct from old.kind then"), "the Prompt 19 section must quote the trade_update_guard hunk");
ok(/What could break/.test(review19) && /Blast radius/.test(review19) && /Unit tails/.test(review19) && /TRADE_STALE/.test(review19), "the Prompt 19 section must state what could break (the live client's unit-tail rows), the blast radius and the give-of-someone-else's-day outcome (TRADE_STALE)");
Object.keys(GIVE_CASES).forEach((k) => ok(review19.includes("`" + GIVE_CASES[k] + "`"), "the Prompt 19 section's probe table must list " + k + "'s AFTER value `" + GIVE_CASES[k] + "`"));
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-give-kind\.sql/.test(review19) && /supersedes: sql\/migrations\/2026-09-24-definer-locks\.sql/.test(review19), "the Prompt 19 section must carry the CLI apply line and the same-day supersedes line");
ok(/2026-09-24-give-kind\.sql/.test(g43) && /Give a day \(Prompt 19, `sql\/migrations\/2026-09-24-give-kind\.sql`, prepared 2026-09-24 \u2014 report-first, (NOT applied|applied 2026-)/.test(g43), "guide 4.3 must carry the Prompt 19 bullet (prepared 2026-09-24, report-first, NOT applied - or 'applied 2026-MM-DD' after the record step)");
["shift_trade_requests.kind", "trade_insert_guard", "trade_update_guard", "apply_trade"].forEach((r) => ok(new RegExp("^\\| `" + r.replace(/\./g, "\\.") + "` \\|", "m").test(g43), "guide 4.3's Prompt 19 table lacks a row for " + r));
ok(/applied: (_to be filled by the orchestrator_|2026-)/.test(g43.slice(g43.indexOf("Give a day (Prompt 19"))), "guide 4.3's Prompt 19 bullet must end with the 'applied: _to be filled by the orchestrator_' placeholder (or 'applied: 2026-MM-DD ...')");

step("Prompt 19 review follow-up: verify-rls.sh section 5c proves PostgREST exposes shift_trade_requests.kind (anon, not JWT- or CLI-gated) - the gate before the client push");
const s5c = vr.slice(vr.indexOf('echo "== 5c.'), vr.indexOf('echo "== 6.'));
ok(vr.indexOf('echo "== 5c.') > vr.indexOf('echo "== 5.') && s5c.length > 0, "verify-rls.sh must carry section 5c between section 5 and section 6");
ok(/curl -s -o \$T\/vr5c\.json -w 'HTTP %\{http_code\}' "\$URL\/rest\/v1\/shift_trade_requests\?select=kind&limit=0" -H "apikey: \$ANON" -H "Authorization: Bearer \$ANON"/.test(s5c), "section 5c must GET shift_trade_requests?select=kind&limit=0 with the anon key (the PostgREST schema cache, which the SQL probe never touches)");
ok(/case "\$line" in "HTTP 200"\) ok /.test(s5c) && /bad "PostgREST does not expose shift_trade_requests\.kind yet/.test(s5c), "section 5c must PASS on HTTP 200 only and FAIL otherwise (400 / 42703 before the apply)");
ok(!/\bif linked\b|SILVIS_SURGEON_JWT|SILVIS_JWT/.test(s5c), "section 5c must run for every caller (an anon read: no linked-CLI or JWT gate)");
ok(/^#   bash scripts\/verify-rls\.sh +anon checks \(1-2, 5c, /m.test(vr), "verify-rls.sh usage header must list 5c among the anon checks");

step("Prompt 19 split: the give-kind file refuses nothing an old installed build sends (its unit tails keep landing as one-way 'trade' rows); the decision is recorded (option (b)); the gates stay (5c before the push, the min_version bump); table (a)'s row is in the record step");
const giveHdr = giveMig.slice(0, giveMig.indexOf("alter table public.shift_trade_requests add column"));
ok(/section 5c/.test(giveHdr) && /min_version/.test(giveHdr) && /old installed builds/.test(giveHdr) && !/Open for Faraz before the apply/.test(giveHdr), "the give-kind header's order must gate the push on 5c and bump client_versions min_version (the follow-up's precondition), say why the member refusal was split out (old installed builds), and no longer flag the decision as open");
ok(/Unit tails - no rollout window in this file/.test(review19) && /\*\*unit split\*\*/.test(review19), "the Prompt 19 section's 'What could break' must say the unit tails of old builds are NOT refused by this file (the unit-split window moved to the follow-up)");
ok(/\*\*Decision \(taken 2026-09-24: option \(b\)\)\.\*\*/.test(review19) && /\(a\) Accept the window/.test(review19) && /\(b\) Two phases, no window/.test(review19) && /\(c\) A server-side exemption/.test(review19), "the Prompt 19 section must record the rollout decision (option (b), two phases) next to the three options");
ok(/4\. the anon gate of \`verify-rls\.sh\` section 5c/.test(review19) && /5\. the Prompt 19 client push AT ONCE/.test(review19) && /6\. \`SILVIS_WORKDIR=<dir> bash scripts\/verify-rls\.sh\` in full/.test(review19) && /update public\.client_versions set min_version = '<the Prompt 19 APP_VERSION>'/.test(review19), "the Prompt 19 apply order must be: AFTER probe, the 5c gate, the client push at once, verify-rls in full after the push, the min_version bump");
ok(/table \(a\)'s \`shift_trade_requests\` row drops "prepared, not yet applied"/.test(review19), "the Prompt 19 record step must list table (a)'s shift_trade_requests row");
ok(/^\| \`shift_trade_requests\` \|[^\n]*\`kind\` \`trade\` \/ \`give\`[^\n]*Prompt 19, (prepared, not yet applied|applied 2026-)/m.test(review), "SCHEMA-REVIEW table (a)'s shift_trade_requests row must name kind and read 'Prompt 19, prepared, not yet applied' (or 'applied 2026-MM-DD' after the record step)");
ok(/section 5c \(anon \`select=kind\` reads HTTP 200/.test(g43), "guide 4.3's Prompt 19 proof must name section 5c");
{
  const g19 = g43.slice(g43.indexOf("Give a day (Prompt 19"));
  const insRow = (g19.match(/^\| `trade_insert_guard` \|[^\n]*/m) || [""])[0];
  ok(/deferred/i.test(insRow) && /2026-09-25-member-trade-return-leg\.sql/.test(insRow) && /EVERY installed app runs the client step/.test(insRow), "guide 4.3's Prompt 19 trade_insert_guard row must say the member return-leg refusal is deferred to sql/migrations/2026-09-25-member-trade-return-leg.sql (until EVERY installed app runs the client step)");
}

// Prompt 19 S5 (tests): the new kind through the PREPARED trade_insert_guard, read as behaviour. guardVerdict re-reads the
// guard's own `if <cond> then raise 'TRADE_INELIGIBLE: ...'` statements out of the function text (so a changed condition
// changes the verdict), runs the member branch's ones only for a member caller (after from := me), and answers the first
// raise or "ok". The live DB half of the same cases is the probe (O = a member give with no return leg accepted, Q = a
// member trade with none - accepted as today after the give-kind apply, refused only after the follow-up), graded by
// verify-rls.sh section 5 - those run only after the migration is applied. Split 2026-09-24: each case has TWO verdicts, the
// shipped guard's (schema.sql = give-kind) and the prepared follow-up's (sql/migrations/2026-09-25-member-trade-return-leg.sql).
step("Prompt 19 S5: the prepared trade_insert_guards, read as behaviour - a member give with no return leg is accepted by both; a member trade with no return leg (kind omitted = the 'trade' default) is ACCEPTED by the shipped give-kind guard (old builds' unit tails) and refused only by the follow-up; the live B6 guard accepted it too (Q's BEFORE); every TRADE_INELIGIBLE raise is translated (none skipped); probe O / Q run as the member caller");
const guardVerdict = (fn, caller, row) => {
  const memberAt = fn.indexOf("if not (public.silvis_is_sched() or server) then");
  const memberEnd = fn.indexOf("\n  end if;\n", fn.indexOf("new.decided_at      := null;"));
  if (memberAt < 0 || memberEnd < memberAt) throw new Error("guardVerdict: the member branch was not found");
  const r = { kind: "trade", return_day: null, return_role: null, ...row };   // the column default is 'trade' (KIND_DDL above)
  if (caller.member) r.from_surgeon_id = caller.me;                          // the member branch forces from := me first
  const toJs = (c) => c
    .replace(/new\.(\w+) is distinct from ('[^']*')/g, "(r.$1 !== $2)")
    .replace(/new\.(\w+) is not null/g, "(r.$1 != null)")
    .replace(/new\.(\w+) is null/g, "(r.$1 == null)")
    .replace(/new\.(\w+) = new\.(\w+)/g, "(r.$1 != null && r.$2 != null && r.$1 === r.$2)")   // SQL: NULL = x is NULL, never true
    .replace(/new\.(\w+) = ('[^']*')/g, "(r.$1 === $2)")
    .replace(/ and /g, " && ").replace(/ or /g, " || ");
  // S5 review: every TRADE_INELIGIBLE raise in the body must be one this evaluator reads - a refusal added in another
  // form (a coalesce(...), a local variable) would otherwise be skipped and the "ok" cases would pass without it.
  const raises = (fn.match(/raise exception 'TRADE_INELIGIBLE:/g) || []).length;
  const read = [...fn.matchAll(/\n\s*if (new\.[^\n]*?) then\n\s*raise exception '(TRADE_INELIGIBLE: [^']*)'/g)];
  if (read.length !== raises) throw new Error("guardVerdict: " + raises + " TRADE_INELIGIBLE raise(s) in the body, " + read.length + " in the form it evaluates (if new.<col> ... then raise) - extend the evaluator");
  for (const m of read) {
    if (m.index > memberAt && m.index < memberEnd && !caller.member) continue;
    const js = toJs(m[1]);
    if (/new\./.test(js)) throw new Error("guardVerdict: untranslated condition `" + m[1] + "`");
    if (Function("r", "return " + js + ";")(r)) return "ERR " + m[2];
  }
  return "ok";
};
{
  const MEMBER = { member: true, me: "s2" }, SCHED = { member: false };
  const give = functionText(schema, "trade_insert_guard"), b6 = functionText(locksMig, "trade_insert_guard");
  const followUp = functionText(read(RETURN_LEG_MIGRATION), "trade_insert_guard");
  const NEEDS = "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead";
  const ONEWAY = "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift";
  const base = { from_surgeon_id: "s2", to_surgeon_id: "s3", day: "2030-03-27", role: "primary" };
  // [what, caller, row, verdict of the shipped give-kind guard, verdict of the prepared follow-up guard]
  const CASES = [
    ["member give, no return leg (probe O)", MEMBER, { ...base, kind: "give" }, "ok", "ok"],
    ["member trade, kind omitted, no return leg (probe Q; an old build's unit tail)", MEMBER, { ...base }, "ok", NEEDS],
    ["member trade, kind 'trade', no return leg", MEMBER, { ...base, kind: "trade" }, "ok", NEEDS],
    ["member trade, half leg - return day, no role (probe Q3)", MEMBER, { ...base, return_day: "2030-03-04" }, "ok", NEEDS],
    ["member trade with a full return leg", MEMBER, { ...base, return_day: "2030-03-04", return_role: "backup" }, "ok", "ok"],
    ["member give WITH a return leg (probe Q2)", MEMBER, { ...base, kind: "give", return_day: "2030-03-04", return_role: "backup" }, ONEWAY, ONEWAY],
    ["member give carrying only a return role (probe Q4)", MEMBER, { ...base, kind: "give", return_role: "backup" }, ONEWAY, ONEWAY],
    ["member give naming someone else as from (probe P: from := me)", MEMBER, { ...base, kind: "give", from_surgeon_id: "s3", to_surgeon_id: "s4" }, "ok", "ok"],
    ["member give to himself", MEMBER, { ...base, kind: "give", to_surgeon_id: "s2" }, "ERR TRADE_INELIGIBLE: a trade needs two different surgeons", "ERR TRADE_INELIGIBLE: a trade needs two different surgeons"],
    ["scheduler one-way trade (probe U, unchanged)", SCHED, { ...base, from_surgeon_id: "s3", to_surgeon_id: "s4" }, "ok", "ok"],
    ["scheduler give (probe U3)", SCHED, { ...base, kind: "give", from_surgeon_id: "s3", to_surgeon_id: "s4" }, "ok", "ok"],
    ["scheduler give WITH a return leg (probe U2)", SCHED, { ...base, kind: "give", from_surgeon_id: "s3", to_surgeon_id: "s4", return_day: "2030-03-04", return_role: "backup" }, ONEWAY, ONEWAY],
  ];
  CASES.forEach(([what, caller, row, want]) => eq(guardVerdict(give, caller, row), want, "prepared trade_insert_guard (schema.sql = the give-kind migration): " + what + ";"));
  CASES.forEach(([what, caller, row, , wantFu]) => eq(guardVerdict(followUp, caller, row), wantFu, "prepared follow-up trade_insert_guard (sql/migrations/" + RETURN_LEG_FILE + "): " + what + ";"));
  // The live guard (B6, frozen by sha256 above) is the BEFORE: it never refused a member's one-way trade (only the client
  // did - Q's BEFORE in the probe header reads status=pending return=null) and knew no kind.
  eq(guardVerdict(b6, MEMBER, { ...base }), "ok", "the live B6 trade_insert_guard accepted a member trade with no return leg (the BEFORE the follow-up closes; the give-kind file keeps it);");
  // the evaluator refuses to grade a body with a refusal it cannot read (S5 review), and models SQL NULL in "a = b"
  let unread = null;
  try { guardVerdict(give.replace("if new.from_surgeon_id = new.to_surgeon_id then", "if coalesce(new.from_surgeon_id, '') = new.to_surgeon_id then"), MEMBER, { ...base, kind: "give" }); } catch (e) { unread = String(e.message); }
  eq(unread, "guardVerdict: 2 TRADE_INELIGIBLE raise(s) in the body, 1 in the form it evaluates (if new.<col> ... then raise) - extend the evaluator", "a TRADE_INELIGIBLE raise in another form must stop guardVerdict, not be skipped;");
  unread = null;
  try { guardVerdict(followUp.replace("if new.from_surgeon_id = new.to_surgeon_id then", "if coalesce(new.from_surgeon_id, '') = new.to_surgeon_id then"), MEMBER, { ...base, kind: "give" }); } catch (e) { unread = String(e.message); }
  eq(unread, "guardVerdict: 3 TRADE_INELIGIBLE raise(s) in the body, 2 in the form it evaluates (if new.<col> ... then raise) - extend the evaluator", "the follow-up body: a TRADE_INELIGIBLE raise in another form must stop guardVerdict too;");
  eq(guardVerdict(give, SCHED, { ...base, kind: "give", from_surgeon_id: null, to_surgeon_id: null }), "ok", "NULL = NULL is not true in SQL - the same-surgeon raise does not fire on two NULLs;");
  eq(guardVerdict(b6, MEMBER, { ...base, to_surgeon_id: "s2" }), "ERR TRADE_INELIGIBLE: a trade needs two different surgeons", "guardVerdict reads B6's same-surgeon refusal (the evaluator is not vacuous on the frozen body);");
  // The probe's O and Q are the MEMBER caller (probe_ctx 'surgeon' = s2, role surgeon) through PostgREST's role and claims
  // - not the scheduler, not the server bypass - and insert exactly the rows the cases above read.
  ok(/update public\.user_profiles set person_id = 's2', role = 'surgeon'   where id = surgeon;/.test(probe), "the probe's 'surgeon' caller must be linked to s2 with role surgeon (a member)");
  [["O", "-- ---------- O:", "-- ---------- P:", "(kind, from_surgeon_id, to_surgeon_id, day, role, status, detail)", "values ('give', 's2', 's3', '2030-03-27', 'primary', 'pending', 'probe O')"],
   ["Q", "-- ---------- Q:", "-- ---------- Q2:", "(from_surgeon_id, to_surgeon_id, day, role, status, detail)", "values ('s2', 's3', '2030-03-27', 'primary', 'pending', 'probe Q')"]].forEach(([k, from, to, cols, vals]) => {
    const blk = probe.slice(probe.indexOf(from), probe.indexOf(to));
    ok(blk.length > 0 && blk.includes("uid text := (select v from probe_ctx where k = 'surgeon');") && blk.includes("execute 'set local role authenticated';") && blk.includes("perform set_config('request.jwt.claims', '{\"sub\":\"' || uid || '\",\"role\":\"authenticated\"}', true);"), "probe case " + k + " must run as the member caller (probe_ctx 'surgeon', role authenticated, its sub in request.jwt.claims)");
    ok(blk.includes("insert into public.shift_trade_requests " + cols + "\n    " + vals + " returning id into tid;"), "probe case " + k + " must insert " + cols + " " + vals + " (no return columns" + (k === "Q" ? ", no kind - the column default 'trade'" : "") + ")");
    ok(!/probe_ctx where k = 'sched'/.test(blk), "probe case " + k + " must not switch to the scheduler caller");
  });
}

// ---- Prompt 19 follow-up (prepared 2026-09-24): the member return-leg refusal, split out of the give-kind file ----
// S1 review (major): the refusal breaks OLD installed builds during the rollout - an old build saves a member's whole-unit trade
// for one return day as a head row WITH the return leg plus tail rows WITHOUT one; refused tails leave a half-saved unit proposal
// whose head row, if accepted, applies as a unit split. So the give-kind file ships without it and this file re-creates
// trade_insert_guard with it (S1's body, byte for byte - pinned by sha256 against git show f9ad08f), REPORT-FIRST and NOT
// applied: only after a client_versions min_version bump to the Prompt 19 build and a day for old builds to drain. schema.sql
// does NOT mirror it (PREPARED_NOT_MIRRORED above); the probe's Q / Q3 refusal is this file's acceptance case - documented in the
// probe header and SCHEMA-REVIEW, never graded live by verify-rls.sh before the apply (it would fail today).
step("Prompt 19 follow-up: sql/migrations/2026-09-25-member-trade-return-leg.sql - PREPARED (report-first, NOT applied, NOT mirrored), trade_insert_guard only = S1's body (sha256), = the give-kind body plus the member block, undone = B6's");
const fuMig = read(RETURN_LEG_MIGRATION);
ok(!/\r/.test(fuMig), "the follow-up migration has CRLF line endings");
checkInsertGuard("follow-up migration", fuMig, true, true, true);
eq(Array.from(fuMig.matchAll(/^create or replace function public\.([a-z_]+)\(/gm)).map((m) => m[1]), ["trade_insert_guard"], "the follow-up re-creates trade_insert_guard and nothing else;");
eq((fuMig.match(/^create trigger /gm) || []).length, 1, "the follow-up re-creates exactly its one trigger;");
ok(!/alter table|drop function|drop table|create table|drop policy|create policy|grant |revoke |notify /.test(fuMig.replace(/--[^\n]*/g, "")), "the follow-up must not alter a table, drop / create a function, table or policy, touch a grant or reload the schema cache (no DDL: one function body)");
const fuFn = functionText(fuMig, "trade_insert_guard");
eq(crypto.createHash("sha256").update(fuFn || "").digest("hex"), S1_INSERT_GUARD_SHA256, "the follow-up's trade_insert_guard must be byte-for-byte S1's (git show f9ad08f:sql/migrations/2026-09-24-give-kind.sql);");
const MEMBER_BLOCK = "    -- (2026-09-24, Prompt 19) a member's 'trade' carries its return shift (return_day AND return_role); a one-way row from a\n    -- member is a 'give'. kind null reads as a trade here (the not-null constraint refuses it after the trigger anyway).\n    " + GIVE_NEEDS_RETURN_IF + "\n      " + GIVE_NEEDS_RETURN_RAISE + "\n    end if;\n";
eq(fuFn, functionText(giveMig, "trade_insert_guard").replace("    new.decided_at      := null;\n  end if;\n", "    new.decided_at      := null;\n" + MEMBER_BLOCK + "  end if;\n"), "the follow-up's body must be the give-kind body with ONLY the member return-leg block added (right after the normalisation, inside the member branch);");
eq(undoFollowUp(fuFn), functionText(locksMig, "trade_insert_guard"), "the follow-up's body with both Prompt 19 blocks undone must equal B6's applied body byte for byte;");
ok(!schema.includes(GIVE_NEEDS_RETURN_IF) && functionText(schema, "trade_insert_guard") !== fuFn, "schema.sql must NOT carry the member return-leg block (it mirrors what the next apply makes live - the give-kind body) until the follow-up's apply is recorded");
const fuHdr = fuMig.slice(0, fuMig.indexOf("create or replace function"));
ok(/^-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED\. NOT MIRRORED in sql\/schema\.sql until its apply is recorded\.$/m.test(fuHdr), "the follow-up header must carry the PREPARED / NOT APPLIED / NOT MIRRORED marker line");
ok(/apply only after a client_versions min_version bump to the Prompt 19 build and a day for old builds to drain/.test(fuHdr.replace(/\n-- /g, " ")), "the follow-up header must say: apply only after a client_versions min_version bump to the Prompt 19 build and a day for old builds to drain");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-25-member-trade-return-leg\.sql/.test(fuHdr), "the follow-up header must carry the CLI apply line");
ok(/Revision 2026-09-25 p/.test(fuHdr) && /test\/schema\.test\.js/.test(fuHdr) && /PREPARED_NOT_MIRRORED/.test(fuHdr), "the follow-up header must plan schema.sql's Revision 2026-09-25 p and the record step (mirror the body, empty PREPARED_NOT_MIRRORED)");
const fuHdrJoined = fuHdr.replace(/\n-- /g, " ");   // comment lines wrap: join the `-- ` continuations before matching a sentence
ok(/until EVERY client runs the Prompt 19 build/.test(fuHdrJoined) && /SPLITS the unit/.test(fuHdrJoined) && /announces the WHOLE unit/.test(fuHdrJoined) && /orphaned-head check/.test(fuHdrJoined), "the follow-up header must state the old-build window it would open if applied early (the whole unit announced, the lone head row applied as a unit split) and the orphaned-head check");
const FU_Q = "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead";
["Q", "Q3"].forEach((k) => {
  ok(fuHdr.includes(k + "=" + FU_Q), "the follow-up header must state its acceptance case " + k + "=" + FU_Q);
  ok(probeHdr.includes("AFTER the follow-up (" + RETURN_LEG_FILE + "): refused -> " + k + "=" + FU_Q), "the trade probe header must state " + k + "'s value after the follow-up (`AFTER the follow-up (" + RETURN_LEG_FILE + "): refused -> " + k + "=...`)");
});
ok(!/expect_eq\s+Q3?\s+"ERR TRADE_INELIGIBLE: a trade needs a return shift/.test(vr), "verify-rls.sh must NOT grade Q / Q3 as refused before the follow-up is applied (the live DB accepts them today - the record step of the follow-up flips them)");
step("Prompt 19 follow-up: docs/SCHEMA-REVIEW.md carries its own PREPARED section (why, the block, the window, the gate, Q / Q3, apply order with the orphaned-head check, observed placeholder); the guide row names it");
ok(/## 2026-09-25 - member trade return leg \(Prompt 19 follow-up; `sql\/migrations\/2026-09-25-member-trade-return-leg\.sql`\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-25 - member trade return leg (Prompt 19 follow-up; `sql/migrations/2026-09-25-member-trade-return-leg.sql`)' section");
const reviewFu = (() => { const at = review.indexOf("## 2026-09-25 - member trade return leg"), end = review.indexOf("\n## ", at + 1); return review.slice(at, end < 0 ? review.length : end); })();
ok(/^\*\*Status: (PREPARED - report-first \(not applied\)|APPLIED 2026-)[^*]*\*\*$/.test(((reviewFu.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the follow-up section's status line must read 'Status: PREPARED - report-first (not applied) ...' (or 'APPLIED 2026-...' after its record step)");
ok(reviewFu.includes("    " + GIVE_NEEDS_RETURN_IF) && reviewFu.includes("      " + GIVE_NEEDS_RETURN_RAISE), "the follow-up section must quote the member return-leg block verbatim");
ok(/old installed builds/.test(reviewFu) && /min_version/.test(reviewFu) && /a day for old builds to drain/.test(reviewFu), "the follow-up section must say why it waits (old installed builds) and its gate (min_version bump + a day to drain)");
ok(/Unit tails - the rollout window/.test(reviewFu) && /until EVERY client runs the Prompt 19 build/.test(reviewFu) && /\*\*unit split\*\*/.test(reviewFu) && /trade_proposed/.test(reviewFu), "the follow-up section's 'What could break' must state the old-build window and the unit-split path");
ok(reviewFu.includes("and t.detail ~ ', day 1 of [0-9]+\\]'") && reviewFu.includes("< substring(t.detail from ', day 1 of ([0-9]+)\\]')::int;"), "the follow-up's apply order must carry the orphaned-head check (a unit head row whose group has fewer rows than its stamp)");
["Q", "Q3"].forEach((k) => ok(reviewFu.includes("| `" + k + "` |") && reviewFu.includes("`" + FU_Q + "`"), "the follow-up section's probe table must list " + k + " refused (`" + FU_Q + "`)"));
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-25-member-trade-return-leg\.sql/.test(reviewFu) && /Revision 2026-09-25 p/.test(reviewFu) && /PREPARED_NOT_MIRRORED/.test(reviewFu), "the follow-up section must carry the CLI apply line and its record step (Revision 2026-09-25 p, mirror, PREPARED_NOT_MIRRORED emptied, Q / Q3 re-graded)");
ok(/observed: /.test(reviewFu), "the follow-up section must carry an 'observed:' line");

// ---- Prompt 20 F1 (2026-09-24) - followers: user_profiles.follows + notification_preferences for an unlinked account ----
// sql/migrations/2026-09-24-followers.sql (REPORT-FIRST, not applied; revision o): a viewer / coordinator account follows roster
// ids (user_profiles.follows, admin-set: the self-update / self-insert policies pin it, user_profiles_admin is the write path of
// Setup > Users) and owns a notification_preferences row by profile_id (the table's key moves from person_id to a new id; person_id
// stays UNIQUE so an upsert that names on_conflict=person_id still resolves; exactly one of person_id / profile_id is set).
// schema.sql mirrors every text byte for byte; sql/probes/followers-probe.sql rolls itself back (users keyed 'probe-follow-',
// the surgeon linked to the non-roster id 'probe-follow'); scripts/verify-rls.sh section 12 grades it.
const FOLLOW_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-followers.sql");
const FOLLOW_PROBE = path.join(ROOT, "sql", "probes", "followers-probe.sql");
const FOLLOW_SHAPE = "check (case when jsonb_typeof(follows) = 'array' then not jsonb_path_exists(follows, 'strict $[*] ? (@.type() != \"string\" || @ == \"\")') else false end)";
const FOLLOW_DDL = [   // in this order: person_id is UNIQUE before the key moves; the key moves before person_id may be null
  "alter table public.user_profiles add column if not exists follows jsonb not null default '[]'::jsonb;",
  "alter table public.user_profiles drop constraint if exists user_profiles_follows_shape;",
  "alter table public.user_profiles add constraint user_profiles_follows_shape\n  " + FOLLOW_SHAPE + ";",
  "alter table public.notification_preferences add column if not exists id uuid not null default gen_random_uuid();",
  "alter table public.notification_preferences add column if not exists profile_id uuid references public.user_profiles(id) on delete cascade;",
  "alter table public.notification_preferences drop constraint if exists notification_preferences_person_id_key;",
  "alter table public.notification_preferences add constraint notification_preferences_person_id_key unique (person_id);",
  "alter table public.notification_preferences drop constraint if exists notification_preferences_pkey;",
  "alter table public.notification_preferences add constraint notification_preferences_pkey primary key (id);",
  "alter table public.notification_preferences alter column person_id drop not null;",
  "alter table public.notification_preferences drop constraint if exists notification_preferences_profile_id_key;",
  "alter table public.notification_preferences add constraint notification_preferences_profile_id_key unique (profile_id);",
  "alter table public.notification_preferences drop constraint if exists notification_preferences_one_owner;",
  "alter table public.notification_preferences add constraint notification_preferences_one_owner\n  check (num_nonnulls(person_id, profile_id) = 1);",
];
const FOLLOW_POLICIES = {
  user_profiles_self_insert: "create policy user_profiles_self_insert on public.user_profiles for insert to authenticated\n  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb);",
  user_profiles_self_update: "create policy user_profiles_self_update on public.user_profiles for update to authenticated\n  using (id = auth.uid())\n  with check (id = auth.uid()\n    and role = (select role from public.user_profiles p where p.id = auth.uid())\n    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())\n    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())\n    and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid()));",
  prefs_own: "create policy prefs_own on public.notification_preferences for all to authenticated\n  using (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched())\n  with check (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched());",
};
const FOLLOW_TABLE_OF = { user_profiles_self_insert: "user_profiles", user_profiles_self_update: "user_profiles", prefs_own: "notification_preferences" };
const FOLLOW_CASES = ["R1", "K1", "F1", "F2", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "A1", "A2", "A3", "A4", "A5", "A6", "F3", "F4", "S1", "S2", "S3", "S4", "I1", "I2", "X1"];
const FOLLOW_AFTER = {   // the exact AFTER value of every case graded by equality (R1 is graded by grade_r1_12: ids = rows and person + profile = rows on every run; person=N profile=0 only on the apply-time run)
  K1: "pk=id unique=person_id,profile_id", F2: "updated=1", P1: "ok rows=1 schedule=false", P2: "updated=1", P3: "own=1 others=0", P4: "updated=0", P5: "deleted=0",
  A1: "updated=1 follows=[\"s2\"]", A5: "probe_rows=3", F3: "follows=[\"s2\"]", S1: "ok rows=1 schedule=false", S3: "own=1 others=0", I2: "ok follows=[]", X1: "before=1 after=0",
};
const FOLLOW_ERR = {   // [SQLSTATE, the substring the grader looks for]
  F1: ["42501", "for table \"user_profiles\""], F4: ["42501", "for table \"user_profiles\""], S4: ["42501", "for table \"user_profiles\""], I1: ["42501", "for table \"user_profiles\""],
  P6: ["42501", "for table \"notification_preferences\""], P7: ["42501", "for table \"notification_preferences\""], P8: ["42501", "for table \"notification_preferences\""],
  P9: ["23514", "notification_preferences_one_owner"], A6: ["23514", "notification_preferences_one_owner"],
  A2: ["23514", "user_profiles_follows_shape"], A3: ["23514", "user_profiles_follows_shape"], A4: ["23514", "user_profiles_follows_shape"],
  S2: ["23505", "notification_preferences_person_id_key"],
};
function checkFollowers(n, s) {
  let at = -1;
  FOLLOW_DDL.forEach((d) => {
    const i = s.indexOf(d);
    ok(i >= 0, n + ": missing DDL line:\n" + d);
    ok(i > at, n + ": DDL line out of order (person_id UNIQUE before the key moves; the key before `drop not null`):\n" + d);
    at = i;
  });
  Object.keys(FOLLOW_POLICIES).forEach((p) => {
    ok(s.indexOf("drop policy if exists " + p + " on public." + FOLLOW_TABLE_OF[p] + ";") >= 0, n + ": `drop policy if exists " + p + " on public." + FOLLOW_TABLE_OF[p] + ";` missing (idempotency)");
    ok(s.indexOf(FOLLOW_POLICIES[p]) >= 0, n + ": policy " + p + " must read exactly:\n" + FOLLOW_POLICIES[p]);
    eq((s.match(new RegExp("create policy " + p + " on public\\.", "g")) || []).length, 1, n + ": policy " + p + " must be created exactly once;");
  });
}
step("P20 F1: the followers migration file - follows + its shape check + the two pins, the notification_preferences key move, prefs_own, nothing else");
const followMig = read(FOLLOW_MIGRATION);
ok(!/\r/.test(followMig), "followers migration has CRLF line endings");
checkFollowers("followers migration", followMig);
eq((followMig.match(/^create policy /gm) || []).length, 3, "the followers migration must create exactly three policies (user_profiles_self_insert, user_profiles_self_update, prefs_own);");
eq((followMig.match(/^drop policy if exists /gm) || []).length, 3, "the followers migration must drop-if-exists exactly the three policies;");
eq((followMig.match(/^alter table /gm) || []).length, FOLLOW_DDL.length, "the followers migration's ALTER statements are exactly the pinned DDL lines;");
const followStmts = followMig.replace(/--[^\n]*/g, "");
ok(!/create or replace function|create table|drop table|drop column|create trigger|drop trigger|user_profiles_admin/.test(followStmts), "the followers migration must not define a function, create / drop a table or column, touch a trigger or re-create user_profiles_admin (the admin's write path stays as it is)");
ok(!/^\s*(insert|update|delete)\b/im.test(followStmts), "the followers migration must not write a row (every existing notification_preferences row keeps its person_id; the new columns fill by default)");
ok(/^-- supersedes: sql\/migrations\/2026-09-24-prelaunch-rls\.sql$/m.test(followMig), "the followers migration must declare `-- supersedes: sql/migrations/2026-09-24-prelaunch-rls.sql` (same day; it re-creates A1's user_profiles_self_update with the follows pin)");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-followers\.sql/.test(followMig), "the followers migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST/.test(followMig) && /Blast radius/.test(followMig), "the followers migration header must say it is report-first and state the blast radius");
ok(/select count\(\*\) from public\.notification_preferences;/.test(followMig), "the followers migration header must carry the read-only pre-count (the probe's R1 must equal it after)");
ok(/on_conflict=person_id/.test(followMig) && /DEPLOY THAT CLIENT FIRST/.test(followMig), "the followers migration header must say the client's prefs upsert names on_conflict=person_id and ships BEFORE the apply (without it PostgREST resolves the merge on the primary key, which moves to id)");
ok(/send-notification/.test(followMig) && /daily-reminder/.test(followMig), "the followers migration header must state that both edge functions' person_id reads stay valid");
ok(/user_profiles_admin/.test(followMig) && /isAdmin/.test(followMig) && /not widened to schedulers/.test(followMig), "the followers migration header must name the admin write path (user_profiles_admin; Setup > Users is isAdmin-gated) and say it is not widened to schedulers");

step("P20 F1: schema.sql mirrors the followers migration byte for byte, the from-scratch tables carry the new shape, the header records revision o");
checkFollowers("schema.sql", schema);
Object.keys(FOLLOW_POLICIES).forEach((p) => ok(policyText(schema, p) === policyText(followMig, p), "policy " + p + ": schema.sql differs from the followers migration"));
ok(/\n  follows       jsonb not null default '\[\]'::jsonb,/.test(schema.slice(schema.indexOf("create table if not exists public.user_profiles ("), schema.indexOf("create or replace function public.handle_new_auth_user()"))), "schema.sql's user_profiles create table must carry `follows jsonb not null default '[]'::jsonb` (a from-scratch schema)");
ok(schema.indexOf(FOLLOW_DDL[0]) > schema.indexOf("alter table public.user_profiles add constraint user_profiles_coordinator_unlinked") && schema.indexOf(FOLLOW_DDL[2]) < schema.indexOf("create or replace function public.handle_new_auth_user()"), "the follows DDL sits right after the user_profiles constraints, before handle_new_auth_user()");
const prefsTable = sliceBetween(schema, "create table if not exists public.notification_preferences (", "\n);");
ok(prefsTable && /\n  id                        uuid primary key default gen_random_uuid\(\),/.test(prefsTable) && /\n  person_id                 text unique,/.test(prefsTable) && /\n  profile_id                uuid unique references public\.user_profiles\(id\) on delete cascade,/.test(prefsTable) && /\n  constraint notification_preferences_one_owner check \(num_nonnulls\(person_id, profile_id\) = 1\)\n\);$/.test(prefsTable), "schema.sql's notification_preferences create table must carry id (primary key), person_id unique, profile_id unique -> user_profiles on delete cascade and the one-owner check (a from-scratch schema)");
ok(!/person_id\s+text primary key/.test(prefsTable || ""), "notification_preferences.person_id is no longer the primary key");
ok(schema.indexOf(FOLLOW_DDL[3]) > schema.indexOf("create table if not exists public.notification_preferences (") && schema.indexOf(FOLLOW_DDL[FOLLOW_DDL.length - 1]) < schema.indexOf("create table if not exists public.audit_log ("), "the notification_preferences DDL sits right after its create table, before audit_log");
ok(/-- Revision 2026-09-24 o \(Prompt 20 F1, sql\/migrations\/2026-09-24-followers\.sql, (report-first, NOT yet applied|applied 2026-)[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 o (followers; 'report-first, NOT yet applied' until the record step writes 'applied <timestamp>')");

step("P20 F1: the probe is self-rolling-back, reports the prefs row count BEFORE (PROBE_SETUP) and AFTER (R1), acts as a follower / a second follower / a surgeon / the admin, covers R1..X1");
const foProbe = read(FOLLOW_PROBE);
ok(!/\r/.test(foProbe), "followers probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(foProbe), "followers probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(foProbe) && /grant insert, select on probe_results to authenticated;/.test(foProbe), "followers probe must collect into a temp table probe_results granted to authenticated");
const foLastDo = foProbe.lastIndexOf("do $$");
ok(foLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(foProbe.slice(foLastDo)), "followers probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
FOLLOW_CASES.forEach((k) => ok(foProbe.indexOf("values ('" + k + "'") >= 0, "followers probe lacks case " + k));
ok(/raise exception 'PROBE_SETUP: user_profiles\.follows \/ notification_preferences\.profile_id are absent - sql\/migrations\/2026-09-24-followers\.sql is not applied \(this is the BEFORE picture\) - notification_preferences rows=%', n;/.test(foProbe), "the BEFORE picture is the PROBE_SETUP raise, and it carries the notification_preferences row count (rows=N)");
ok(foProbe.indexOf("values ('R1'") < foProbe.indexOf("insert into auth.users"), "R1 (the row count AFTER) is taken before any fixture row exists");
ok(/'probe-follow-' \|\| [a-z_]+ \|\| '@example\.test'/.test(foProbe), "followers probe's throwaway auth users must be probe-follow-<uuid>@example.test (the leftover count keys on it)");
ok(/set person_id = 'probe-follow', role = 'surgeon'/.test(foProbe) && /set role = 'admin'/.test(foProbe), "followers probe links its surgeon to the NON-roster id 'probe-follow' (no live prefs row is touched even inside the rolled-back batch) and makes an admin");
ok(/on conflict \(person_id\) do update/.test(foProbe) && /on conflict \(id\) do update/.test(foProbe) && /on conflict \(profile_id\) do update/.test(foProbe), "S1 upserts on person_id (the client's on_conflict=person_id), S2 on the primary key (what PostgREST does without on_conflict), P1 on profile_id (the follower's own row)");
ok(/'\[\["s2"\]\]'/.test(foProbe), "A4 must try a nested array (the strict jsonpath refuses it; lax mode would unwrap it)");
ok(/delete from auth\.users where id = /.test(foProbe) && /delete from public\.user_profiles where id = /.test(foProbe), "X1 deletes the follower's auth user (his prefs row cascades) and I1 / I2 start from a deleted profile row (the self-insert door)");
ok(/'ERR ' \|\| sqlstate \|\| ' ' \|\| replace\(sqlerrm, ';', ','\)/.test(foProbe) && /get diagnostics n = row_count;/.test(foProbe), "followers probe records the SQLSTATE with each error and observes UPDATE / DELETE row counts (RLS filters silently)");
const foHeader = foProbe.slice(0, foProbe.indexOf("create temp table probe_results"));
Object.keys(FOLLOW_AFTER).forEach((k) => ok(foHeader.indexOf(FOLLOW_AFTER[k]) > 0, "followers probe header must state " + k + "'s AFTER string `" + FOLLOW_AFTER[k] + "`"));
Object.keys(FOLLOW_ERR).forEach((k) => ok(foHeader.indexOf(FOLLOW_ERR[k][1]) > 0, "followers probe header must state " + k + "'s AFTER refusal (`" + FOLLOW_ERR[k][1] + "`)"));
ok(/rows=N person=N profile=0 ids=N/.test(foHeader), "followers probe header must state R1's AFTER shape (rows=N person=N profile=0 ids=N)");
ok(/person \+ profile = rows/.test(foHeader) && /ids = rows/.test(foHeader), "followers probe header must state R1's lasting invariants (ids = rows, person + profile = rows) - the apply-time shape stops holding once a follower saves prefs");
ok(!/set local role anon/.test(foProbe) && !/'2030-/.test(foProbe), "followers probe has no anon case (prefs has no anon policy) and no schedule fixture day");

step("P20 F1: verify-rls.sh section 12 - the client's on_conflict pin, the probe graded case by case (R1 by shape, optionally against SILVIS_PREFS_ROWS_BEFORE), leftovers counted, nothing written over REST");
ok(/^echo "== 12\. /m.test(vr), "verify-rls.sh has no section 12");
const s12 = vr.slice(vr.indexOf('echo "== 12. '));
ok(s12.length > 0 && s12.length < vr.length, "verify-rls.sh section 12 could not be sliced out");
ok(/followers-probe\.sql/.test(s12), "section 12 must run sql/probes/followers-probe.sql through the linked CLI");
FOLLOW_CASES.filter((k) => k !== "R1").forEach((k) => ok(new RegExp("expect_(eq|err)12\\s+" + k + "\\s").test(s12), "section 12 does not grade probe case " + k));
Object.keys(FOLLOW_AFTER).forEach((k) => ok(s12.indexOf(FOLLOW_AFTER[k].replace(/"/g, '\\"')) > 0, "section 12 must expect " + k + " = " + FOLLOW_AFTER[k]));
Object.keys(FOLLOW_ERR).forEach((k) => ok(new RegExp("expect_err12\\s+" + k + "\\s+" + FOLLOW_ERR[k][0] + "\\s").test(s12), "section 12 must grade " + k + " as ERR " + FOLLOW_ERR[k][0]));
// R1 counts every live prefs row, so after the first follower saves prefs it reads e.g. rows=7 person=6 profile=1 ids=7 on a
// healthy table (review 9/24, major): graded by grade_r1_12 - invariants on every run, the strict picture only on the apply-time run.
const r1Start = s12.indexOf("\ngrade_r1_12() {\n");
const r1Fn = r1Start >= 0 ? s12.slice(r1Start + 1, s12.indexOf("\n}\n", r1Start) + 3) : "";
const r1Cases = [
  ["rows=7 person=6 profile=1 ids=7", "", "OK"],    // a follower has saved prefs: healthy on every later run
  ["rows=6 person=6 profile=0 ids=6", "", "OK"],
  ["rows=6 person=6 profile=0 ids=6", "6", "OK"],   // the apply-time run
  ["rows=7 person=6 profile=1 ids=7", "6", "BAD"],  // the apply-time run: no follower row can exist yet
  ["rows=5 person=5 profile=0 ids=5", "6", "BAD"],  // a row lost by the key move
  ["rows=7 person=6 profile=0 ids=7", "", "BAD"],   // a row with no owner
  ["rows=7 person=7 profile=0 ids=6", "", "BAD"],   // two rows share an id
  ["", "", "BAD"],
  ["PROBE_SETUP", "", "BAD"],
];
const r1Script = 'ok() { echo "OK $*"; }\nbad() { echo "BAD $*"; }\n' + r1Fn + r1Cases.map(([v, b]) => 'echo "== case"\ngrade_r1_12 ' + JSON.stringify(v) + " " + JSON.stringify(b)).join("\n") + "\n";
const r1Run = require("child_process").spawnSync("bash", ["-c", r1Script], { encoding: "utf8" });
ok(!r1Run.error, "bash could not be started to run grade_r1_12: " + (r1Run.error && r1Run.error.message));
const r1Out = (r1Run.stdout || "").split("== case\n").slice(1);
r1Cases.forEach(([v, b, want], i) => {
  const o = r1Out[i] || "";
  const got = /^BAD /m.test(o) ? "BAD" : (/^OK /m.test(o) ? "OK" : "none");
  ok(got === want, "grade_r1_12 '" + v + "' SILVIS_PREFS_ROWS_BEFORE='" + b + "': expected " + want + ", got " + got + " (" + (o.trim() || (r1Run.stderr || "").trim().slice(0, 200)) + ")");
});
ok(s12.indexOf("person=\\1 profile=0") < 0, "section 12 must not grade R1 by the apply-time shape alone (rows = person, profile 0) - it goes red once a follower saves prefs");
ok(s12.indexOf('grade_r1_12 "$(case_val12 R1)" "${SILVIS_PREFS_ROWS_BEFORE:-}"') > 0, "section 12 must grade R1 with grade_r1_12, passing SILVIS_PREFS_ROWS_BEFORE");
ok(/SILVIS_PREFS_ROWS_BEFORE/.test(s12) && /SILVIS_PREFS_ROWS_BEFORE/.test(vr.slice(0, vr.indexOf('echo "== 1.'))), "section 12 compares R1 with SILVIS_PREFS_ROWS_BEFORE when set, and the file header documents the variable");
ok(/PROBE_SETUP: user_profiles\.follows/.test(s12) && /notification_preferences rows=/.test(s12), "section 12 must name the BEFORE picture (PROBE_SETUP) and print its row count");
ok(/email like 'probe-follow-%@example\.test'/.test(s12) && /person_id = 'probe-follow'/.test(s12) && /LEFT ROWS BEHIND/.test(s12), "section 12 must count leftovers (auth.users probe-follow-*, prefs person_id 'probe-follow') and report them as a failure");
const s12write = s12.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const s12curl = s12write.split("\n").filter((l) => /\bcurl /.test(l));
ok(s12curl.length === 2 && s12curl.every((l) => /curl -s -o "\$T\/vr12-[a-z]+\.[a-z]+" -w '%\{http_code\}' "\$PAGES\/(config\.js|index\.html)\?vr=\$\$"/.test(l) && !/ -X | -d | -H /.test(l)), "section 12's only curls are two anon GETs of the live Pages client (config.js, index.html) - nothing is written over REST:\n" + s12curl.join("\n"));
ok(/^PAGES="https:\/\/fkhan628\.github\.io\/Silvis-Call-Schedule"$/m.test(s12), "section 12 must name the live Pages origin (PAGES=...)");
ok(s12.indexOf("grep -qF 'on_conflict=${encodeURIComponent(opts.onConflict)}' \"$T/vr12-config.js\"") > 0 && s12.indexOf("grep -qF 'onConflict: \"person_id\"' \"$T/vr12-index.html\"") > 0, "section 12a' must check the LIVE client (the served config.js sends on_conflict, the served index.html names onConflict: \"person_id\")");
ok(/do NOT apply/.test(s12), "section 12a' must say the migration may not be applied while the live client lacks the pin");
ok(s12.indexOf('db.upsert("notification_preferences", row, { onConflict: "person_id" })') > 0, "section 12a must check the client's prefs upsert names on_conflict=person_id");

step("P20 F1: docs - SCHEMA-REVIEW.md PREPARED section (before / after, blast radius, probe table, apply order, observed placeholder), tables (a) / (b), guide 4.3 row");
ok(/## 2026-09-24 - followers: user_profiles\.follows \+ notification_preferences for an unlinked account \(Prompt 20 F1\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - followers: user_profiles.follows + notification_preferences for an unlinked account (Prompt 20 F1)' section");
const reviewF1 = review.slice(review.indexOf("## 2026-09-24 - followers:"));
ok(/^\*\*Status: (PREPARED - report-first \(not applied\)|APPLIED 2026-)/.test(((reviewF1.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the F1 section's status line must read 'Status: PREPARED - report-first (not applied)' (or 'APPLIED 2026-...' after the record step)");
ok(/observed: /.test(reviewF1), "the F1 section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
Object.keys(FOLLOW_POLICIES).forEach((p) => ok(reviewF1.includes(FOLLOW_POLICIES[p].replace(/\n  /g, "\n      ")), "the F1 section must quote the AFTER text of " + p + " verbatim (indented as a code block)"));
FOLLOW_CASES.forEach((k) => ok(new RegExp("^\\| `" + k + "` \\|", "m").test(reviewF1), "the F1 probe table lacks a row for " + k));
ok(/Blast radius/.test(reviewF1) && /send-notification/.test(reviewF1) && /daily-reminder/.test(reviewF1) && /on_conflict=person_id/.test(reviewF1), "the F1 section must state the blast radius, both edge functions' person_id reads and the client's on_conflict=person_id");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-followers\.sql/.test(reviewF1) && /followers-probe\.sql/.test(reviewF1), "the F1 section must carry the CLI apply line and the probe command");
ok(/client first/i.test(reviewF1) && /SILVIS_PREFS_ROWS_BEFORE/.test(reviewF1), "the F1 section's apply order must put the client (on_conflict=person_id) first and carry the BEFORE count into verify-rls");
ok(/verify-rls\.sh[^\n]*12a'/.test(reviewF1) && /min_version/.test(reviewF1.slice(reviewF1.indexOf("**Apply order.**"), reviewF1.indexOf("Rolling back"))), "the F1 apply order must observe the live client (verify-rls 12a') and decide client_versions.min_version as an explicit step");
ok(!/delete from public\.notification_preferences where person_id is null/.test(reviewF1) && /select count\(\*\) from public\.notification_preferences where person_id is null/.test(reviewF1.slice(reviewF1.indexOf("Rolling back"))), "the F1 rollback must start from a read-only guard (count of follower prefs rows must be 0), never a silent delete of followers' prefs");
ok(/person \+ profile = rows/.test(reviewF1), "the F1 probe table must state R1's lasting invariants (ids = rows, person + profile = rows)");
ok(/select=\*&person_id=in\.\(\.\.\.\)/.test(reviewF1) && /select=\*&person_id=in\.\(\.\.\.\)/.test(followMig), "the F1 section and the migration header must describe daily-reminder's day-before read as select=*&person_id=in.(...)");
ok(/user_profiles_admin/.test(reviewF1) && /scheduler/.test(reviewF1), "the F1 section must say which policy lets the admin write follows (user_profiles_admin) and why a non-admin scheduler is not added");
const tblA = review.slice(review.indexOf("## (a) "), review.indexOf("## (b) "));
const tblB = review.slice(review.indexOf("## (b) "), review.indexOf("## (c) "));
ok(/^\| `user_profiles` \|[^\n]*follows/m.test(tblA) && /^\| `notification_preferences` \|[^\n]*profile_id/m.test(tblA), "SCHEMA-REVIEW table (a) must name user_profiles.follows and notification_preferences.profile_id");
ok(/^\| `notification_preferences` \|[^\n]*profile_id/m.test(tblB) && /^\| `user_profiles` \|[^\n]*follows/m.test(tblB), "SCHEMA-REVIEW table (b) must name the prefs profile_id clause and the follows pin");
ok(/2026-09-24-followers\.sql/.test(g43) && /report-first, (NOT applied|applied 2026-)/.test(g43.slice(g43.indexOf("2026-09-24-followers.sql") - 400)), "guide 4.3 must carry the Prompt 20 F1 bullet (report-first, NOT applied - or 'applied 2026-MM-DD' after the record step)");
["user_profiles.follows", "user_profiles_self_update", "user_profiles_self_insert", "notification_preferences` key", "prefs_own"].forEach((p) => ok(new RegExp("^\\| `" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m").test(g43.slice(g43.indexOf("2026-09-24-followers.sql"))), "guide 4.3's F1 table lacks a row for " + p));
ok(/applied: (_to be filled by the orchestrator_|2026-)/.test(g43.slice(g43.indexOf("2026-09-24-followers.sql"))), "guide 4.3's F1 bullet must carry the 'applied: _to be filled by the orchestrator_' placeholder");

// ---- Prompt 20 R1 (rebase onto Prompt 19, 9/25) - Faraz's decisions on the Followers file are recorded; the file ships in ONE rollout
// with the member return-leg follow-up, and the two never touch the same object (followers: user_profiles / notification_preferences;
// the follow-up: trade_insert_guard() and its trigger trade_insert_guard_trg on shift_trade_requests only).
const reviewF1Only = reviewF1.slice(0, reviewF1.indexOf("\n## ", 5) > 0 ? reviewF1.indexOf("\n## ", 5) : undefined);
const decF1 = reviewF1Only.slice(reviewF1Only.indexOf("**Decisions (Faraz 9/25).**"));
ok(reviewF1Only.indexOf("**Decisions (Faraz 9/25).**") > 0 && decF1.indexOf("**What could break.**") > 0, "the Followers section must carry the Decisions (Faraz 9/25) paragraph, before What could break");
ok(/\*\*Followers get the publish e-mail\*\* - yes/.test(decF1) && /\*\*The self-insert pin stays\*\*/.test(decF1) && /keeps clearing `follows`/.test(decF1) && /\*\*One rollout\*\*[^]*2026-09-25-member-trade-return-leg\.sql/.test(decF1), "the three decisions and the one rollout with the member return-leg follow-up");
ok(!/decision needed/i.test(reviewF1Only) && !/decision needed/i.test(guide), "no decision-needed wording left");
ok(/Decisions \(Faraz 9\/25/.test(g43.slice(g43.indexOf("2026-09-24-followers.sql"))), "guide 4.3 records the decisions beside the Followers row");
{
  const fol = fs.readFileSync(FOLLOW_MIGRATION, "utf8").replace(/--[^\n]*/g, "");
  const fu = fs.readFileSync(path.join(ROOT, "sql", "migrations", "2026-09-25-member-trade-return-leg.sql"), "utf8").replace(/--[^\n]*/g, "");
  ok(!/trade_insert_guard|shift_trade_requests|apply_trade/.test(fol), "the followers migration touches no trade object (the member return-leg follow-up owns trade_insert_guard)");
  ok(!/user_profiles|notification_preferences/.test(fu), "the member return-leg follow-up touches no followers object");
}
{
  // review R1: the ordered steps the orchestrator follows must carry the decided gate, not the old either/or
  const ao = reviewF1Only.slice(reviewF1Only.indexOf("**Apply order.**"), reviewF1Only.indexOf("Rolling back"));
  ok(!/or leave it and record/.test(ao) && !/Either way the choice/.test(ao), "the F1 apply order must no longer offer leaving min_version as it is (Faraz 9/25: bump it)");
  ok(/raise `client_versions\.min_version` \(decided, Faraz 9\/25/.test(ao) && /24 h have passed/.test(ao) && /every heartbeat in Client versions/.test(ao) && /report instead of applying/.test(ao), "the F1 apply order must raise min_version, then wait 24 h with every heartbeat of the last 24 h on that build or newer, else report instead of applying");
  ok(/member trade return leg/.test(ao) && /ONE rollout/.test(ao), "the F1 apply order must name the member return-leg follow-up applied in the same rollout");
  ok(/re-creates its trigger `trade_insert_guard_trg`/.test(decF1), "the no-overlap sentence must name the follow-up's trigger re-create, not 'trade_insert_guard() only'");
}
console.log("- P20 R1: Faraz 9/25 decisions recorded (publish mail yes, the self-insert pin kept, follows cleared on a role change); one rollout with the member return-leg follow-up, no shared object");

console.log("schema.test.js: " + N + " assertions passed");
