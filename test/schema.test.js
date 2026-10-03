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
//     the follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql (report-first; applied 2026-09-27 00:43:01Z by the
//     24-hour gate, after the client_versions min_version bump and a day for old builds to drain) - schema.sql mirrors it since its
//     record step (revision p; until then it was the one file exempt from the mirror pin, by name); its body is S1's (f9ad08f), pinned by sha256,
//   - trade_update_guard(): kind joins the TRADE_IMMUTABLE leg list; the rest is the 9/23 trade-past body byte for byte,
//   - apply_trade() untouched (the receiver already applies a one-way row as a party); the file declares `-- supersedes:` B6;
//     B6's trade_insert_guard and the 9/23 trade_update_guard are frozen by sha256; the probe gains GIVE_SETUP and O..U.
// Prompt 21 step 1 (2026-09-25, Faraz - sql/migrations/2026-09-25-audit-read-own.sql, REPORT-FIRST; applied 2026-09-27 00:49:39Z
//   after the 24-hour gate): audit_read_own lets a user read back the audit rows he wrote, so logAudit's INSERT ... RETURNING (db.insert,
//   Prefer: return=representation) stops failing 42501 for a linked surgeon; the policy text exactly as approved, the three
//   existing audit policies byte-unchanged, schema.sql's mirror + revision q, the rolled-back probe (RETURNING and PostgREST's
//   return=representation shape as a surgeon / a coordinator / a viewer; CLI and 'cron' rows stay unread), verify-rls.sh
//   section 13 (run against a faked CLI), C21, and the apply order (rebase after the gate's record commit; 403 reconciliation).
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
const GIVE_MIGRATION = path.join(ROOT, "sql", "migrations", "2026-09-24-give-kind.sql");   // Prompt 19 (applied 2026-09-25): the newest for trade_update_guard; its trade_insert_guard is frozen (sha256) since the follow-up
const RETURN_LEG_FILE = "2026-09-25-member-trade-return-leg.sql";   // Prompt 19 follow-up: applied 2026-09-27 00:43:01Z, mirrored in schema.sql (revision p) - the newest for trade_insert_guard
// sha256 of the give-kind file's trade_insert_guard, frozen as applied 2026-09-25 (live until the follow-up's apply, 2026-09-27)
const GIVE_INSERT_GUARD_SHA256 = "edb1945657e5dbd392cc291a0ef5d1feca25f327a2c4ba95a55f98cced49e1aa";
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
// `needsReturn` = true for the follow-up 2026-09-25-member-trade-return-leg.sql (the member return-leg refusal, deferred out of
// the give-kind file for the old installed builds' unit tails; applied 2026-09-27) and for schema.sql, which mirrors it since its
// record step - the give-kind file, frozen as applied, must NOT carry it.
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
step("trade_insert_guard() + BEFORE INSERT trigger in schema.sql (the member return-leg refusal mirrored since the follow-up's record step)");
checkInsertGuard("schema.sql", schema, true, true, true);

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

step("2026-09-22 migration: both bodies frozen as applied live (sha256); schema.sql's trade_insert_guard = the 2026-09-25 member return-leg follow-up (Prompt 19, the newest touching it; applied 2026-09-27)");
(function frozen() {
  const sha = (t) => crypto.createHash("sha256").update(t || "").digest("hex");
  eq(sha(functionText(migration, "apply_trade")), "d9ec012b9265b8a7fe4f6db7242165e181709d58f824bdf72a793a7c9d908737",
    "2026-09-22-trade-guards.sql apply_trade() must stay byte-for-byte what was applied live on 2026-09-22 (a change belongs in a NEW migration);");
  eq(sha(functionText(migration, "trade_insert_guard")), "b2b5e23fe401765241523846131265825bdcca18bcfb41f1d328d54729357a5b",
    "2026-09-22-trade-guards.sql trade_insert_guard() must stay byte-for-byte what was applied live on 2026-09-22 (the roster names went into the 2026-09-24 migration);");
  const a = functionText(schema, "trade_insert_guard"), b = functionText(read(RETURN_LEG_MIGRATION), "trade_insert_guard");
  ok(a && b && a === b, "trade_insert_guard(): schema.sql differs from sql/migrations/" + RETURN_LEG_FILE + " (the newest migration touching it, applied 2026-09-27; keep them identical)");
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
// Prompt 19 split (2026-09-24): a prepared file may be exempt from the mirror, by name, while it waits for a gate (the member
// return-leg follow-up was, from 9/24 until its apply was recorded: it had to wait for a client_versions min_version bump and for
// old installed builds to drain, so schema.sql mirrored what the NEXT apply made live, the give-kind body). The exemption holds
// only while the file says it is not applied and schema.sql's header records it as NOT MIRRORED. The follow-up's record step
// (applied 2026-09-27 00:43:01Z) mirrored its body, added Revision 2026-09-25 p and emptied this list; the pin below compares
// schema.sql with it like any other file.
const PREPARED_NOT_MIRRORED = [];
const PREPARED_MARKER = /^-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED\. NOT MIRRORED in sql\/schema\.sql until its apply is recorded\.$/m;
PREPARED_NOT_MIRRORED.forEach((f) => {
  ok(migFiles.includes(f), "sql/migrations/" + f + " is listed as PREPARED_NOT_MIRRORED but does not exist");
  ok(PREPARED_MARKER.test(migText[f] || ""), "sql/migrations/" + f + " is exempt from the schema.sql mirror only while its header reads `-- PREPARED FOLLOW-UP - REPORT-FIRST, NOT APPLIED. NOT MIRRORED in sql/schema.sql until its apply is recorded.`");
  ok(schema.slice(0, schema.indexOf("create extension if not exists pgcrypto;")).split("\n").some((l) => l.includes("sql/migrations/" + f) && /PREPARED FOLLOW-UP, NOT MIRRORED/.test(l)), "schema.sql's header must record sql/migrations/" + f + " on a `PREPARED FOLLOW-UP, NOT MIRRORED` line while it is exempt from the mirror");
});
// ... and the other way round (the marker-line pin, moved here by the follow-up's record step): a file NOT on the list carries no
// PREPARED FOLLOW-UP marker, and schema.sql's header names no file on a NOT MIRRORED line - a marker left behind would claim an
// exemption the suite no longer grants.
migFiles.filter((f) => !PREPARED_NOT_MIRRORED.includes(f)).forEach((f) => ok(!/^-- PREPARED FOLLOW-UP/m.test(migText[f]), "sql/migrations/" + f + " carries a `-- PREPARED FOLLOW-UP` marker line but is not listed in PREPARED_NOT_MIRRORED (drop the marker at its record step, or list the file while it waits)"));
ok(!schema.slice(0, schema.indexOf("create extension if not exists pgcrypto;")).split("\n").some((l) => /PREPARED FOLLOW-UP, NOT MIRRORED/.test(l) && !PREPARED_NOT_MIRRORED.some((f) => l.includes("sql/migrations/" + f))), "schema.sql's header carries a `PREPARED FOLLOW-UP, NOT MIRRORED` line for a file that is not exempt (its record step replaces the line with its Revision line)");
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
function checkOfferRpcs(n, s, coord, np) {
  // coord = the Prompt 16 A7 texts (a coordinator may relay for another person; the 2026-09-23 rpc migration keeps the older texts)
  // np = the Prompt 28 save_offers text (seven arguments, the save_no_primary call, the offers-side NP009) - schema.sql only;
  // the 2026-09-23 and coordinator files stay frozen as applied (np false)
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
  checkSaveOffers(n, s, coord, np);
}
// pin moved deliberately 10/1 (Prompt 28): the save_offers half of checkOfferRpcs is its own function, because the no-primary
// migration re-creates save_offers (and adds save_no_primary) without set_offer_mode. np = the Prompt 28 text: the seven-argument
// signature and grants, the save_no_primary call (guarded by the cardinality condition, after the office-relay flag is cleared and
// before set_offer_mode), the offers-side NP009 after it, no availability write, the np_* return keys. Kept intent: every older
// pin reads as before for np = false (the 2026-09-23 and coordinator files, frozen as applied).
const NP_SAVE_CALL = "  if coalesce(cardinality(p_np_add), 0) + coalesce(cardinality(p_np_clear), 0) > 0 then\n    np := public.save_no_primary(who, p_np_add, p_np_clear);\n  end if;";
function checkSaveOffers(n, s, coord, np) {
  const save = functionText(s, "save_offers");
  ok(save, n + ": no `create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[])` ... `end $$;` block");
  if (save) {
    ok((np ? /^create or replace function public\.save_offers\(p_person text, p_rows jsonb, p_clear date\[\], p_period uuid default null, p_mode text default null, p_np_add date\[\] default null, p_np_clear date\[\] default null\) returns jsonb\nlanguage plpgsql security invoker set search_path = public as \$\$/ : /^create or replace function public\.save_offers\(p_person text, p_rows jsonb, p_clear date\[\], p_period uuid default null, p_mode text default null\) returns jsonb\nlanguage plpgsql security invoker set search_path = public as \$\$/).test(save),
      n + ": save_offers must be `returns jsonb`, `language plpgsql security invoker set search_path = public` with the optional p_period / p_mode" + (np ? " / p_np_add / p_np_clear (Prompt 28)" : "") + " (the combined days + mode Save; RLS + OF001-OF003 apply per row)");
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
    if (np) {
      ok(save.includes("  return jsonb_build_object('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by,\n                            'source', v_src, 'mode', p_mode, 'np_added', coalesce((np->>'added')::int, 0),\n                            'np_cleared', coalesce((np->>'cleared')::int, 0), 'np_kept', coalesce((np->>'kept')::int, 0));"),
        n + ": return shape must be {ok, person_id, upserted, deleted, entered_by, source, mode, np_added, np_cleared, np_kept} (the np keys 0 when no day was sent)");
      ok(/\n  np        jsonb;\n  v_name    text;\n/.test(save), n + ": save_offers declares np jsonb and v_name text (Prompt 28)");
      const flagOff = save.indexOf("if coord then perform set_config('silvis.office_relay', '', true); end if;");
      const callAt = save.indexOf(NP_SAVE_CALL);
      const modeAt2 = save.indexOf("perform public.set_offer_mode(p_period, p_mode, who);");
      ok(callAt > 0 && callAt > insertAt && callAt > flagOff && callAt < modeAt2, n + ": the no-primary days go through `np := public.save_no_primary(who, p_np_add, p_np_clear);`, guarded by the cardinality condition, after the upsert and the office-relay flag is cleared, before set_offer_mode (one transaction: a refusal there rolls the offer rows back too)");
      eq((save.match(/public\.save_no_primary\(/g) || []).length, 1, n + ": save_offers calls save_no_primary exactly once;");
      const np9 = save.match(raiseRe("NO_PRIMARY_OFFER_CONFLICT", "NP009"));
      const np9At = np9 ? save.indexOf(np9[0]) : -1;
      ok(np9At > callAt && np9At < modeAt2, n + ": the offers-side NP009 (a day this Save offers as primary / either that carries a backup_only row afterwards) is raised after the save_no_primary call and before set_offer_mode");
      ok(save.includes("raise exception 'NO_PRIMARY_OFFER_CONFLICT: % offers primary on % and marks it No primary - keep one of the two (nothing was saved)', v_name, bad using errcode = 'NP009';"), n + ": the offers-side NP009 carries the shared message");
      ok(save.includes("   where o.person_id = who and o.role_pref in ('primary', 'either')\n     and o.day in (select (r->>'day')::date from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r)\n     and exists (select 1 from public.availability a\n                  where a.person_id = who and a.kind = 'backup_only' and o.day between a.start_date and a.end_date);"),
        n + ": NP009 on the offers side reads only the days THIS Save offers (p_rows) as primary / either, against any backup_only row of the person (single or range)");
      eq((save.match(/using errcode = 'NP0/g) || []).length, 1, n + ": save_offers raises one NP code itself (NP009; the others are save_no_primary's);");
      ok(!/(insert into|update|delete from) public\.availability/.test(save), n + ": save_offers never writes availability itself (it reads it; the definer sibling writes)");
      // review 10/1 (closes SCHEMA-REVIEW residual 5): save_no_primary's per-person advisory lock, taken once, after the OS checks
      // and before the first write - this Save's NP009 read and a concurrent mark of the same person serialise
      const lockAt = save.indexOf("  perform pg_advisory_xact_lock(hashtext('availability:no_primary:' || who));");
      const osEnd = save.indexOf("using errcode = 'OS003';\n  end if;\n  -- Prompt 28 (review 10/1): save_no_primary's per-person lock, before the first write");
      ok(osEnd > save.indexOf("using errcode = 'OS004'") && save.indexOf("using errcode = 'OS004'") > 0 && lockAt > osEnd && lockAt < firstWrite, n + ": save_offers takes save_no_primary's per-person advisory lock after the OS checks and before its first write (residual 5 closed)");
      eq((save.match(/pg_advisory_xact_lock\(/g) || []).length, 1, n + ": save_offers takes exactly one advisory lock;");
    } else {
      ok(/return jsonb_build_object\('ok', true, 'person_id', who, 'upserted', n_up, 'deleted', n_del, 'entered_by', v_by, 'source', v_src, 'mode', p_mode\);/.test(save),
        n + ": return shape must be {ok, person_id, upserted, deleted, entered_by, source, mode}");
      ok(!/save_no_primary|p_np_|NP00/.test(save), n + ": the frozen pre-Prompt-28 text carries no no-primary parameter, call or code");
    }
  }
  if (np) {
    ok(/revoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text, date\[\], date\[\]\) from public;\nrevoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text, date\[\], date\[\]\) from anon;\ngrant execute on function public\.save_offers\(text, jsonb, date\[\], uuid, text, date\[\], date\[\]\) to authenticated;/.test(s),
      n + ": save_offers grants (seven-argument signature): revoke from public and anon, grant execute to authenticated");
    ok(!/save_offers\(text, jsonb, date\[\], uuid, text\)\s+(from|to|is)\b/.test(s), n + ": no grant / revoke / comment may name the dropped five-argument save_offers");
  } else {
    ok(/revoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) from public;\nrevoke all on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) from anon;\ngrant execute on function public\.save_offers\(text, jsonb, date\[\], uuid, text\) to authenticated;/.test(s),
      n + ": save_offers grants (five-argument signature): revoke from public and anon, grant execute to authenticated");
  }
  ok(!/save_offers\(text, jsonb, date\[\]\)\s+(from|to)\b/.test(s), n + ": no grant / revoke may still name the three-argument save_offers (it does not exist)");
}
step("P14 P3a: schema.sql carries set_offer_mode() + save_offers() (placement after the call_offers guards, header revision line)");
checkOfferRpcs("schema.sql", schema, true, true);   // Prompt 16 A7: schema.sql mirrors the coordinator migration's set_offer_mode; Prompt 28: the no-primary migration's save_offers
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
checkOfferRpcs("rpc migration", rpcMig, false, false);
eq((rpcMig.match(/create or replace function/g) || []).length, 2, "the rpc migration must define set_offer_mode and save_offers and nothing else;");
ok(!/drop table|create table|alter table|create policy|drop policy|create trigger/.test(rpcMig), "the rpc migration must be additive (no table / policy / trigger changes)");
// the ONE drop allowed: save_offers' earlier three-argument draft (never applied live) - so no second overload can
// ever leave PostgREST unable to resolve rpc/save_offers
eq((rpcMig.match(/drop function/g) || []).length, 1, "the rpc migration may drop exactly one function (the never-applied three-argument save_offers);");
ok(/^drop function if exists public\.save_offers\(text, jsonb, date\[\]\);\ncreate or replace function public\.save_offers\(/m.test(rpcMig), "the drop must be `drop function if exists public.save_offers(text, jsonb, date[]);` right before the create");
// pin moved deliberately 10/1 (Prompt 28): the section carries exactly ONE drop, the five-argument save_offers, directly before the
// save_offers create - a wholesale re-run on a database that still has the five-argument function must not leave two overloads
// (PGRST203). Kept intent: no other drop in the offers-RPC section.
{
  const rpcSection = schema.slice(schema.indexOf("create or replace function public.set_offer_mode("), schema.indexOf("create table if not exists public.notifications ("));
  eq((rpcSection.match(/drop function/g) || []).length, 1, "schema.sql's offers-RPC section carries exactly one drop (the five-argument save_offers, Prompt 28);");
  ok(/^drop function if exists public\.save_offers\(text, jsonb, date\[\], uuid, text\);\ncreate or replace function public\.save_offers\(/m.test(rpcSection), "schema.sql: the one drop is `drop function if exists public.save_offers(text, jsonb, date[], uuid, text);` directly before the save_offers create");
}
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
// pin moved deliberately (Prompt 29): schema.sql's self-insert carries the APP clause `and not is_app` since revision v
// (sql/migrations/2026-10-02-app-call-days.sql); kept intent: a self-insert lands as viewer, unlinked, following nobody.
ok(schema.indexOf("create policy user_profiles_self_insert on public.user_profiles for insert to authenticated\n  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb and not is_app);") > 0, "schema.sql: user_profiles_self_insert lands as viewer, unlinked, (Prompt 20 F1) following nobody and (Prompt 29) not an APP");
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
const s10 = vr.slice(vr.indexOf('echo "== 10. '), vr.indexOf('echo "== 14. ') > 0 ? vr.indexOf('echo "== 14. ') : vr.length);   // bounded at the call pay section (2026-09-27), whose anon POST must be refused
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
checkOfferRpcs("coordinator migration", coordMig, true, false);   // np false: frozen as applied (Prompt 28 re-creates save_offers in its own file)
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
// pin moved deliberately 10/1 (Prompt 28): save_offers leaves this list - sql/migrations/2026-10-01-no-primary-days.sql re-creates it
// (seven arguments) and is now the newest migration touching it; schema.sql's save_offers / save_no_primary are pinned against that
// file in the Prompt 28 block below. Kept intent: set_offer_mode still mirrors the coordinator migration byte for byte.
["set_offer_mode"].forEach((name) => ok(functionText(schema, name) === functionText(coordMig, name), name + "(): schema.sql differs from the coordinator migration (the newest migration touching it)"));
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
// C21's AFTER string is the picture after Prompt 21 step 1 (sql/migrations/2026-09-25-audit-read-own.sql): own_other=1 - the
// coordinator reads its own 'probe.coord' row through audit_read_own (own_other=0 was audit_read_coord alone; pinned below).
["ok created_by=self", "ok entered_by=self source=office-relay", "own_family=1 others=0 own_other=1", "user_profiles_coordinator_unlinked", "TRADE_FORBIDDEN", "closed on 2030-07-20", "OS004 OFFERS_UNKNOWN_PERSON: zz is not a roster id", "OM007 MODE_UNKNOWN_PERSON: zz is not a roster id"].forEach((s) => ok(coProbe.slice(0, coProbe.indexOf("create temp table")).indexOf(s) > 0, "coordinator probe header must state the AFTER string `" + s + "`"));
ok(/save_offers\('zz', /.test(coProbe) && /set_offer_mode\(o::uuid, 'preferred', 'zz'\)/.test(coProbe), "C26 / C27 must relay for 'zz' (not a roster id) through save_offers and set_offer_mode as the coordinator");

step("P16 A7: verify-rls.sh section 11 - the client gates, the probe graded case by case, leftovers counted, nothing written over REST");
ok(/^echo "== 11\. /m.test(vr), "verify-rls.sh has no section 11");
const s11 = vr.slice(vr.indexOf('echo "== 11. '), vr.indexOf('echo "== 12. ') > vr.indexOf('echo "== 11. ') ? vr.indexOf('echo "== 12. ') : vr.length);   // section 12a' reads the live Pages client (Prompt 20 F1)
ok(s11.length > 0 && s11.length < vr.length, "verify-rls.sh section 11 could not be sliced out");
ok(/coordinator-probe\.sql/.test(s11), "section 11 must run sql/probes/coordinator-probe.sql through the linked CLI");
COORD_CASES.forEach((k) => ok(new RegExp("expect_(eq|err)11\\s+" + k + "\\s").test(s11), "section 11 does not grade probe case " + k));
["ok created_by=self", "ok entered_by=self source=office-relay", "ok entered_by=scheduler source=email-relay", "own_family=1 others=0 own_other=1", "own=1 leak=0 sched_ok=t", "ON_CALL_CONFLICT", "TRADE_FORBIDDEN", "MODE_FROZEN", "closed on 2030-07-20", "42501", "23514", "user_profiles_coordinator_unlinked", "updated=0", "deleted=0", "contacts=0", "visible=0", "OFFERS_UNKNOWN_PERSON", "MODE_UNKNOWN_PERSON"].forEach((c) => ok(s11.indexOf(c) > 0, "section 11 must expect " + c));
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
// accept it is applied exactly like a trade (apply_trade, return_day null). REPORT-FIRST (applied 2026-09-25 05:34 UTC by the
// orchestrator after the go). Split 2026-09-24 (S1 review, major; Faraz offline - the orchestrator took the report's option (b)): the member
// return-leg refusal is NOT in this file - it would refuse the unit-tail rows of OLD installed builds - and lives in the
// follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql (applied 2026-09-27; pinned in its own block below). Same-day order against B6 by its `-- supersedes:` line; B6's trade_insert_guard and
// the 9/23 trade_update_guard are frozen by sha256 above; schema.sql mirrors this file's trade_update_guard and table lines, and
// its trade_insert_guard until the follow-up's record step (frozen by sha256 below since, now that it is no longer the newest). Pinned
// below: the file's shape, the byte identity, header revision n, the table DDL, that nothing else in either trigger body
// moved (the body with the Prompt 19 lines undone equals the frozen one, byte for byte), apply_trade untouched, the probe's new
// cases with verify-rls.sh's expected strings, verify-rls 6a's return leg, the SCHEMA-REVIEW.md record and the guide row.
step("Prompt 19: migration 2026-09-24-give-kind.sql - the kind column + two checks, trade_insert_guard (frozen as applied, sha256) + trade_update_guard (byte-identical to schema.sql) (nothing else), supersedes B6, both triggers re-created, CLI apply line");
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
{
  const a = functionText(schema, "trade_update_guard"), b = functionText(giveMig, "trade_update_guard");
  ok(a && b && a === b, "trade_update_guard(): schema.sql differs from sql/migrations/2026-09-24-give-kind.sql (keep them identical; the migration is what runs live)");
  // the follow-up's record step (2026-09-27): schema.sql's trade_insert_guard is the follow-up's, and this file's stays frozen as applied
  eq(crypto.createHash("sha256").update(functionText(giveMig, "trade_insert_guard") || "").digest("hex"), GIVE_INSERT_GUARD_SHA256, "the give-kind file's trade_insert_guard must stay byte-for-byte what was applied live on 2026-09-25 (the member return-leg refusal belongs to sql/migrations/" + RETURN_LEG_FILE + ");");
  ok(functionText(schema, "trade_insert_guard") === functionText(read(RETURN_LEG_MIGRATION), "trade_insert_guard") && functionText(schema, "trade_insert_guard") !== functionText(giveMig, "trade_insert_guard"), "trade_insert_guard(): schema.sql mirrors the member return-leg follow-up (the newest touching it), not the give-kind file");
}
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-24-give-kind\.sql/.test(giveMig), "the give-kind migration header must carry the CLI apply line for the orchestrator");
ok(/REPORT-FIRST/.test(giveMig) && /Blast radius/.test(giveMig) && /TAIL rows/.test(giveMig), "the give-kind migration header must say it is report-first and state the blast radius (incl. the live client's one-way unit-tail rows)");
ok(/DEFERRED to the follow-up sql\/migrations\/2026-09-25-member-trade-return-leg\.sql/.test(giveMig.slice(0, giveMig.indexOf("alter table public.shift_trade_requests add column"))), "the give-kind migration header must say the member return-leg refusal is DEFERRED to the follow-up sql/migrations/2026-09-25-member-trade-return-leg.sql");
ok(/\nnotify pgrst, 'reload schema';\n$/.test(giveMig), "the give-kind migration ends with `notify pgrst, 'reload schema';` (the client may send kind right after the apply)");
ok(/-- Revision 2026-09-24 n \(Prompt 19 give a day, sql\/migrations\/2026-09-24-give-kind\.sql, (report-first, NOT yet applied|applied 2026-)[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-24 n (give a day; report-first, NOT yet applied - the record step changes it to 'applied <timestamp>')");
{
  const revN = header.slice(header.indexOf("-- Revision 2026-09-24 n ")).split("\n-- Revision ")[0].replace(/\n-- /g, " ");
  ok(/member return-leg refusal[^.]*DEFERRED to the follow-up/.test(revN) && !/refuses a member 'trade' without/.test(revN), "schema.sql's revision n text must say the member return-leg refusal is DEFERRED to the follow-up (and no longer claim the guard refuses a member 'trade' without one)");
  // written by the commit that records the follow-up's apply (2026-09-27), in place of the PREPARED FOLLOW-UP, NOT MIRRORED line
  ok(/^-- Revision 2026-09-25 p \(Prompt 19 follow-up, sql\/migrations\/2026-09-25-member-trade-return-leg\.sql, applied 2026-09-27 00:43:01Z\)/m.test(header), "schema.sql must carry `-- Revision 2026-09-25 p (Prompt 19 follow-up, sql/migrations/2026-09-25-member-trade-return-leg.sql, applied 2026-09-27 00:43:01Z)` (the follow-up's record step)");
  ok(!/^-- PREPARED FOLLOW-UP, NOT MIRRORED/m.test(header), "schema.sql's header must no longer carry the PREPARED FOLLOW-UP, NOT MIRRORED line (revision p replaced it)");
  ok(header.search(/^-- Revision 2026-09-25 p /m) > header.search(/^-- Revision 2026-09-24 o /m), "revision p follows revision o in schema.sql's header");
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
// the give-kind body has ONE Prompt 19 block, after the member branch (undoInsert); the follow-up - live since 2026-09-27 and
// mirrored in schema.sql since its record step - adds the member one back (undoFollowUp undoes both)
const undoInsert = (t) => t.replace(/\n  end if;\n  -- \(2026-09-24, Prompt 19\)[^\n]*\n  if new\.kind = 'give'[\s\S]*?\n  end if;\n/, "\n  end if;\n");
const undoFollowUp = (t) => t.replace(/    -- \(2026-09-24, Prompt 19\)[\s\S]*?\n    end if;\n  end if;\n  -- \(2026-09-24, Prompt 19\)[^\n]*\n  if new\.kind = 'give'[\s\S]*?\n  end if;\n/, "  end if;\n");
const undoUpdate = (t) => t.replace("new.return_role is distinct from old.return_role\n     or new.kind is distinct from old.kind then", "new.return_role is distinct from old.return_role then");
[["schema.sql", schema, undoFollowUp], ["give-kind migration", giveMig, undoInsert]].forEach(([n, s, undo]) => {
  eq(undo(functionText(s, "trade_insert_guard")), functionText(locksMig, "trade_insert_guard"), n + ": with the Prompt 19 lines undone textually, trade_insert_guard must equal B6's applied body byte for byte (from := me, the same-surgeon refusal and the roster names untouched);");
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
  // Q / Q3: stored before and after the give-kind apply (split 2026-09-24); refused since the follow-up's apply (2026-09-27, its record step flipped them)
  Q: "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead",
  Q2: "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift",
  Q3: "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead",   // review follow-up: a half leg
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
// the give-kind section's table records what THAT file made live: Q / Q3 stored (their refused value is the follow-up section's)
const GIVE_FILE_AFTER = Object.assign({}, GIVE_CASES, { Q: "status=pending return=null", Q3: "status=pending return=2030-03-04 return_role=null" });
Object.keys(GIVE_FILE_AFTER).forEach((k) => ok(review19.includes("`" + GIVE_FILE_AFTER[k] + "`"), "the Prompt 19 section's probe table must list " + k + "'s AFTER value `" + GIVE_FILE_AFTER[k] + "` (the give-kind file's AFTER)"));
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
  ok(/applied 2026-09-27/.test(insRow) && !/NOT applied/.test(insRow), "guide 4.3's Prompt 19 trade_insert_guard row must record the follow-up's apply (2026-09-27) - the follow-up's record step");
}

// Prompt 19 S5 (tests): the new kind through the trade_insert_guards, read as behaviour. guardVerdict re-reads the
// guard's own `if <cond> then raise 'TRADE_INELIGIBLE: ...'` statements out of the function text (so a changed condition
// changes the verdict), runs the member branch's ones only for a member caller (after from := me), and answers the first
// raise or "ok". The live DB half of the same cases is the probe (O = a member give with no return leg accepted, Q = a
// member trade with none - accepted after the give-kind apply, refused since the follow-up's), graded by verify-rls.sh
// section 5. Split 2026-09-24: each case has TWO verdicts, the give-kind file's (live 2026-09-25 -> 2026-09-27, frozen by
// sha256) and the follow-up's (sql/migrations/2026-09-25-member-trade-return-leg.sql, live since 2026-09-27 00:43:01Z; schema.sql
// mirrors it since its record step).
step("Prompt 19 S5: the trade_insert_guards, read as behaviour - a member give with no return leg is accepted by both; a member trade with no return leg (kind omitted = the 'trade' default) was ACCEPTED by the give-kind guard (old builds' unit tails) and is refused by the follow-up (schema.sql's since its record step); the B6 guard accepted it too (Q's BEFORE); every TRADE_INELIGIBLE raise is translated (none skipped); probe O / Q run as the member caller");
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
  const give = functionText(giveMig, "trade_insert_guard"), b6 = functionText(locksMig, "trade_insert_guard");   // the give-kind file's body (frozen as applied)
  const followUp = functionText(read(RETURN_LEG_MIGRATION), "trade_insert_guard");
  const NEEDS = "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead";
  const ONEWAY = "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift";
  const base = { from_surgeon_id: "s2", to_surgeon_id: "s3", day: "2030-03-27", role: "primary" };
  // [what, caller, row, verdict of the give-kind file's guard, verdict of the follow-up's guard (= schema.sql's)]
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
  CASES.forEach(([what, caller, row, want]) => eq(guardVerdict(give, caller, row), want, "give-kind trade_insert_guard (sql/migrations/2026-09-24-give-kind.sql, frozen as applied): " + what + ";"));
  CASES.forEach(([what, caller, row, , wantFu]) => eq(guardVerdict(followUp, caller, row), wantFu, "follow-up trade_insert_guard (sql/migrations/" + RETURN_LEG_FILE + ", applied 2026-09-27): " + what + ";"));
  CASES.forEach(([what, caller, row, , wantFu]) => eq(guardVerdict(functionText(schema, "trade_insert_guard"), caller, row), wantFu, "schema.sql's trade_insert_guard (the follow-up's since its record step): " + what + ";"));
  // The B6 guard (frozen by sha256 above) was the BEFORE of Prompt 19: it never refused a member's one-way trade (only the client
  // did - Q's BEFORE in the probe header reads status=pending return=null) and knew no kind.
  eq(guardVerdict(b6, MEMBER, { ...base }), "ok", "the B6 trade_insert_guard accepted a member trade with no return leg (the BEFORE the follow-up closed; the give-kind file kept it);");
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

// ---- Prompt 19 follow-up (prepared 2026-09-24, applied 2026-09-27): the member return-leg refusal, split out of the give-kind file ----
// S1 review (major): the refusal breaks OLD installed builds during the rollout - an old build saves a member's whole-unit trade
// for one return day as a head row WITH the return leg plus tail rows WITHOUT one; refused tails leave a half-saved unit proposal
// whose head row, if accepted, applies as a unit split. So the give-kind file shipped without it and this file re-creates
// trade_insert_guard with it (S1's body, byte for byte - pinned by sha256 against git show f9ad08f), REPORT-FIRST, applied only
// after a client_versions min_version bump to the Prompt 19 build and a day for old builds to drain: the 24-hour gate applied it
// 2026-09-27 00:43:01Z (probe Q / Q3 refused, the other 32 cases unchanged). Its record step mirrored it into schema.sql
// (revision p), emptied PREPARED_NOT_MIRRORED and made verify-rls.sh section 5 grade Q / Q3 refused by default.
step("Prompt 19 follow-up: sql/migrations/2026-09-25-member-trade-return-leg.sql - APPLIED 2026-09-27 and mirrored (revision p), trade_insert_guard only = S1's body (sha256), = the give-kind body plus the member block, undone = B6's");
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
ok(schema.includes(GIVE_NEEDS_RETURN_IF) && functionText(schema, "trade_insert_guard") === fuFn, "schema.sql must carry the member return-leg block - it mirrors the follow-up since its apply was recorded (2026-09-27)");
const fuHdr = fuMig.slice(0, fuMig.indexOf("create or replace function"));
ok(!/^-- PREPARED FOLLOW-UP/m.test(fuHdr) && /^-- APPLIED 2026-09-27 00:43:01Z by the 24-hour gate \(run by hand\); sql\/schema\.sql mirrors it as Revision 2026-09-25 p since the record step\.$/m.test(fuHdr), "the follow-up header's PREPARED / NOT APPLIED / NOT MIRRORED marker line is gone; its place reads `-- APPLIED 2026-09-27 00:43:01Z by the 24-hour gate (run by hand); sql/schema.sql mirrors it as Revision 2026-09-25 p since the record step.`");
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
// 24-hour gate (Faraz 9/25): the REFUSED grading of Q / Q3 lived behind SILVIS_RETURN_LEG_APPLIED=1 for the gate's run right after the
// return-leg apply (Q / Q3 were graded STORED by default until then). The follow-up's record step (2026-09-27) made REFUSED the
// only grading and dropped the variable - from the file header, --help and section 5 alike.
{
  ok(!/SILVIS_RETURN_LEG_APPLIED/.test(vr), "verify-rls.sh no longer reads or documents SILVIS_RETURN_LEG_APPLIED (the follow-up's record step dropped it)");
  const REFUSED_RL = "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead";
  ["Q", "Q3"].forEach((k) => {
    eq((s5.match(new RegExp("^\\s*expect_eq\\s+" + k + "\\s", "gm")) || []).length, 1, "section 5 grades " + k + " exactly once (no second, STORED grading behind a variable);");
    ok(s5.includes("expect_eq         " + k + " \"" + REFUSED_RL + "\""), "section 5 must grade " + k + " refused with the migration's exact sentence, by default");
    ok(read(path.join(ROOT, "sql", "migrations", "2026-09-25-member-trade-return-leg.sql")).includes(REFUSED_RL.replace("ERR ", "")), "the graded sentence must be the return-leg migration's own");
  });
  ok(!/expect_eq\s+Q3?\s+"status=pending return=/.test(vr), "verify-rls.sh must no longer grade Q / Q3 STORED (the live DB refuses them since 2026-09-27 00:43:01Z)");
}
step("Prompt 19 follow-up: docs/SCHEMA-REVIEW.md carries its own section (why, the block, the window, the gate, Q / Q3, apply order with the orphaned-head check, APPLIED status + observed line, the gate's TRADE_PAST date note); the guide row names it");
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
// the record step (2026-09-27): the status line, the observed line, and the gate's procedure note on the TRADE_PAST date
{
  ok(((reviewFu.match(/\*\*Status: [^*]*\*\*/) || [""])[0]) === "**Status: APPLIED 2026-09-27 00:43:01Z.**", "the follow-up section's status line must read `**Status: APPLIED 2026-09-27 00:43:01Z.**` (its record step)");
  const obsFu = (reviewFu.match(/^observed: .*$/m) || [""])[0];
  ok(!/_to be filled/.test(obsFu) && /applied 2026-09-27 00:43:01/.test(obsFu) && obsFu.includes("`Q=" + FU_Q + "`") && /RETURN-LEG APPLY ACCEPTED/.test(obsFu) && /0 rows/.test(obsFu) && /192 passed, 0 failed/.test(obsFu), "the follow-up section's observed line must carry the apply time, Q refused (AFTER), RETURN-LEG APPLY ACCEPTED, the orphaned-head check's 0 rows and verify-rls 192 / 0");
  const note = reviewFu.slice(reviewFu.indexOf("**Gate procedure note"));
  ok(reviewFu.indexOf("**Gate procedure note") > 0 && /TRADE_PAST/.test(note) && /BOTH sides/.test(note) && /expect_past/.test(note) && note.includes("(<date>)"), "the follow-up section must carry the gate procedure note: a comparison of probe runs from different days blanks the Central date inside TRADE_PAST on both sides (verify-rls already grades I / K by token + day, expect_past)");
}

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
// `superseded` (Prompt 29): policies a later migration re-creates - their verbatim text is pinned there (the APP call days block
// below re-creates user_profiles_self_insert / _self_update with the is_app clause); the drop-if-exists and created-once counts stay.
const FOLLOW_SUPERSEDED_BY_P29 = ["user_profiles_self_insert", "user_profiles_self_update"];
function checkFollowers(n, s, superseded) {
  let at = -1;
  FOLLOW_DDL.forEach((d) => {
    const i = s.indexOf(d);
    ok(i >= 0, n + ": missing DDL line:\n" + d);
    ok(i > at, n + ": DDL line out of order (person_id UNIQUE before the key moves; the key before `drop not null`):\n" + d);
    at = i;
  });
  Object.keys(FOLLOW_POLICIES).forEach((p) => {
    ok(s.indexOf("drop policy if exists " + p + " on public." + FOLLOW_TABLE_OF[p] + ";") >= 0, n + ": `drop policy if exists " + p + " on public." + FOLLOW_TABLE_OF[p] + ";` missing (idempotency)");
    if (!(superseded || []).includes(p)) ok(s.indexOf(FOLLOW_POLICIES[p]) >= 0, n + ": policy " + p + " must read exactly:\n" + FOLLOW_POLICIES[p]);
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
// pins moved deliberately (Prompt 29): schema.sql mirrors sql/migrations/2026-10-02-app-call-days.sql for user_profiles_self_insert /
// _self_update (the followers texts plus the is_app clause, and the APP display_name clause in _self_update - pinned verbatim in
// the APP call days block below); prefs_own is still
// compared with the followers migration, and the followers file keeps its own texts and pins.
checkFollowers("schema.sql", schema, FOLLOW_SUPERSEDED_BY_P29);
Object.keys(FOLLOW_POLICIES).filter((p) => !FOLLOW_SUPERSEDED_BY_P29.includes(p)).forEach((p) => ok(policyText(schema, p) === policyText(followMig, p), "policy " + p + ": schema.sql differs from the followers migration"));
ok(/\n  follows       jsonb not null default '\[\]'::jsonb,/.test(schema.slice(schema.indexOf("create table if not exists public.user_profiles ("), schema.indexOf("create or replace function public.handle_new_auth_user()"))), "schema.sql's user_profiles create table must carry `follows jsonb not null default '[]'::jsonb` (a from-scratch schema)");
ok(schema.indexOf(FOLLOW_DDL[0]) > schema.indexOf("alter table public.user_profiles add constraint user_profiles_coordinator_unlinked") && schema.indexOf(FOLLOW_DDL[2]) < schema.indexOf("create or replace function public.handle_new_auth_user()"), "the follows DDL sits right after the user_profiles constraints, before handle_new_auth_user()");
const prefsTable = sliceBetween(schema, "create table if not exists public.notification_preferences (", "\n);");
ok(prefsTable && /\n  id                        uuid primary key default gen_random_uuid\(\),/.test(prefsTable) && /\n  person_id                 text unique,/.test(prefsTable) && /\n  profile_id                uuid unique references public\.user_profiles\(id\) on delete cascade,/.test(prefsTable) && /\n  constraint notification_preferences_one_owner check \(num_nonnulls\(person_id, profile_id\) = 1\)\n\);$/.test(prefsTable), "schema.sql's notification_preferences create table must carry id (primary key), person_id unique, profile_id unique -> user_profiles on delete cascade and the one-owner check (a from-scratch schema)");
ok(!/person_id\s+text primary key/.test(prefsTable || ""), "notification_preferences.person_id is no longer the primary key");
ok(schema.indexOf(FOLLOW_DDL[3]) > schema.indexOf("create table if not exists public.notification_preferences (") && schema.indexOf(FOLLOW_DDL[FOLLOW_DDL.length - 1]) < schema.indexOf("create table if not exists public.audit_log ("), "the notification_preferences DDL sits right after its create table, before audit_log");
// tightened to the applied wording by the record step (2026-09-27, the 24-hour gate), as revision m's pin was at its record step
ok(/-- Revision 2026-09-24 o \(Prompt 20 F1, sql\/migrations\/2026-09-24-followers\.sql, applied 2026-09-27 00:43:54Z[^)]*\)/.test(schema) && !/^-- Revision 2026-09-24 o [^\n]*NOT yet applied/m.test(schema), "schema.sql header must record revision 2026-09-24 o (followers) as 'applied 2026-09-27 00:43:54Z' (the record step; it read 'report-first, NOT yet applied' before)");

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
const s12 = vr.slice(vr.indexOf('echo "== 12. '), vr.indexOf('echo "== 13. ') > vr.indexOf('echo "== 12. ') ? vr.indexOf('echo "== 13. ') : vr.length);   // section 13 is Prompt 21 step 1's (audit read-back)
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
ok(s12curl.length === 3 && s12curl.every((l) => /curl -s -o "\$T\/vr12-[a-z]+\.[a-z]+" -w '%\{http_code\}' "\$PAGES\/(config\.js|index\.html|helpers\.js)\?vr=\$\$"/.test(l) && !/ -X | -d | -H /.test(l)), "section 12's only curls are three anon GETs of the live Pages client (config.js, index.html, helpers.js - P20 R2) - nothing is written over REST:\n" + s12curl.join("\n"));
ok(/^PAGES="https:\/\/fkhan628\.github\.io\/Silvis-Call-Schedule"$/m.test(s12), "section 12 must name the live Pages origin (PAGES=...)");
ok(s12.indexOf("grep -qF 'on_conflict=${encodeURIComponent(opts.onConflict)}' \"$T/vr12-config.js\"") > 0 && s12.indexOf("grep -qF 'db.upsert(\"notification_preferences\", req.row, { onConflict: req.onConflict })' \"$T/vr12-config.js\"") > 0 && s12.indexOf("grep -qF '? { onConflict: \"person_id\", row: { person_id: personId' \"$T/vr12-helpers.js\"") > 0 && s12.indexOf("tr -d ' \\r\\n' < \"$T/vr12-index.html\" | grep -qF 'notifPrefsDb.save({personId}'") > 0, "section 12a' must check the LIVE client (P20 R2: the served config.js sends on_conflict through notifPrefsDb.save, the served helpers.js builds a surgeon's row with on_conflict=person_id, the served index.html saves a surgeon through notifPrefsDb.save({ personId })");
ok(/do NOT apply/.test(s12), "section 12a' must say the migration may not be applied while the live client lacks the pin");
ok(s12.indexOf("grep -qF 'notifPrefsDb.save({ personId }' index-source.html") > 0 && s12.indexOf("grep -qF 'db.upsert(\"notification_preferences\", req.row, { onConflict: req.onConflict })' config.js") > 0 && s12.indexOf("grep -qF '? { onConflict: \"person_id\", row: { person_id: personId' helpers.js") > 0, "section 12a must check the client's prefs upsert names on_conflict=person_id (P20 R2: index-source.html notifPrefsDb.save({ personId }, config.js notifPrefsDb.save's db.upsert, helpers.js notifPrefSaveRequest)");
ok(s12.indexOf('db.upsert("notification_preferences", row, { onConflict: "person_id" })') < 0 && s12.indexOf("grep -qF 'onConflict: \"person_id\"' \"$T/vr12-index.html\"") < 0, "section 12a / 12a' must no longer grep the pre-R2 inline upsert (index-source.html / the served index.html no longer carry it)");

step("P20 F1: docs - SCHEMA-REVIEW.md PREPARED section (before / after, blast radius, probe table, apply order, observed placeholder), tables (a) / (b), guide 4.3 row");
ok(/## 2026-09-24 - followers: user_profiles\.follows \+ notification_preferences for an unlinked account \(Prompt 20 F1\)/.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-24 - followers: user_profiles.follows + notification_preferences for an unlinked account (Prompt 20 F1)' section");
// Bounded at the next "## " heading (review fix, Prompt 21 step 1): the audit read-back section that follows carries its own
// probe table (P1, S1-S7, A1, A2 ...), an 'observed:' line and 'Blast radius', which would otherwise satisfy the F1 pins below.
const reviewF1 = (() => { const at = review.indexOf("## 2026-09-24 - followers:"), end = review.indexOf("\n## ", at + 1); return at < 0 ? "" : review.slice(at, end < 0 ? review.length : end); })();
ok(/^\*\*Status: (PREPARED - report-first \(not applied\)|APPLIED 2026-)/.test(((reviewF1.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the F1 section's status line must read 'Status: PREPARED - report-first (not applied)' (or 'APPLIED 2026-...' after the record step)");
ok(/observed: /.test(reviewF1), "the F1 section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
// the record step (2026-09-27, the 24-hour gate): the status line and the observed line (BEFORE sentinel with its row count, AFTER R1, verify-rls)
{
  ok(((reviewF1.match(/\*\*Status: [^*]*\*\*/) || [""])[0]) === "**Status: APPLIED 2026-09-27 00:43:54Z.**", "the F1 section's status line must read `**Status: APPLIED 2026-09-27 00:43:54Z.**` (its record step)");
  const obsF1 = (reviewF1.match(/^observed: .*$/m) || [""])[0];
  ok(!/_to be filled/.test(obsF1) && /applied 2026-09-27 00:43:54/.test(obsF1) && /notification_preferences rows=2`/.test(obsF1) && /`R1=rows=2 person=2 profile=0 ids=2`/.test(obsF1) && /192 passed, 0 failed/.test(obsF1) && /leftover 0/.test(obsF1), "the F1 observed line must carry the apply time, the BEFORE sentinel with its row count (2), R1 AFTER with the same count, verify-rls 192 / 0 and the leftover count");
}
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
ok(!/Prompt 20 F1 \(prepared/.test(tblA + tblB) && (tblA + tblB).split("\n").filter((l) => /Prompt 20 F1 \(applied 2026-09-27/.test(l)).length === 4, "SCHEMA-REVIEW tables (a) / (b): the four Prompt 20 F1 notes drop 'prepared' and read 'applied 2026-09-27' (the record step)");
{
  // the bullet line itself (a slice around the file name also reaches the Prompt 19 bullet above it); tightened at the record step
  const f1Bullet = (g43.match(/^- \*\*Followers \(Prompt 20 F1, [^\n]*/m) || [""])[0];
  ok(/`sql\/migrations\/2026-09-24-followers\.sql`/.test(f1Bullet) && /report-first, applied 2026-09-27 00:43 UTC/.test(f1Bullet) && !/NOT applied/.test(f1Bullet), "guide 4.3 must carry the Prompt 20 F1 bullet reading 'report-first, applied 2026-09-27 00:43 UTC' (the record step; it read 'report-first, NOT applied' before)");
}
["user_profiles.follows", "user_profiles_self_update", "user_profiles_self_insert", "notification_preferences` key", "prefs_own"].forEach((p) => ok(new RegExp("^\\| `" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "m").test(g43.slice(g43.indexOf("2026-09-24-followers.sql"))), "guide 4.3's F1 table lacks a row for " + p));
{
  const f1Proof = (g43.match(/^Proof: `sql\/probes\/followers-probe\.sql`[^\n]*/m) || [""])[0];
  ok(/applied: 2026-09-27 00:43:54 UTC/.test(f1Proof) && !/_to be filled/.test(f1Proof), "guide 4.3's F1 Proof line must carry 'applied: 2026-09-27 00:43:54 UTC ...' (the record step filled the placeholder)");
}

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

step("P20 R2 review: verify-rls section 12a / 12a' cannot drift from the client - every fixed string it greps exists in the file it names");
{
  // The prefs upsert moved into config.js notifPrefsDb.save + helpers.js notifPrefSaveRequest (P20 R2); a gate still grepping
  // the old inline call went red on a correct build and would have stopped the rollout at its migration step. So: every
  // `grep -qF '<s>' <file>` in 12a / 12a' must find <s> in that repo file. A served copy "$T/vr12-<f>" maps to the repo's <f>;
  // the served index.html is the babel output of index-source.html, transpiled here exactly as build.js does; a
  // `tr -d '<chars>' < <file> |` pipe strips the same characters first.
  const gate = s12.slice(s12.indexOf("# 12a. client pin"), s12.indexOf("# grade_r1_12"));
  ok(gate.length > 0, "section 12a / 12a' not found between '# 12a. client pin' and '# grade_r1_12'");
  const gateCode = gate.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  let served = null;
  const servedIndex = () => {
    if (served === null) {
      const html = read(path.join(ROOT, "index-source.html"));
      const open = html.search(/<script\s+type=["']text\/babel["']\s*>/i);
      const jsx = html.slice(html.indexOf(">", open) + 1, html.indexOf("</script>", open));
      served = require("@babel/core").transformSync(jsx, {
        babelrc: false, configFile: false, compact: false, comments: false,
        presets: [["@babel/preset-env", { targets: { safari: "11" }, modules: false }], ["@babel/preset-react", { runtime: "classic", development: false }]],
      }).code;
    }
    return served;
  };
  const trChars = (s) => s.replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  const rx = /(?:tr -d '([^']*)' < ("[^"]+"|[^\s|;]+) \| )?grep -qF '([^']+)'(?: ("[^"]+"|[^\s|;)]+))?/g;
  const pins = [];
  let m;
  while ((m = rx.exec(gateCode))) {
    const file = (m[2] || m[4] || "").replace(/^"|"$/g, "");
    pins.push({ strip: m[1], file, s: m[3] });
  }
  pins.forEach((p) => {
    ok(!!p.file, "a grep -qF in section 12a / 12a' names no file: '" + p.s + "'");
    const base = p.file.replace(/^\$T\/vr12-/, "");
    const isServed = base !== p.file;
    let text = isServed && base === "index.html" ? servedIndex() : read(path.join(ROOT, base));
    if (p.strip !== undefined) { const cs = trChars(p.strip); text = text.split("").filter((c) => !cs.includes(c)).join(""); }
    ok(text.includes(p.s), "verify-rls section 12a" + (isServed ? "'" : "") + " greps '" + p.s + "' in " + p.file + ", but " + (isServed && base === "index.html" ? "the babel build of index-source.html" : base) + (p.strip !== undefined ? " (after tr -d)" : "") + " does not contain it - the gate would report red on a correct build");
  });
  ok(pins.length >= 7, "section 12a / 12a' should grep at least 7 fixed strings (source: index-source.html, config.js x2, helpers.js; served: index.html, config.js x2, helpers.js) - found " + pins.length + ": " + JSON.stringify(pins));
  ok(pins.some((p) => /index-source\.html$/.test(p.file) && /personId/.test(p.s)) && pins.some((p) => /vr12-index\.html$/.test(p.file) && /personId/.test(p.s)), "section 12a / 12a' must pin the surgeon's save (notifPrefsDb.save({ personId }) in the source and in the served index.html");
  ok(pins.some((p) => /(^|vr12-)helpers\.js$/.test(p.file) && /onConflict: "person_id"/.test(p.s) && p.file === "helpers.js") && pins.some((p) => p.file === "$T/vr12-helpers.js" && /onConflict: "person_id"/.test(p.s)), "section 12a / 12a' must pin helpers.js notifPrefSaveRequest's on_conflict=person_id row (source and served)");
}
console.log("- P20 R2 review: section 12a / 12a' pins all exist in the files they name");

// ---- Prompt 21 step 1 (2026-09-25, Faraz) - the Activity log gap: a user reads back the audit rows he wrote ----
// Acton's two vacations of 9/24 never reached audit_log (POST /rest/v1/audit_log -> 403 at 18:17:57Z / 18:19:23Z): config.js
// db.insert sends Prefer: return=representation, so logAudit runs INSERT ... RETURNING, and a RETURNING that reads columns needs
// a SELECT policy that sees the new row - none did for a linked surgeon (42501; logAudit only console.warns). The prelaunch
// probe's L4 inserts WITHOUT RETURNING, which is why verify-rls stayed green. sql/migrations/2026-09-25-audit-read-own.sql
// (REPORT-FIRST; revision q, applied 2026-09-27 00:49:39Z) creates ONE policy, audit_read_own, exactly as Faraz approved it (1b); audit_insert,
// audit_read and audit_read_coord stay byte-unchanged (audit_read_coord kept on purpose, now redundant). It waited for the 24-hour
// gate: the gate ran the 33e529d verify-rls, whose C21 expected own_other=0 - an earlier apply would have turned it red. schema.sql mirrors
// the policy; sql/probes/audit-read-own-probe.sql (rolled back) inserts WITH RETURNING and in PostgREST's return=representation
// shape as a surgeon, a coordinator and a viewer - the case that would have caught the bug; verify-rls.sh section 13 grades its
// AFTER picture (nine cases red before the apply, run here against a faked CLI) and section 11's C21 now expects own_other=1.
const AUDIT_OWN_FILE = "2026-09-25-audit-read-own.sql";
const AUDIT_OWN_MIGRATION = path.join(ROOT, "sql", "migrations", AUDIT_OWN_FILE);
const AUDIT_OWN_PROBE = path.join(ROOT, "sql", "probes", "audit-read-own-probe.sql");
const AUDIT_READ_OWN = "create policy audit_read_own on public.audit_log for select to authenticated\n  using ((public.silvis_person_id() is not null and actor_id = public.silvis_person_id()) or actor_id = auth.uid()::text);";
const AUDIT_UNCHANGED = {   // byte-unchanged by Prompt 21 step 1
  audit_insert: COORD_POLICIES.audit_insert,
  audit_read: "create policy audit_read on public.audit_log for select to authenticated using (public.silvis_is_sched());",
  audit_read_coord: COORD_POLICIES.audit_read_coord,
};
const AUDIT_OWN_CASES = ["P1", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "T1", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "D1", "V1", "V2", "V3", "A1", "A2"];
const AUDIT_OWN_AFTER = {   // the exact AFTER value of every case graded by equality
  P1: "policies=audit_insert,audit_read,audit_read_coord,audit_read_own", S1: "ok", S2: "ok rows=1", S3: "ok", S4: "ok", S5: "own=5",
  S6: "s2=0 s1=0 coord=0 cli=0 cron=0", T1: "own=1 s3=0", C1: "ok", C2: "ok", C3: "ok", C4: "ok rows=1", C5: "own_family=1 own_other=4",
  C6: "coord2=0 surgeons=0 cli=0 cron=0", D1: "own_family=1 own_other=1 coord=0", V3: "visible=0", A1: "ok", A2: "sees_all=t",
};
const AUDIT_OWN_ERR = ["S7", "C7", "V1", "V2"];   // ERR 42501 ... for table "audit_log" before AND after (audit_insert's WITH CHECK, unchanged)
const AUDIT_OWN_BEFORE = { P1: "policies=audit_insert,audit_read,audit_read_coord", S5: "own=0", T1: "own=0 s3=0", C5: "own_family=1 own_other=0", D1: "own_family=1 own_other=0 coord=0" };
const AUDIT_OWN_REFUSED_BEFORE = ["S1", "S2", "C2", "C4"];   // the RETURNING inserts: ERR 42501 before, ok after
const AUDIT_OWN_RED_BEFORE = ["P1", "S1", "S2", "S5", "T1", "C2", "C4", "C5", "D1"];
const RLS_42501_AUDIT = 'ERR 42501 new row violates row-level security policy for table "audit_log"';

step("P21 S1: the migration - ONE policy, audit_read_own, exactly as approved (1b); nothing else dropped or created; report-first, applied 2026-09-27 after the 24-hour gate");
const aoMig = read(AUDIT_OWN_MIGRATION);
ok(!/\r/.test(aoMig), "audit-read-own migration has CRLF line endings");
ok(migFiles.includes(AUDIT_OWN_FILE) && !PREPARED_NOT_MIRRORED.includes(AUDIT_OWN_FILE), "sql/migrations/" + AUDIT_OWN_FILE + " is a mirrored migration (not exempt like the member return-leg follow-up)");
eq(aoMig.split("\n").filter((l) => !/^\s*--/.test(l) && l.trim() !== "").join("\n"), "drop policy if exists audit_read_own on public.audit_log;\n" + AUDIT_READ_OWN,
  "the audit-read-own migration's statements must be exactly the drop-if-exists and the approved policy (Faraz 9/25, 1b as written);");
const aoHdr = aoMig.slice(0, aoMig.search(/^drop policy if exists audit_read_own/m));   // the header quotes the same statement as its rollback
ok(/^-- REPORT-FIRST \([^)]*\); APPLIED 2026-09-27 00:49:39Z after the/m.test(aoHdr) && !/^-- REPORT-FIRST, NOT APPLIED/m.test(aoHdr) && /audit_insert, audit_read and audit_read_coord are NOT changed/.test(aoHdr), "the migration header must say REPORT-FIRST (...); APPLIED 2026-09-27 00:49:39Z after the 24-hour gate (step 9 replaced 'REPORT-FIRST, NOT APPLIED'; the pin was tightened with it) and that the three existing audit policies are not changed");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-25-audit-read-own\.sql/.test(aoHdr), "the migration header must carry the CLI apply line for the orchestrator");
ok(/WAITS FOR THE 24-HOUR GATE - never apply this file ahead of it/.test(aoHdr) && /silvis-24h-gate/.test(aoHdr) && /33e529d/.test(aoHdr) && /C21/.test(aoHdr) && /own_other=1/.test(aoHdr) && /If the gate reports instead of applying, stop\./.test(aoHdr),
  "the migration header must state the gate constraint (the gate's 33e529d verify-rls C21 expects own_other=0; an early apply turns it red) and the order (gate -> report -> go -> apply -> verify-rls -> push; stop if the gate reports)");
// Review fix (9/25): the branch is cut at 33e529d and the gate's record commit lands on main first, so the apply order rebases
// before the probes / apply / verify-rls; and the detailed order carries the push between verify-rls and the backfill, the
// same sequence as the SCHEMA-REVIEW section's.
{
  const hj = aoHdr.replace(/\n-- /g, " ");
  ok(/Faraz approves -> rebase this branch/.test(hj) && /re-run the gates -> apply this file -> verify-rls from the rebased branch -> push\./.test(hj),
    "the migration header's gate order must rebase onto origin/main (after the gate's record commit) and re-run the gates before the apply");
  ok(/probe BEFORE -> this file, one session -> probe AFTER -> verify-rls from the rebased branch \([^)]*\) -> push \(1d\) -> step 3, the backfill/.test(hj),
    "the migration header's detailed order must read: rebase -> probe BEFORE -> apply -> probe AFTER -> verify-rls -> push -> step 3 -> record");
  ok(/POST \/rest\/v1\/audit_log -> 403 entries from launch to the apply/.test(hj) && /not recoverable from the tables, never skipped/.test(hj),
    "the migration header's step 3 must reconcile against the gateway log's 403s and list the unrecoverable ones for Faraz");
}
ok(/18:17:57Z/.test(aoHdr) && /18:19:23Z/.test(aoHdr) && /Prefer: return=representation/.test(aoHdr) && /RETURNING 1/.test(aoHdr) && /L4/.test(aoHdr), "the migration header must carry the evidence (the two 403s), the cause (return=representation -> RETURNING) and why L4 missed it");
ok(/1c \(approved, Faraz 9\/25\): no change for viewers or followers now/.test(aoHdr) && /saveFollowerPref/.test(aoHdr) && /prelaunch probe S4/.test(aoHdr), "the migration header must record decision 1c (no change for viewers / followers; the stranger hole)");
// (comment lines wrap: join the `-- ` continuations before matching a sentence)
ok(/EVERY member or coordinator write since launch that has no audit row/.test(aoHdr.replace(/\n-- /g, " ")) && /detail\.backfilled = true/.test(aoHdr) && /call_schedule_snapshots row first/.test(aoHdr) && /shown to Faraz before inserting/.test(aoHdr),
  "the migration header's order must carry step 3 as widened by Faraz 9/25 (every member / coordinator write without an audit row; detail.backfilled; snapshot first; Faraz sees the rows first)");
ok(/^-- Rolling back = `drop policy if exists audit_read_own on public\.audit_log;`/m.test(aoHdr), "the migration header must give the rollback (drop policy if exists audit_read_own)");
ok(!/^-- supersedes:/m.test(aoMig) && !/^-- PREPARED FOLLOW-UP/m.test(aoMig), "the audit-read-own migration redefines no function (no supersedes line) and is not a NOT-MIRRORED follow-up");

step("P21 S1: schema.sql mirrors audit_read_own byte for byte beside audit_read_coord; audit_insert / audit_read / audit_read_coord byte-unchanged; the header records revision q");
ok(policyText(schema, "audit_read_own") === AUDIT_READ_OWN, "schema.sql: policy audit_read_own must read exactly:\n" + AUDIT_READ_OWN);
ok(policyText(schema, "audit_read_own") === policyText(aoMig, "audit_read_own"), "policy audit_read_own: schema.sql differs from sql/migrations/" + AUDIT_OWN_FILE);
eq((schema.match(/create policy audit_read_own on public\./g) || []).length, 1, "schema.sql must create audit_read_own exactly once;");
eq((schema.match(/drop policy if exists audit_read_own on public\.audit_log;/g) || []).length, 1, "schema.sql must drop-if-exists audit_read_own exactly once (idempotency);");
Object.keys(AUDIT_UNCHANGED).forEach((p) => ok(policyText(schema, p) === AUDIT_UNCHANGED[p], "schema.sql: " + p + " must stay byte-unchanged by Prompt 21 step 1:\n" + AUDIT_UNCHANGED[p]));
eq(Array.from(schema.matchAll(/create policy ([a-z_]+) on public\.audit_log\b/g)).map((m) => m[1]), ["audit_insert", "audit_read", "audit_read_coord", "audit_read_own"], "schema.sql's audit_log policies must be exactly these four, in this order;");
ok(schema.indexOf(AUDIT_READ_OWN) > schema.indexOf(AUDIT_UNCHANGED.audit_read_coord) && schema.indexOf(AUDIT_READ_OWN) < schema.indexOf("-- snapshots: scheduler/admin only"), "audit_read_own sits right after audit_read_coord, before the snapshots policies");
const aoComment = schema.slice(schema.indexOf("-- audit_log: insert by a scheduler / admin"), schema.indexOf("drop policy if exists audit_insert on public.audit_log;"));
ok(/audit_read_own/.test(aoComment) && /return=representation/.test(aoComment) && /revision q/.test(aoComment), "schema.sql's audit_log comment block must name audit_read_own, why (return=representation -> RETURNING) and revision q");
// step 9 (the record step, 2026-09-27) tightened the revision q pins to the applied wording, as revision m's was at its record step
ok(/revision q - applied 2026-09-27 00:49:39Z/.test(aoComment) && !/NOT yet applied/.test(aoComment), "schema.sql's audit_log comment block must read 'revision q - applied 2026-09-27 00:49:39Z' (step 9; it read 'report-first, NOT yet applied' before)");
ok(/-- Revision 2026-09-25 q \(Prompt 21 step 1, sql\/migrations\/2026-09-25-audit-read-own\.sql, applied 2026-09-27 00:49:39Z[^)]*\)/.test(schema), "schema.sql header must record revision 2026-09-25 q (audit_read_own) as 'applied 2026-09-27 00:49:39Z' (step 9; it read 'report-first, NOT yet applied' before)");
{
  const revQ = header.slice(header.search(/^-- Revision 2026-09-25 q /m)).split("\n-- Revision ")[0].split("\n-- Two same-day migrations")[0];
  ok(!/NOT yet applied|although not applied/.test(revQ) && /Applied after the 24-hour gate had passed/.test(revQ) && /backfilled/.test(revQ), "schema.sql's revision q text must say it was applied after the 24-hour gate and the rebuildable lost rows backfilled (no 'NOT yet applied' / 'although not applied' left)");
}
// Revision q follows whichever records the member return-leg follow-up: the PREPARED FOLLOW-UP line until the gate's record
// step, the Revision 2026-09-25 p line since (review fix 9/25: after that rebase an indexOf of the old line is -1 and a plain
// '>' would pass vacuously - so one of the two must exist).
{
  const qAt = header.search(/^-- Revision 2026-09-25 q /m), pAt = header.search(/^-- Revision 2026-09-25 p /m), fuAt = header.search(/^-- PREPARED FOLLOW-UP, NOT MIRRORED/m);
  ok(pAt >= 0 || fuAt >= 0, "schema.sql's header must record the member return-leg follow-up - the PREPARED FOLLOW-UP line or, after its record step, Revision 2026-09-25 p");
  ok(qAt > 0 && qAt > Math.max(pAt, fuAt), "revision q must follow the member return-leg follow-up's line (PREPARED FOLLOW-UP today, Revision 2026-09-25 p after its record step; revision p stays reserved for it)");
}

step("P21 S1: the probe is self-rolling-back, acts as two surgeons / two coordinators / a viewer / the admin, inserts WITH RETURNING and in PostgREST's shape, counts probe rows only, states BEFORE and AFTER");
const aoProbe = read(AUDIT_OWN_PROBE);
ok(!/\r/.test(aoProbe), "audit read-back probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(aoProbe), "audit read-back probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(aoProbe) && /grant insert, select on probe_results to authenticated;/.test(aoProbe), "audit read-back probe must collect into a temp table probe_results granted to authenticated");
const aoLastDo = aoProbe.lastIndexOf("do $$");
ok(aoLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(aoProbe.slice(aoLastDo)), "audit read-back probe's last DO block must raise 'PROBE_RESULTS %;END' so the batch rolls back");
AUDIT_OWN_CASES.forEach((k) => ok(aoProbe.indexOf("values ('" + k + "', ") >= 0, "audit read-back probe lacks case " + k));
ok(/'probe-auditown-' \|\| [a-z_]+ \|\| '@example\.test'/.test(aoProbe), "audit read-back probe's throwaway auth users must be probe-auditown-<uuid>@example.test (the leftover count keys on it)");
ok(/set person_id = 's3', role = 'surgeon' where id = surgeon;/.test(aoProbe) && /set person_id = 's2', role = 'surgeon' where id = surgeon2;/.test(aoProbe) && /set person_id = 's1', role = 'admin' where id = admin_u;/.test(aoProbe)
  && /set role = 'coordinator' where id = coord;/.test(aoProbe) && /set role = 'coordinator' where id = coord2;/.test(aoProbe) && /role = 'viewer' and person_id is null/.test(aoProbe),
  "audit read-back probe fixtures: surgeon s3, second surgeon s2, admin s1, two coordinators (no roster link) and an unlinked viewer (asserted as created)");
const aoCase = (k) => { const at = aoProbe.indexOf("values ('" + k + "', "); return at < 0 ? "" : aoProbe.slice(aoProbe.lastIndexOf("  begin\n", at), at); };
["S1", "S7", "C1", "C2", "C7", "V2", "A1"].forEach((k) => ok(/insert into public\.audit_log [^;]*\) returning \* into r;/.test(aoCase(k)), "case " + k + " must insert WITH `returning * into r` (what PostgREST reads back for Prefer: return=representation)"));
["S2", "C4"].forEach((k) => {
  const c = aoCase(k);
  ok(/with pgrst_source as \(\n\s+insert into public\.audit_log /.test(c) && /returning public\.audit_log\.\*\)/.test(c) && /json_to_record\(pgrst_payload\.json_data\)/.test(c) && /json_agg\(_postgrest_t\)/.test(c) && /from \(select \* from pgrst_source\) _postgrest_t;/.test(c),
    "case " + k + " must use PostgREST's return=representation shape - RLS-equivalent, not byte-identical (CTE pgrst_source, returning public.audit_log.*, json_to_record body, json_agg over _postgrest_t)");
});
ok(/RLS-equivalent/.test(aoProbe.slice(0, aoProbe.indexOf("create temp table"))) && !/a pass here is a pass over REST/.test(aoProbe), "the probe header must call S2 / C4 RLS-equivalent to PostgREST's statement, never 'a pass over REST' (no REST call is made)");
// Review fix (9/25): the rows no non-scheduler may read - a CLI row (actor_id null: scripts/day-edit.js, scripts/publish-preview.js)
// and a daily-reminder row (actor_id 'cron') - are fixtures, and S6 / C6 count them (a later coalesce() in the policy would show)
ok(/\(null, 'probe auditown', 'schedule\.day_edit', '\{"probe":"probe-auditown"\}'::jsonb\)/.test(aoProbe) && /\('cron', 'probe auditown', 'period\.close', '\{"probe":"probe-auditown"\}'::jsonb\)/.test(aoProbe),
  "the probe fixtures must include a CLI row (actor_id null) and a daily-reminder row (actor_id 'cron'), both tagged probe-auditown");
["S6", "C6"].forEach((k) => ok(/count\(\*\) filter \(where actor_id is null\), count\(\*\) filter \(where actor_id = 'cron'\)/.test(aoCase(k)) && /' cli=' \|\| n_cli \|\| ' cron=' \|\| n_cron/.test(aoProbe.slice(aoProbe.indexOf("values ('" + k + "', "), aoProbe.indexOf("values ('" + k + "', ") + 200)),
  "case " + k + " must count the CLI (actor_id null) and 'cron' rows it can see and report them as cli= / cron="));
ok(/\) returning 1 into n;/.test(aoCase("S3")), "case S3 must insert with RETURNING 1 (reads no column - the control that passes before and after)");
["S4", "C3", "V1"].forEach((k) => ok(/insert into public\.audit_log [^;]*;/.test(aoCase(k)) && !/returning/.test(aoCase(k)), "case " + k + " must be a plain insert (no RETURNING)"));
ok(/values \('s2', 'probe auditown'/.test(aoCase("S7")) && /values \('s3', 'probe auditown'/.test(aoCase("C7")), "S7 inserts as s2 (a surgeon as another surgeon) and C7 as s3 (a coordinator as a surgeon) - the unchanged refusals");
const aoCode = aoProbe.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
aoCode.split("\n").filter((l) => /probe auditown/.test(l)).forEach((l) => ok(/probe-auditown/.test(l), "every probe audit row must carry detail.probe = 'probe-auditown' on the same line as its actor_name (the leftover count keys on it): " + l.trim()));
Array.from(aoCode.matchAll(/insert into public\.audit_log[^;]*;/g)).forEach((m) => ok(/probe auditown/.test(m[0]), "every audit insert in the probe must write actor_name 'probe auditown' (and so the probe tag): " + m[0].slice(0, 160)));
Array.from(aoCode.matchAll(/from public\.audit_log\b[^;]*/g)).forEach((m) => ok(/where detail ->> 'probe' = 'probe-auditown'/.test(m[0]), "every audit_log read in the probe must count probe rows only (where detail ->> 'probe' = 'probe-auditown') - the live table's rows never enter a result: " + m[0].slice(0, 160)));
ok(/from pg_policies where schemaname = 'public' and tablename = 'audit_log'/.test(aoCode), "P1 must read the audit_log policy names from pg_policies (the apply's fingerprint)");
ok(!/set local role anon/.test(aoProbe) && !/'2030-/.test(aoProbe), "audit read-back probe has no anon case and no schedule fixture day");
const aoProbeHdr = aoProbe.slice(0, aoProbe.indexOf("create temp table probe_results"));
Object.keys(AUDIT_OWN_AFTER).forEach((k) => ok(aoProbeHdr.indexOf(AUDIT_OWN_AFTER[k]) > 0, "audit read-back probe header must state " + k + "'s AFTER string `" + AUDIT_OWN_AFTER[k] + "`"));
Object.keys(AUDIT_OWN_BEFORE).forEach((k) => ok(aoProbeHdr.indexOf(AUDIT_OWN_BEFORE[k]) > 0, "audit read-back probe header must state " + k + "'s BEFORE string `" + AUDIT_OWN_BEFORE[k] + "`"));
ok(aoProbeHdr.indexOf(RLS_42501_AUDIT) > 0 && /return=representation/.test(aoProbeHdr) && /THE case/.test(aoProbeHdr), "audit read-back probe header must state the 42501 refusal, the return=representation shape and mark S1 as THE case");
ok(!/simple-protocol/.test(aoProbe), "audit read-back probe header must not claim a simple-protocol connection");

step("P21 S1: verify-rls.sh section 13 grades the AFTER picture case by case (nine cases red before the apply, by name), counts leftovers, writes nothing over REST; section 11's C21 expects own_other=1");
ok(/^echo "== 13\. /m.test(vr), "verify-rls.sh has no section 13");
// (bounded at section 14 since the call pay section landed after it, 2026-09-27)
const s13End = vr.indexOf('echo "== 14. ') > 0 ? vr.indexOf('echo "== 14. ') : vr.indexOf('echo "RESULT: ');
const s13 = vr.slice(vr.indexOf('echo "== 13. '), s13End);
ok(s13.length > 0 && s13.length < vr.length, "verify-rls.sh section 13 could not be sliced out (it must sit right before section 14, or the RESULT line)");
ok(/audit-read-own-probe\.sql/.test(s13) && /PROBE13="\$\(cd sql\/probes && \(pwd -W 2>\/dev\/null \|\| pwd\)\)\/audit-read-own-probe\.sql"/.test(s13), "section 13 must run sql/probes/audit-read-own-probe.sql through the linked CLI (absolute path via pwd -W, as 11b / 12b)");
AUDIT_OWN_CASES.forEach((k) => ok(new RegExp("expect_(eq|err)13\\s+" + k + "\\s").test(s13), "section 13 does not grade probe case " + k));
Object.keys(AUDIT_OWN_AFTER).forEach((k) => ok(s13.indexOf("expect_eq13  " + k + "  \"" + AUDIT_OWN_AFTER[k] + "\"") >= 0, "section 13 must grade " + k + " = " + AUDIT_OWN_AFTER[k]));
AUDIT_OWN_ERR.forEach((k) => ok(new RegExp("expect_err13\\s+" + k + "\\s+42501\\s+'row-level security policy for table \"audit_log\"'").test(s13), "section 13 must grade " + k + " as ERR 42501 on audit_log"));
ok(s13.indexOf(AUDIT_OWN_RED_BEFORE.join(" ") + " below are red until it is") > 0, "section 13 must name the cases that are red before the apply: " + AUDIT_OWN_RED_BEFORE.join(" "));
ok(/nine cases are RED/.test(s13) && AUDIT_OWN_RED_BEFORE.every((k) => new RegExp("#[^\\n]*\\b" + k + "\\b").test(s13)), "section 13's comment must say which nine cases are red before the apply");
ok(/detail ->> 'probe' = 'probe-auditown'/.test(s13) && /email like 'probe-auditown-%@example\.test'/.test(s13) && /LEFT ROWS BEHIND/.test(s13), "section 13 must count leftovers (audit_log probe-auditown rows, auth.users probe-auditown-*) and report them as a failure with the cleanup statements");
ok(/SKIP 13 \(supabase CLI not linked at \$WORKDIR\)/.test(s13), "section 13 must SKIP when the CLI is not linked");
const s13code = s13.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
ok(!/\bcurl /.test(s13code) && !/-X (POST|PATCH|DELETE|PUT)/.test(s13code), "section 13 must write nothing over REST (no curl at all)");
ok(/audit read-back probe \(13\)/.test(vr.slice(0, vr.indexOf('echo "== 1.'))), "verify-rls.sh's usage header must list the audit read-back probe (13)");
ok(/expect_eq11\s+C21\s+"own_family=1 others=0 own_other=1"/.test(s11) && !/expect_eq11\s+C21\s+"own_family=1 others=0 own_other=0"/.test(s11), "section 11's C21 must expect own_other=1 (the coordinator reads its own 'probe.coord' row through audit_read_own)");
ok(/2026-09-25-audit-read-own\.sql/.test(s11) && /33e529d/.test(s11), "section 11's comment must say C21 is red until the audit-read-own apply and that the gate runs the 33e529d copy");
// Review fix (9/25): the C21 move and the gate constraint both rest on the SQL that computes own_other - pin it: the
// coordinator's own 'probe.coord' row (outside the three families) inserted as itself, counted by actor = auth.uid().
ok(/values \(u, 'probe office', 'probe\.coord', '\{\}'::jsonb\);/.test(coProbe) && /count\(\*\) filter \(where actor_id = auth\.uid\(\)::text and action = 'probe\.coord'\)\s+into own, leak, c from public\.audit_log/.test(coProbe) && /' own_other=' \|\| c\);/.test(coProbe),
  "coordinator-probe C21's own_other must count the coordinator's own 'probe.coord' row (actor_id = auth.uid(), outside the families) - the row audit_read_own makes visible");
ok(!/a surgeon still reads no audit row/.test(s11) && !/no read policy for him\)/.test(coProbe) && /audit_read_own/.test(coProbe.slice(0, coProbe.indexOf("create temp table"))), "section 11's L3 / the coordinator probe's C21 / L3 comments must no longer say a surgeon has no audit read policy");
{
  // Grade section 13 for real against a faked CLI (no network): the AFTER results must be all green, the BEFORE results red on
  // exactly the nine cases the comment names. The CLI escapes the quotes of the error text, as the live output does.
  const code13 = vr.slice(vr.indexOf('echo "== 13. '), vr.indexOf('echo "== 14. ') > 0 ? vr.indexOf('\necho "== 14. ') : vr.indexOf('\necho\necho "RESULT: '));
  const ERRQ = 'ERR 42501 new row violates row-level security policy for table \\"audit_log\\"';
  const after = Object.assign({}, AUDIT_OWN_AFTER);
  AUDIT_OWN_ERR.forEach((k) => { after[k] = ERRQ; });
  const before = Object.assign({}, after, AUDIT_OWN_BEFORE);
  AUDIT_OWN_REFUSED_BEFORE.forEach((k) => { before[k] = ERRQ; });
  const run13 = (m) => {
    const res = Object.keys(m).sort().map((k) => k + "=" + m[k]).join(";");
    const script = "set -u\nWORKDIR=/nonexistent; pass=0; fail=0\nok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      "linked() { true; }\nq() { echo '{\"rows\":[{\"leftover\":0}]}'; }\nsupabase() { echo 'Initialising login role...'; echo '{\"message\": \"ERROR: P0001: PROBE_RESULTS " + res + ";END\"}'; }\n" +
      code13 + "\necho \"RESULT $pass $fail\"\n";
    // the script goes in on stdin, not as `bash -c <arg>`: on Windows the command-line quoting of the escaped \" in the faked
    // CLI output does not survive the trip into Git Bash
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    ok(!r.error, "bash could not be started to run section 13: " + (r.error && r.error.message));
    return { out: r.stdout || "", failed: Array.from((r.stdout || "").matchAll(/^FAIL  audit read-back probe ([A-Z][0-9]):/gm)).map((x) => x[1]).sort(), result: ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number), err: r.stderr || "" };
  };
  const ra = run13(after);
  eq(ra.result, [AUDIT_OWN_CASES.length + 1, 0], "section 13 against the AFTER picture: every case + the leftover check PASS, nothing FAILs (" + ra.out.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") + ra.err.slice(0, 200) + ");");
  const rb = run13(before);
  eq(rb.failed, AUDIT_OWN_RED_BEFORE.slice().sort(), "section 13 against the BEFORE picture must fail exactly the nine cases its comment names;");
  ok(/the BEFORE picture: audit_read_own is not live/.test(rb.out) && !/the BEFORE picture/.test(ra.out), "section 13 must name the BEFORE picture when P1 lacks audit_read_own (and only then)");
}

step("P21 S1: docs - SCHEMA-REVIEW.md section (evidence, cause, diagnostic, decisions 1b / 1c / 1d + the widened step 3, blast radius, probe table, apply order with the gate, rollback, APPLIED status + observed line with the backfill), tables (a) / (b), guide 4.3 bullet");
ok(/^## 2026-09-25 - audit_log read-back: audit_read_own \(Prompt 21 step 1; `sql\/migrations\/2026-09-25-audit-read-own\.sql`\)$/m.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-25 - audit_log read-back: audit_read_own (Prompt 21 step 1; `sql/migrations/2026-09-25-audit-read-own.sql`)' section");
const reviewP21 = (() => { const at = review.indexOf("## 2026-09-25 - audit_log read-back: audit_read_own"), end = review.indexOf("\n## ", at + 1); return at < 0 ? "" : review.slice(at, end < 0 ? review.length : end); })();
ok(/^\*\*Status: (PREPARED - report-first \(not applied\)|APPLIED 2026-)/.test(((reviewP21.match(/\*\*Status: [^*]*\*\*/) || [""])[0])), "the P21 section's status line must read 'Status: PREPARED - report-first (not applied) ...' (or 'APPLIED 2026-...' after the record step)");
ok(reviewP21.includes(AUDIT_READ_OWN.replace(/\n  /g, "\n      ")), "the P21 section must quote the audit_read_own text verbatim (indented as a code block)");
AUDIT_OWN_CASES.concat(["C21"]).forEach((k) => ok(new RegExp("^\\| `" + k + "` \\|", "m").test(reviewP21), "the P21 probe table lacks a row for " + k));
ok(/18:17:57Z/.test(reviewP21) && /18:19:23Z/.test(reviewP21) && /Prefer: return=representation/.test(reviewP21) && /RETURNING 1/.test(reviewP21) && /\bL4\b/.test(reviewP21), "the P21 section must carry the evidence, the cause and why L4 missed it");
ok(/\*\*Decisions \(Faraz 9\/25\)\.\*\*/.test(reviewP21) && /\*\*1b\*\*/.test(reviewP21) && /\*\*1c\*\*/.test(reviewP21) && /\*\*1d\*\*/.test(reviewP21) && /\*\*Step 3, widened\*\*/.test(reviewP21), "the P21 section must record decisions 1b, 1c, 1d and the widened step 3");
ok(/33e529d/.test(reviewP21) && /silvis-24h-gate/.test(reviewP21) && /own_other=1/.test(reviewP21) && /reports instead of applying, stop/.test(reviewP21), "the P21 section's apply order must carry the gate constraint (33e529d, C21 own_other) and the stop rule");
ok(/detail\.backfilled = true/.test(reviewP21) && /call_schedule_snapshots/.test(reviewP21) && /before inserting/.test(reviewP21) && /created_at/.test(reviewP21), "the P21 section's step 3 must be the widened backfill (every member / coordinator write without an audit row; created_at copied; detail.backfilled; snapshot first; Faraz sees the rows first)");
ok(/Blast radius/.test(reviewP21) && /loadAudit/.test(reviewP21) && /prefs\.save/.test(reviewP21), "the P21 section must state the blast radius (surgeons' client never calls loadAudit; a coordinator's Activity may list its own prefs.save rows)");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-25-audit-read-own\.sql/.test(reviewP21) && /audit-read-own-probe\.sql/.test(reviewP21), "the P21 section must carry the CLI apply line and the probe command");
ok(/drop policy if exists audit_read_own on public\.audit_log;/.test(reviewP21.slice(reviewP21.indexOf("Rolling back"))), "the P21 section's rollback must drop audit_read_own");
ok(/observed: /.test(reviewP21), "the P21 section must carry an 'observed:' line (placeholder until the orchestrator fills it)");
// the record step (apply order step 9, 2026-09-27): the status line and the observed line - both probe sentinels, verify-rls
// sections 11 / 13, the leftovers, the 403 reconciliation (incl. its false positives), the backfilled rows + snapshot, the pending window
{
  ok(((reviewP21.match(/\*\*Status: [^*]*\*\*/) || [""])[0]) === "**Status: APPLIED 2026-09-27 00:49:39Z.**", "the P21 section's status line must read `**Status: APPLIED 2026-09-27 00:49:39Z.**` (step 9)");
  const obsP21 = (reviewP21.match(/^observed: .*$/m) || [""])[0];
  ok(!/_to be filled/.test(obsP21) && /applied 2026-09-27 00:49:39/.test(obsP21), "the P21 observed line must be filled with the apply time");
  ok(obsP21.includes("`P1=policies=audit_insert,audit_read,audit_read_coord`") && obsP21.includes("`P1=policies=audit_insert,audit_read,audit_read_coord,audit_read_own`") && /`S2=ok rows=1`/.test(obsP21) && /`C5=own_family=1 own_other=4`/.test(obsP21), "the P21 observed line must carry both probe sentinels (P1 before / after) and the moved cases");
  ok(/214 passed, 0 failed/.test(obsP21) && /`C21=own_family=1 others=0 own_other=1`/.test(obsP21) && /section 13/.test(obsP21) && /every leftover count 0/.test(obsP21), "the P21 observed line must carry verify-rls 214 / 0, section 11's C21, section 13 and the leftover counts");
  ok(/2 false positives/.test(obsP21) && /3 backfilled/.test(obsP21) && /snapshot `[0-9a-f-]{36}`/.test(obsP21) && (obsP21.match(/audit row `[0-9a-f-]{36}`/g) || []).length === 3 && /Not recoverable/.test(obsP21) && /403 coverage, complete/.test(obsP21) && !/PENDING/.test(obsP21) && /detail ->> 'backfilled' = 'true'/.test(obsP21) && /'b3323705-8b8e-4f63-8c37-aef3d219bd36'\);`/.test(obsP21), "the P21 observed line must carry the reconciliation (2 false positives), the 3 backfilled rows with their snapshot, the unrecoverable 403s, the closed 403 coverage (Cowork's closing read, 9/27) and the undo (all four backfilled ids)");
  // review fix (9/27): the last window's own deadline is step 8a's (24 h after the 9/26 read), stated as such; Cowork's
  // closing read (2026-09-27 ~13:15Z, Faraz 9/27) met it with no failed write, and step 8a's table itemizes the four reads
  ok(/no-gap deadline of 2026-09-27 22:00Z/.test(obsP21) && /\| apply time: Cowork read 4, 2026-09-27 ~13:15Z \(the closing read\) \| 2026-09-26 ~13:15 -> 2026-09-27 ~13:15 \| none \|/.test(reviewP21) && !/\(PENDING\)/.test(reviewP21), "the P21 observed line must state the last window's no-gap deadline (2026-09-27 22:00Z, step 8a) and step 8a's table must carry the closing read (Cowork read 4, 2026-09-27 ~13:15Z, none), no PENDING row");
  ok(/\| Cowork read 1, 2026-09-25 ~12:30Z \| 2026-09-24 ~12:30 -> 2026-09-25 ~12:30 /.test(reviewP21) && /\| Cowork read 2, 2026-09-25 22:27Z \| 2026-09-24 22:27 -> 2026-09-25 22:27 \| none \|/.test(reviewP21) && /\| Cowork read 3, 2026-09-26 22:00Z \(17:00 CDT\) \| 2026-09-25 22:00 -> 2026-09-26 22:00 \|/.test(reviewP21), "step 8a's table must itemize Cowork's reads 1-3, one row each (Faraz 9/27)");
}
// Review fixes (9/25): the apply order rebases onto the gate's record commit before the probes, pushes after verify-rls and
// before the backfill (the migration header's sequence); step 3 reconciles against the gateway log's 403s and matches a lost
// timeoff.add by person + time, never by the (editable) dates; the read follows actor_id, not role.
{
  const at = (s) => reviewP21.indexOf(s);
  const order = ["1. **The 24-hour gate first", "2. **Rebase first.**", "3. Probe BEFORE", "4. The migration, one session", "5. Probe AFTER", "6. `SILVIS_WORKDIR=<dir> bash scripts/verify-rls.sh` from the rebased branch", "7. Push (1d: after verify-rls)", "8. **Step 3, the backfill**", "9. The record step, ONE commit"];
  ok(order.every((s, i) => at(s) > 0 && (i === 0 || at(s) > at(order[i - 1]))), "the P21 apply order must read: gate -> rebase -> probe BEFORE -> apply -> probe AFTER -> verify-rls (rebased branch) -> push -> step 3 backfill -> record (missing or out of order: " + order.filter((s) => at(s) < 0).join(" | ") + ")");
  ok(/Rebase this branch onto `origin\/main`/.test(reviewP21) && /revision\s+q stays after p/.test(reviewP21), "the P21 rebase step must rebase onto origin/main and keep revision q after p");
  ok(/`POST \/rest\/v1\/audit_log` -> 403 from launch/.test(reviewP21) && /not recoverable, never silently skipped/.test(reviewP21), "the P21 backfill must reconcile against the gateway log's 403s and list the unrecoverable ones for Faraz");
  // Faraz 9/25 evening: the gateway log keeps 24 hours, so the 403 list is a chain of reads (Cowork's to 2026-09-25 22:27 UTC,
  // Cowork's 9/26 17:00 CDT read, the apply-time read) and a gap of more than 24 hours between two reads must be reported.
  ok(/Retention is 24 hours on\s+this plan/.test(reviewP21) && /22:27 UTC/.test(reviewP21) && /more than 24 hours separate two consecutive reads/.test(reviewP21), "the P21 backfill must treat the 24-hour gateway log as a chain of reads and report a gap of more than 24 hours");
  ok(/keeps only 24 hours on this plan/.test(aoHdr) && /22:27 UTC/.test(aoHdr) && /more than 24 hours separate two consecutive reads/.test(aoHdr.replace(/\n-- /g, " ")), "the migration header's step 3 must carry the 24-hour chain-of-reads rule");
  ok(/Dry run observed 2026-09-25 22:55 UTC/.test(reviewP21), "the P21 order's probe BEFORE step must record the 9/25 dry run");
  // Cowork's 9/26 read (Faraz): three prefs.save 403s from Fierce - the one matching his prefs row is backfilled, the other
  // two are listed as probable and not independently recoverable; the apply-time read must close the chain by 9/27 22:00Z.
  ok(/2026-09-25 22:00 -> 2026-09-26 22:00/.test(reviewP21) && /23:06:18 matches his `notification_preferences` row/.test(reviewP21) && /23:06:06 and 00:16:35 are probable `prefs\.save` writes, not independently recoverable/.test(reviewP21) && /2026-09-27 22:00Z/.test(reviewP21), "the P21 step-3 list must carry Cowork's 9/26 read (Fierce's prefs.save 403s: one backfilled, two listed) and the apply-time read deadline");
  ok(/a\.detail ->> 'person_id' = t\.person_id/.test(reviewP21) && /a\.created_at between t\.created_at - interval/.test(reviewP21) && !/a\.detail ->> 'start' = t\.start_date/.test(reviewP21), "the P21 time_off candidate query must match on person_id and created_at proximity, never on the dates");
  ok(/The read follows `actor_id`, not role/.test(reviewP21) && /user_profiles_admin/.test(reviewP21), "the P21 section must say the read follows actor_id, not role (a demoted coordinator; linking hands over a roster id's history)");
  ok(!/PostgREST's own statement/.test(reviewP21) && /RLS-equivalent/.test(reviewP21), "the P21 section must call S2 / C4 RLS-equivalent to PostgREST's statement, not PostgREST's own statement");
}
ok(/^\| `audit_log` \|[^\n]*audit_read_own/m.test(tblB) && /^\| `audit_log` \|[^\n]*audit_read_coord/m.test(tblB), "SCHEMA-REVIEW table (b)'s audit_log row must name audit_read_coord and audit_read_own");
ok([tblA, tblB].every((t) => /^\| `audit_log` \|[^\n]*Prompt 21 step 1[ ,(]+applied 2026-09-27 00:49:39Z/m.test(t) && !/^\| `audit_log` \|[^\n]*Prompt 21 step 1[ ,(]+prepared/m.test(t)), "SCHEMA-REVIEW tables (a) / (b): the audit_log rows' Prompt 21 step 1 notes drop 'prepared' and read 'applied 2026-09-27 00:49:39Z' (step 9)");
const g43ao = g43.indexOf("2026-09-25-audit-read-own.sql");
ok(g43ao > 0 && /report-first, (NOT applied|applied 2026-)/.test(g43.slice(Math.max(0, g43ao - 400), g43ao + 400)), "guide 4.3 must carry the Prompt 21 step 1 bullet (report-first, NOT applied - or 'applied 2026-MM-DD' after the record step)");
ok(/^\| `audit_read_own` \|/m.test(g43.slice(g43ao)) && /applied: (_to be filled by the orchestrator_|2026-)/.test(g43.slice(g43ao)) && /24-hour gate/.test(g43.slice(g43ao)), "guide 4.3's Prompt 21 step 1 bullet must carry its audit_read_own row, the gate and the 'applied: _to be filled by the orchestrator_' placeholder");
{
  // step 9 (2026-09-27) tightened these to the applied wording - the bullet line itself and its own Proof line
  const aoBullet = (g43.match(/^- \*\*Audit read-back \(Prompt 21 step 1, [^\n]*/m) || [""])[0];
  const aoProof = (g43.match(/^Proof: `sql\/probes\/audit-read-own-probe\.sql`[^\n]*/m) || [""])[0];
  ok(/report-first, applied 2026-09-27 00:49 UTC after the 24-hour gate/.test(aoBullet) && !/NOT applied/.test(aoBullet), "guide 4.3's Prompt 21 step 1 bullet must read 'report-first, applied 2026-09-27 00:49 UTC after the 24-hour gate' (step 9; it read 'report-first, NOT applied' before)");
  ok(/applied: 2026-09-27 00:49:39 UTC/.test(aoProof) && !/_to be filled/.test(aoProof) && /403 coverage closed by Cowork's 2026-09-27 ~13:15Z read/.test(aoProof) && !/pending Cowork/.test(aoProof) && /backfilled 4 audit rows/.test(aoProof), "guide 4.3's Prompt 21 step 1 Proof line must carry 'applied: 2026-09-27 00:49:39 UTC ...', the four backfilled rows and the closed 403 coverage (Cowork's closing read, 9/27)");
}
console.log("- P21 S1: audit_read_own applied 2026-09-27 00:49:39Z after the 24-hour gate (report-first); probe + verify-rls section 13 + C21 own_other=1; step 3 backfill recorded");

// ---- Call pay (2026-09-27, Faraz: primary call pay is tracked in the app - this reverses the 9/21 "no compensation logic" rule) ----
// sql/migrations/2026-09-27-call-pay.sql (report-first; APPLIED 2026-09-28 01:15:26Z, revision r) creates two NEW tables and touches nothing that
// exists: call_pay_settings (one 'main' row - the rates the scheduler enters in the app, null until then, and the pay-model flags)
// and call_pay_logs (one row per call-in of the PRIMARY on a past call day). Neither is anon-readable, anon's privileges are
// revoked on top, and NO RATE FIGURE may appear in the repo: the rate columns carry no default and the files carry no numeric
// literal beyond the check bounds and the column precisions. schema.sql mirrors every statement; verify-rls.sh section 14 grades
// the anon refusals and the rolled-back probe (sql/probes/call-pay-probe.sql) strictly since the record step: a 404, an anon 200 or
// PROBE_SETUP FAILs (SILVIS_CALL_PAY_APPLIED, the flag for the run right after the apply, is gone).
const PAY_FILE = "2026-09-27-call-pay.sql";
const PAY_MIGRATION = path.join(ROOT, "sql", "migrations", PAY_FILE);
const PAY_PROBE = path.join(ROOT, "sql", "probes", "call-pay-probe.sql");
const PAY_S = "public.silvis_is_sched()";
// Faraz 9/27 items 5a / 5b (folded in before the apply): the office COORDINATOR reads both tables (read-only - it prepares the
// stipends) and writes neither; a surgeon's own-row clause also requires that he is paid by the call stipend
// (public.silvis_pay_enabled - the per-surgeon switch in call_pay_settings.stipend_off_ids), so a switched-off surgeon reads
// no rate and none of his call-ins and writes none - in RLS, not only in the client.
const PAY_SELF = "(public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id))";
const PAY_OWN = "(" + PAY_S + " or " + PAY_SELF + ")";
const PAY_READ = "(" + PAY_S + " or public.silvis_is_coord() or " + PAY_SELF + ")";
const PAY_POLICIES = {
  call_pay_settings_read: "create policy call_pay_settings_read on public.call_pay_settings for select to authenticated\n  using (" + PAY_S + " or public.silvis_is_coord() or (public.silvis_role() = 'surgeon' and public.silvis_pay_enabled(public.silvis_person_id())));",
  call_pay_settings_write: "create policy call_pay_settings_write on public.call_pay_settings for all to authenticated\n  using (" + PAY_S + ") with check (" + PAY_S + ");",
  call_pay_logs_read: "create policy call_pay_logs_read on public.call_pay_logs for select to authenticated\n  using " + PAY_READ + ";",
  call_pay_logs_insert: "create policy call_pay_logs_insert on public.call_pay_logs for insert to authenticated\n  with check " + PAY_OWN + ";",
  call_pay_logs_update: "create policy call_pay_logs_update on public.call_pay_logs for update to authenticated\n  using " + PAY_OWN + "\n  with check " + PAY_OWN + ";",
  call_pay_logs_delete: "create policy call_pay_logs_delete on public.call_pay_logs for delete to authenticated\n  using " + PAY_OWN + ";",
};
const PAY_CASES = ["P1", "P2", "P3", "P4", "N1", "N2", "N3", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "X1", "X2", "T1", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "V1", "V2", "A1", "A2", "A3", "A4",
  "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "O9", "O10", "O11", "O12"];
const PAY_AFTER_EQ = {
  P1: "policies=call_pay_logs_delete,call_pay_logs_insert,call_pay_logs_read,call_pay_logs_update,call_pay_settings_read,call_pay_settings_write",
  P2: "anon_logs=f anon_settings=f auth_truncate=f", P3: "rows=1", S1: "ok created_by=s3 hours=1.50", S6: "ok", S10: "own=2 others=0", S11: "updated=1 hours=2.25 created_by=s3",
  S12: "updated=0", S13: "deleted=0", S14: "rows=1", S15: "updated=0", S17: "updated=1 created_by=s3", X2: "deleted=1", T1: "own=1 s3=0",
  // 5a: the office coordinator reads every call-in and the settings row (was visible=0 / rows=0), writes nothing
  C1: "sees_all=t", C2: "rows=1", C4: "updated=0", C5: "deleted=0",
  // 9/27 review: the office never writes call_pay_settings either (the rates, the switches)
  C6: "updated=0",
  V1: "visible=0", V2: "rows=0", A1: "sees_all=t", A2: "updated=1 updated_by=s1", A3: "ok created_by=s1",
  // 5b: the switch helper's grants, and s3 switched off the stipend
  P4: "anon_exec=f auth_exec=t definer=t",
  O1: "rows=0", O2: "own=0", O4: "updated=0", O5: "deleted=0", O6: "settings=1 own=1", O7: "sees_s3=t", O10: "sees_s3=t",
  // 9/27 review: silvis_pay_enabled over RPC - an uninformative true for a viewer / colleague, the real answer for the entitled
  O11: "viewer=t colleague=t", O12: "admin=f coord=f self=f nojwt=f",
};
const PAY_STIPEND_OFF_ERR = "ERR PY005 PAY_STIPEND_OFF: s3 is not paid by the call stipend - no call-in is logged for him (switched off in Setup > Pay rates)";
const PAY_AFTER_ERR = {   // what the probe records AFTER the apply (the CLI escapes the quotes, as the live output does)
  N1: "ERR 42501 permission denied for table call_pay_logs", N2: "ERR 42501 permission denied for table call_pay_settings", N3: "ERR 42501 permission denied for table call_pay_logs",
  S2: "ERR PY002 PAY_NOT_PRIMARY: s3 is not the primary on 2020-03-03 - call pay is logged for the primary only",
  S3: 'ERR 42501 new row violates row-level security policy for table \\"call_pay_logs\\"',
  S4: "ERR PY001 PAY_FUTURE: 2099-01-01 is after today (2098-12-02) in Central time - a call-in is logged once it happened",
  S5: 'ERR 23514 new row for relation \\"call_pay_logs\\" violates check constraint \\"call_pay_logs_hours_check\\"',
  S7: "ERR PY003 PAY_HOURS_OVER: s3 already has 23.00 h logged on 2020-03-05 - one call day holds at most 24 h",
  S8: 'ERR 23514 new row for relation \\"call_pay_logs\\" violates check constraint \\"call_pay_logs_note_check\\"',
  S9: "ERR PY003 PAY_HOURS_OVER: s3 already has 0 h logged on 2020-03-04 - one call day holds at most 24 h",
  S16: 'ERR 42501 new row violates row-level security policy for table \\"call_pay_settings\\"',
  X1: "ERR PY002 PAY_NOT_PRIMARY: s3 is not the primary on 2020-03-02 - call pay is logged for the primary only",
  C3: "ERR PY004 PAY_READ_ONLY: the office reads call pay and writes none - a call-in is logged by the surgeon or the scheduler",
  C7: 'ERR 42501 new row violates row-level security policy for table \\"call_pay_settings\\"',
  O3: PAY_STIPEND_OFF_ERR, O8: PAY_STIPEND_OFF_ERR, O9: PAY_STIPEND_OFF_ERR,
  A4: "ERR PY002 PAY_NOT_PRIMARY: s3 is not the primary on 2020-03-03 - call pay is logged for the primary only",
};
// Top-level statements of a SQL file (comment lines dropped; a $$ body is one statement with the create it belongs to).
function payStatements(sql) {
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = ""; let inBody = false;
  for (let i = 0; i < code.length; i++) {
    if (code.startsWith("$$", i)) { inBody = !inBody; cur += "$$"; i++; continue; }
    cur += code[i];
    if (code[i] === ";" && !inBody) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

step("call pay: the migration - two NEW tables + the stipend-switch helper, report-first, APPLIED 2026-09-28 01:15:26Z (the record step), the CLI apply line and rollback, no supersedes, mirrored (not exempt)");
const payMig = read(PAY_MIGRATION);
ok(!/\r/.test(payMig), "call pay migration has CRLF line endings");
ok(migFiles.includes(PAY_FILE) && !PREPARED_NOT_MIRRORED.includes(PAY_FILE), "sql/migrations/" + PAY_FILE + " is a mirrored migration (not exempt)");
const payHdr = payMig.slice(0, payMig.indexOf("create table if not exists public.call_pay_settings"));
ok(/^-- REPORT-FIRST \(/m.test(payHdr) && /APPLIED 2026-09-28 01:15:26Z after the/.test(payHdr) && !/NOT APPLIED/.test(payHdr) && /Blast radius/.test(payHdr) && /REVERSES the 9\/21 rule/.test(payHdr), "the call pay migration header must say REPORT-FIRST and APPLIED 2026-09-28 01:15:26Z (the record step; it read NOT APPLIED before), state the blast radius and that it reverses the 9/21 rule");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-27-call-pay\.sql/.test(payHdr) && /SILVIS_CALL_PAY_APPLIED=1 bash scripts\/verify-rls\.sh/.test(payHdr) && /call-pay-probe\.sql/.test(payHdr), "the call pay migration header must carry the CLI apply line, the probe and the strict verify-rls run");
ok(/^-- Rolling back = `drop table if exists public\.call_pay_logs; drop table if exists public\.call_pay_settings;$/m.test(payHdr) && /drop function if exists public\.call_pay_logs_guard\(\); drop function if exists public\.call_pay_settings_touch\(\);`/.test(payHdr), "the call pay migration header must give the rollback (both tables, both functions)");
ok(/NO RATE FIGURE ANYWHERE/.test(payHdr), "the call pay migration header must state that no rate figure is in the repo");
ok(!/^-- supersedes:/m.test(payMig) && !/^-- PREPARED FOLLOW-UP/m.test(payMig), "the call pay migration redefines no existing function (no supersedes line) and is not a NOT-MIRRORED follow-up");
const payStmts = payStatements(payMig);
ok(payStmts.length >= 25, "the call pay migration's statements could not be split (" + payStmts.length + ")");
payStmts.forEach((st) => ok(!/^(drop table|alter table public\.(?!call_pay_)|drop function|create or replace function public\.(?!call_pay_|silvis_pay_enabled\()|update |delete )/i.test(st), "the call pay migration touches only its own two tables / three functions: " + st.slice(0, 120)));
eq(payStmts.filter((st) => /^create table/.test(st)).map((st) => st.match(/public\.([a-z_]+)/)[1]), ["call_pay_settings", "call_pay_logs"], "the call pay migration creates exactly two tables;");
eq(payStmts.filter((st) => /^create or replace function/.test(st)).map((st) => st.match(/public\.([a-z_]+)/)[1]), ["silvis_pay_enabled", "call_pay_logs_guard", "call_pay_settings_touch"], "the call pay migration creates exactly three functions (the 5b switch helper, the guard, the touch);");
{
  // 5b: the switch column and its helper. stipend_off_ids is a JSON array of non-empty strings (roster ids), default '[]' -
  // everyone paid by the stipend until the scheduler switches someone off (data, never a roster id in the repo). The helper is
  // security definer (it reads the settings row whoever the caller is, so the settings read policy does not recurse on itself),
  // stable, with a pinned search_path, and executable by authenticated / service_role only.
  const col = (payMig.match(/^  stipend_off_ids +[^\n]*$/m) || [""])[0];
  ok(col === "  stipend_off_ids                 jsonb not null default '[]'::jsonb check (case when jsonb_typeof(stipend_off_ids) = 'array' then not jsonb_path_exists(stipend_off_ids, 'strict $[*] ? (@.type() != \"string\" || @ == \"\")') else false end),", "call_pay_settings.stipend_off_ids must be `jsonb not null default '[]'` with the array-of-non-empty-strings check: " + col);
  const helper = (payMig.match(/create or replace function public\.silvis_pay_enabled\(pid text\)[\s\S]*?\n\$\$;/) || [""])[0];
  // 9/27 review fix (deliberate pin change, same intent + one gate): the helper answers truly only to a caller entitled to
  // know (no signed-in user - service_role / SQL editor -, the scheduler, the coordinator, the person himself); any other
  // signed-in caller gets an uninformative true - it is callable over /rest/v1/rpc and "who is switched off" is pay status
  ok(helper === "create or replace function public.silvis_pay_enabled(pid text) returns boolean\nlanguage sql stable security definer set search_path = public, pg_temp as $$\n  select pid is not null and (\n    not coalesce(auth.uid() is null or public.silvis_is_sched() or public.silvis_is_coord() or pid = public.silvis_person_id(), false)\n    or not exists (select 1 from public.call_pay_settings s where s.stipend_off_ids ? pid));\n$$;", "silvis_pay_enabled(pid) must read exactly as approved (security definer, stable, search_path public, pg_temp; null -> false; the real answer only to an entitled caller, else true):\n" + helper);
  ok(/answers truly only to a caller entitled to know/.test(payHdr), "the header says who gets the real answer");
  const addCol = payStmts.filter((st) => /^alter table public\.call_pay_settings add column if not exists stipend_off_ids /.test(st));
  ok(addCol.length === 1 && addCol[0] === "alter table public.call_pay_settings add column if not exists stipend_off_ids " + col.trim().replace(/^stipend_off_ids +/, "").replace(/,$/, "") + ";" && payMig.indexOf(addCol[0]) < payMig.indexOf(helper), "a re-run over a pre-5b call_pay_settings adds stipend_off_ids with the same type / default / check, before the helper reads it");
  ok(helper && payMig.indexOf(helper) > payMig.indexOf("create table if not exists public.call_pay_settings") && payMig.indexOf(helper) < payMig.indexOf("create or replace function public.call_pay_logs_guard"), "the helper is created after call_pay_settings (a SQL body is checked at create) and before the guard");
  ["revoke execute on function public.silvis_pay_enabled(text) from public;", "revoke execute on function public.silvis_pay_enabled(text) from anon;", "grant execute on function public.silvis_pay_enabled(text) to authenticated;", "grant execute on function public.silvis_pay_enabled(text) to service_role;"].forEach((g) => ok(payMig.indexOf(g) > 0 && schema.indexOf(g) > 0, "the helper's grants (as offer_status): " + g));
  ok(/drop function if exists public\.silvis_pay_enabled\(text\);/.test(payHdr), "the rollback drops the helper too");
  ok(!/'s[0-9]+'/.test(payStmts.join("\n")), "the migration names no roster id (who is switched off is data the scheduler sets)");
}

step("call pay: schema.sql mirrors every statement of the migration; the six policies read exactly as approved, in order; triggers identical; revision r after q");
const schemaCode = schema.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
payStmts.forEach((st) => ok(schemaCode.indexOf(st) >= 0, "schema.sql does not mirror this call pay statement byte for byte:\n" + st.slice(0, 300)));
Object.keys(PAY_POLICIES).forEach((pn) => {
  ok(policyText(payMig, pn) === PAY_POLICIES[pn], "the migration's policy " + pn + " must read exactly:\n" + PAY_POLICIES[pn]);
  ok(policyText(schema, pn) === PAY_POLICIES[pn], "schema.sql's policy " + pn + " must read exactly:\n" + PAY_POLICIES[pn]);
  eq((schema.match(new RegExp("create policy " + pn + " on ", "g")) || []).length, 1, "schema.sql must create " + pn + " exactly once;");
  ok(schema.indexOf("drop policy if exists " + pn + " on public.") >= 0 && payMig.indexOf("drop policy if exists " + pn + " on public.") >= 0, pn + " must be dropped-if-exists first (idempotency)");
});
eq(Array.from(schema.matchAll(/create policy ([a-z_]+) on public\.call_pay_settings\b/g)).map((m) => m[1]), ["call_pay_settings_read", "call_pay_settings_write"], "call_pay_settings carries exactly these policies, in order;");
eq(Array.from(schema.matchAll(/create policy ([a-z_]+) on public\.call_pay_logs\b/g)).map((m) => m[1]), ["call_pay_logs_read", "call_pay_logs_insert", "call_pay_logs_update", "call_pay_logs_delete"], "call_pay_logs carries exactly these policies, in order;");
ok(schema.indexOf(PAY_POLICIES.call_pay_settings_read) > schema.indexOf("create policy contacts_write on public.office_contacts") && schema.indexOf(PAY_POLICIES.call_pay_settings_read) < schema.indexOf("-- Seed rows"), "the call pay policies sit after contacts_write, before the seed rows");
["call_pay_logs_guard_trg", "call_pay_settings_touch_trg"].forEach((tn) => {
  ok(triggerText(schema, tn) && triggerText(schema, tn) === triggerText(payMig, tn), "trigger " + tn + ": schema.sql differs from the migration");
  ok(payMig.indexOf("drop trigger if exists " + tn + " on public.") >= 0, "trigger " + tn + " must be dropped-if-exists first");
});
ok(/before insert or update on public\.call_pay_logs\n  for each row execute function public\.call_pay_logs_guard\(\);/.test(schema), "call_pay_logs_guard runs BEFORE INSERT OR UPDATE (never on delete: an orphan row stays deletable)");
["call_pay_logs_guard", "call_pay_settings_touch"].forEach((fn) => ok(functionText(schema, fn) === functionText(payMig, fn), fn + "(): schema.sql differs from the migration"));
const payGuard = functionText(payMig, "call_pay_logs_guard");
ok(!/security definer/.test(payGuard), "call_pay_logs_guard must be security invoker (schedule_days is readable by every role)");
ok(/today_c date := \(now\(\) at time zone 'America\/Chicago'\)::date;/.test(payGuard), "call_pay_logs_guard's today is the Central date");
ok(/raise exception 'PAY_FUTURE: [^']*' , ?|raise exception 'PAY_FUTURE: /.test(payGuard) && /using errcode = 'PY001';/.test(payGuard), "PAY_FUTURE / PY001");
ok(/raise exception 'PAY_NOT_PRIMARY: [^\n]*using errcode = 'PY002';/.test(payGuard) && /d\.primary_id = new\.person_id/.test(payGuard), "PAY_NOT_PRIMARY / PY002 against schedule_days.primary_id");
ok(/raise exception 'PAY_HOURS_OVER: [^\n]*using errcode = 'PY003';/.test(payGuard) && /others \+ new\.hours > 24/.test(payGuard) && /l\.id is distinct from new\.id/.test(payGuard), "PAY_HOURS_OVER / PY003 sums the person's OTHER rows of the day");
ok(payGuard.indexOf("PY001") < payGuard.indexOf("PY002") && payGuard.indexOf("PY002") < payGuard.indexOf("PY003"), "the guard refuses in the order PY001, PY002, PY003");
// 5a / 5b: the office coordinator is refused (PY004) and a switched-off person's call-in is refused for everyone (PY005),
// both before the day / primary / hours checks
ok(/  if public\.silvis_is_coord\(\) then\n    raise exception 'PAY_READ_ONLY: [^\n]*using errcode = 'PY004';\n  end if;/.test(payGuard), "PAY_READ_ONLY / PY004: the guard refuses the office coordinator");
ok(/  if not public\.silvis_pay_enabled\(new\.person_id\) then\n    raise exception 'PAY_STIPEND_OFF: [^\n]*using errcode = 'PY005';\n  end if;/.test(payGuard), "PAY_STIPEND_OFF / PY005: the guard refuses a new or edited call-in of a switched-off person, for every caller");
ok(payGuard.indexOf("PY004") < payGuard.indexOf("PY005") && payGuard.indexOf("PY005") < payGuard.indexOf("PY001"), "the guard refuses PY004, then PY005, before PY001-PY003");
ok(/new\.created_by := old\.created_by;/.test(payGuard) && /new\.created_at := old\.created_at;/.test(payGuard) && /new\.created_by := coalesce\(public\.silvis_person_id\(\), auth\.uid\(\)::text, new\.created_by\);/.test(payGuard), "created_by / created_at are stamped on insert and pinned on update");
ok(!/\bsilvis_is_sched\b/.test(payGuard), "the primary-only guard applies to every caller - no scheduler exemption");
ok(/perform pg_advisory_xact_lock\(hashtext\('call_pay:' \|\| new\.person_id \|\| ':' \|\| new\.day::text\)\);\n  select coalesce\(sum\(l\.hours\), 0\) into others/.test(payGuard), "call_pay_logs_guard must take the (person, day) advisory lock right before the 24 h sum (two concurrent inserts must not both pass PY003)");
["call_pay_logs_guard", "call_pay_settings_touch"].forEach((fn) => ok(new RegExp("create or replace function public\\." + fn + "\\(\\) returns trigger\nlanguage plpgsql security invoker set search_path = public as \\$\\$").test(payMig), fn + "() must be security invoker with a pinned search_path (function_search_path_mutable)"));
["call_pay_settings", "call_pay_logs"].forEach((t) => ok(payMig.indexOf("revoke truncate, references, trigger on table public." + t + " from authenticated;") >= 0 && schema.indexOf("revoke truncate, references, trigger on table public." + t + " from authenticated;") >= 0, "authenticated must lose TRUNCATE / REFERENCES / TRIGGER on " + t + " (Supabase's default privileges grant them; RLS does not cover TRUNCATE)"));
const payLoop = schema.match(/foreach t in array array\[[^\]]*\]/);
ok(payLoop && !/call_pay/.test(payLoop[0]), "neither call pay table may be in the anon read_all loop");
["call_pay_settings", "call_pay_logs"].forEach((t) => {
  ok(new RegExp("^alter table public\\." + t + " +enable row level security;$", "m").test(schema), "schema.sql must enable RLS on " + t);
  ok(schema.indexOf("revoke all on table public." + t + " from anon;") >= 0 && payMig.indexOf("revoke all on table public." + t + " from anon;") >= 0, "anon's privileges on " + t + " must be revoked (defence in depth for pay data - the other authenticated-only tables rely on RLS alone)");
  ok(schema.indexOf("grant select, insert, update, delete on table public." + t + " to authenticated;") >= 0, t + " is granted to authenticated");
  ok(!new RegExp("create policy [a-z_]+ on public\\." + t + " for [a-z]+ (?!to authenticated)").test(schema), "every " + t + " policy is `to authenticated`");
});
// No rate figure: the rate columns carry no default, the seed inserts the id only, and no numeric literal beyond the bounds.
["stipend_per_shift", "weekday_callin_rate", "weekend_holiday_callin_rate", "activation_rate"].forEach((c) => {
  const line = (payMig.match(new RegExp("^  " + c + " +[^\\n]*$", "m")) || [""])[0];
  ok(/numeric\(10,2\) check \(/.test(line) && !/default/.test(line), "rate column " + c + " must be numeric(10,2) with a range check and NO default (a figure must never be in the repo): " + line);
});
eq(payStmts.filter((st) => /^insert into/.test(st)), ["insert into public.call_pay_settings (id) values ('main') on conflict (id) do nothing;"], "the migration's only insert is the 'main' settings row with the id alone (every rate null);");
ok(schema.indexOf("insert into public.call_pay_settings (id) values ('main') on conflict (id) do nothing;") > schema.indexOf("-- Seed rows"), "schema.sql seeds the settings row under Seed rows");
const PAY_ALLOWED_NUMBERS = ["0", "1", "2", "4", "5", "10", "24", "200", "99999"];   // check bounds, column precisions and `select 1` only
// moved deliberately (Prompt 29): the call pay block ends at the next `-- ---------- ` section header (the APP call days block follows
// the call pay grants since revision v), else at the Row Level Security header; kept intent: no rate figure in the call pay block.
const payBlockAt = schema.indexOf("-- ---------- call pay (2026-09-27");
const payBlockNext = schema.indexOf("\n-- ---------- ", payBlockAt + 5);
const payBlock = schema.slice(payBlockAt, payBlockNext > 0 && payBlockNext < schema.indexOf("-- Row Level Security") ? payBlockNext : schema.indexOf("-- Row Level Security"));
[["the migration", payStmts.join("\n")], ["schema.sql's call pay block", payBlock.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")]].forEach(([n, txt]) => {
  const stripped = txt.replace("'[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}'", "''").replace(/'[0-9]{4}-[0-9]{2}-[0-9]{2}'/g, "''").replace(/[a-z_]+[0-9]+[a-z_0-9]*/gi, "");
  const nums = Array.from(stripped.matchAll(/\b[0-9]+(\.[0-9]+)?\b/g)).map((m) => m[0]);
  ok(nums.length > 0 && nums.every((x) => PAY_ALLOWED_NUMBERS.includes(x)), n + " carries a numeric literal outside the check bounds / precisions (" + PAY_ALLOWED_NUMBERS.join(", ") + "): " + nums.filter((x) => !PAY_ALLOWED_NUMBERS.includes(x)).join(", "));
});
ok(payBlock.length > 0 && /PY001 PAY_FUTURE/.test(payBlock) && /revoke all/.test(payBlock), "schema.sql's call pay block (after office_notification_state, before the RLS banner) must document PY001-PY003 and the anon revoke");
{
  const rAt = header.search(/^-- Revision 2026-09-27 r \(call pay, sql\/migrations\/2026-09-27-call-pay\.sql, applied 2026-09-28 01:15:26Z after the probe\): /m);
  const qAt = header.search(/^-- Revision 2026-09-25 q /m);
  ok(rAt > 0 && rAt > qAt, "schema.sql's header must record revision 2026-09-27 r (call pay; 'applied 2026-09-28 01:15:26Z after the probe' since the record step, 'report-first, NOT yet applied' before it) after revision q");
  ok(!/NOT yet applied/.test(payBlock) && !/call pay \(2026-09-27, revision r - report-first, NOT yet applied\)/.test(schema), "schema.sql's call pay comments must read applied since the record step (no 'NOT yet applied' left for revision r)");
  const revR = header.slice(rAt).split("\n-- Revision ")[0].split("\n-- Two same-day migrations")[0];
  ok(/PY001/.test(revR) && /not anon-readable|Neither is anon-readable/.test(revR) && /no rate figure/.test(revR) && /reverses the 9\/21/.test(revR), "revision r must name the guards, the anon posture, the absence of rate figures and the 9/21 reversal");
}

step("call pay: the probe is self-rolling-back, raises PROBE_SETUP before the apply, uses past 2020-03 fixtures and five throwaway users, never reads a rate");
const payProbe = read(PAY_PROBE);
ok(!/\r/.test(payProbe), "call pay probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(payProbe), "call pay probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(payProbe) && /grant insert, select on probe_results to authenticated;/.test(payProbe), "call pay probe collects into probe_results granted to authenticated");
const payLastDo = payProbe.lastIndexOf("do $$");
ok(payLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(payProbe.slice(payLastDo)), "call pay probe's last DO block must raise 'PROBE_RESULTS %;END'");
ok(/raise exception 'PROBE_SETUP: call_pay_logs is absent - sql\/migrations\/2026-09-27-call-pay\.sql is not applied';/.test(payProbe) && payProbe.indexOf("PROBE_SETUP: call_pay_logs is absent") < payProbe.indexOf("insert into auth.users"), "call pay probe's setup must raise PROBE_SETUP before any fixture when the tables are absent");
PAY_CASES.forEach((k) => ok(payProbe.indexOf("values ('" + k + "', ") >= 0 || payProbe.indexOf("values ('" + k + "', v)") >= 0, "call pay probe lacks case " + k));
ok(/'probe-pay-' \|\| u \|\| '@example\.test'/.test(payProbe), "call pay probe's throwaway users are probe-pay-<uuid>@example.test");
{
  // 5b: the setup switches s2 / s3 ON before the fixture call-in (whatever the live switches read), the O block switches s3 OFF;
  // the final raise rolls both back (verify-rls 14d reads the list before and after)
  const setOn = payProbe.indexOf("update public.call_pay_settings set stipend_off_ids = stipend_off_ids - 's2' - 's3' where id = 'main';");
  ok(setOn > 0 && setOn < payProbe.indexOf("insert into public.call_pay_logs (day, person_id, hours, note) values ('2020-03-03', 's2', 2, 'probe-pay fixture');"), "the probe setup switches s2 and s3 on BEFORE the fixture call-in");
  const setOff = payProbe.indexOf("update public.call_pay_settings set stipend_off_ids = (stipend_off_ids - 's3') || '[\"s3\"]'::jsonb where id = 'main';");
  ok(setOff > payProbe.indexOf("values ('A4', ") && setOff < payProbe.indexOf("values ('O1', "), "the probe switches s3 off after the A block, before the O cases");
}
ok(/set person_id = 's3', role = 'surgeon' where id = surgeon;/.test(payProbe) && /set person_id = 's2', role = 'surgeon' where id = surgeon2;/.test(payProbe) && /set role = 'coordinator' where id = coord;/.test(payProbe) && /set person_id = 's1', role = 'admin' where id = admin_u;/.test(payProbe) && /role = 'viewer' and person_id is null/.test(payProbe), "call pay probe fixtures: surgeon s3, surgeon s2, an unlinked coordinator, an unlinked viewer, admin s1");
const payProbeCode = payProbe.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
ok(Array.from(payProbeCode.matchAll(/'(20[0-9]{2})-([0-9]{2})-[0-9]{2}'/g)).every((m) => m[1] === "2020" && m[2] === "03"), "every fixture day in the call pay probe is a PAST day in 2020-03 (PY001 refuses a future day)");
Array.from(payProbeCode.matchAll(/insert into public\.call_pay_logs \(day, person_id, hours, note\) values \([^;]*;/g)).forEach((m) => ok(/'probe-pay[^']*'\)/.test(m[0]), "every call_pay_logs insert in the probe carries a 'probe-pay' note (the leftover count keys on it): " + m[0].slice(0, 160)));
{
  // every call_pay_logs read counts probe rows only - except N1, anon's bare count, which must be refused before it reads anything
  const reads = Array.from(payProbeCode.matchAll(/from public\.call_pay_logs\b[^;]*/g)).map((m) => m[0]);
  eq(reads.filter((r) => r.trim() === "from public.call_pay_logs").length, 1, "only N1 (anon) reads call_pay_logs without the probe filter;");
  reads.filter((r) => r.trim() !== "from public.call_pay_logs").forEach((r) => ok(/note like 'probe-pay%'|where id = |l\.person_id = new\.person_id/.test(r), "every call_pay_logs read in the probe counts probe rows only: " + r.slice(0, 160)));
}
ok(!/stipend_per_shift|weekday_callin_rate|weekend_holiday_callin_rate|activation_rate\b/.test(payProbeCode), "the call pay probe never reads or writes a rate column");
ok(/source = 'probe-pay'|'probe-pay'\)/.test(payProbeCode) && /values \('2020-03-02', 's3', 's2', 'probe-pay'\)/.test(payProbeCode), "the probe's schedule_days fixtures carry source 'probe-pay'");
const payProbeHdr = payProbe.slice(0, payProbe.indexOf("create temp table probe_results"));
ok(/REPORT-FIRST; APPLIED 2026-09-28 01:15:26Z\)/.test(payProbeHdr) && !/NOT APPLIED/.test(payProbeHdr) && /-- As run: the migration was applied 2026-09-28 01:15:26Z/.test(payProbeHdr) && /section 14d FAILs a PROBE_SETUP/.test(payProbeHdr), "the call pay probe header must read APPLIED 2026-09-28 01:15:26Z and carry the as-run note (the record step made PROBE_SETUP a FAIL in section 14d)");
Object.keys(PAY_AFTER_EQ).forEach((k) => ok(payProbeHdr.indexOf(PAY_AFTER_EQ[k]) > 0, "call pay probe header must state " + k + "'s AFTER string `" + PAY_AFTER_EQ[k] + "`"));

step("call pay: verify-rls.sh section 14 - anon count=exact reads, the anon POST, the surgeon read, the graded probe, leftovers, the stipend switches by value; strict since the record step (a 404, an anon 200 or PROBE_SETUP FAILs); graded against a faked CLI");
ok(/^echo "== 14\. call pay \(2026-09-27\): anon sees neither table, anon cannot write, rolled-back probe =="$/m.test(vr), "verify-rls.sh has no section 14 (call pay)");
// pin moved deliberately 9/30 (Prompt 27): section 15 (the vacation guard) now follows section 14, so section 14 is bounded at
// section 15's heading when it exists (the RESULT line otherwise) - the pins below keep judging section 14 alone (its one REST
// write, its graded cases), and the faked 14d run below does not run section 15's code.
const s14End = vr.indexOf('echo "== 15. ') > 0 ? vr.indexOf('echo "== 15. ') : vr.indexOf('echo "RESULT: ');
const s14 = vr.slice(vr.indexOf('echo "== 14. '), s14End);
ok(s14.length > 0 && s14.length < vr.length, "verify-rls.sh section 14 could not be sliced out (it sits right before section 15, or the RESULT line)");
ok(/for t in call_pay_settings call_pay_logs; do/.test(s14) && /-H "Prefer: count=exact"/.test(s14), "section 14a must read both tables as anon with count=exact");
ok(/^\s*200\) bad "anon read of \$t: HTTP 200/m.test(s14), "section 14a must FAIL any anon 200 (even Content-Range */0) - the anon revoke is proven over REST (strict since the record step)");
ok(/^\s*404\) bad "anon read of \$t: HTTP 404/m.test(s14) && /"HTTP 404"\) bad "anon POST call_pay_logs: HTTP 404/.test(s14) && /bad "call pay probe: PROBE_SETUP - call_pay_logs is absent/.test(s14), "section 14 must FAIL a 404 and PROBE_SETUP since the record step (the tables exist since the 2026-09-28 apply)");
ok(/-X POST "\$URL\/rest\/v1\/call_pay_logs"/.test(s14) && /"HTTP 401"\|"HTTP 403"\) ok "anon insert into call_pay_logs refused/.test(s14), "section 14b must POST call_pay_logs as anon and accept 401/403 (or 42501)");
ok(/SILVIS_SURGEON_JWT/.test(s14) && /call_pay_logs\?select=person_id/.test(s14), "section 14c must read call_pay_logs as a surgeon (gated on SILVIS_SURGEON_JWT)");
const s14code = s14.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
ok(!/PAYSTRICT14|SILVIS_CALL_PAY_APPLIED/.test(s14code), "section 14's code must not read SILVIS_CALL_PAY_APPLIED any more (the record step made strict the default)");
eq((s14code.match(/-X (POST|PATCH|DELETE|PUT)/g) || []).length, 1, "section 14 writes nothing over REST but the one anon POST that must be refused;");
ok(/call-pay-probe\.sql/.test(s14) && /PROBE14="\$\(cd sql\/probes && \(pwd -W 2>\/dev\/null \|\| pwd\)\)\/call-pay-probe\.sql"/.test(s14), "section 14d must run sql/probes/call-pay-probe.sql through the linked CLI");
PAY_CASES.forEach((k) => ok(new RegExp("expect_(eq|err)14\\s+" + k + "\\s").test(s14), "section 14 does not grade probe case " + k));
Object.keys(PAY_AFTER_EQ).forEach((k) => ok(new RegExp("expect_eq14\\s+" + k + "\\s+\"" + PAY_AFTER_EQ[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s14), "section 14 must grade " + k + " = " + PAY_AFTER_EQ[k]));
ok(/email like 'probe-pay-%@example\.test'/.test(s14) && /source = 'probe-pay'/.test(s14) && /note like 'probe-pay%'/.test(s14) && /LEFT ROWS BEHIND/.test(s14), "section 14 must count leftovers (auth.users / schedule_days / call_pay_logs) and fail on non-zero");
ok(!/SILVIS_CALL_PAY_APPLIED/.test(vr.slice(0, vr.indexOf("set -u"))), "verify-rls.sh's header and --help must no longer name SILVIS_CALL_PAY_APPLIED (the record step dropped it; strict is the default)");
{
  // pin moved deliberately 9/30 (Prompt 27): bounded at section 15's heading (the vacation guard follows 14d), else the RESULT line
  const code14d = vr.slice(vr.indexOf("# 14d."), vr.indexOf('\necho "== 15. ') > 0 ? vr.indexOf('\necho "== 15. ') : vr.indexOf('\necho\necho "RESULT: '));
  // the faked q(): the real CLI's shape (CLI 2.84, as the 9/28 apply run printed it) - indented multi-line JSON with a space
  // after each colon, a RANDOM "boundary" per call and the value JSON-escaped - carrying the leftover count or the stipend switch
  // list: OFFVAL (already escaped, e.g. [\"s3\"]) on every read, unless OFFMARK is set - then the read after the probe answers
  // OFFVAL2; ERR answers a CLI error instead of JSON. The whole-output comparison 14d used until the record step failed the 9/28
  // apply run on the boundary alone (stipend_off_ids [] both times); the layout keeps off14_val's `tr -d ' \n'` under test.
  const PAY_FAKE_Q = String.raw`q() { b="$RANDOM$RANDOM$RANDOM"; case "$1" in *off_ids*) v="$OFFVAL"; if [ -n "$OFFMARK" ]; then if [ -f "$OFFMARK" ]; then v="$OFFVAL2"; else touch "$OFFMARK"; fi; fi; if [ "$v" = ERR ]; then echo 'unexpected status 500: connection refused'; else printf '{\n  "boundary": "%s",\n  "rows": [\n    {\n      "off_ids": "%s"\n    }\n  ],\n  "warning": "untrusted"\n}\n' "$b" "$v"; fi;; *) printf '{\n  "boundary": "%s",\n  "rows": [\n    {\n      "leftover": 0\n    }\n  ],\n  "warning": "untrusted"\n}\n' "$b";; esac; }` + "\n";
  const run14 = (cliOut, off) => {
    off = off || {};
    const script = "set -u\nWORKDIR=/nonexistent; pass=0; fail=0\nok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      "OFFVAL='" + (off.before || "[]") + "'; OFFVAL2='" + (off.after || "") + "'\n" +
      "OFFMARK=" + (off.after !== undefined ? "$(mktemp -u)" : "") + "\ntrap 'rm -f \"$OFFMARK\"' EXIT\n" +
      "linked() { true; }\n" + PAY_FAKE_Q + "supabase() { echo 'Initialising login role...'; echo '" + cliOut.replace(/'/g, "'\\''") + "'; }\n" +
      code14d + "\necho \"RESULT $pass $fail\"\n";
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    ok(!r.error, "bash could not be started to run section 14d: " + (r.error && r.error.message));
    return { out: r.stdout || "", result: ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number), err: r.stderr || "" };
  };
  const fails = (x) => x.out.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") + x.err.slice(0, 200);
  const after = Object.assign({}, PAY_AFTER_EQ, PAY_AFTER_ERR);
  eq(Object.keys(after).sort(), PAY_CASES.slice().sort(), "the faked AFTER picture covers every probe case;");
  const res = Object.keys(after).sort().map((k) => k + "=" + after[k]).join(";");
  const ra = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + res + ';END"}');
  eq(ra.result, [PAY_CASES.length + 2, 0], "section 14d against the AFTER picture: every case + the leftover check + the unchanged stipend switches PASS, though every CLI read carries a different boundary (" + fails(ra) + ");");
  const rs = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + res + ';END"}', { before: '[\\"s3\\"]', after: '[\\"s3\\"]' });
  eq(rs.result, [PAY_CASES.length + 2, 0], "section 14d: an unchanged non-empty switch list (escaped quotes in the CLI's JSON) PASSES (" + fails(rs) + ");");
  ok(/unchanged, "off_ids":"\[\\"s3\\"\]"/.test(rs.out), "section 14d prints the unchanged switch list it compared");
  const rc = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + res + ';END"}', { before: "[]", after: '[\\"s3\\"]' });
  eq(rc.result, [PAY_CASES.length + 1, 1], "section 14d must fail when the stipend switch list differs after the probe (it did not roll back);");
  ok(/CHANGED the stipend switches/.test(rc.out), "section 14d names the changed stipend switches");
  const re = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + res + ';END"}', { before: "ERR" });
  eq(re.result, [PAY_CASES.length + 1, 1], "section 14d must fail when the switch list cannot be read before the probe (never a silent pass);");
  ok(/could not be read before the probe/.test(re.out), "section 14d names the unreadable switch list");
  const rf = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + res + ';END"}', { before: "[]", after: "ERR" });
  eq(rf.result, [PAY_CASES.length + 1, 1], "section 14d must fail when the switch list reads before the probe but not after it;");
  ok(/could not be read after the probe/.test(rf.out), "section 14d names the switch list unreadable after the probe");
  const setup = '{"message": "ERROR: P0001: PROBE_SETUP: call_pay_logs is absent - sql/migrations/2026-09-27-call-pay.sql is not applied"}';
  eq(run14(setup).result, [1, 1], "section 14d since the record step: PROBE_SETUP is a FAIL (the leftover check still runs without the missing table);");
  const broken = Object.assign({}, after, { S3: "inserted (NO refusal)", C1: "sees_all=f coord=0 postgres=2" });
  const rb = run14('{"message": "ERROR: P0001: PROBE_RESULTS ' + Object.keys(broken).sort().map((k) => k + "=" + broken[k]).join(";") + ';END"}');
  eq(rb.result, [PAY_CASES.length, 2], "section 14d must fail a surgeon writing for another surgeon and an office read that is not every call-in;");
}

{
  // 14a against a faked curl, strict since the record step: an anon 401 / 403 passes; a 200 (even + */0) and a 404 fail
  const code14a = s14.slice(s14.indexOf("for t in call_pay_settings call_pay_logs; do"), s14.indexOf("line=$(curl"));
  const run14a = (status, range) => {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "vr14a-"));
    const script = "set -u\nT=" + tmp + "; URL=http://x; ANON=a; pass=0; fail=0\nok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      "curl() { local o=''; while [ $# -gt 0 ]; do if [ \"$1\" = -o ]; then o=\"$2\"; shift; fi; shift; done; echo '[]' > \"$o\"; printf 'HTTP/2 " + status + "\\r\\n" + (range ? "content-range: " + range + "\\r\\n" : "") + "\\r\\n'; }\n" +
      code14a + "\necho \"RESULT $pass $fail\"\n";
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    fs.rmSync(tmp, { recursive: true, force: true });
    return ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number);
  };
  ok(code14a.length > 0, "section 14a's loop could not be sliced out");
  eq(run14a(200, "*/0"), [0, 2], "section 14a: anon 200 + */0 FAILS (the revoke did not take);");
  eq(run14a(200, ""), [0, 2], "section 14a: anon 200 without a Content-Range FAILS;");
  eq(run14a(401, ""), [2, 0], "section 14a: anon 401 passes;");
  eq(run14a(403, ""), [2, 0], "section 14a: anon 403 passes;");
  eq(run14a(404, ""), [0, 2], "section 14a: 404 fails (the tables exist since the 2026-09-28 apply);");
}

step("call pay: docs - SCHEMA-REVIEW.md section (APPLIED + observed line since the record step, policies verbatim, blast radius, apply order, rollback), tables (a) / (b), guide 4.2 / 4.3");
ok(/^## 2026-09-27 - call pay: call_pay_settings \+ call_pay_logs \(Faraz 9\/27; `sql\/migrations\/2026-09-27-call-pay\.sql`\)$/m.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-27 - call pay: call_pay_settings + call_pay_logs (Faraz 9/27; `sql/migrations/2026-09-27-call-pay.sql`)' section");
const reviewPay = (() => { const at = review.indexOf("## 2026-09-27 - call pay:"), end = review.indexOf("\n## ", at + 1); return at < 0 ? "" : review.slice(at, end < 0 ? review.length : end); })();
ok(/\*\*Status: APPLIED 2026-09-28 01:15:26Z\.\*\*/.test(reviewPay) && !/\*\*Status: PREPARED/.test(reviewPay), "the call pay section's status line must read `**Status: APPLIED 2026-09-28 01:15:26Z.**` since the record step (PREPARED - report-first, NOT APPLIED before it)");
Object.keys(PAY_POLICIES).forEach((pn) => ok(reviewPay.includes(PAY_POLICIES[pn].replace(/\n  /g, "\n      ")), "the call pay section must quote " + pn + " verbatim (indented as a code block)"));
ok(/Blast radius/.test(reviewPay) && /notify pgrst, 'reload schema'/.test(reviewPay) && /What could break/.test(reviewPay), "the call pay section must state the blast radius (incl. the schema cache) and what could break");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-27-call-pay\.sql/.test(reviewPay) && /SILVIS_CALL_PAY_APPLIED=1 bash scripts\/verify-rls\.sh/.test(reviewPay) && /to_regclass\('public\.call_pay_logs'\)/.test(reviewPay) && /Setup > Pay rates/.test(reviewPay), "the call pay section's apply order: pre-check, probe BEFORE, apply, probe AFTER, strict verify-rls, the rates entered in Setup, the record step");
ok(/drop table if exists public\.call_pay_logs;/.test(reviewPay.slice(reviewPay.indexOf("Rolling back"))), "the call pay section's rollback must drop both tables");
{
  const obsPay = (reviewPay.match(/^observed: [^\n]*/m) || [""])[0];
  ok(!/_to be filled/.test(obsPay) && /^observed: applied 2026-09-28 01:15:26Z/.test(obsPay) && /PROBE_SETUP: call_pay_logs is absent/.test(obsPay) && /all 52 cases exactly as the header lists/.test(obsPay) &&
    /`P1=policies=call_pay_logs_delete,call_pay_logs_insert,call_pay_logs_read,call_pay_logs_update,call_pay_settings_read,call_pay_settings_write`/.test(obsPay) &&
    /`O12=admin=f coord=f self=f nojwt=f`/.test(obsPay) && /RESULT: 271 passed, 0 failed/.test(obsPay) && /random `boundary`/.test(obsPay) && /No rate and no switch entered/.test(obsPay),
    "the call pay section's observed line (the record step) must carry the apply time, probe BEFORE / AFTER (52 cases), the verify-rls counts, the 14d boundary fix and that no rate or switch was entered");
}
["call_pay_settings", "call_pay_logs"].forEach((t) => {
  ok(new RegExp("^\\| `" + t + "` [^\\n]*\\*\\*applied live 2026-09-28 01:15 UTC\\*\\*", "m").test(tblA) && !new RegExp("^\\| `" + t + "` [^\\n]*NOT APPLIED", "m").test(tblA), "SCHEMA-REVIEW table (a) needs a `" + t + "` row marked **applied live 2026-09-28 01:15 UTC** (the record step)");
  ok(new RegExp("^\\| `" + t + "` - applied 2026-09-28, call pay 9/27 \\|", "m").test(tblB), "SCHEMA-REVIEW table (b) needs a `" + t + "` row marked applied 2026-09-28 (the record step)");
});
const g42 = guide.slice(guide.indexOf("### 4.2 Tables"), guide.indexOf("### 4.3 RLS posture"));
ok(/`call_pay_settings`/.test(g42) && /`call_pay_logs`/.test(g42), "guide 4.2 must list the two call pay tables");
{
  const cpBullet = (g43.match(/^- \*\*Call pay \(2026-09-27, [^\n]*/m) || [""])[0];
  const cpProof = (g43.match(/^Proof: `sql\/probes\/call-pay-probe\.sql`[^\n]*/m) || [""])[0];
  ok(/^- \*\*Call pay \(2026-09-27, report-first, applied 2026-09-28 01:15 UTC; `sql\/migrations\/2026-09-27-call-pay\.sql`, revision r\)\.\*\*/.test(cpBullet), "guide 4.3 must carry the 'Call pay (2026-09-27, report-first, applied 2026-09-28 01:15 UTC; ...)' bullet (the record step; it read 'report-first, NOT applied' before)");
  ok(/52 cases in its header/.test(cpProof) && /applied: 2026-09-28 01:15:26 UTC/.test(cpProof) && !/_to be filled/.test(cpProof) && !/SILVIS_CALL_PAY_APPLIED/.test(cpProof) && /verify-rls 271 \/ 0/.test(cpProof), "guide 4.3's call pay Proof line must carry the 52 probe cases, 'applied: 2026-09-28 01:15:26 UTC' and verify-rls 271 / 0 (no flag since the record step)");
}
console.log("- call pay: two new authenticated-only tables (report-first, applied 2026-09-28 01:15:26Z), mirrored, probe + verify-rls section 14 (strict) graded against a faked CLI, docs pinned");

// ---- Vacation guard (2026-09-30, Faraz 9/30 - Prompt 27: "need at least 2 surgeons around") ----
// sql/migrations/2026-09-30-vacation-guard.sql (REPORT-FIRST; APPLIED 2026-10-01 16:53:33Z by Faraz; revision s) adds ONE trigger
// function and ONE trigger on time_off and touches nothing that exists: VG001 VACATION_TOO_FEW_AROUND when, on a day the row takes the
// person off, fewer than groupRules.vacations.minSurgeonsAround (default 2) active roster surgeons would stay around (off = a time_off
// row or an East vacation not reviewed 'home'); the scheduler and a no-user session pass, the coordinator is refused. schema.sql
// mirrors it; sql/probes/vacation-guard-probe.sql proves it (rolled back) and verify-rls.sh section 15 grades it.
// pins moved deliberately 10/1 (the record step, like call pay's): the applied wording everywhere; verify-rls section 15 strict by
// default (PROBE_SETUP FAILs, SILVIS_VACATION_GUARD_APPLIED gone) and verify-rls sets the CLI's agent mode (AI_AGENT) itself; the
// migration file is kept byte for byte as it ran - its body is pinned by sha256 (the offers pattern: annotated only in ONE
// trailer line), so its header still reads as it ran ("REPORT-FIRST, NOT APPLIED", the flag in its apply order).
const VG_FILE = "2026-09-30-vacation-guard.sql";
const VG_MIGRATION = path.join(ROOT, "sql", "migrations", VG_FILE);
const VG_PROBE = path.join(ROOT, "sql", "probes", "vacation-guard-probe.sql");
const VG_OVERLIMIT = path.join(ROOT, "sql", "probes", "vacation-guard-overlimit.sql");
// sha256 of the applied file, observed 2026-10-01: the file apply-vacation-guard.sh ran (repo HEAD 00d446b, unchanged since d97dba0;
// sha256sum of Faraz's clone's copy and of `git show 00d446b:sql/migrations/2026-09-30-vacation-guard.sql` agree).
const VG_APPLIED_SHA256 = "6b6b4a31cae2ff619f94f8849e70d215a2f0c2155f59dacadae56731617f3db0";
// The repo copy carries ONE trailer line after the applied body; the body (everything before it) is what is hashed.
const VG_TRAILER = "\n-- applied 2026-10-01 16:53:33Z by Faraz";
// pin moved deliberately 10/1 (review item 8): two cases added - D1 (a surgeon already off that day enters another row over
// it: ok, decision 4) and U1 (the coordinator moves a row to another surgeon onto a day at the limit: VG(10/10)); 18 -> 20.
const VG_CASES = ["P1", "P2", "P3", "P4", "S1", "S2", "S3", "S4", "E1", "E2", "E3", "I1", "K1", "K2", "C1", "M1", "A1", "N1", "D1", "U1"];
const VG_MSG = (days) => "ERR VG001 VACATION_TOO_FEW_AROUND: on " + days + " only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler";
const VG_AFTER_EQ = {
  P1: "active=6 min=2", P2: "east=yes", P3: "triggers=time_off_no_call_conflict_trg,time_off_vacation_guard_trg definer=t",
  S1: "ok", S2: VG_MSG("10/16, 10/17"), S3: VG_MSG("10/19"), S4: "updated=1",
  E1: VG_MSG("10/1"), E2: "ok", E3: VG_MSG("10/7"), I1: "ok",
  C1: VG_MSG("10/9, 10/10"), M1: VG_MSG("10/25"), A1: "ok", N1: "ok",
  D1: "ok", U1: VG_MSG("10/10"),
};
// what the probe records AFTER the apply for the cases graded by code + substring (K1 / K2 carry the live roster id of n1)
const VG_AFTER_ERR = {
  K1: "ERR P0001 ON_CALL_CONFLICT: s2 is on call 10/13 (primary), trade those shifts before entering this vacation",
  K2: "ERR P0001 ON_CALL_CONFLICT: s2 is on call 10/29 (backup), trade those shifts before entering this vacation",
};
const VG_TRIGGER = "create trigger time_off_vacation_guard_trg\n  before insert or update on public.time_off\n  for each row execute function public.time_off_vacation_guard();";

step("vacation guard: the migration = the applied file (sha256 of the body; APPLIED 2026-10-01 16:53:33Z in ONE trailer line) - one NEW trigger function + one NEW trigger on time_off (blast radius, apply order, rollback), no supersedes, mirrored (not exempt)");
const vgBuf = fs.existsSync(VG_MIGRATION) ? fs.readFileSync(VG_MIGRATION) : null;
ok(vgBuf, "missing file " + path.relative(ROOT, VG_MIGRATION));
const vgMig = vgBuf.toString("utf8");
ok(!/\r/.test(vgMig), "vacation guard migration has CRLF line endings");
{
  // the record step (10/1): the file that ran is the file that is kept - the body hashed, the apply noted after it in ONE line
  const at = vgBuf.indexOf(VG_TRAILER);
  ok(at > 0, "the vacation guard migration must carry its trailer line `" + VG_TRAILER.slice(1) + " ...` after the applied body (the record step)");
  const tail = at > 0 ? vgBuf.slice(at + 1).toString("utf8") : "";
  ok(tail.split("\n").filter((l) => l.length).length === 1 && tail.endsWith("\n"), "vacation guard migration: exactly ONE trailer line after the applied body");
  ok(tail.includes("the body above this line is the applied file, sha256 " + VG_APPLIED_SHA256) && tail.includes("AI_AGENT=1") && tail.includes("docs/SCHEMA-REVIEW.md"), "the trailer names the applied sha256, the agent-mode run and the record");
  eq(crypto.createHash("sha256").update(at > 0 ? vgBuf.slice(0, at + 1) : vgBuf).digest("hex"), VG_APPLIED_SHA256,
    "vacation guard migration body sha256 must equal the applied file's (strip nothing; annotate only in the trailer line);");
}
ok(migFiles.includes(VG_FILE) && !PREPARED_NOT_MIRRORED.includes(VG_FILE), "sql/migrations/" + VG_FILE + " is a mirrored migration (not exempt)");
const vgHdr = vgMig.slice(0, vgMig.indexOf("create or replace function public.time_off_vacation_guard()"));
// pin kept deliberately 10/1 (the record step): the header is the text as it ran (the body is sha256-pinned above), so it still
// says REPORT-FIRST, NOT APPLIED; the APPLIED note is the trailer line.
ok(/^-- REPORT-FIRST, NOT APPLIED \(/m.test(vgHdr) && /Blast radius/.test(vgHdr) && /What the trigger sees/.test(vgHdr) && /Who it binds/.test(vgHdr) && /Need at least 2 surgeons around/.test(vgHdr), "the vacation guard migration header (as it ran) must say REPORT-FIRST, NOT APPLIED, quote Faraz, and state what the trigger sees, whom it binds and the blast radius");
ok(/supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-30-vacation-guard\.sql/.test(vgHdr) && /SILVIS_VACATION_GUARD_APPLIED=1 bash scripts\/verify-rls\.sh/.test(vgHdr) && /vacation-guard-probe\.sql/.test(vgHdr) && /vacation-guard-overlimit\.sql/.test(vgHdr) && /to_regprocedure\('public\.time_off_vacation_guard\(\)'\)/.test(vgHdr), "the header carries the pre-check, the over-limit query, the probe, the CLI apply line and the strict verify-rls run");
ok(/^-- Rolling back = `drop trigger if exists time_off_vacation_guard_trg on public\.time_off; drop function if exists public\.time_off_vacation_guard\(\);`$/m.test(vgHdr), "the header gives the rollback (the trigger, then the function)");
ok(/VG001 VACATION_TOO_FEW_AROUND: on 3\/18, 3\/19 only 1 of 6 surgeons would be around \(minimum 2\) - pick other dates or ask the scheduler/.test(vgHdr), "the header quotes the refusal");
ok(!/^-- supersedes:/m.test(vgMig) && !/^-- PREPARED FOLLOW-UP/m.test(vgMig), "the vacation guard migration redefines no existing function (no supersedes line) and is not a NOT-MIRRORED follow-up");
const vgStmts = payStatements(vgMig);
eq(vgStmts.map((st) => st.split("\n")[0]), ["create or replace function public.time_off_vacation_guard() returns trigger", "drop trigger if exists time_off_vacation_guard_trg on public.time_off;", "create trigger time_off_vacation_guard_trg"], "the migration is exactly the function, the drop-if-exists and the trigger;");
eq(vgStmts[2], VG_TRIGGER, "the trigger: BEFORE INSERT OR UPDATE, FOR EACH ROW, on time_off;");
ok("time_off_no_call_conflict_trg" < "time_off_vacation_guard_trg", "the on-call trigger fires first (Postgres fires BEFORE ROW triggers in name order)");
const vgFn = functionText(vgMig, "time_off_vacation_guard");
ok(vgFn && vgFn.startsWith("create or replace function public.time_off_vacation_guard() returns trigger\nlanguage plpgsql security definer set search_path = public, pg_temp as $$\n"), "time_off_vacation_guard must be security definer with search_path public, pg_temp (the reads must not depend on the caller's RLS)");
eq((vgFn.match(/raise exception/g) || []).length, 1, "one refusal, one code;");
ok(/raise exception 'VACATION_TOO_FEW_AROUND: on % of % surgeons would be around \(minimum %\) - pick other dates or ask the scheduler',\n      over_txt, cardinality\(active\), min_around using errcode = 'VG001';/.test(vgFn), "the refusal: VG001 VACATION_TOO_FEW_AROUND with the days, the active count and the minimum");
{
  const lock = vgFn.indexOf("  perform pg_advisory_xact_lock(hashtext('time_off:vacation_guard'));");
  const bypass = vgFn.indexOf("  if auth.uid() is null or public.silvis_is_sched() then\n    return new;\n  end if;");
  const blob = vgFn.indexOf("  select c.data into blob from public.call_schedule_data c where c.id = 'main';");
  ok(lock > 0 && bypass > lock && blob > bypass, "the advisory lock, then the scheduler / no-user exit, then the blob read (" + [lock, bypass, blob] + ")");
  ok(vgFn.indexOf("if tg_op = 'UPDATE' then\n    if new.person_id = old.person_id then\n      if new.start_date >= old.start_date and new.end_date <= old.end_date then\n        return new;\n      end if;\n      o_start := old.start_date;\n      o_end := old.end_date;\n    end if;\n    ex_old := old.id;\n  end if;") > 0 && vgFn.indexOf("if tg_op = 'UPDATE'") < lock, "an UPDATE that takes the person off no new day returns first; a widening checks only the NEW-minus-OLD days of the same person");
}
ok(!/silvis_is_coord/.test(vgFn), "no office exemption: the coordinator is refused like a surgeon");
ok(vgFn.includes("  min_around  int := 2;") && vgFn.includes("if jsonb_typeof(blob #> '{groupRules,vacations,minSurgeonsAround}') = 'number' then") && vgFn.includes("if m = trunc(m) and m >= 0 and m <= 99 then"), "the minimum: groupRules.vacations.minSurgeonsAround, a whole number 0-99, else 2 (helpers.vacationRules)");
ok(vgFn.includes("and coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external'") && vgFn.includes("if not (new.person_id = any(active)) then\n    return new;\n  end if;"), "counted over the ACTIVE roster (active not false, not external); a non-active person passes");
ok(vgFn.includes("'eastFeed', 'enabled']) = 'true'::jsonb") && vgFn.includes("'eastFeed', 'eastBlocksPrimary']) = 'true'::jsonb") && vgFn.includes("'eastFeed', 'eastBlocksBackup']) = 'true'::jsonb") && vgFn.includes("coalesce(e.r->>'code', '') <> ''"), "the East people: the app's eastVacationPerson (an enabled East feature that blocks a role, a roster code)");
ok(vgFn.includes("where (f.data->'isForecast') is distinct from 'true'::jsonb") && vgFn.includes("upper(coalesce(v.r->>'code', '')) = east_codes[array_position(east_ids, a.id)]") && vgFn.includes("and to_char(d.day, 'YYYY-MM-DD') between v.r->>'start' and v.r->>'end')"), "the East ranges: the east_feed payload by roster code, forecast rows skipped, compared as YYYY-MM-DD text (never cast)");
ok(vgFn.includes("and not exists (select 1 from public.east_vacation_reviews w\n                             where w.person_id = a.id and w.decision = 'home' and d.day between w.\"start\" and w.\"end\"))"), "a day a 'home' review covers is not off; away and unreviewed are");
ok(vgFn.includes("where t.person_id = a.id and t.id <> new.id and t.id is distinct from ex_old"), "the row being written (and on an UPDATE its old version) is not counted");
ok(vgFn.includes("     where not exists (select 1 from off_before o where o.day = d.day and o.id = new.person_id)"), "a day the person is already off by another row / an East vacation is not checked");
{
  // the message parity with helpers.js: the SQL builds the day list exactly as vacationGuardMessage does
  const H = require(path.join(ROOT, "helpers.js"));
  const fmt = (vgFn.match(/raise exception '(VACATION_TOO_FEW_AROUND: [^']*)'/) || [])[1] || "";
  ok(fmt.startsWith(H.VG_CODE + ": on ") && fmt.endsWith(H.VG_TAIL), "the SQL text starts with helpers VG_CODE and ends with VG_TAIL");
  ok(vgFn.includes("string_agg(case when n = 1 then to_char(s, 'FMMM/FMDD')\n                           when n = 2 then to_char(s, 'FMMM/FMDD') || ', ' || to_char(e, 'FMMM/FMDD')\n                           else to_char(s, 'FMMM/FMDD') || '-' || to_char(e, 'FMMM/FMDD') end, ', ' order by s) as txt") &&
     vgFn.includes("select string_agg(txt || ' only ' || around, '; on ' order by first_day) into over_txt from by_count;") &&
     vgFn.includes("day - (row_number() over (partition by around order by day))::int as grp"), "the SQL runs: 'M/D', 'M/D, M/D', 'M/D-M/D', grouped by the count in the order of the first day, '; on ' between groups");
  const sql = (over, n, min) => fmt.replace("%", over).replace("%", String(n)).replace("%", String(min));
  eq(sql("3/18, 3/19 only 1", 6, 2), H.vacationGuardMessage([{ day: "2027-03-18", around: 1 }, { day: "2027-03-19", around: 1 }], 6, 2), "the SQL text = helpers.vacationGuardMessage (one group);");
  eq(sql("3/18, 3/20 only 1; on 3/19 only 0", 6, 2), H.vacationGuardMessage([{ day: "2027-03-18", around: 1 }, { day: "2027-03-19", around: 0 }, { day: "2027-03-20", around: 1 }], 6, 2), "the SQL text = helpers.vacationGuardMessage (two groups);");
  eq(sql("3/16-3/18 only 1", 6, 3), H.vacationGuardMessage([{ day: "2027-03-16", around: 1 }, { day: "2027-03-17", around: 1 }, { day: "2027-03-18", around: 1 }], 6, 3), "the SQL text = helpers.vacationGuardMessage (a run of three);");
}

step("vacation guard: schema.sql mirrors every statement (the function byte for byte, the trigger after the on-call trigger), revision s 'applied 2026-10-01 16:53:33Z' after revision r");
vgStmts.forEach((st) => ok(schemaCode.indexOf(st) >= 0, "schema.sql does not mirror this vacation guard statement byte for byte:\n" + st.slice(0, 300)));
ok(functionText(schema, "time_off_vacation_guard") === vgFn, "time_off_vacation_guard(): schema.sql differs from the migration");
{
  const onCall = schema.indexOf("  for each row execute function public.time_off_no_call_conflict();");
  // pins moved deliberately 10/1 (the record step): the block comment and revision s read applied 2026-10-01 16:53:33Z
  const block = schema.indexOf("-- ---------- vacation guard (2026-09-30, Faraz 9/30 - Prompt 27; sql/migrations/2026-09-30-vacation-guard.sql, revision s - report-first; applied 2026-10-01 16:53:33Z)");
  ok(!/vacation-guard\.sql[^\n]*NOT yet applied/.test(schema), "schema.sql no longer calls the vacation guard 'NOT yet applied' (the record step)");
  const trg = schema.indexOf(VG_TRIGGER);
  const avail = schema.indexOf("-- ---------- dated availability statements");
  ok(onCall > 0 && block > onCall && trg > block && avail > trg, "schema.sql's vacation guard block sits right after the on-call trigger, before the availability table (" + [onCall, block, trg, avail] + ")");
  eq((schema.match(/create trigger time_off_vacation_guard_trg/g) || []).length, 1, "one vacation guard trigger in schema.sql;");
  const sAt = header.search(/^-- Revision 2026-09-30 s \(vacation guard, sql\/migrations\/2026-09-30-vacation-guard\.sql, applied 2026-10-01 16:53:33Z after the probe\): /m);
  const rAt = header.search(/^-- Revision 2026-09-27 r /m);
  ok(sAt > 0 && sAt > rAt, "schema.sql's header must record revision 2026-09-30 s (vacation guard; 'applied 2026-10-01 16:53:33Z after the probe' since the record step, 'report-first, NOT yet applied' before it) after revision r");
  const revS = header.slice(sAt).split("\n-- Revision ")[0].split("\n-- Two same-day migrations")[0];
  ok(/VG001 VACATION_TOO_FEW_AROUND/.test(revS) && /minSurgeonsAround/.test(revS) && /the scheduler and a no-user session pass, the coordinator is refused like a surgeon/.test(revS) && /No table, column, policy, grant or existing function changes/.test(revS), "revision s must name the code, the minimum, who passes and that nothing existing changes");
  // review 10/1 item 7: the known gap is written down where the trigger is described - revision s, the block comment, the migration header
  ok(/Known gap \(review 10\/1\): the rule is enforced only when a time_off\n-- row is written/.test(revS) && /east_vacation_reviews/.test(revS.slice(revS.indexOf("Known gap"))) && /vacation-guard-overlimit\.sql lists such days/.test(revS), "revision s must state the known gap (only a time_off write is checked; an East review / a feed range is never refused; the over-limit query lists such days)");
  const blk = schema.slice(block, trg);
  ok(/Known gap: only a time_off write is checked - an East review turned 'away' or a new\n-- Davenport range from the feed refresh can leave a day under the minimum/.test(blk), "schema.sql's vacation guard block comment must state the known gap");
}
{
  const gapAt = vgHdr.indexOf("-- Known gap (review 10/1). The rule is enforced only when a time_off row is written.");
  const gapTxt = gapAt < 0 ? "" : vgHdr.slice(gapAt).split("\n--\n")[0].replace(/\n-- ?/g, " ");
  ok(gapAt > vgHdr.indexOf("-- Blast radius:") && gapTxt.includes("an East review changed to 'away'") && gapTxt.includes("a new or longer Davenport range arriving through the East feed refresh") && gapTxt.includes("vacation-guard-overlimit.sql lists such days"), "the migration header must state the known gap after the blast radius");
  ok(/The month painter \(Setup > Vacations > Paint month\) opens for the scheduler\n-- only/.test(vgHdr), "the migration's blast radius must say the month painter is the scheduler's (review 10/1 item 14)");
}

step("vacation guard: the probe is self-rolling-back, raises PROBE_SETUP before the apply, reads (never writes) the live roster, uses far-future 2030-10 fixtures and four throwaway users, states every AFTER string");
const vgProbe = read(VG_PROBE);
ok(!/\r/.test(vgProbe), "vacation guard probe has CRLF line endings");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(vgProbe), "vacation guard probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(/create temp table probe_results/.test(vgProbe) && /grant insert, select on probe_results to authenticated;/.test(vgProbe), "vacation guard probe collects into probe_results granted to authenticated");
const vgLastDo = vgProbe.lastIndexOf("do $$");
ok(vgLastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(vgProbe.slice(vgLastDo)), "vacation guard probe's last DO block must raise 'PROBE_RESULTS %;END'");
ok(/raise exception 'PROBE_SETUP: time_off_vacation_guard is absent - sql\/migrations\/2026-09-30-vacation-guard\.sql is not applied';/.test(vgProbe) && vgProbe.indexOf("PROBE_SETUP: time_off_vacation_guard is absent") < vgProbe.indexOf("insert into auth.users"), "the setup raises PROBE_SETUP before any fixture when the trigger is absent");
VG_CASES.forEach((k) => ok(vgProbe.indexOf("values ('" + k + "', ") >= 0, "vacation guard probe lacks case " + k));
ok(/'probe-vacguard-' \|\| u \|\| '@example\.test'/.test(vgProbe), "the throwaway users are probe-vacguard-<uuid>@example.test");
ok(vgProbe.includes("update public.user_profiles set person_id = n[1], role = 'surgeon' where id = surgeon;") && vgProbe.includes("update public.user_profiles set person_id = n[2], role = 'surgeon' where id = surgeon2;") && vgProbe.includes("update public.user_profiles set role = 'coordinator' where id = coord;") && vgProbe.includes("update public.user_profiles set role = 'admin' where id = admin_u;"), "the acting users: surgeon n1, surgeon n2, an unlinked coordinator, an unlinked admin");
const vgProbeCode = vgProbe.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
ok(!/(update|insert into|delete from)\s+public\.call_schedule_data/.test(vgProbeCode), "the probe never writes the blob (the roster is read, never modified - not even inside its transaction)");
ok(vgProbeCode.includes("select c.data into blob from public.call_schedule_data c where c.id = 'main';"), "the probe reads the live roster from the blob");
{
  const days = Array.from(vgProbeCode.matchAll(/'(20[0-9]{2}-[0-9]{2}-[0-9]{2})'/g)).map((m) => m[1]);
  ok(days.length > 20 && days.every((d) => d.slice(0, 7) === "2030-10" || d === "2030-09-30"), "every fixture day in the probe is a far-future 2030-10 day (or the east_feed week 2030-09-30): " + days.filter((d) => !(d.slice(0, 7) === "2030-10" || d === "2030-09-30")).join(", "));
  const inserts = Array.from(vgProbeCode.matchAll(/insert into public\.time_off \(person_id, start_date, end_date, note\) values ([^;]*);/g)).map((m) => m[1]);
  ok(inserts.length >= 12, "the probe's time_off inserts could not be found (" + inserts.length + ")");
  inserts.forEach((v) => v.split(/\),\s*\(/).forEach((t) => ok(/'probe-vacguard[^']*'\)?\s*$/.test(t.replace(/\s*returning id into rid\s*$/, "")), "every time_off row the probe writes carries a 'probe-vacguard' note (the leftover count keys on it): " + t.slice(0, 140))));
  ok(vgProbeCode.includes("values ('2030-10-13', n[1], null, 'probe-vacguard'), ('2030-10-29', null, n[1], 'probe-vacguard');"), "the schedule_days fixtures carry source 'probe-vacguard' (10/13 primary n1, 10/29 backup n1)");
  ok(vgProbeCode.includes("jsonb_build_object('probe', 'vacguard', 'vacations', jsonb_build_array(") && vgProbeCode.includes("values (e_id, '2030-10-01', '2030-10-02', 'away', 'probe-vacguard'), (e_id, '2030-10-04', '2030-10-05', 'home', 'probe-vacguard');"), "the East fixtures: one east_feed row (data.probe vacguard) with three ranges, an away and a home review (decided_by probe-vacguard), the third range unreviewed");
  ok(/raise exception 'PROBE_SETUP: live rows already sit in 2030-10/.test(vgProbeCode) && /raise exception 'PROBE_SETUP: a cached East vacation range already touches 2030-10/.test(vgProbeCode), "the setup refuses to run over live rows in 2030-10");
  // review 10/1 item 8: D1 as the second surgeon n2 over a day at the limit he is already off; U1 as the coordinator, moving the D1 row to n1
  const d1 = vgProbeCode.indexOf("insert into public.time_off (person_id, start_date, end_date, note) values (n2, '2030-10-10', '2030-10-10', 'probe-vacguard D1');");
  const d1Jwt = vgProbeCode.lastIndexOf("perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);", d1);
  ok(d1 > 0 && d1Jwt > 0 && d1Jwt > vgProbeCode.indexOf("values ('K2', "), "D1: n2's session (u2), after K2, inserts n2 on 10/10 with the 'probe-vacguard D1' note");
  const u1 = vgProbeCode.indexOf("update public.time_off set person_id = n1 where note = 'probe-vacguard D1';");
  const coordBlock = vgProbeCode.indexOf("select v into u from probe_ctx where k = 'coord';");
  ok(u1 > coordBlock && coordBlock > d1 && u1 < vgProbeCode.indexOf("select v into u from probe_ctx where k = 'admin';"), "U1: in the coordinator's block (after D1, before A1), the D1 row moved to n1 by note");
  ok(/do \$\$ declare u text; n1 text; n2 text; n int; begin\n  select v into u from probe_ctx where k = 'coord';/.test(vgProbeCode), "the coordinator's block declares n for U1's row count");
}
const vgProbeHdr = vgProbe.slice(0, vgProbe.indexOf("create temp table probe_results"));
// pin moved deliberately 10/1 (the record step, like call pay's probe header): APPLIED 2026-10-01 16:53:33Z + the as-run note
ok(/REPORT-FIRST; APPLIED 2026-10-01 16:53:33Z\)/.test(vgProbeHdr) && !/NOT APPLIED/.test(vgProbeHdr) && /-- As run: the migration was applied 2026-10-01 16:53:33Z/.test(vgProbeHdr) && /section\n-- 15 FAILs a PROBE_SETUP/.test(vgProbeHdr) && /WITHOUT PERSISTING ANYTHING/.test(vgProbeHdr) && /does not modify the blob/.test(vgProbeHdr), "the probe header: report-first, APPLIED 2026-10-01 16:53:33Z with the as-run note (section 15 FAILs a PROBE_SETUP since the record step), nothing persisted, the blob never modified");
ok(vgProbeHdr.includes("VG(days) below = '" + VG_MSG("<days>") + "'."), "the probe header defines VG(days) as the full refusal");
Object.entries({ P1: "active=6 min=2", P2: "east=yes", P3: VG_AFTER_EQ.P3, P4: "inactive=roster | inactive=non-roster", S1: "ok", S2: "VG(10/16, 10/17)", S3: "VG(10/19)", S4: "updated=1", E1: "VG(10/1)", E3: "VG(10/7)", C1: "VG(10/9, 10/10)", M1: "VG(10/25)",
  K1: "ERR P0001 ON_CALL_CONFLICT: <n1> is on call 10/13 (primary), trade those shifts before entering this vacation", K2: "ERR P0001 ON_CALL_CONFLICT: <n1> is on call 10/29 (backup), trade those shifts before entering this vacation",
  D1: "Decision 4", U1: "VG(10/10)" }).forEach(([k, v]) => {
  const at = vgProbeHdr.indexOf("--   " + k + "  ");
  const next = vgProbeHdr.slice(at + 5).search(/\n--   [A-Z][0-9]+  /);
  const txt = at < 0 ? "" : vgProbeHdr.slice(at, next < 0 ? vgProbeHdr.length : at + 5 + next);
  ok(at > 0 && txt.indexOf(v) > 0, "the probe header must state " + k + "'s AFTER `" + v + "`");
});

step("vacation guard: verify-rls.sh section 15 - the graded probe, leftovers, strict since the record step (PROBE_SETUP FAILs, no flag); the CLI's agent mode set by the script; no REST write; graded against a faked CLI");
ok(/^echo "== 15\. vacation guard \(2026-09-30, Prompt 27\): at least minSurgeonsAround surgeons around - the time_off trigger, rolled-back probe =="$/m.test(vr), "verify-rls.sh has no section 15 (vacation guard)");
// pin moved deliberately 10/1 (Prompt 28) and again (Prompt 29, its merge with main 10/2): section 15 ends at the NEXT section
// header (the first `\necho "== ` after its own), else at the RESULT line - section 16 (no-primary days) follows it, then section 18
// (APP call days), and the pair claim's 17 will after its merge; every section-15 pin keeps judging section 15 alone (its no-curl pin
// would otherwise count section 16's / 18's anon REST calls) and the faked run below never executes them.
const vrSectionEnd = (hdr) => { const at = vr.indexOf(hdr); const nx = vr.indexOf('\necho "== ', at + 5); const res = vr.indexOf('\necho\necho "RESULT: '); return nx > 0 && nx < res ? nx : res; };
const s15 = vr.slice(vr.indexOf('echo "== 15. '), vrSectionEnd('echo "== 15. '));
ok(s15.length > 0 && s15.length < vr.length && vr.indexOf('echo "== 15. ') > vr.indexOf('echo "== 14. '), "verify-rls.sh section 15 could not be sliced out (after section 14, up to the next section header (16) or the RESULT line)");
const s15code = s15.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
eq((s15code.match(/-X (POST|PATCH|DELETE|PUT)|curl /g) || []).length, 0, "section 15 goes over no REST call (the probe runs through the linked CLI);");
// pins moved deliberately 10/1 (the record step): PROBE_SETUP is a FAIL with no flag - the trigger exists since the apply - and
// SILVIS_VACATION_GUARD_APPLIED is gone from the whole script (like SILVIS_RETURN_LEG_APPLIED after its record step)
ok(/bad "vacation guard probe: PROBE_SETUP - time_off_vacation_guard is absent \(the trigger exists since the 2026-10-01 apply\)"/.test(s15code) && !/ok "vacation guard probe: the trigger is absent/.test(s15code), "section 15 must FAIL a PROBE_SETUP (strict since the record step; it passed as the not-applied picture before)");
ok(!/SILVIS_VACATION_GUARD_APPLIED|VGSTRICT15/.test(vr), "verify-rls.sh no longer reads or documents SILVIS_VACATION_GUARD_APPLIED (the record step dropped it; strict is the default)");
{
  // the record step (10/1): the Supabase CLI prints the {"warning","boundary","rows"} envelope q() / verdict() read only in agent
  // mode - outside an agent shell a bare array, so a q() success would read as an error (Faraz's first apply run, 16:48Z, stopped on
  // that shape). The script sets AI_AGENT itself, keeping one already set, after the --help arm and before any CLI call.
  const vrCodeAll = vr.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const exp = vrCodeAll.indexOf('export AI_AGENT="${AI_AGENT:-1}"');
  ok(exp > 0 && exp > vrCodeAll.indexOf("set -u") && exp > vrCodeAll.indexOf("-h|--help)") && exp < vrCodeAll.indexOf("supabase db query") && exp < vrCodeAll.indexOf("curl "), "verify-rls.sh must `export AI_AGENT=\"${AI_AGENT:-1}\"` after set -u / the --help arm and before the first CLI call or curl (" + exp + ")");
  ok(/AI_AGENT=1, exported below unless already set/.test(vr.slice(0, vr.indexOf("case \"${1:-}\""))), "verify-rls.sh's header names the agent mode it sets");
  ok(!/[^\x00-\x7f]/.test(vr), "verify-rls.sh stays ASCII");
}
ok(/PROBE15="\$\(cd sql\/probes && \(pwd -W 2>\/dev\/null \|\| pwd\)\)\/vacation-guard-probe\.sql"/.test(s15code), "section 15 runs sql/probes/vacation-guard-probe.sql through the linked CLI");
ok(s15code.includes('vg15()         { echo "ERR VG001 VACATION_TOO_FEW_AROUND: on $1 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler"; }'), "section 15's refusal template");
VG_CASES.filter((k) => k !== "P4").forEach((k) => ok(new RegExp("expect_(eq|err)15\\s+" + k + "\\s").test(s15code), "section 15 does not grade probe case " + k));
ok(/p4_15=\$\(case_val15 P4\)/.test(s15code) && s15code.includes('"inactive=roster"|"inactive=non-roster") ok'), "section 15 grades P4 as either kind of inactive id");
["P1", "P2", "P3", "S1", "S4", "E2", "I1", "A1", "N1", "D1"].forEach((k) => ok(new RegExp("expect_eq15\\s+" + k + "\\s+\"" + VG_AFTER_EQ[k].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(s15code), "section 15 must grade " + k + " = " + VG_AFTER_EQ[k]));
[["S2", "10/16, 10/17"], ["S3", "10/19"], ["E1", "10/1"], ["E3", "10/7"], ["C1", "10/9, 10/10"], ["M1", "10/25"], ["U1", "10/10"]].forEach(([k, d]) => ok(s15code.includes("expect_eq15  " + k + " \"$(vg15 '" + d + "')\""), "section 15 must grade " + k + " = VG(" + d + ")"));
ok(/expect_err15 K1 P0001 "ON_CALL_CONFLICT"/.test(s15code) && /expect_err15 K2 P0001 "ON_CALL_CONFLICT"/.test(s15code), "section 15 grades K1 / K2 as the on-call refusal");
ok(s15code.includes("email like 'probe-vacguard-%@example.test'") && s15code.includes("note like 'probe-vacguard%'") && s15code.includes("source = 'probe-vacguard'") && s15code.includes("data->>'probe' = 'vacguard'") && s15code.includes("decided_by = 'probe-vacguard'") && /LEFT ROWS BEHIND/.test(s15code), "section 15 counts leftovers over auth.users / time_off / schedule_days / east_feed / east_vacation_reviews and fails on non-zero");
// pin moved deliberately 10/1 (the record step): the header still names section 15; the header and --help no longer name the flag
// pin moved deliberately 10/1 (the merge with Prompt 28; review of the merge): vacation-guard-only - the header names section 15
// and the --help line lists SILVIS_PREFS_ROWS_BEFORE but no SILVIS_VACATION_GUARD_APPLIED. The tail of --help's env-var list
// (SILVIS_NO_PRIMARY_APPLIED until Prompt 28's record step) is pinned in the Prompt 28 step only, so that record step moves one
// pin, not this one (Prompt 29's SILVIS_APP_DAYS_APPLIED was such a tail until its record step of 10/2 dropped it). Kept intent: the
// vacation guard's flag is not listed
{
  const helpLine = (vr.slice(0, vr.indexOf("set -u")).match(/-h\|--help\) echo "[^\n]*/) || [""])[0];
  ok(/vacation guard probe \(15\)/.test(vr.slice(0, vr.indexOf("set -u"))) && /SILVIS_PREFS_ROWS_BEFORE/.test(helpLine) && /see the header of this file/.test(helpLine) && !/SILVIS_VACATION_GUARD_APPLIED/.test(helpLine), "verify-rls.sh's header must name section 15 and --help must list SILVIS_PREFS_ROWS_BEFORE without SILVIS_VACATION_GUARD_APPLIED (dropped at the record step)");
}
{
  // Prompt 28 (10/1) / Prompt 29 (10/2): the faked run stops at the next section header (16, then 18 after it) when one follows,
  // else at the RESULT line - the later sections' anon curls and probes never run here (each has its own faked run below)
  const code15 = vr.slice(vr.indexOf('echo "== 15. '), vrSectionEnd('echo "== 15. '));
  // pin moved deliberately 10/1 (the record step): no strict parameter - section 15 reads no flag (under set -u, with the variable
  // unset); `pre` adds a line before the section, e.g. a SILVIS_VACATION_GUARD_APPLIED left in the environment (the apply script
  // still sets it), which must change nothing
  const run15 = (cliOut, leftover, pre) => {
    const script = "set -u\nWORKDIR=/nonexistent; pass=0; fail=0\nok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      (pre ? pre + "\n" : "") + "linked() { true; }\n" +
      "q() { printf '{\\n  \"boundary\": \"%s\",\\n  \"rows\": [\\n    {\\n      \"leftover\": " + (leftover || 0) + "\\n    }\\n  ]\\n}\\n' \"$RANDOM\"; }\n" +
      "supabase() { echo 'Initialising login role...'; echo '" + cliOut.replace(/'/g, "'\\''") + "'; }\n" + code15 + "\necho \"RESULT $pass $fail\"\n";
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    ok(!r.error, "bash could not be started to run section 15: " + (r.error && r.error.message));
    return { out: r.stdout || "", result: ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number), err: r.stderr || "" };
  };
  const fails = (x) => x.out.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") + x.err.slice(0, 200);
  const after = Object.assign({}, VG_AFTER_EQ, VG_AFTER_ERR, { P4: "inactive=roster" });
  eq(Object.keys(after).sort(), VG_CASES.slice().sort(), "the faked AFTER picture covers every probe case;");
  const msgOf = (pic) => '{"message": "ERROR: P0001: PROBE_RESULTS ' + Object.keys(pic).sort().map((k) => k + "=" + pic[k]).join(";") + ';END"}';
  const ra = run15(msgOf(after));
  eq(ra.result, [VG_CASES.length + 1, 0], "section 15 against the AFTER picture: every case + the leftover check PASS (" + fails(ra) + ");");
  const rn = run15(msgOf(Object.assign({}, after, { P4: "inactive=non-roster" })));
  eq(rn.result, [VG_CASES.length + 1, 0], "section 15: P4 inactive=non-roster passes too (" + fails(rn) + ");");
  // the 10/1 live picture as the log printed it (P4 the non-roster kind, K1 / K2 naming s2): every case + the leftover check PASS
  const rlive = run15(msgOf(Object.assign({}, after, { P4: "inactive=non-roster" })), 0, "export SILVIS_VACATION_GUARD_APPLIED=1");
  eq(rlive.result, [VG_CASES.length + 1, 0], "section 15 against the 2026-10-01 AFTER picture, a leftover SILVIS_VACATION_GUARD_APPLIED=1 in the environment ignored (" + fails(rlive) + ");");
  const setup = '{"message": "ERROR: P0001: PROBE_SETUP: time_off_vacation_guard is absent - sql/migrations/2026-09-30-vacation-guard.sql is not applied"}';
  const rsu = run15(setup);
  eq(rsu.result, [1, 1], "section 15 since the record step: PROBE_SETUP is a FAIL with no flag (the trigger exists since the 2026-10-01 apply; the leftover check still runs);");
  ok(/FAIL  vacation guard probe: PROBE_SETUP - time_off_vacation_guard is absent \(the trigger exists since the 2026-10-01 apply\)/.test(rsu.out), "section 15 names the missing trigger");
  eq(run15(setup, 0, "SILVIS_VACATION_GUARD_APPLIED=").result, [1, 1], "section 15: an empty SILVIS_VACATION_GUARD_APPLIED no longer turns PROBE_SETUP into a PASS;");
  const rb = run15(msgOf(Object.assign({}, after, { S2: "inserted (NO refusal)", C1: "inserted (NO refusal)", A1: VG_MSG("10/9, 10/10") })));
  eq(rb.result, [VG_CASES.length - 2, 3], "section 15 must fail a 5th surgeon let through, the office let through and the scheduler refused;");
  const rk = run15(msgOf(Object.assign({}, after, { K1: VG_MSG("10/13") })));
  eq(rk.result, [VG_CASES.length, 1], "section 15 must fail K1 when the vacation guard answers before the on-call trigger;");
  eq(run15('{"message": "connection refused"}').result, [1, 1], "section 15 fails a run with no sentinel-terminated PROBE_RESULTS (the leftover check still runs);");
  const rl = run15(msgOf(after), 3);
  eq(rl.result, [VG_CASES.length, 1], "section 15 fails a non-zero leftover count;");
  ok(/LEFT ROWS BEHIND/.test(rl.out), "section 15 names the leftovers");
}

step("vacation guard: docs - SCHEMA-REVIEW.md section (APPLIED 2026-10-01 16:53:33Z + the observed apply since the record step, what the trigger sees, decisions, blast radius, the over-limit query verbatim, the probe table, apply order, rollback), table (a), guide 4.3 / 8, the rules doc, CLAUDE.md; the over-limit query is read-only");
ok(/^## 2026-09-30 - vacation guard: time_off_vacation_guard \(Faraz 9\/30, Prompt 27; `sql\/migrations\/2026-09-30-vacation-guard\.sql`\)$/m.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-09-30 - vacation guard: time_off_vacation_guard (Faraz 9/30, Prompt 27; `sql/migrations/2026-09-30-vacation-guard.sql`)' section");
const reviewVg = (() => { const at = review.indexOf("## 2026-09-30 - vacation guard:"), end = review.indexOf("\n## ", at + 1); return at < 0 ? "" : review.slice(at, end < 0 ? review.length : end); })();
// pin moved deliberately 10/1 (the record step): the status reads APPLIED (it read `**Status: PREPARED - report-first, NOT APPLIED.**` before)
ok(/^\*\*Status: APPLIED 2026-10-01 16:53:33Z\*\* \(Faraz, from PowerShell through Git's bash\.exe with `AI_AGENT=1` - `apply-vacation-guard\.sh`; the observed lines at the end\)\./m.test(reviewVg) && !/\*\*Status: PREPARED/.test(reviewVg), "the vacation guard section's status line must read `**Status: APPLIED 2026-10-01 16:53:33Z** (Faraz, ... AI_AGENT=1 ...)` since the record step");
ok(/What the trigger sees/.test(reviewVg) && /How the client covers the rest/.test(reviewVg) && /Decisions for Faraz to approve with the apply/.test(reviewVg) && /Blast radius/.test(reviewVg) && /What could break/.test(reviewVg), "the section answers what the trigger sees and how the client covers the rest, lists the decisions, the blast radius and what could break");
ok(reviewVg.includes("    VACATION_TOO_FEW_AROUND: on 3/18, 3/19 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler"), "the section quotes the refusal");
ok(/to_regprocedure\('public\.time_off_vacation_guard\(\)'\)/.test(reviewVg) && /supabase db query --linked --workdir <dir> -f <abs>\/sql\/probes\/vacation-guard-probe\.sql/.test(reviewVg) && /supabase db query --linked --workdir <dir> -f <abs>\/sql\/migrations\/2026-09-30-vacation-guard\.sql/.test(reviewVg) && /SILVIS_VACATION_GUARD_APPLIED=1 bash scripts\/verify-rls\.sh/.test(reviewVg) && /The record step/.test(reviewVg), "the apply order: pre-check, probe BEFORE, apply, probe AFTER, strict verify-rls, the record step");
ok(reviewVg.includes("**Rolling back** = `drop trigger if exists time_off_vacation_guard_trg on public.time_off; drop function if exists\npublic.time_off_vacation_guard();`"), "the section's rollback");
// pin moved deliberately 10/1 (review item 11): the observed line records the pre-apply facts (the over-limit query's 0 rows
// on 10/1 ~05:10 UTC, probe BEFORE = PROBE_SETUP, the orchestrator's apply refused by the permission classifier - Faraz
// applies it) and keeps a placeholder for the post-apply half (probe AFTER, verify-rls counts) until the record step.
ok(/^observed \(pre-apply, 2026-10-01\): the read-only over-limit query \(`sql\/probes\/vacation-guard-overlimit\.sql`\) returned 0 rows on\n2026-10-01 ~05:10 UTC/m.test(reviewVg), "the observed line records the over-limit query's 0 rows (2026-10-01 ~05:10 UTC)");
{
  const obs = reviewVg.slice(reviewVg.indexOf("observed (pre-apply, 2026-10-01)")).replace(/\n/g, " ");
  ok(obs.includes("probe BEFORE: `PROBE_SETUP: time_off_vacation_guard is absent - sql/migrations/2026-09-30-vacation-guard.sql is not applied`") && obs.includes("refused by the session's permission classifier") && obs.includes("Faraz applies the migration himself") && obs.includes("as he did the period fold on 10/1 04:33Z"), "the observed line records probe BEFORE, the refused apply and who applies it");
  // pin moved deliberately 10/1 (the record step): the placeholder is gone - the post-apply half is the next paragraph
  ok(!/_to be filled/.test(reviewVg) && obs.includes("Post-apply: the next paragraph."), "the pre-apply observed line points at the post-apply paragraph (no placeholder since the record step)");
}
{
  // the record step (10/1): the observed apply, from Faraz's log apply-vacation-guard-20261001T165241Z.log
  const at = reviewVg.indexOf("observed (apply, 2026-10-01): applied 2026-10-01 16:53:33Z");
  ok(at > 0 && at > reviewVg.indexOf("observed (pre-apply, 2026-10-01)"), "the section must carry the 'observed (apply, 2026-10-01): applied 2026-10-01 16:53:33Z ...' paragraph after the pre-apply one");
  const ap = at < 0 ? "" : reviewVg.slice(at);
  const apFlat = ap.replace(/\s+/g, " ");
  ok(apFlat.includes("CLI exit 0") && apFlat.includes("export AI_AGENT=1") && apFlat.includes("repo HEAD `00d446b`") && apFlat.includes("supabase CLI 2.84.2") && apFlat.includes("`bzhsroegtagqhutbnsrp`"), "the observed apply names the CLI exit, the agent-mode run, the repo HEAD, the CLI version and the project");
  ok(apFlat.includes("Step 1, the over-limit pre-check (read-only): 0 rows") && apFlat.includes("Step 2, the function-absent check: 0 rows") && apFlat.includes("Step 3, probe BEFORE: `PROBE_SETUP: time_off_vacation_guard is absent - sql/migrations/2026-09-30-vacation-guard.sql is not applied`"), "the observed apply records the pre-check, the absent check and probe BEFORE");
  // the 20 AFTER lines as the log printed them, in one text block: exactly the graded picture (P4 the non-roster kind)
  const blockAt = ap.indexOf("```text\n");
  const block = blockAt < 0 ? "" : ap.slice(blockAt + 8, ap.indexOf("\n```", blockAt + 8));
  const live = Object.assign({}, VG_AFTER_EQ, VG_AFTER_ERR, { P4: "inactive=non-roster" });
  eq(block.split("\n"), Object.keys(live).sort().map((k) => k + "=" + live[k]), "the observed probe AFTER lists the 20 cases exactly as the log printed them (sorted, one per line);");
  ok(apFlat.includes("`RESULT: 292 passed, 0 failed`") && apFlat.includes("section 15 every case PASS") && apFlat.includes("leftover count 0") && apFlat.includes("(3, 6, 7c-7e, 8c / 8d, 9d, 14c) skipped"), "the observed apply records verify-rls 292 / 0, section 15 green, leftovers 0 and the skipped JWT checks");
  ok(apFlat.includes("The first attempt (log `apply-vacation-guard-20261001T164818Z.log`, started 16:48:18Z) stopped at step 1 and changed nothing") && apFlat.includes("a bare JSON array") && apFlat.includes("`{\"warning\",\"boundary\",\"rows\"}`") && apFlat.includes("only in agent mode") && apFlat.includes("Faraz re-ran with `export AI_AGENT=1`"), "the observed apply records the stopped first attempt and its cause (the CLI's output shape outside agent mode)");
  const flatAll = reviewVg.replace(/\s+/g, " ");
  ok(flatAll.includes("*As run (2026-10-01): item 1 first") && flatAll.includes("kept byte for byte as it ran (sha256 `" + VG_APPLIED_SHA256 + "`") && flatAll.includes("the first attempt below"), "the apply order carries its as-run note (the script's steps, the migration kept as it ran with its sha256, verify-rls's agent mode)");
  ok(flatAll.includes("*As run (2026-10-01): the first live run read all 20 cases exactly as written"), "what could break (1) carries its as-run note");
}
// review 10/1 items 7, 12, 14, 15: the known gap, the record step's full list of docs, the painter as the scheduler's, decision 1's references
{
  const flat = reviewVg.replace(/\s+/g, " ");
  ok(flat.includes("**Known gap (review 10/1): the rule is enforced only when a `time_off` row is written.**") && flat.includes("there is no refusing trigger on `east_vacation_reviews`") && flat.includes("(4) The known gap above"), "the section states the known gap (blast radius + what could break)");
  ok(flat.includes("The month painter (Setup > Vacations > Paint month) is NOT one of them: Setup opens for the scheduler only") && !/the Time off form \(surgeon, coordinator\), its Edit, the month painter/.test(flat), "the blast radius no longer lists the month painter as a non-scheduler path");
  ok(flat.includes("section 8 item 17") && flat.includes("the app's 9/23 rule (`docs/SILVIS-CALL-RULES.md` section 3, Khan, \"East vacations, away / home (Prompt 15)\""), "decision 1 points at the rules doc's section 8 item 17 and the 9/23 rule");
  const step7 = flat.slice(flat.indexOf("7. The record step, ONE commit:"), flat.indexOf("**Rolling back**"));
  ok(step7.includes("`docs/SILVIS-CALL-RULES.md` section 1's Time off row") && step7.includes("`docs/SILVIS-BUILD-GUIDE.md` section 8's \"Vacation guard\" bullet") && step7.includes("`CLAUDE.md`'s time-off sentence") && step7.includes("table (a)'s `time_off` row") && step7.includes("guide 4.3's bullet and Proof line"), "the record step lists every doc that says the trigger is not applied");
  ok(flat.includes("5. Probe AFTER: every case as the table lists (20 cases: P1-P4, S1-S4, E1-E3, I1, K1-K2, C1, M1, A1, N1, D1, U1)."), "apply-order step 5 counts the 20 cases");
}
VG_CASES.forEach((k) => ok(new RegExp("^\\| (" + k + "|[A-Z][0-9] / " + k + "|" + k + " / [A-Z][0-9]|[A-Z][0-9] / [A-Z][0-9] / " + k + "|" + k + " / [A-Z][0-9] / [A-Z][0-9]|[A-Z][0-9] / " + k + " / [A-Z][0-9]) \\|", "m").test(reviewVg), "the section's probe table lists case " + k));
{
  const ol = read(VG_OVERLIMIT);
  ok(!/\r/.test(ol), "the over-limit query has CRLF line endings");
  const olHdr = ol.slice(0, ol.indexOf("with blob as ("));
  ok(/READ-ONLY: one SELECT, nothing is written, locked\n-- or changed/.test(olHdr) && /Run it BEFORE the apply/.test(olHdr), "the over-limit query's header says READ-ONLY and when to run it");
  const olCode = ol.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim();
  // pins moved deliberately 10/1 (review item 9): the final select reads off_people (aggregated per day and person first), so it
  // ends "order by p.day;" and counts distinct p.id; kept intent: one read-only statement listing the days under the minimum.
  ok(olCode.startsWith("with blob as (") && olCode.endsWith("order by p.day;") && (olCode.match(/;/g) || []).length === 1, "the over-limit query is ONE statement (a select with CTEs)");
  ok(!/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|lock|perform)\b/i.test(olCode), "the over-limit query writes, locks and changes nothing");
  ok(olCode.includes("coalesce(e.r->'active', 'true'::jsonb) <> 'false'::jsonb and coalesce(e.r->>'type', '') <> 'external'") && olCode.includes("w.decision = 'home'") && olCode.includes("(f.data->'isForecast') is distinct from 'true'::jsonb") && olCode.includes("having (select n from active_n) - count(distinct p.id)::int < (select n from minimum)"), "the over-limit query reads like the trigger (active roster, East not home, forecast skipped) and lists the days under the minimum");
  // review 10/1 item 9: a surgeon off by a time_off row AND an East range on one day is named once, tagged (East) only when every source is East
  ok(olCode.includes("off_people as (\n  select o.day, o.id, bool_and(o.east) as east_only\n    from off_days o\n   group by o.day, o.id\n)") && olCode.includes("string_agg(a.name || case when p.east_only then ' (East)' else '' end, ', ' order by a.ord) as off") && !olCode.includes("string_agg(distinct"), "the over-limit query aggregates per (day, id) first and tags (East) only when every source is East, names in roster order");
  ok(olCode.includes("with ordinality as e(r, ord)") && olCode.includes("select e.r->>'id' as id, e.ord, "), "the roster CTE carries the roster order");
  ok(reviewVg.includes("```sql\n" + ol.slice(ol.indexOf("with blob as (")).replace(/\n+$/, "") + "\n```"), "the SCHEMA-REVIEW section carries the over-limit query verbatim (= sql/probes/vacation-guard-overlimit.sql)");
}
// pin moved deliberately 10/1 (the record step): table (a)'s time_off row reads applied live (it read **prepared 2026-09-30 - report-first, NOT APPLIED** before)
ok(/^\| `time_off` \|[^\n]*prepared 2026-09-30 - report-first, \*\*applied live 2026-10-01 16:53 UTC\*\*[^\n]*time_off_vacation_guard_trg/m.test(tblA) && !/^\| `time_off` \|[^\n]*NOT APPLIED/m.test(tblA), "SCHEMA-REVIEW table (a)'s time_off row must name the vacation guard trigger, **applied live 2026-10-01 16:53 UTC**");
{
  const vgBullet = (g43.match(/^- \*\*Vacation guard \(2026-09-30, [^\n]*/m) || [""])[0];
  const vgProof = (g43.match(/^Proof: `sql\/probes\/vacation-guard-probe\.sql`[^\n]*/m) || [""])[0];
  // pin moved deliberately 10/1 (the record step): the bullet reads applied (it read 'report-first, NOT applied' before)
  ok(/^- \*\*Vacation guard \(2026-09-30, report-first, applied 2026-10-01 16:53 UTC; `sql\/migrations\/2026-09-30-vacation-guard\.sql`, revision s\)\.\*\*/.test(vgBullet) && /VACATION_TOO_FEW_AROUND/.test(vgBullet) && /it shipped before the apply; the trigger backs it since/.test(vgBullet), "guide 4.3 must carry the 'Vacation guard (2026-09-30, report-first, applied 2026-10-01 16:53 UTC; ..., revision s)' bullet");
  // pins moved deliberately 10/1 (review items 8 and 11, then the record step): 20 probe cases (D1, U1 added), the pre-apply
  // facts, and since the record step the applied facts in place of the placeholder and section 15 strict with no flag.
  ok(/20 cases in its header/.test(vgProof) && /D1 a person already off that day, U1 a row moved to another person/.test(vgProof) && /vacation-guard-overlimit\.sql/.test(vgProof) && /section 15 \(the graded probe \+ leftovers; strict since the record step - a PROBE_SETUP FAILs\)/.test(vgProof) && !/SILVIS_VACATION_GUARD_APPLIED/.test(vgProof) && !/_to be filled/.test(vgProof) && /pre-apply 2026-10-01: the over-limit query 0 rows at ~05:10 UTC, probe BEFORE `PROBE_SETUP`; the orchestrator's apply was refused by the permission classifier - Faraz applies it; applied: 2026-10-01 16:53:33 UTC by Faraz/.test(vgProof) && /AFTER 20 \/ 20, verify-rls 292 \/ 0/.test(vgProof), "guide 4.3's vacation guard Proof line: the 20 probe cases, the over-limit query, verify-rls section 15 (strict, no flag), the pre-apply facts and 'applied: 2026-10-01 16:53:33 UTC' with probe AFTER 20 / 20 and verify-rls 292 / 0");
  ok(/Known gap \(review 10\/1\): only a `time_off` write is checked/.test(vgBullet), "guide 4.3's bullet states the known gap");
}
// review 10/1 items 10, 12, 13: the docs the record step updates say the same; the "Also off" example is one the app can produce
{
  const rulesDoc = read(path.join(ROOT, "docs", "SILVIS-CALL-RULES.md"));
  const guideAll = read(path.join(ROOT, "docs", "SILVIS-BUILD-GUIDE.md"));
  const helpersSrc = read(path.join(ROOT, "helpers.js"));
  const H = require(path.join(ROOT, "helpers.js"));
  const ROSTER6 = [{ id: "s1", name: "Khan" }, { id: "s2", name: "Burchett" }, { id: "s3", name: "Acton" }, { id: "s4", name: "Philip" }, { id: "s5", name: "Fierce" }, { id: "s6", name: "Sarkar" }];
  const nm = (id) => (ROSTER6.find((r) => r.id === id) || {}).name || id;
  const g = H.vacationGuard({ personId: "s4", start: "2027-03-16", end: "2027-03-20", roster: ROSTER6, groupRules: {},
    timeOffRows: [{ id: "a", person_id: "s3", start_date: "2027-03-15", end_date: "2027-03-21" }, { id: "b", person_id: "s2", start_date: "2027-03-18", end_date: "2027-03-20" }] });
  const example = H.vacationGuardLine(g, nm, { mine: true });
  eq(example, "Also off: Burchett 3/18-3/20, Acton 3/15-3/21 - after yours, 3 of 6 are around 3/18-3/20", "the documented example is what the app produces (roster order);");
  ok(rulesDoc.includes('"' + example + '"') && guideAll.includes('"' + example + '"') && helpersSrc.includes('"' + example + '"'), "the rules doc, the build guide and the helper comment quote the example the app produces");
  ok(![rulesDoc, guideAll, helpersSrc].some((t) => t.includes("Also off: Acton 3/15-3/21, Burchett 3/18-3/20")), "the old, roster-order-breaking example is gone");
  const claudeMd = read(path.join(ROOT, "CLAUDE.md"));
  // pin moved deliberately 10/1 (the record step): CLAUDE.md says the trigger is applied and backs the client check (it said
  // "report-first until applied ..., the client check is the gate until then" before)
  ok(/refused when fewer than `groupRules\.vacations\.minSurgeonsAround` \(default 2\)\nactive surgeons would stay around on one of its days/.test(claudeMd) && /the scheduler may override after a\nconfirm/.test(claudeMd) && /its `time_off` trigger is applied \(2026-10-01, `docs\/SCHEMA-REVIEW\.md`\) and backs the\nclient check/.test(claudeMd) && !/report-first until applied/.test(claudeMd), "CLAUDE.md's time-off summary names the vacation guard (the key, default 2, the scheduler's confirm, the trigger applied 2026-10-01 backing the client check)");
  // the record step (10/1): the rules doc's Time off row and guide section 8 say applied too
  ok(rulesDoc.includes("`time_off_vacation_guard` (`sql/migrations/2026-09-30-vacation-guard.sql`, report-first, **applied 2026-10-01**;") && !/until it is applied the app's own check is the gate/.test(rulesDoc) && !/vacation-guard\.sql`, \*\*prepared/.test(rulesDoc), "the rules doc's Time off row says the vacation guard trigger is applied 2026-10-01 (no 'prepared - report-first, not applied' / 'until it is applied')");
  ok(guideAll.includes("Database: `time_off_vacation_guard` (applied 2026-10-01 16:53 UTC - section 4.3;") && !/time_off_vacation_guard` \(report-first, NOT applied/.test(guideAll), "guide section 8's vacation guard bullet says the trigger is applied 2026-10-01");
}
console.log("- vacation guard: one trigger function + one trigger on time_off (report-first, applied 2026-10-01 16:53:33Z; the file kept as it ran, sha256-pinned), mirrored (revision s), SQL text = helpers.vacationGuardMessage, probe + verify-rls section 15 (strict) graded against a faked CLI, docs pinned");

// ---- Prompt 28 - no-primary days (2026-10-01, Faraz 10/1: "I do want them to be able to do that") ----
// sql/migrations/2026-10-01-no-primary-days.sql (REPORT-FIRST; APPLIED 2026-10-02 12:05:22Z by Faraz; revision t): ONE new
// security-definer function save_no_primary(p_person, p_add, p_clear) - one availability row per no-primary day (kind backup_only,
// role any, note null), the person's single-day backup_only rows cleared, never a range split - and save_offers re-created with
// p_np_add / p_np_clear (the five-argument signature dropped; still security invoker), which calls it inside its own transaction and
// refuses a day it offers as primary / either that carries a backup_only row afterwards (NP009). schema.sql mirrors both;
// sql/probes/no-primary-probe.sql proves them (rolled back, 43 cases), sql/probes/no-primary-precheck.sql reads the facts
// (read-only), verify-rls.sh section 16 grades them. Faraz's one-command apply scripts live OUTSIDE the repo (Faraz 10/1: they carry
// machine paths), so no apply script is pinned here and none may sit under scripts/ (the test/ci.test.js .sh pin keeps verify-rls.sh
// the only one).
// pins moved deliberately 10/2 (the record step, like the vacation guard's of 10/1): the applied wording everywhere; verify-rls
// section 16 strict by default (PROBE_SETUP and an anon 404 FAIL, SILVIS_NO_PRIMARY_APPLIED gone); the migration file is kept byte
// for byte as it ran - its body is pinned by sha256 (annotated only in ONE trailer line), so its header still reads as it ran
// ("REPORT-FIRST, NOT APPLIED", the flag in its apply order); the observed apply (Faraz's log of 10/2) is pinned line by line.
const NP_FILE = "2026-10-01-no-primary-days.sql";
const NP_MIGRATION = path.join(ROOT, "sql", "migrations", NP_FILE);
const NP_PROBE = path.join(ROOT, "sql", "probes", "no-primary-probe.sql");
const NP_PRECHECK = path.join(ROOT, "sql", "probes", "no-primary-precheck.sql");
// sha256 of the applied file, observed 2026-10-02: the log's "migration sha256" line of apply-no-primary-days.sh (repo HEAD 3c59e79,
// "(expected e77a...)" matched; sha256sum of `git show 3c59e79:sql/migrations/2026-10-01-no-primary-days.sql` agrees).
const NP_APPLIED_SHA256 = "e77a005aceb2ff74acd293b12102295836870faf3d5564c5fb2651e038296f08";
// The repo copy carries ONE trailer line after the applied body; the body (everything before it) is what is hashed.
const NP_TRAILER = "\n-- applied 2026-10-02 12:05:22Z by Faraz";
const NP_SIGNATURE = "create or replace function public.save_no_primary(p_person text, p_add date[], p_clear date[]) returns jsonb\nlanguage plpgsql security definer set search_path = public, pg_temp as $$\n";
// the shared contract with the app lane: every refusal's exact text, in check order (NP001 twice, ... NP009), all before the first write
const NP_RAISES = [
  "raise exception 'NO_PRIMARY_NOT_LINKED: sign in with an account that is linked to a roster entry to mark no-primary days' using errcode = 'NP001';",
  "raise exception 'NO_PRIMARY_NOT_LINKED: name the person (your account is not linked to a roster entry)' using errcode = 'NP001';",
  "raise exception 'NO_PRIMARY_NOT_YOURS: only the scheduler or the office can mark another surgeon''s no-primary days' using errcode = 'NP002';",
  "raise exception 'NO_PRIMARY_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'NP003';",
  "raise exception 'NO_PRIMARY_BAD_DAY: a day in the list is empty - nothing was saved' using errcode = 'NP004';",
  "raise exception 'NO_PRIMARY_BAD_DAY: % is both marked and cleared in one save - nothing was saved', bad using errcode = 'NP004';",
  "raise exception 'NO_PRIMARY_PAST: % is before today (%) in Central time - a past day stays as it was', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'NP005';",
  "raise exception 'NO_PRIMARY_FROZEN: offers for % closed on % - ask the scheduler (%)', frozen.label, frozen.offers_close_at, frozen.days using errcode = 'NP006';",
  "raise exception 'NO_PRIMARY_RANGE: % is part of a longer no-primary range the scheduler set - change it in Setup > Availability statements', bad using errcode = 'NP007';",
  "raise exception 'NO_PRIMARY_ON_CALL: % holds primary on % - trade those days first, then mark them No primary', v_name, bad using errcode = 'NP008';",
  "raise exception 'NO_PRIMARY_OFFER_CONFLICT: % offers primary on % and marks it No primary - keep one of the two (nothing was saved)', v_name, bad using errcode = 'NP009';",
];
const NP_CODES = [["NP001", "NO_PRIMARY_NOT_LINKED"], ["NP002", "NO_PRIMARY_NOT_YOURS"], ["NP003", "NO_PRIMARY_UNKNOWN_PERSON"], ["NP004", "NO_PRIMARY_BAD_DAY"], ["NP005", "NO_PRIMARY_PAST"], ["NP006", "NO_PRIMARY_FROZEN"], ["NP007", "NO_PRIMARY_RANGE"], ["NP008", "NO_PRIMARY_ON_CALL"], ["NP009", "NO_PRIMARY_OFFER_CONFLICT"]];
const NP_SOURCES_LINE = "if me is not null and who = me then v_by := me; v_src := 'app'; elsif sched then v_by := 'scheduler'; v_src := 'email-relay'; else v_by := auth.uid()::text; v_src := 'office-relay'; end if;";
const NP_DELETE = "  delete from public.availability a\n   where a.person_id = who and a.kind = 'backup_only' and a.start_date = a.end_date and a.start_date = any(clears);";
const NP_INSERT = "  insert into public.availability (person_id, kind, role, start_date, end_date, note, source, created_by)\n  select who, 'backup_only', 'any', d, d, null, v_src, v_by\n    from unnest(adds) d\n   where not exists (select 1 from public.availability a\n                      where a.person_id = who and a.kind = 'backup_only' and d between a.start_date and a.end_date)\n  on conflict do nothing;";
const NP_RETURN = "  return jsonb_build_object('ok', true, 'person_id', who, 'added', n_add, 'cleared', n_clear, 'kept', cardinality(adds) - n_add, 'source', v_src, 'created_by', v_by);";
const NP_GRANTS = "revoke all on function public.save_no_primary(text, date[], date[]) from public;\nrevoke all on function public.save_no_primary(text, date[], date[]) from anon;\ngrant execute on function public.save_no_primary(text, date[], date[]) to authenticated;";
// the probe's 43 cases (42 + C5 since the review of 10/1) and what section 16 grades for each: eq = the exact string; np = ERR <code> <token>: ... <substring> (the
// NP008 / NP009 texts carry s3's roster name, written <name> in the probe header); err = ERR <code> ... <substring>
const NP_NAME = "Acton";   // s3 in the live blob (the probe header writes <name>; the faked runs below substitute it)
const NP_PROBE_CASES = {
  P1: ["eq", "np_fn=yes np_definer=yes np_path=yes offers7=yes offers5=no offers_invoker=yes overloads=1 np_anon=no np_auth=yes offers_anon=no offers_auth=yes"],
  S1: ["eq", "ok np_added=2 np_cleared=0 rows=2 src=app by=s3 role=any note=null"],
  S2: ["eq", "ok np_added=0 np_kept=2 rows=2"],
  S3: ["eq", "ok deleted=1 np_added=1 offer=none np=1"],
  S4: ["eq", "ok np_added=1 offer=backup np=1"],
  S5: ["eq", "ok upserted=1 np_cleared=1 offer=primary np=0"],
  S6: ["np", "NP009", "NO_PRIMARY_OFFER_CONFLICT", "offers primary on 11/2 and marks it No primary - keep one of the two (nothing was saved)"],
  S6s: ["eq", "offer=none np=1"],
  S7: ["np", "NP009", "NO_PRIMARY_OFFER_CONFLICT", "offers primary on 11/13 and marks it No primary"],
  S8: ["eq", "ok np_cleared=1 left=0"],
  S9: ["np", "NP007", "NO_PRIMARY_RANGE", "11/11 is part of a longer no-primary range the scheduler set"],
  S10: ["eq", "ok np_cleared=0 unavailable=1"],
  S11: ["err", "42501", "row-level security policy for table \"availability\""],
  S12: ["err", "42501", "row-level security policy for table \"availability\""],
  S13: ["np", "NP009", "NO_PRIMARY_OFFER_CONFLICT", "offers primary on 11/10 and marks it No primary"],
  V1: ["eq", "ok np_added=1"],
  H1: ["np", "NP008", "NO_PRIMARY_ON_CALL", "holds primary on 11/5 - trade those days first, then mark them No primary"],
  H2: ["eq", "ok np_added=1"],
  D1: ["np", "NP005", "NO_PRIMARY_PAST", "4/6 is before today ("],
  D2: ["np", "NP005", "NO_PRIMARY_PAST", "4/6 is before today ("],
  F1: ["np", "NP006", "NO_PRIMARY_FROZEN", "offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/20)"],
  F2: ["np", "NP006", "NO_PRIMARY_FROZEN", "offers for probe np frozen closed on 2026-09-01 - ask the scheduler (11/21)"],
  B1: ["np", "NP008", "NO_PRIMARY_ON_CALL", "holds primary on 11/5 - trade those days first"],
  B1s: ["eq", "offer_1101=none np_1115=0"],
  B2: ["np", "NP004", "NO_PRIMARY_BAD_DAY", "11/15 is both marked and cleared in one save - nothing was saved"],
  B3: ["np", "NP004", "NO_PRIMARY_BAD_DAY", "a day in the list is empty - nothing was saved"],
  R1: ["err", "OS002", "OFFERS_NOT_YOURS"],
  R2: ["np", "NP002", "NO_PRIMARY_NOT_YOURS", "only the scheduler or the office can mark another surgeon's no-primary days"],
  R3: ["np", "NP009", "NO_PRIMARY_OFFER_CONFLICT", "offers primary on 11/13 and marks it No primary"],
  O1: ["eq", "ok upserted=1 np_added=0"],
  C1: ["eq", "ok np_added=1 src=office-relay by=self"],
  C2: ["err", "OS004", "OFFERS_UNKNOWN_PERSON"],
  C3: ["np", "NP003", "NO_PRIMARY_UNKNOWN_PERSON", "zz is not a roster id - the office relays for a roster surgeon only"],
  C4: ["np", "NP006", "NO_PRIMARY_FROZEN", "ask the scheduler (11/22)"],
  C5: ["np", "NP001", "NO_PRIMARY_NOT_LINKED", "name the person (your account is not linked to a roster entry)"],   // review 10/1: the second NP001 raise
  A1: ["eq", "ok np_added=1 src=email-relay by=scheduler"],
  A2: ["eq", "ok np_cleared=1"],
  A3: ["np", "NP008", "NO_PRIMARY_ON_CALL", "holds primary on 11/5"],
  A4: ["np", "NP005", "NO_PRIMARY_PAST", "4/6 is before today ("],
  A5: ["np", "NP007", "NO_PRIMARY_RANGE", "11/11 is part of a longer no-primary range"],
  A6: ["eq", "ok np_added=0 np_kept=1"],
  N1: ["err", "42501", "permission denied for function save_no_primary"],
  N2: ["np", "NP001", "NO_PRIMARY_NOT_LINKED", "sign in with an account that is linked to a roster entry"],
};
const NP_CASES = Object.keys(NP_PROBE_CASES);
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// the top-level statements of a SQL file (comment lines dropped; a ';' inside a $$ body or a '...' literal does not end one)
function topStatements(sql) {
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = ""; let body = false; let str = false;
  for (let i = 0; i < code.length; i++) {
    if (!str && code.startsWith("$$", i)) { body = !body; cur += "$$"; i++; continue; }
    if (!body && code[i] === "'") str = !str;
    cur += code[i];
    if (code[i] === ";" && !body && !str) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function checkNoPrimaryFn(n, s) {
  const fn = functionText(s, "save_no_primary");
  ok(fn, n + ": no `create or replace function public.save_no_primary(...)` ... `end $$;` block");
  if (!fn) return;
  ok(fn.startsWith(NP_SIGNATURE), n + ": save_no_primary must read `" + NP_SIGNATURE.trim() + "` (security definer: a surgeon cannot write availability under RLS; search_path public, pg_temp)");
  const del = fn.indexOf(NP_DELETE), ins = fn.indexOf(NP_INSERT);
  ok(del > 0 && ins > del, n + ": the clear (single-day backup_only rows of the person on the named days, any source) then the add (one row per day not already covered by any backup_only row; backup_only / any / note null / v_src / v_by; on conflict do nothing)");
  eq((fn.match(/(insert into|update|delete from) public\.availability/g) || []).length, 2, n + ": save_no_primary writes availability exactly twice (the delete and the insert);");
  ok(!/(insert into|update|delete from) public\.(call_offers|schedule_days|time_off|call_periods|audit_log|notifications|call_schedule_data|user_profiles)\b/.test(fn) && !/audit_log|notifications/.test(fn), n + ": save_no_primary writes nothing but availability (no audit / feed row: the client's offers.save is the one audit row)");
  let last = -1;
  NP_RAISES.forEach((r) => {
    const at = fn.indexOf(r);
    ok(at > last, n + ": the refusal is missing or out of order (NP001 x2, NP002, NP003, NP004 x2, NP005, NP006, NP007, NP008, NP009):\n" + r);
    ok(at < del, n + ": every refusal comes BEFORE the first write (fail closed):\n" + r);
    if (at > last) last = at;
  });
  eq((fn.match(/using errcode = 'NP0/g) || []).length, NP_RAISES.length, n + ": exactly the eleven NP raises;");
  ok(fn.includes("  if auth.uid() is null or (me is null and not sched and not coord) then\n    raise exception 'NO_PRIMARY_NOT_LINKED: sign in"), n + ": NP001 fires for anon (auth.uid() null) and for an unlinked caller who is neither the scheduler nor the office");
  ok(fn.includes("  who := coalesce(who, me);") && fn.includes("  if who <> coalesce(me, '') and not sched and not coord then\n    raise exception 'NO_PRIMARY_NOT_YOURS"), n + ": the person defaults to the caller; NP002 for another person unless the scheduler or the office");
  ok(fn.includes("  if coord and " + COORD_ROSTER_CHECK + " then\n    raise exception 'NO_PRIMARY_UNKNOWN_PERSON: % is not a roster id - the office relays for a roster surgeon only', who using errcode = 'NP003';\n  end if;"), n + ": NP003 - the office relays for a roster id only (the OS004 expression word for word; gated on coord)");
  const lock = fn.indexOf("  perform pg_advisory_xact_lock(hashtext('availability:no_primary:' || who));");
  ok(lock > fn.indexOf(NP_RAISES[3]) && lock < fn.indexOf(NP_RAISES[4]), n + ": the per-person advisory lock is taken after NP003 and before every availability read (two Saves of one person serialise)");
  ok(fn.includes("  today_c  date := (now() at time zone 'America/Chicago')::date;") && fn.includes("from unnest(adds || clears) d where d < today_c;"), n + ": NP005 reads the Central date, for marks and clears");
  const gate = fn.indexOf("  if not sched then\n"), gateEnd = fn.indexOf("\n  end if;\n", gate);
  eq((fn.match(/if not sched then/g) || []).length, 1, n + ": one scheduler exemption;");
  eq((fn.slice(gate, gateEnd).match(/errcode = 'NP0\d\d'/g) || []), ["errcode = 'NP006'"], n + ": `not sched` gates NP006 (the freeze) only - past days, ranges, a held primary and offer conflicts bind the scheduler too;");
  ok(fn.includes("       and (p.offers_close_at <= today_c or p.status <> 'upcoming')\n     order by p.start_day\n     limit 1;"), n + ": NP006 reads the OF003 freeze (closed by date or no longer upcoming); the earliest such period names the message");
  ok(fn.includes("from unnest(clears) d\n   where exists (select 1 from public.availability a where a.person_id = who and a.kind = 'backup_only' and a.start_date < a.end_date and d between a.start_date and a.end_date);"), n + ": NP007 - a day to CLEAR covered by a longer backup_only range of the person (any role, any source)");
  ok(fn.includes("from public.schedule_days s where s.day = any(adds) and s.primary_id = who;"), n + ": NP008 - a day to MARK he holds as PRIMARY on schedule_days (a held backup is fine; a clear is never refused)");
  ok(fn.includes("   where o.person_id = who and o.day = any(adds) and o.role_pref in ('primary', 'either');"), n + ": NP009 - a day to MARK with a primary / either offer of the person");
  ok(fn.includes("  " + NP_SOURCES_LINE), n + ": source / created_by come from the caller - save_offers' rule, one line");
  ok(fn.includes(NP_RETURN), n + ": return shape {ok, person_id, added, cleared, kept, source, created_by}");
  const kinds = fn.match(/\bkind = '[a-z_]+'/g) || [];
  ok(kinds.length === 3 && kinds.every((x) => x === "kind = 'backup_only'") && !/p_kind|'(available|unavailable|avoid|prefer|no_backup)'/.test(fn), n + ": no kind parameter - the function only ever reads, writes and deletes backup_only rows");
  ok(s.indexOf(NP_GRANTS) > s.indexOf(fn), n + ": save_no_primary grants: revoke from public and anon, grant execute to authenticated (an invoker's nested call needs it)");
  ok(/^comment on function public\.save_no_primary\(text, date\[\], date\[\]\) is '[^\n]*NP009 NO_PRIMARY_OFFER_CONFLICT[^\n]*offers\.save[^\n]*';$/m.test(s), n + ": save_no_primary carries a comment naming its codes and the client's offers.save audit row");
}

step("Prompt 28: the migration = the applied file (sha256 of the body; APPLIED 2026-10-02 12:05:22Z in ONE trailer line) - save_no_primary (NEW, security definer) + save_offers re-created with p_np_add / p_np_clear (five-argument signature dropped), no table / policy / trigger, ends with the schema-cache reload");
const npBuf = fs.existsSync(NP_MIGRATION) ? fs.readFileSync(NP_MIGRATION) : null;
ok(npBuf, "missing file " + path.relative(ROOT, NP_MIGRATION));
const npMig = npBuf.toString("utf8");
ok(!/\r/.test(npMig), "no-primary migration has CRLF line endings");
ok(/^[\x00-\x7f]*$/.test(npMig), "the no-primary migration is ASCII only");
let npBody = npMig;
{
  // the record step (10/2): the file that ran is the file that is kept - the body hashed, the apply noted after it in ONE line
  const at = npBuf.indexOf(NP_TRAILER);
  ok(at > 0, "the no-primary migration must carry its trailer line `" + NP_TRAILER.slice(1) + " ...` after the applied body (the record step)");
  const tail = at > 0 ? npBuf.slice(at + 1).toString("utf8") : "";
  ok(tail.split("\n").filter((l) => l.length).length === 1 && tail.endsWith("\n"), "no-primary migration: exactly ONE trailer line after the applied body");
  ok(tail.includes("the body above this line is the applied file, sha256 " + NP_APPLIED_SHA256) && tail.includes("apply-no-primary-days.sh") && tail.includes("AI_AGENT") && tail.includes("repo HEAD 3c59e79") && tail.includes("predates residual 4's paged read") && tail.includes("docs/SCHEMA-REVIEW.md \"2026-10-01 - no-primary days\""), "the trailer names the applied sha256, the script, the agent mode, the HEAD it ran at, the stale 'unpaged' header sentence and the record");
  eq(crypto.createHash("sha256").update(at > 0 ? npBuf.slice(0, at + 1) : npBuf).digest("hex"), NP_APPLIED_SHA256,
    "no-primary migration body sha256 must equal the applied file's (strip nothing; annotate only in the trailer line);");
  if (at > 0) npBody = npBuf.slice(0, at + 1).toString("utf8");
}
ok(migFiles.includes(NP_FILE) && !PREPARED_NOT_MIRRORED.includes(NP_FILE), "sql/migrations/" + NP_FILE + " is a mirrored migration (not exempt)");
const npHdr = npMig.slice(0, npMig.indexOf("create or replace function public.save_no_primary("));
const npHdrFlat = npHdr.replace(/\n-- ?/g, " ");
// pin kept deliberately 10/2 (the record step): the header is the text as it ran (the body is sha256-pinned above), so it still
// says REPORT-FIRST, NOT APPLIED; the APPLIED note is the trailer line.
ok(/^-- REPORT-FIRST, NOT APPLIED \(/m.test(npHdr), "the migration header (as it ran) must say REPORT-FIRST, NOT APPLIED");
ok(npHdrFlat.includes("\"I do want them to be able to do that\"") && npHdrFlat.includes("\"These are days I am at Jackson County - I need to be blocked out as unavailable for primary call. I can cover backup call these days\""), "the header quotes Faraz and Burchett (10/1)");
ok(npHdr.includes("\n--   bash <run folder>/apply-no-primary-days.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)\n--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-01-no-primary-days.sql   (what it runs)\n"), "the header carries the two apply lines (the one command - its script kept outside the repo - and what it runs)");
ok(!/bash scripts\/apply-/.test(npHdr), "the migration header names no in-repo apply script (Faraz 10/1: apply scripts live outside the repo)");
ok(npHdrFlat.includes("sql/probes/no-primary-precheck.sql") && npHdrFlat.includes("sql/probes/no-primary-probe.sql") && npHdrFlat.includes("PROBE_SETUP: save_no_primary is absent") && npHdrFlat.includes("SILVIS_NO_PRIMARY_APPLIED=1 bash scripts/verify-rls.sh") && npHdrFlat.includes("docs/SCHEMA-REVIEW.md \"2026-10-01 - no-primary days\""), "the header gives the order: pre-check, probe BEFORE (PROBE_SETUP), the file, probe AFTER, strict verify-rls, the record step");
NP_CODES.forEach(([c, t]) => ok(npHdrFlat.includes(c + " " + t + ": "), "the header lists " + c + " " + t + " with its message"));
ok(npHdr.includes("\n--   drop function if exists public.save_offers(text, jsonb, date[], uuid, text, date[], date[]);\n--   -- re-create the five-argument save_offers from sql/migrations/2026-09-24-coordinator-role.sql (its create, grants, comment)\n--   drop function if exists public.save_no_primary(text, date[], date[]);\n--   notify pgrst, 'reload schema';\n"), "the header gives the rollback (drop the seven-argument save_offers, re-create the coordinator file's, drop save_no_primary, reload)");
// pin moved deliberately 10/1 (review of Prompt 28): the || is parenthesised - `A && B && C && D || E` passed on E alone, so the
// three section names never bound; kept intent: all four must hold.
ok(/Blast radius/.test(npHdr) && /Who it binds/.test(npHdr) && /The decision/.test(npHdr) && (npHdrFlat.includes("one implicit transaction") || npHdrFlat.includes("ONE implicit transaction")), "the header states the decision, whom it binds, the blast radius and that the file runs as one transaction");
ok(npHdrFlat.includes("NP009 is enforced in both directions by the two RPCs") && npHdrFlat.includes("a direct call_offers REST write") && npHdrFlat.includes("claim_open_slot's offer upsert skip NP009") && npHdrFlat.includes("residual 6"), "the header says NP009 binds the two RPCs only and names what skips it (review 10/1: SCHEMA-REVIEW residual 6)");
ok(!/^-- supersedes:/m.test(npMig) && !/^-- PREPARED FOLLOW-UP/m.test(npMig), "the no-primary migration has no supersedes line (no same-day migration redefines either function) and is not a NOT-MIRRORED follow-up");
eq((npMig.match(/create or replace function/g) || []).length, 2, "the migration creates exactly two functions (save_no_primary, save_offers);");
const npCode = npMig.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
eq((npCode.match(/drop function/g) || []).length, 1, "the migration drops exactly one function (the five-argument save_offers);");
ok(/^drop function if exists public\.save_offers\(text, jsonb, date\[\], uuid, text\);\ncreate or replace function public\.save_offers\(/m.test(npCode), "the drop is `drop function if exists public.save_offers(text, jsonb, date[], uuid, text);` directly before the save_offers create (no two overloads: PGRST203)");
ok(!/create table|alter table|drop table|create policy|drop policy|create trigger|drop trigger|create index/i.test(npCode), "the migration changes no table, policy, trigger or index");
// pin moved deliberately 10/2 (the record step): the applied BODY ends with the reload (the trailer line follows it)
ok(npBody.endsWith("\nnotify pgrst, 'reload schema';\n"), "the migration's applied body ends with `notify pgrst, 'reload schema';` (a seven-key call needs the cache to know p_np_add / p_np_clear)");
const npStmts = topStatements(npMig);
eq(npStmts.map((st) => st.split("\n")[0].replace(/ is '.*$/, " is ...")), [
  "create or replace function public.save_no_primary(p_person text, p_add date[], p_clear date[]) returns jsonb",
  "revoke all on function public.save_no_primary(text, date[], date[]) from public;",
  "revoke all on function public.save_no_primary(text, date[], date[]) from anon;",
  "grant execute on function public.save_no_primary(text, date[], date[]) to authenticated;",
  "comment on function public.save_no_primary(text, date[], date[]) is ...",
  "drop function if exists public.save_offers(text, jsonb, date[], uuid, text);",
  "create or replace function public.save_offers(p_person text, p_rows jsonb, p_clear date[], p_period uuid default null, p_mode text default null, p_np_add date[] default null, p_np_clear date[] default null) returns jsonb",
  "revoke all on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) from public;",
  "revoke all on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) from anon;",
  "grant execute on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) to authenticated;",
  "comment on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) is ...",
  "notify pgrst, 'reload schema';",
], "the migration is exactly: save_no_primary + grants + comment, the drop, save_offers + grants + comment, the reload;");
checkNoPrimaryFn("no-primary migration", npMig);
checkSaveOffers("no-primary migration", npMig, true, true);
ok(functionText(npMig, "save_offers").includes("  " + NP_SOURCES_LINE), "save_offers' sources line is the one save_no_primary repeats");

step("Prompt 28: schema.sql mirrors the migration (both functions byte for byte, grants, comments, the drop; save_no_primary right after set_offer_mode), revision t 'applied 2026-10-02 12:05:22Z' after revision s, the offers-RPC block names the new parameters and codes");
checkNoPrimaryFn("schema.sql", schema);
["save_no_primary", "save_offers"].forEach((name) => ok(functionText(schema, name) === functionText(npMig, name), name + "(): schema.sql differs from sql/migrations/" + NP_FILE + " (the newest migration touching it)"));
npStmts.filter((st) => !/^notify pgrst/.test(st)).forEach((st) => ok(schemaCode.indexOf(st) >= 0, "schema.sql does not mirror this no-primary statement byte for byte:\n" + st.slice(0, 300)));
{
  const at = (t) => schema.indexOf(t);
  const order = [at("comment on function public.set_offer_mode(uuid, text, text) is "), at("create or replace function public.save_no_primary("), at("grant execute on function public.save_no_primary(text, date[], date[]) to authenticated;"), at("comment on function public.save_no_primary(text, date[], date[]) is "),
    at("drop function if exists public.save_offers(text, jsonb, date[], uuid, text);"), at("create or replace function public.save_offers("), at("comment on function public.save_offers(text, jsonb, date[], uuid, text, date[], date[]) is "), at("create table if not exists public.notifications (")];
  ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "schema.sql order: set_offer_mode's comment, save_no_primary (+ grants + comment), the drop, save_offers (+ grants + comment), then the notifications table (" + order + ")");
  eq((schema.match(/create or replace function public\.save_offers\(/g) || []).length, 1, "schema.sql defines save_offers once;");
  eq((schema.match(/create or replace function public\.save_no_primary\(/g) || []).length, 1, "schema.sql defines save_no_primary once;");
  // pins moved deliberately 10/2 (the record step): revision t and the block comment read applied 2026-10-02 12:05:22Z
  const tAt = header.search(/^-- Revision 2026-10-01 t \(no-primary days, sql\/migrations\/2026-10-01-no-primary-days\.sql, applied 2026-10-02 12:05:22Z after the probe\): /m);
  const sAt = header.search(/^-- Revision 2026-09-30 s /m);
  ok(sAt > 0 && tAt > sAt, "schema.sql's header must record revision 2026-10-01 t (no-primary days; 'applied 2026-10-02 12:05:22Z after the probe' since the record step, 'report-first, NOT yet applied' before it) after revision s");
  ok(!/no-primary-days\.sql[^\n]*NOT yet applied/.test(schema), "schema.sql no longer calls the no-primary migration 'NOT yet applied' (the record step)");
  const revT = header.slice(tAt).split("\n-- Revision ")[0].split("\n-- Two same-day migrations")[0].replace(/\n-- ?/g, " ");
  ok(/save_no_primary\(p_person, p_add, p_clear\) \(security definer, search_path public, pg_temp\)/.test(revT) && /p_np_add \/ p_np_clear/.test(revT) && /five-argument signature is dropped and re-created with seven/.test(revT) && /NP001-NP009/.test(revT) && /No table, column, policy or trigger change/.test(revT), "revision t names the new definer, the two parameters, the dropped signature, the codes and that no table / policy / trigger changes");
  ok(schema.includes("-- set_offer_mode(p_period, p_mode, p_person) + save_offers(p_person, p_rows, p_clear, p_period, p_mode, p_np_add, p_np_clear) - the offer painter"), "the offers-RPC block comment's first line names save_offers' seven parameters");
  const blk = schema.slice(schema.indexOf("-- set_offer_mode(p_period, p_mode, p_person) + save_offers("), schema.indexOf("create or replace function public.set_offer_mode("));
  ok(blk.includes("-- Prompt 28 (2026-10-01, revision t; sql/migrations/2026-10-01-no-primary-days.sql - report-first; applied 2026-10-02 12:05:22Z)") && NP_CODES.every(([c, t]) => blk.includes(c + " " + t)), "the offers-RPC block comment carries the Prompt 28 paragraph (applied 2026-10-02 12:05:22Z) and every NP code with its token");
  ok(/the drop line stays here on purpose/.test(blk.replace(/\n-- +/g, " ")), "the block comment says why the drop line stays in schema.sql");
}

step("Prompt 28: the probe - self-rolling-back, the collision guard (s3's rows in 2030-11 / 2020-04-06, schedule_days / call_periods in 2030-11) first, then PROBE_SETUP, three throwaway users, 43 cases each stating its AFTER string in the header");
const npProbe = read(NP_PROBE);
ok(!/\r/.test(npProbe) && /^[\x00-\x7f]*$/.test(npProbe), "the no-primary probe is LF and ASCII");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(npProbe), "the no-primary probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(npProbe.includes("create temp table probe_results (k text, v text);\ngrant insert, select on probe_results to authenticated;\ngrant insert, select on probe_results to anon;"), "the probe collects into probe_results, granted to authenticated and anon (N1 runs as anon)");
{
  const lastDo = npProbe.lastIndexOf("do $$");
  ok(lastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(npProbe.slice(lastDo)), "the probe's last DO block raises 'PROBE_RESULTS %;END'");
  // pin moved deliberately 10/1 (review of Prompt 28): the collision guard now runs BEFORE the absent check (the apply script's
  // step 3 / --dry-run must see a live row in the window before anything is applied) and looks at what the fixtures can meet
  // only (s3's availability / call_offers / time_off, any schedule_days / call_periods in 2030-11) - another surgeon's long Setup
  // range is no collision; kept intent: both raise PROBE_SETUP before any fixture is written.
  const setupAt = npProbe.indexOf("raise exception 'PROBE_SETUP: save_no_primary is absent - sql/migrations/2026-10-01-no-primary-days.sql is not applied';");
  const guardAt = npProbe.indexOf("raise exception 'PROBE_SETUP: live rows already sit in the probe window (availability / call_offers / time_off rows of s3 in 2030-11 or an availability row of s3 over 2020-04-06, schedule_days / call_periods in 2030-11) - the probe fixtures would collide';");
  const usersAt = npProbe.indexOf("insert into auth.users");
  const regAt = npProbe.indexOf("if to_regprocedure('public.save_no_primary(text, date[], date[])') is null then");
  ok(guardAt > 0 && regAt > guardAt && setupAt > regAt && usersAt > setupAt, "the setup raises the collision guard first, then PROBE_SETUP (absent), before any fixture (" + [guardAt, regAt, setupAt, usersAt] + ")");
  const code = npProbe.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  ["select 1 from public.availability where person_id = 's3' and start_date <= '2030-11-30' and end_date >= '2030-11-01'", "select 1 from public.availability where person_id = 's3' and '2020-04-06' between start_date and end_date", "select 1 from public.call_offers where person_id = 's3' and day between '2030-11-01' and '2030-11-30'", "select 1 from public.time_off where person_id = 's3' and start_date <= '2030-11-30' and end_date >= '2030-11-01'", "select 1 from public.schedule_days where day between '2030-11-01' and '2030-11-30'", "select 1 from public.call_periods where start_day <= '2030-11-30' and end_day >= '2030-11-01'"].forEach((g) => ok(code.includes(g), "the collision guard checks: " + g));
  ok(!/select 1 from public\.(availability|call_offers|time_off) where (start_date|day|')/.test(code), "the collision guard never counts another surgeon's availability / call_offers / time_off row");
  ok(code.includes("'probe-noprimary-' || u || '@example.test'") && code.includes("update public.user_profiles set person_id = 's3', role = 'surgeon' where id = surgeon;") && code.includes("update public.user_profiles set role = 'coordinator' where id = coord;") && code.includes("update public.user_profiles set person_id = 's1', role = 'admin' where id = admin_u;"), "the throwaway users: surgeon S (s3), an unlinked coordinator C, an admin A (s1), probe-noprimary-<uuid>@example.test");
  ok(code.includes("values ('probe np open', '2030-11-01', '2030-11-15', '2030-09-01', '2030-10-01', 'upcoming', 'probe'),\n         ('probe np frozen', '2030-11-16', '2030-11-30', '2026-09-01', '2026-09-15', 'upcoming', 'probe');") && code.includes("values ('2030-11-05', 's3', null, 'probe-noprimary'), ('2030-11-06', 's2', 's3', 'probe-noprimary');"), "the fixtures: an open and a frozen period, s3 primary 11/5 and backup 11/6 (source probe-noprimary)");
  ok(code.includes("('s3', 'backup_only', 'any', '2030-11-10', '2030-11-12', 'probe-noprimary', 'setup', 'probe')") && code.includes("('s3', 'unavailable', 'any', '2030-11-09', '2030-11-09', 'probe-noprimary', 'setup', 'probe')") && code.includes("values ('s3', '2030-11-14', '2030-11-14', 'probe-noprimary', 'probe');"), "the fixtures: s3's Setup range, an unavailable row, a vacation");
  const days = Array.from(code.matchAll(/'(20[0-9]{2}-[0-9]{2}-[0-9]{2})'/g)).map((m) => m[1]).concat(Array.from(code.matchAll(/\{(20[0-9]{2}-[0-9]{2}-[0-9]{2})/g)).map((m) => m[1]));
  ok(days.length > 30 && days.every((d) => d.slice(0, 7) === "2030-11" || d === "2020-04-06" || ["2030-09-01", "2030-10-01", "2026-09-01", "2026-09-15"].includes(d)), "every day the probe touches is in 2030-11 or 2020-04-06 (period close / publish dates aside): " + days.filter((d) => !(d.slice(0, 7) === "2030-11" || d === "2020-04-06")).join(", "));
  ok(!/(update|insert into|delete from)\s+public\.call_schedule_data/.test(code), "the probe never writes the blob");
  NP_CASES.forEach((k) => ok(code.includes("values ('" + k + "', "), "the probe lacks case " + k));
  ok(code.includes("execute 'set local role anon';\n  perform set_config('request.jwt.claims', '', true);") && code.includes("perform set_config('request.jwt.claims', '{}', true);\n  begin\n    r := public.save_no_primary('s3', '{2030-11-15}', null);\n    insert into probe_results values ('N2', "), "N1 runs as anon, N2 as postgres with no signed-in user");
  ok(code.includes("r := public.save_offers('s3', '[{\"day\":\"2030-11-01\",\"role_pref\":\"backup\"}]'::jsonb, null);\n    insert into probe_results values ('O1', "), "O1 calls save_offers in the old three-argument shape");
}
const npProbeHdr = npProbe.slice(0, npProbe.indexOf("create temp table probe_results"));
// pin moved deliberately 10/2 (the record step, like the vacation guard probe's header): APPLIED 2026-10-02 12:05:22Z + the as-run note
ok(/REPORT-FIRST; APPLIED 2026-10-02 12:05:22Z\)/.test(npProbeHdr) && !/NOT APPLIED/.test(npProbeHdr) && /-- As run: the migration was applied 2026-10-02 12:05:22Z/.test(npProbeHdr) && /all 43 cases below as listed after it \(<name> = Acton, <today M\/D> = 10\/2\)/.test(npProbeHdr) && /section 16 FAILs a PROBE_SETUP or an anon 404/.test(npProbeHdr) && /WITHOUT PERSISTING ANYTHING/.test(npProbeHdr) && /\n-- 43 cases\.\n/.test(npProbeHdr), "the probe header: report-first, APPLIED 2026-10-02 12:05:22Z with the as-run note (section 16 FAILs a PROBE_SETUP since the record step), nothing persisted, 43 cases");
const NP_AFTER = {};
npProbeHdr.split("\n").forEach((l) => { const m = l.match(/^--   ([A-Z][0-9]+s?)\s+.* -> (.*)$/); if (m) NP_AFTER[m[1]] = m[2]; });
eq(Object.keys(NP_AFTER).sort(), NP_CASES.slice().sort(), "the probe header lists every case once with its AFTER string (`--   <case> <what> -> <AFTER>`);");
NP_CASES.forEach((k) => {
  const [kind, a, b, c] = NP_PROBE_CASES[k], h = NP_AFTER[k] || "";
  ok(kind === "eq" ? h === a : kind === "np" ? h.startsWith("ERR " + a + " " + b + ": ") && h.includes(c) : h.startsWith("ERR " + a + " ") && h.includes(b), "the probe header's AFTER for " + k + " (" + h + ") must agree with what section 16 grades (" + NP_PROBE_CASES[k].join(" | ") + ")");
});
// the record step (10/2): the 43 probe AFTER lines of the live run as Faraz's log printed them (apply-no-primary-days-20261002T120405Z.log,
// step 6 = verify-rls section 16 = the paste-back block): the header strings with <name> = Acton and <today M/D> = 10/2, sorted by
// case, a double quote escaped by the CLI's JSON (S11 / S12). SCHEMA-REVIEW's observed block and the faked section-16 run use them.
const NP_LIVE_LINES = NP_CASES.slice().sort().map((k) => k + "=" + (NP_AFTER[k] || "?").replace(/<name>/g, NP_NAME).replace(/<today M\/D>/g, "10/2").replace(/"/g, '\\"'));

step("Prompt 28: the pre-check - ONE read-only SELECT (the functions gate, the availability total, backup_only rows per person with a note COUNT, offer conflicts, a primary held on a no-primary day)");
const npPre = read(NP_PRECHECK);
ok(!/\r/.test(npPre) && /^[\x00-\x7f]*$/.test(npPre), "the pre-check is LF and ASCII");
{
  const hdr = npPre.slice(0, npPre.indexOf("with today as ("));
  ok(/READ-ONLY: one SELECT, nothing is written, locked or changed/.test(hdr) && /Run it BEFORE the apply/.test(hdr), "the pre-check's header says READ-ONLY and when to run it");
  // the record step (10/2): the header reads APPLIED with its as-run note, and row 2's note no longer says the client reads
  // availability unpaged (residual 4 - kept as reviewed until the apply, while the apply script pinned the file's sha256)
  ok(/REPORT-FIRST; APPLIED 2026-10-02 12:05:22Z\)/.test(hdr) && !/NOT APPLIED/.test(hdr) && /-- As run \(2026-10-02\): before the apply the gate read np_fn=no offers5=yes offers7=no overloads=1/.test(hdr) && /no row 4 \(no offer conflict\)/.test(hdr) && !/unpaged/.test(hdr) && /the client reads availability in pages of\n--\s+1000 since residual 4/.test(hdr), "the pre-check's header: APPLIED 2026-10-02 12:05:22Z, the as-run gate before / after, row 2's note corrected (paged since residual 4)");
  ok(hdr.includes("np_fn=no offers5=yes offers7=no overloads=1") && hdr.includes("np_fn=yes offers5=no offers7=yes overloads=1"), "the header states the gate before and after the apply");
  const code = npPre.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim();
  ok(code.startsWith("with today as (") && code.endsWith("order by ord, person_id;") && (code.match(/;/g) || []).length === 1, "the pre-check is ONE statement (a select with CTEs) ordered by ord, person_id");
  ok(!/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|lock|perform|set role|set_config)\b/i.test(code), "the pre-check writes, locks and changes nothing");
  ok(code.includes("'np_fn=' || case when to_regprocedure('public.save_no_primary(text, date[], date[])') is null then 'no' else 'yes' end") && code.includes("to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text)')") && code.includes("to_regprocedure('public.save_offers(text, jsonb, date[], uuid, text, date[], date[])')") && code.includes("where n.nspname = 'public' and p.proname = 'save_offers'"), "row 1 (the gate): save_no_primary, the five- and seven-argument save_offers, the overload count");
  ["'functions'::text", "'availability total'::text", "'backup_only rows'::text", "'offer conflict'::text", "'primary held on a no-primary day'::text"].forEach((t) => ok(code.includes(t), "the pre-check has the section " + t));
  const NOTE_COUNT = "' with_note=' || count(*) filter (where nullif(btrim(coalesce(a.note, '')), '') is not null)";
  ok(code.includes(NOTE_COUNT) && !/\bnote\b/.test(code.split(NOTE_COUNT).join("")), "the note is COUNTED, never printed - the count filter is the one place the pre-check reads a note (an anon-readable table's notes carry no reasons; the live Jackson County note is flagged, not copied)");
  ok(code.includes("where o.day >= t.d and o.role_pref in ('primary', 'either')") && code.includes("where s.day >= t.d and s.primary_id is not null"), "the conflict sections look at today or later (Central)");
}

step("Prompt 28: verify-rls.sh section 16 - anon REST (16a save_no_primary, 16b the seven-key save_offers), the graded probe, leftovers; strict since the record step (PROBE_SETUP and an anon 404 FAIL, no flag); graded against a faked CLI and curl");
ok(/^echo "== 16\. no-primary days \(2026-10-01, Prompt 28\): save_no_primary \+ save_offers p_np_add \/ p_np_clear - anon refused, rolled-back probe =="$/m.test(vr), "verify-rls.sh has no section 16 (no-primary days)");
// pin moved deliberately 10/2 (Prompt 29's merge with main): section 18 (APP call days) follows section 16, so the slice ends at the
// next section header (vrSectionEnd), else at the RESULT line - section 16's two-REST-call pin must not count section 18's curls.
const s16 = vr.slice(vr.indexOf('echo "== 16. '), vrSectionEnd('echo "== 16. '));
ok(s16.length > 0 && vr.indexOf('echo "== 16. ') > vr.indexOf('echo "== 15. ') && (vr.indexOf('echo "== 18. ') < 0 || vr.indexOf('echo "== 18. ') > vr.indexOf('echo "== 16. ')), "verify-rls.sh section 16 could not be sliced out (after section 15 and before section 18, up to the next section header or the RESULT line)");
const s16code = s16.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
// pins moved deliberately 10/2 (the record step): section 16 reads no flag - SILVIS_NO_PRIMARY_APPLIED / NPSTRICT16 are gone from
// the whole script (like SILVIS_VACATION_GUARD_APPLIED after its record step)
ok(!/SILVIS_NO_PRIMARY_APPLIED|NPSTRICT16/.test(vr), "verify-rls.sh no longer reads or documents SILVIS_NO_PRIMARY_APPLIED (the record step dropped it; strict is the default)");
eq((s16code.match(/curl /g) || []).length, 2, "section 16 makes exactly two REST calls (16a, 16b);");
ok(s16code.includes("-X POST \"$URL/rest/v1/rpc/save_no_primary\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\" -H \"Content-Type: application/json\" -d '{\"p_person\":\"s9test\",\"p_add\":[],\"p_clear\":[]}'"), "16a: anon POST rpc/save_no_primary (anon key as apikey and bearer; empty lists - nothing written)");
ok(s16code.includes("-X POST \"$URL/rest/v1/rpc/save_offers\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\" -H \"Content-Type: application/json\" -d '{\"p_person\":\"s9test\",\"p_rows\":[],\"p_clear\":[],\"p_period\":null,\"p_mode\":null,\"p_np_add\":[],\"p_np_clear\":[]}'"), "16b: anon POST rpc/save_offers with the seven keys (the schema-cache gate before the client push)");
ok(!/SILVIS_JWT|SILVIS_SURGEON_JWT/.test(s16code), "section 16 sends no user token (anon only)");
// pin moved deliberately 10/2 (the record step): a 404 is a FAIL with no flag (it passed as the not-applied picture before)
ok((s16code.match(/"HTTP 401"\|"HTTP 403"\) ok /g) || []).length === 2 && (s16code.match(/"HTTP 404"\) bad "anon rpc save_[a-z_ ]+: HTTP 404 \([^"]*2026-10-02 apply/g) || []).length === 2 && !/HTTP 404 - not applied yet/.test(s16code) && (s16code.match(/\n  \*\) bad "anon rpc save_/g) || []).length === 2, "16a / 16b: 401/403 PASS, a 404 FAIL (the functions exist since the 2026-10-02 apply), anything else - a 200 included - FAIL");
ok(/PROBE16="\$\(cd sql\/probes && \(pwd -W 2>\/dev\/null \|\| pwd\)\)\/no-primary-probe\.sql"/.test(s16code), "16c runs sql/probes/no-primary-probe.sql through the linked CLI");
// pin moved deliberately 10/2 (the record step): PROBE_SETUP (absent) is a FAIL with no flag - the function exists since the apply
ok(/bad "no-primary probe: PROBE_SETUP - save_no_primary is absent \(the function exists since the 2026-10-02 apply\)"/.test(s16code) && !/ok "no-primary probe: save_no_primary is absent/.test(s16code), "16c must FAIL a PROBE_SETUP (strict since the record step; it passed as the not-applied picture before)");
ok(s16code.includes("expect_eq16()  { v=$(case_val16 \"$1\" | sed 's/\\\\//g');") && s16code.includes("case \"$v\" in \"ERR $2 $3: \"*\"$4\"*) ok") && s16code.includes("case \"$v\" in \"ERR $2 \"*\"$3\"*) ok"), "section 16's graders strip the CLI's backslashes and match ERR <code> [<token>:] ... <substring> literally");
NP_CASES.forEach((k) => {
  const [kind, a, b, c] = NP_PROBE_CASES[k];
  const re = kind === "eq" ? new RegExp("\\n    expect_eq16\\s+" + reEsc(k) + "\\s+\"" + reEsc(a) + "\"\\s") : kind === "np" ? new RegExp("\\n    expect_np16\\s+" + reEsc(k) + "\\s+" + a + "\\s+" + b + "\\s+\"" + reEsc(c) + "\"\\s") : new RegExp("\\n    expect_err16\\s+" + reEsc(k) + "\\s+" + a + "\\s+[\"']" + reEsc(b) + "[\"']\\s");
  ok(re.test(s16code), "section 16 must grade " + k + " as " + NP_PROBE_CASES[k].join(" | "));
});
eq((s16code.match(/\n    expect_(eq|np|err)16 /g) || []).length, NP_CASES.length, "section 16 grades exactly the 43 cases;");
// pin moved deliberately 10/1 (review of Prompt 28): 16d counts by the probe's identity - tagged rows (only the probe writes them;
// ready-to-paste DELETEs) and s3's availability / call_offers in the window (in_window; SELECTs to review, never a DELETE) - not every
// row of anyone in 2030-11 / over 2020-04-06 (a legitimate long statement of s5 was reported as a leftover and its DELETE printed);
// kept intent: a non-zero count after a run that passed the collision guard is a FAIL naming LEFT ROWS BEHIND.
ok(["(select count(*) from auth.users where email like 'probe-noprimary-%@example.test')", "(select count(*) from public.schedule_days where source = 'probe-noprimary')", "(select count(*) from public.time_off where note = 'probe-noprimary')", "(select count(*) from public.call_periods where label like 'probe np %')", "(select count(*) from public.availability where note = 'probe-noprimary' or source = 'probe-noprimary')", "(select count(*) from public.call_offers where note = 'probe-noprimary'))::int as tagged", "(select count(*) from public.availability where person_id = 's3' and ((start_date <= '2030-11-30' and end_date >= '2030-11-01') or '2020-04-06' between start_date and end_date))", "(select count(*) from public.call_offers where person_id = 's3' and day between '2030-11-01' and '2030-11-30'))::int as in_window"].every((t) => s16code.includes(t)) && /LEFT ROWS BEHIND/.test(s16code), "16d counts leftovers by the probe's identity (tagged: auth.users / schedule_days / time_off / call_periods / availability / call_offers tagged probe-noprimary; in_window: s3's availability / call_offers) and fails on non-zero");
ok(!/count\(\*\) from public\.(availability|call_offers) where (start_date|day|')/.test(s16code) && !/delete from public\.(availability|call_offers) where (\(start_date|start_date|day|person_id)/.test(s16code), "16d never counts nor deletes another person's availability / call_offers row by date alone, and prints no DELETE for an untagged row");
ok(s16code.includes('echo "   SKIP 16 (supabase CLI not linked at $WORKDIR)"'), "without a linked CLI 16c / 16d skip (16a / 16b still run)");
{
  const head = vr.slice(0, vr.indexOf("case \"${1:-}\""));
  // pins moved deliberately 10/2 (the record step): the header still names section 16 and its anon checks; the header and --help
  // no longer name the flag - --help's env-var list ends at SILVIS_PREFS_ROWS_BEFORE again (it ended at SILVIS_NO_PRIMARY_APPLIED
  // from the 10/1 merge with the vacation guard's record step until now)
  ok(/no-primary days anon RPC checks and probe \(16\)/.test(head) && /anon checks \(1-2, 5c, 7a, 8, 9a-9b, 10a, 16a-16b[,)]/.test(head), "verify-rls.sh's header names section 16 and its anon checks (moved deliberately 10/2 at Prompt 29's merge: 18a-18d may follow)");
  ok(/SILVIS_PREFS_ROWS_BEFORE - see the header of this file/.test(vr.slice(0, vr.indexOf("set -u"))), "verify-rls.sh --help must end its env-var list at SILVIS_PREFS_ROWS_BEFORE (SILVIS_NO_PRIMARY_APPLIED dropped)");
}
{
  // pin moved deliberately 10/2 (Prompt 29's merge with main): the faked run stops at the next section header (18) - section 18's
  // anon curls and its probe never run here (section 18 has its own faked run below)
  const code16 = vr.slice(vr.indexOf('echo "== 16. '), vrSectionEnd('echo "== 16. '));
  // pin moved deliberately 10/2 (the record step): no strict option - section 16 reads no flag (under set -u, with the variable
  // unset); `pre` adds a line before the section, e.g. a SILVIS_NO_PRIMARY_APPLIED left in the environment (the apply script
  // set it), which must change nothing
  const run16 = (cliOut, opts) => {
    const o = Object.assign({ tagged: 0, win: 0, shape: "envelope", a: "401", b: "401", pre: "" }, opts || {});
    // the CLI's -o json: the agent envelope, a plain terminal's bare array (review 10/1: both occur), or an error line
    const qBody = o.shape === "error" ? "echo 'unexpected status 500: connection refused'"
      : o.shape === "bare" ? "printf '[\\n  {\\n    \"tagged\": " + o.tagged + ",\\n    \"in_window\": " + o.win + "\\n  }\\n]\\n'"
      : "printf '{\\n  \"boundary\": \"%s\",\\n  \"rows\": [\\n    {\\n      \"tagged\": " + o.tagged + ",\\n      \"in_window\": " + o.win + "\\n    }\\n  ]\\n}\\n' \"$RANDOM\"";
    const script = "set -u\nWORKDIR=/nonexistent; pass=0; fail=0; T=$(mktemp -d); URL=http://verify.invalid; ANON=x\n" +
      "ok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      (o.pre ? o.pre + "\n" : "") + "CURL16A='" + o.a + "'; CURL16B='" + o.b + "'\nlinked() { true; }\n" +
      "q() { " + qBody + "; }\n" +
      "curl() { local of='' prev='' code='' a; for a in \"$@\"; do [ \"$prev\" = '-o' ] && of=\"$a\"; case \"$a\" in *rpc/save_no_primary*) code=\"$CURL16A\";; *rpc/save_offers*) code=\"$CURL16B\";; esac; prev=\"$a\"; done; [ -n \"$of\" ] && : > \"$of\"; printf 'HTTP %s' \"$code\"; }\n" +
      "supabase() { echo 'Initialising login role...'; echo '" + cliOut.replace(/'/g, "'\\''") + "'; }\n" + code16 + "\nrm -rf \"$T\"\necho \"RESULT $pass $fail\"\n";
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    ok(!r.error, "bash could not be started to run section 16: " + (r.error && r.error.message));
    return { out: r.stdout || "", result: ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number), err: r.stderr || "" };
  };
  const fails = (x) => x.out.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") + x.err.slice(0, 200);
  const after = {};
  NP_CASES.forEach((k) => { after[k] = NP_PROBE_CASES[k][0] === "eq" ? NP_PROBE_CASES[k][1] : (NP_AFTER[k] || "").replace(/<name>/g, NP_NAME).replace(/<today M\/D>/g, "10/1"); });
  // the CLI's JSON escapes a double quote inside the message (S11 / S12): the graders strip the backslashes
  const msgOf = (pic) => '{"message": "ERROR: P0001: PROBE_RESULTS ' + Object.keys(pic).sort().map((k) => k + "=" + pic[k].replace(/"/g, '\\"')).join(";") + ';END"}';
  const ra = run16(msgOf(after));
  eq(ra.result, [NP_CASES.length + 3, 0], "section 16 against the AFTER picture (401 / 401, every case, leftover 0): every check PASS (" + fails(ra) + ");");
  // the record step (10/2): the 2026-10-02 live picture exactly as Faraz's log printed it (today 10/2; S11 / S12 with the CLI's
  // escaped quotes) - every check PASS, a leftover SILVIS_NO_PRIMARY_APPLIED=1 in the environment ignored
  const rlive = run16('{"message": "ERROR: P0001: PROBE_RESULTS ' + NP_LIVE_LINES.join(";") + ';END"}', { pre: "export SILVIS_NO_PRIMARY_APPLIED=1" });
  eq(rlive.result, [NP_CASES.length + 3, 0], "section 16 against the 2026-10-02 AFTER picture as the log printed it (401 / 401, the 43 lines, leftover 0), a leftover SILVIS_NO_PRIMARY_APPLIED=1 ignored (" + fails(rlive) + ");");
  // pins moved deliberately 10/2 (the record step): the not-applied picture is a FAIL with no flag (it passed before; strict was the flag's)
  const setup = '{"message": "ERROR: P0001: PROBE_SETUP: save_no_primary is absent - sql/migrations/2026-10-01-no-primary-days.sql is not applied"}';
  const rb = run16(setup, { a: "404", b: "404" });
  eq(rb.result, [1, 3], "section 16 since the record step (404 / 404, PROBE_SETUP): the two 404s and PROBE_SETUP are FAILs with no flag, the leftover check still runs (" + fails(rb) + ");");
  ok(/FAIL  no-primary probe: PROBE_SETUP - save_no_primary is absent \(the function exists since the 2026-10-02 apply\)/.test(rb.out) && /FAIL  anon rpc save_no_primary: HTTP 404/.test(rb.out) && /FAIL  anon rpc save_offers with seven keys: HTTP 404/.test(rb.out), "section 16 names the missing function and both 404s");
  eq(run16(setup, { a: "404", b: "404", pre: "SILVIS_NO_PRIMARY_APPLIED=" }).result, [1, 3], "section 16: an empty SILVIS_NO_PRIMARY_APPLIED no longer turns the 404s and PROBE_SETUP into PASSes;");
  const rl = run16(msgOf(Object.assign({}, after, { H1: "ok np_added=1", F1: "ok np_added=1" })), { a: "200" });
  eq(rl.result, [NP_CASES.length, 3], "section 16 must fail a held primary let through, a frozen day let through and an anon 200 - exactly those three (" + fails(rl) + ");");
  const rq = run16(msgOf(after), { tagged: 3 });
  eq(rq.result, [NP_CASES.length + 2, 1], "section 16 fails a non-zero tagged leftover count;");
  ok(/LEFT ROWS BEHIND \(tagged=3/.test(rq.out) && rq.out.includes("delete from public.schedule_days where source = 'probe-noprimary';") && rq.out.includes("delete from public.availability where note = 'probe-noprimary' or source = 'probe-noprimary';"), "section 16 names the tagged leftovers and prints their DELETEs");
  const rw = run16(msgOf(after), { win: 2 });
  eq(rw.result, [NP_CASES.length + 2, 1], "section 16 fails s3's rows left in the window after a run that passed the collision guard;");
  ok(/LEFT ROWS BEHIND \(in_window=2/.test(rw.out) && rw.out.includes("select * from public.availability where person_id = 's3'") && !/delete from public\.(availability|call_offers)/.test(rw.out), "... and prints SELECTs to review, never a DELETE of an untagged row (a probe row and a real entry of s3 look alike)");
  // pin moved deliberately 10/2 (the record step): the PROBE_SETUP run is a FAIL itself now (16a / 16b answer 401 here); kept intent:
  // the guard passed before the absent raise, so s3's rows in the window after it are still a leftover (FAIL)
  eq(run16(setup, { win: 1 }).result, [2, 2], "an absent-function run passed the guard too (the absent raise comes after it): s3's rows in the window then are a leftover (FAIL) beside the PROBE_SETUP FAIL;");
  eq(run16(msgOf(after), { shape: "bare" }).result, [NP_CASES.length + 3, 0], "16d reads a plain terminal's bare-array -o json the same as the agent envelope;");
  eq(run16(msgOf(after), { shape: "error" }).result, [NP_CASES.length + 2, 1], "16d fails a leftover count it cannot read;");
  eq(run16('{"message": "connection refused"}').result, [3, 1], "section 16 fails a run with no sentinel-terminated PROBE_RESULTS (16a / 16b and the leftover check still run);");
  const collide = '{"message": "ERROR: P0001: PROBE_SETUP: live rows already sit in the probe window (availability / call_offers / time_off rows of s3 in 2030-11 or an availability row of s3 over 2020-04-06, schedule_days / call_periods in 2030-11) - the probe fixtures would collide"}';
  eq(run16(collide).result, [3, 1], "the probe's collision guard is a FAIL, never 'not applied';");
  const rc = run16(collide, { win: 2 });
  eq(rc.result, [2, 1], "a collision with s3's live rows in the window: 16c FAILs, 16d neither passes nor fails them (the probe wrote nothing) - " + fails(rc));
  ok(!/LEFT ROWS BEHIND/.test(rc.out) && /an untagged one is a live row, not a leftover/.test(rc.out) && !/delete from public\.(availability|call_offers)/.test(rc.out), "... and lists them for review only, never as leftovers and never with a DELETE");
}

step("Prompt 28: no apply script in the repo (Faraz 10/1: the one-command apply scripts carry machine paths and live outside the repo) - none under scripts/, no tracked SQL or SCHEMA-REVIEW line runs one from scripts/");
{
  ["apply-no-primary-days.sh", "apply-vacation-guard.sh"].forEach((f) => ok(!fs.existsSync(path.join(ROOT, "scripts", f)), "scripts/" + f + " must not be in the repo (Faraz 10/1: apply scripts live outside it; test/ci.test.js keeps verify-rls.sh the only shell script)"));
  [NP_MIGRATION, NP_PROBE, NP_PRECHECK, path.join(ROOT, "sql", "schema.sql"), path.join(ROOT, "scripts", "verify-rls.sh"), path.join(ROOT, "docs", "SCHEMA-REVIEW.md")].forEach((p) =>
    ok(!/bash scripts\/apply-|scripts\/apply-(no-primary-days|vacation-guard)\.sh/.test(read(p)), path.relative(ROOT, p) + " names an in-repo apply script (they live outside the repo since 10/1)"));
}

step("Prompt 28: docs - SCHEMA-REVIEW.md section (APPLIED 2026-10-02 12:05:22Z + the observed apply since the record step, the decision, NP001-NP009, decisions, flags, blast radius, residuals, the pre-check verbatim, the probe table, apply order, one command, rollback), table (a), the vacation guard's one command, guide 4.3, the rules doc");
ok(/^## 2026-10-01 - no-primary days: save_no_primary \+ save_offers p_np_add \/ p_np_clear \(Faraz 10\/1, Prompt 28; `sql\/migrations\/2026-10-01-no-primary-days\.sql`\)$/m.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-10-01 - no-primary days: ...' section");
{
  const at = review.indexOf("## 2026-10-01 - no-primary days:"), end = review.indexOf("\n## ", at + 1);
  const sec = at < 0 ? "" : review.slice(at, end < 0 ? review.length : end);
  const flat = sec.replace(/\s+/g, " ");
  // pin moved deliberately 10/2 (the record step): the status reads APPLIED (it read `**Status: PREPARED - report-first, NOT APPLIED.**` before)
  ok(/^\*\*Status: APPLIED 2026-10-02 12:05:22Z\*\* \(Faraz, from PowerShell through Git's bash\.exe - `apply-no-primary-days\.sh`, which exports `AI_AGENT`; the observed lines at the end\)\./m.test(sec) && !/\*\*Status: PREPARED/.test(sec), "the section's status line must read `**Status: APPLIED 2026-10-02 12:05:22Z** (Faraz, ... apply-no-primary-days.sh ...)` since the record step");
  ok(flat.includes("\"I do want them to be able to do that\"") && flat.includes("I can cover backup call these days"), "the section quotes Faraz and Burchett");
  ok(/^\| `save_no_primary\(p_person text, p_add date\[\], p_clear date\[\]\)` \| - \|/m.test(sec) && /^\| `save_offers` \| five arguments/m.test(sec) && /\*\*unchanged\*\*/.test(sec) && flat.includes("`notify pgrst, 'reload schema';`"), "the object table: the new definer, save_offers dropped and re-created, everything else unchanged, the cache reload");
  ok(flat.includes("**The decision: extend `save_offers` AND add the definer sibling, called inside it.**"), "the section states the decision");
  NP_CODES.forEach(([c, t]) => ok(new RegExp("^\\| `" + c + "` \\|[^\\n]*`" + t + ": ", "m").test(sec), "the refusal table lists " + c + " with its " + t + " message"));
  // pin moved deliberately 10/1 (review of Prompt 28): decision 6 is reworded in the direction the code goes (No primary painted
  // over an Either offer removes it; "Either on a no-primary day is replaced by nothing" read as the reverse); kept intent: the
  // section lists every decision.
  ok(flat.includes("**Decisions for Faraz**") && flat.includes("**Past days bind the scheduler too**") && flat.includes("**A vacation day is allowed**") && flat.includes("**Only a held PRIMARY is refused**") && flat.includes("**No primary painted over an Either offer removes the offer**") && flat.includes("**A cleared seed-sourced row comes back on the next seed apply**") && flat.includes("**NP009 also binds older builds' Saves**"), "the section lists the decisions for Faraz");
  ok(flat.includes("(5) closed in review (10/1)") && flat.includes("(6) NP009 binds the two RPCs only") && flat.includes("(7) No horizon or size cap"), "the residuals record the closed lock gap (5), the direct call_offers / claim path that skips NP009 (6) and the uncapped availability writes (7)");
  ok(flat.includes("**Flags (live data, never changed here):**") && flat.includes("carry the public note \"Jackson County\"") && flat.includes("The function writes note NULL") && flat.includes("10/15"), "the section flags the live Jackson County note and the 10/15 seed row (nothing changed live)");
  ok(flat.includes("**Blast radius.**") && flat.includes("**Residuals.**") && flat.includes("`claim_open_slot` does not consult availability") && flat.includes("unpaged"), "the section states the blast radius and the residuals");
  ok(sec.includes("```sql\n" + npPre.slice(npPre.indexOf("with today as (")).replace(/\n+$/, "") + "\n```"), "the section carries the pre-check verbatim (= sql/probes/no-primary-precheck.sql)");
  NP_CASES.forEach((k) => ok(new RegExp("^\\| " + reEsc(k) + " \\| [^\\n]* \\| `" + reEsc(NP_AFTER[k] || "?") + "` \\|$", "m").test(sec), "the section's probe table lists case " + k + " with its AFTER string"));
  ok(flat.includes("4. Probe AFTER: every case as the table lists (43 cases).") && flat.includes("5. `SILVIS_NO_PRIMARY_APPLIED=1 bash scripts/verify-rls.sh`") && flat.includes("6. The record step, ONE commit:") && flat.includes("`supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-01-no-primary-days.sql`"), "the apply order: pre-check, probe BEFORE, the file, probe AFTER (43), strict verify-rls, the record step");
  ok(flat.includes("**One command (Faraz):** his apply script `apply-no-primary-days.sh`, kept OUTSIDE the repo") && flat.includes("the migration's sha256 is the reviewed one") && flat.includes("--dry-run") && flat.includes("PASTE THIS BACK TO CLAUDE CODE"), "the section names the one command (its script outside the repo, Faraz 10/1), the sha256 stop, its dry run and the paste-back block");
  ok(sec.includes("    drop function if exists public.save_offers(text, jsonb, date[], uuid, text, date[], date[]);\n    -- re-create the five-argument save_offers from sql/migrations/2026-09-24-coordinator-role.sql (its create, grants, comment)\n    drop function if exists public.save_no_primary(text, date[], date[]);\n    notify pgrst, 'reload schema';"), "the section gives the rollback");
  // pin moved deliberately 10/2 (the record step): the placeholder is gone - the observed apply paragraph from Faraz's log
  // apply-no-primary-days-20261002T120405Z.log replaces it
  ok(!/_to be filled/.test(sec), "the section has no observed placeholder since the record step");
  const at2 = sec.indexOf("observed (apply, 2026-10-02): applied 2026-10-02 12:05:22Z");
  ok(at2 > 0 && at2 > sec.indexOf("**Rolling back**"), "the section must end with the 'observed (apply, 2026-10-02): applied 2026-10-02 12:05:22Z ...' paragraph");
  const ap = at2 < 0 ? "" : sec.slice(at2);
  const apFlat = ap.replace(/\s+/g, " ");
  ok(apFlat.includes("exit 0, an empty result `\"rows\": []`") && apFlat.includes("log `apply-no-primary-days-20261002T120405Z.log`, outside the repo, result `APPLIED AND VERIFIED`") && apFlat.includes("repo HEAD `3c59e79`") && apFlat.includes("`" + NP_APPLIED_SHA256 + "` = the expected one") && apFlat.includes("supabase CLI 2.84.2") && apFlat.includes("`bzhsroegtagqhutbnsrp`"), "the observed apply names the CLI exit, the log and its result, the repo HEAD, the applied sha256, the CLI version and the project");
  // the observed lines, copied from the log: the gate before + its facts, the signatures before / after, probe BEFORE, the gate after
  ok(apFlat.includes("gate before: `np_fn=no offers5=yes offers7=no overloads=1`") && ap.includes("```text\n2 availability total: rows=45\n3 backup_only rows s2: single=18 ranges=0 with_note=18 sources=seed,setup\n5 primary held on a no-primary day s2: days=2026-10-15\n```") && apFlat.includes("(no row 4: no offer conflict)"), "the observed apply records the pre-check gate before and its three facts as the log printed them");
  ok(apFlat.includes("signatures before: `save_offers(text, jsonb, date[], uuid, text) invoker`") && apFlat.includes("Step 3, probe BEFORE: `PROBE_SETUP: save_no_primary is absent - sql/migrations/2026-10-01-no-primary-days.sql is not applied`") && apFlat.includes("gate after: `np_fn=yes offers5=no offers7=yes overloads=1`") && apFlat.includes("signatures after: `save_no_primary(text, date[], date[]) definer;save_offers(text, jsonb, date[], uuid, text, date[], date[]) invoker`"), "the observed apply records the signatures before / after, probe BEFORE and the gate after");
  // the 43 AFTER lines as the log printed them, in one text block: exactly the live picture (sorted, the CLI's escaped quotes kept)
  const blockAt = ap.indexOf("```text\nA1=");
  const block = blockAt < 0 ? "" : ap.slice(blockAt + 8, ap.indexOf("\n```", blockAt + 8));
  eq(block.split("\n"), NP_LIVE_LINES, "the observed probe AFTER lists the 43 cases exactly as the log printed them (sorted, one per line);");
  ok(apFlat.includes("`RESULT: 338 passed, 0 failed`") && apFlat.includes("16a `HTTP 401`") && apFlat.includes("16b `HTTP 401`") && apFlat.includes("every one of the 43 cases PASS") && apFlat.includes("leftover count 0") && apFlat.includes("(3, 6, 7c-7e, 8c / 8d, 9d, 14c) skipped"), "the observed apply records verify-rls 338 / 0, 16a / 16b 401, section 16 green, leftovers 0 and the skipped JWT checks");
  ok(flat.includes("*As run (2026-10-02): the first live run read all 43 cases exactly as their header strings") && flat.includes("section 16 graded 46 / 0.*"), "what could break carries its as-run note");
  ok(flat.includes("Faraz ran it on 2026-10-02 at `3c59e79` (the observed lines at the end)"), "the one-command paragraph says when it ran");
  // ship review 10/2: the apply order's as-run note (the record lane's edit had been refused; the vacation guard's sits after its
  // item 7): the dry run, the run's steps against items 1-5, item 6 as the record commit, the flag gone from verify-rls
  const npAsRun = flat.indexOf("*As run (2026-10-02): a `--dry-run` first (log `apply-no-primary-days-20261002T120333Z.log`, started 12:03:33Z");
  ok(npAsRun > flat.indexOf("6. The record step, ONE commit:") && npAsRun < flat.indexOf("**One command (Faraz):**"), "the apply order carries its as-run note after item 6, before the one-command paragraph");
  ok(flat.includes("then `DRY RUN - nothing applied`") && flat.includes("log `apply-no-primary-days-20261002T120405Z.log`, started 12:04:05Z") && flat.includes("(item 5, as written - the flag was still in the script at `3c59e79`)") && flat.includes("(body sha256 `" + NP_APPLIED_SHA256 + "`, pinned as `NP_APPLIED_SHA256`") && flat.includes("so item 5's flag is history.*"), "the as-run note: the dry run (nothing applied), the run, item 5 as written, item 6 the record commit with the body's sha256, the flag history");
  ok(flat.includes("the `--dry-run` at 12:03:33Z (nothing applied), then the run at 12:04:05Z"), "the one-command paragraph names the dry run and the run");
}
// pin moved deliberately 10/2 (the record step): table (a)'s availability row reads applied live (it read "(prepared 2026-10-01, NOT APPLIED" before)
ok(/^\| `availability` \|[^\n]*through `save_offers` -> `save_no_primary` \(prepared 2026-10-01 - report-first, \*\*applied live 2026-10-02 12:05 UTC\*\*/m.test(tblA) && !/^\| `availability` \|[^\n]*NOT APPLIED/m.test(tblA), "SCHEMA-REVIEW table (a)'s availability row names the no-primary write path, **applied live 2026-10-02 12:05 UTC**");
{
  // the record step (10/2): guide 4.3's bullet and Proof line, the client paragraph and the rules doc's section 1 row say applied
  const guideAll = read(path.join(ROOT, "docs", "SILVIS-BUILD-GUIDE.md"));
  const rulesDoc = read(path.join(ROOT, "docs", "SILVIS-CALL-RULES.md"));
  const npBullet = (guideAll.match(/^- \*\*No-primary days \(2026-10-01, [^\n]*/m) || [""])[0];
  const npProof = (guideAll.match(/^Proof: `sql\/probes\/no-primary-probe\.sql`[^\n]*/m) || [""])[0];
  ok(/^- \*\*No-primary days \(2026-10-01, Prompt 28, report-first, applied 2026-10-02 12:05 UTC; `sql\/migrations\/2026-10-01-no-primary-days\.sql`, revision t\)\.\*\*/.test(npBullet), "guide 4.3 must carry the 'No-primary days (2026-10-01, Prompt 28, report-first, applied 2026-10-02 12:05 UTC; ..., revision t)' bullet");
  ok(/section 16 \(the anon RPC checks, the graded probe \+ leftovers; strict since the record step - a PROBE_SETUP or an anon 404 FAILs\)/.test(npProof) && !/SILVIS_NO_PRIMARY_APPLIED/.test(npProof) && !/_to be filled/.test(npProof) && /applied: 2026-10-02 12:05:22 UTC by Faraz/.test(npProof) && /AFTER 43 \/ 43, verify-rls 338 \/ 0/.test(npProof) && /the migration file kept as it ran, its sha256 pinned/.test(npProof), "guide 4.3's no-primary Proof line: section 16 strict (no flag), 'applied: 2026-10-02 12:05:22 UTC' with probe AFTER 43 / 43 and verify-rls 338 / 0, the file kept as it ran");
  ok(guideAll.includes("That is why the client ships only after the\napply (applied 2026-10-02 12:05 UTC - section 4.3)."), "the painter paragraph's 'ships only after the apply' names the apply");
  ok(rulesDoc.includes("the office or the scheduler for anyone; prepared 10/1, report-first, **applied 2026-10-02**)") && !/save_no_primary` \([^)]*prepared 10\/1, report-first\)/.test(rulesDoc), "the rules doc's section 1 No-primary row says applied 2026-10-02");
}
{
  const at = review.indexOf("## 2026-09-30 - vacation guard:"), end = review.indexOf("\n## ", at + 1);
  const vgSec = review.slice(at, end < 0 ? review.length : end);
  const one = vgSec.indexOf("One command (10/1): Faraz's apply script `apply-vacation-guard.sh`, kept OUTSIDE the repo");
  ok(one > 0 && one < vgSec.indexOf("observed (pre-apply, 2026-10-01)"), "the vacation guard section names its one command (the script kept outside the repo) before its observed lines");
}
console.log("- Prompt 28: save_no_primary + the seven-argument save_offers (report-first, applied 2026-10-02 12:05:22Z; the file kept as it ran, sha256-pinned), mirrored (revision t), probe + pre-check + verify-rls section 16 (strict) graded against a faked CLI, apply scripts kept outside the repo, docs pinned");

// ---- Prompt 29 - APP call days (2026-10-02, Faraz 10/1 6:33 PM: "I want the APPs to be able to add themselves to call days") ----
// sql/migrations/2026-10-02-app-call-days.sql (REPORT-FIRST; APPLIED 2026-10-02 19:19:27Z by Faraz; revision v): user_profiles.is_app
// (a FLAG on an unlinked viewer row, not a role - the follower e-mails pick followers by role) + the check user_profiles_app_viewer +
// the is_app pin in the two self policies; silvis_is_app(); the table app_call_days (one APP per day - day is the primary key;
// authenticated read, never anon; authenticated keeps SELECT only); app_call_names() (definer, stable: the display names);
// save_app_days() (definer, volatile: the ONLY write path, AP001-AP007, the appdays.save audit row). schema.sql mirrors it;
// sql/probes/app-call-days-probe.sql proves it (rolled back, 69 cases), sql/probes/app-call-days-precheck.sql reads the gate and the
// facts (read-only), verify-rls.sh section 18 grades both (section 18: 16 and 17 are taken by Prompt 28 and the weekend pair claim on
// other branches). Faraz's one-command apply script apply-app-call-days.sh lives OUTSIDE the repo. These pins read DB-lane files
// only (no client file, no app-lane doc), apart from the record step's doc pins at the end.
// pins moved deliberately 10/2 (the record step, like the no-primary days' and the vacation guard's): the applied wording everywhere;
// verify-rls section 18 strict by default (PROBE_SETUP and a 404 FAIL, SILVIS_APP_DAYS_APPLIED gone); the migration file is kept
// byte for byte as it ran - its body is pinned by sha256 (annotated only in ONE trailer line), so its header still reads as it ran
// ("REPORT-FIRST, NOT APPLIED", the flag in its apply order); the observed apply (Faraz's log of 10/2) is pinned line by line.
// local helpers under their own names (Prompt 28's block defines reEsc / topStatements - the merge must not redeclare a const)
const apEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// the top-level statements of a SQL file (comment lines dropped; a ';' inside a $$ body or a '...' literal does not end one)
function apTopStatements(sql) {
  const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  const out = []; let cur = ""; let body = false; let str = false;
  for (let i = 0; i < code.length; i++) {
    if (!str && code.startsWith("$$", i)) { body = !body; cur += "$$"; i++; continue; }
    if (!body && code[i] === "'") str = !str;
    cur += code[i];
    if (code[i] === ";" && !body && !str) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const AP_FILE = "2026-10-02-app-call-days.sql";
const AP_MIGRATION = path.join(ROOT, "sql", "migrations", AP_FILE);
const AP_PROBE = path.join(ROOT, "sql", "probes", "app-call-days-probe.sql");
const AP_PRECHECK = path.join(ROOT, "sql", "probes", "app-call-days-precheck.sql");
// sha256 of the applied file, observed 2026-10-02: the log's "migration sha256" line of apply-app-call-days.sh (repo HEAD 5b9964e,
// "(expected 9a03...)" matched; sha256sum of `git show 5b9964e:sql/migrations/2026-10-02-app-call-days.sql` agrees).
const APPDAYS_APPLIED_SHA256 = "9a03c834010cbb1a8eee5fa4b36fb57ada091c89364172709c6a5da800d27880";
// The repo copy carries ONE trailer line after the applied body; the body (everything before it) is what is hashed.
const APPDAYS_TRAILER = "\n-- applied 2026-10-02 19:19:27Z by Faraz";
const AP_COLUMN_LINES = [
  "alter table public.user_profiles add column if not exists is_app boolean not null default false;",
  "alter table public.user_profiles drop constraint if exists user_profiles_app_viewer;",
  "alter table public.user_profiles add constraint user_profiles_app_viewer\n  check (not is_app or (role = 'viewer' and person_id is null));",
];
// the two self policies: the followers texts plus ONE clause (self_insert: not is_app) and TWO (self_update: the is_app pin and, review
// 10/2, the APP display_name pin - app_call_names shows an APP's name to every signed-in user) - derived from FOLLOW_POLICIES below,
// so "byte for byte otherwise" is pinned
const AP_SELF_INSERT = "create policy user_profiles_self_insert on public.user_profiles for insert to authenticated\n  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb and not is_app);";
const AP_SELF_UPDATE = "create policy user_profiles_self_update on public.user_profiles for update to authenticated\n  using (id = auth.uid())\n  with check (id = auth.uid()\n    and role = (select role from public.user_profiles p where p.id = auth.uid())\n    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())\n    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())\n    and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid())\n    and is_app is not distinct from (select is_app from public.user_profiles p where p.id = auth.uid())\n    and (not is_app or display_name is not distinct from (select display_name from public.user_profiles p where p.id = auth.uid())));";
const AP_READ_POLICY = "create policy app_call_days_read on public.app_call_days for select to authenticated using (true);";
const AP_TABLE = "create table if not exists public.app_call_days (\n" +
  "  day         date primary key check (isfinite(day)),                                  -- one APP per day: the database enforces it (never infinity)\n" +
  "  profile_id  uuid not null references public.user_profiles(id) on delete cascade,     -- deleting the account removes its days\n" +
  "  source      text not null check (source in ('app', 'scheduler')),                    -- the APP itself / the scheduler for an APP\n" +
  "  created_by  uuid,                                                                    -- auth.uid() of the writer (no FK: a deleted scheduler account touches nothing)\n" +
  "  created_at  timestamptz not null default now()\n);";
const AP_INDEX = "create index if not exists app_call_days_profile_idx on public.app_call_days (profile_id, day);";
const AP_ENABLE = "alter table public.app_call_days enable row level security;";
const AP_PRIVS = "revoke all on table public.app_call_days from anon;\nrevoke all on table public.app_call_days from authenticated;\ngrant select on table public.app_call_days to authenticated;";
const AP_GRANTS = {
  silvis_is_app: "revoke all on function public.silvis_is_app() from public;\nrevoke all on function public.silvis_is_app() from anon;\ngrant execute on function public.silvis_is_app() to authenticated;\ngrant execute on function public.silvis_is_app() to service_role;",
  app_call_names: "revoke all on function public.app_call_names() from public;\nrevoke all on function public.app_call_names() from anon;\ngrant execute on function public.app_call_names() to authenticated;",
  save_app_days: "revoke all on function public.save_app_days(uuid, date[], date[], boolean) from public;\nrevoke all on function public.save_app_days(uuid, date[], date[], boolean) from anon;\ngrant execute on function public.save_app_days(uuid, date[], date[], boolean) to authenticated;",
};
const AP_IS_APP_FN = "create or replace function public.silvis_is_app() returns boolean\nlanguage sql stable security definer set search_path = public, pg_temp as $$\n  select coalesce((select p.is_app and p.role = 'viewer' and p.person_id is null from public.user_profiles p where p.id = auth.uid()), false);\n$$;";
const AP_NAMES_SIG = "create or replace function public.app_call_names() returns table (profile_id uuid, display_name text, is_app boolean)\nlanguage sql stable security definer set search_path = public, pg_temp as $$\n";
const AP_SAVE_SIG = "create or replace function public.save_app_days(p_profile uuid, p_add date[], p_clear date[], p_replace boolean default false) returns jsonb\nlanguage plpgsql security definer set search_path = public, pg_temp as $$\n";
// the shared contract with the app lane: every refusal's exact text, in check order, all before the first write
const AP_RAISES = [
  "raise exception 'APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day' using errcode = 'AP001';",
  "raise exception 'APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)' using errcode = 'AP001';",
  "raise exception 'APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler' using errcode = 'AP002';",
  "raise exception 'APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day' using errcode = 'AP002';",
  "raise exception 'APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved' using errcode = 'AP004';",
  "raise exception 'APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved' using errcode = 'AP004';",
  "raise exception 'APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved' using errcode = 'AP004';",
  "raise exception 'APP_DAY_BAD_DAY: % is both added and removed in one save - nothing was saved', bad using errcode = 'AP004';",
  "raise exception 'APP_DAY_NOT_APP: % is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)', coalesce(t_name, 'that account') using errcode = 'AP003';",
  "raise exception 'APP_DAY_PAST: % is before today (%) in Central time - a past day stays as it was', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'AP006';",
  "raise exception 'APP_DAY_STALE: % - reload the calendar (nothing was saved)', bad using errcode = 'AP007';",
  "raise exception 'APP_DAY_NOT_YOURS: % - only that APP or the scheduler can remove it (nothing was saved)', bad using errcode = 'AP002';",
  "raise exception 'APP_DAY_TAKEN: % - nothing was saved', bad using errcode = 'AP005';",
  "raise exception 'APP_DAY_TAKEN: a day changed hands during this save - reload and try again (nothing was saved)' using errcode = 'AP005';",
];
const AP_CODES = [["AP001", "APP_DAY_NOT_ALLOWED"], ["AP002", "APP_DAY_NOT_YOURS"], ["AP003", "APP_DAY_NOT_APP"], ["AP004", "APP_DAY_BAD_DAY"], ["AP005", "APP_DAY_TAKEN"], ["AP006", "APP_DAY_PAST"], ["AP007", "APP_DAY_STALE"]];
const AP_LOCK = "  perform pg_advisory_xact_lock(hashtext('app_call_days:save'));";
const AP_RETURN = "  return jsonb_build_object('ok', true, 'profile_id', who, 'added', cardinality(ins_days), 'removed', cardinality(del_days),\n                            'kept', cardinality(adds) - cardinality(ins_days), 'absent', cardinality(clears) - cardinality(del_days),\n                            'replaced', jsonb_array_length(replaced), 'source', v_src, 'audit', cardinality(ins_days) + cardinality(del_days) > 0);";
// the probe's 69 cases and what section 18 grades for each: eq = the exact AFTER string; err = ERR <code> ... <substring>; ap = ERR
// <code> <token>: <head><M/D><tail> (A9 / A10 carry the Central date of the run). These strings are the probe header's, verify-rls 18's,
// SCHEMA-REVIEW's and the faked run's below.
const AP_ALLOW = "ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day";
const AP_NOTAPP = " is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)";
const AP_PROBE_CASES = {
  P1: ["eq", "table=yes rls=yes pk=day fk=cascade policies=app_call_days_read/select/authenticated anon_sel=no auth_sel=yes auth_write=no"],
  P2: ["eq", "save_definer=yes names_definer=yes isapp_definer=yes paths=3 names_stable=yes save_volatile=yes save_anon=no save_auth=yes names_anon=no names_auth=yes isapp_anon=no isapp_auth=yes"],
  P3: ["eq", "is_app=boolean not_null=yes default=false check=user_profiles_app_viewer self_pins=2"],
  A1: ["eq", "ok added=3 removed=0 kept=0 source=app 12/2=one/app 12/3=one/app 12/11=one/app by=self"],
  A2: ["eq", "audit=1 actor=self name=probe app one sums=probe app one: on call 12/2, 12/3, 12/11"],
  A3: ["eq", "ok added=0 kept=2 audit=false audit_rows=1"],
  A4: ["eq", "ok removed=1 12/3=none sums=probe app one: on call 12/2, 12/3, 12/11 | probe app one: removed 12/3"],
  A5: ["eq", "ok removed=0 absent=1 audit=false"],
  A6: ["eq", "ERR AP004 APP_DAY_BAD_DAY: 12/4 is both added and removed in one save - nothing was saved"],
  A7: ["eq", "ERR AP004 APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved"],
  A8: ["eq", "ERR AP004 APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved"],
  A9: ["ap", "AP006", "APP_DAY_PAST", "5/4 is before today (", ") in Central time - a past day stays as it was"],
  A10: ["ap", "AP006", "APP_DAY_PAST", "5/4 is before today (", ") in Central time - a past day stays as it was"],
  A10s: ["eq", "12/5=none"],
  A11: ["eq", "ERR AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler"],
  A12: ["eq", "ERR AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day"],
  A13: ["err", "42501", "permission denied for table app_call_days"],
  A14: ["err", "42501", "permission denied for table app_call_days"],
  A15: ["eq", "rows=2"],
  A16: ["eq", "names=1 self=yes"],
  A17: ["eq", "ERR AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved"],
  A18: ["err", "42501", "row-level security policy for table \"user_profiles\""],
  A19: ["eq", "updated=1"],
  B1: ["eq", "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved"],
  B1s: ["eq", "12/2=one/app"],
  B2: ["eq", "ok added=2 source=app 12/7=two/app 12/8=two/app"],
  B3: ["eq", "ERR AP002 APP_DAY_NOT_YOURS: 12/2 is probe app one's day - only that APP or the scheduler can remove it (nothing was saved)"],
  B4: ["eq", "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one, 12/11 already has probe app one - nothing was saved"],
  B4s: ["eq", "12/9=none"],
  B5: ["eq", "names=2"],
  S1: ["eq", AP_ALLOW], S2: ["eq", AP_ALLOW], S3: ["eq", "rows=4"],
  S4: ["err", "42501", "permission denied for table app_call_days"],
  S5: ["eq", "names=2 one=probe app one two=probe app two"],
  C1: ["eq", AP_ALLOW], C2: ["eq", "rows=4"],
  V1: ["eq", AP_ALLOW], V2: ["eq", "rows=4"],
  V3: ["err", "42501", "row-level security policy for table \"user_profiles\""],
  V4: ["eq", "updated=1"],
  D1: ["eq", "ok added=1 source=scheduler 12/10=two/scheduler by=admin"],
  D2: ["eq", "actor=s1 name=probe admin sums=probe app two: on call 12/10"],
  D3: ["eq", "ok removed=1 12/10=none"],
  D4: ["eq", "ok added=1 5/4=one/scheduler"],
  D5: ["eq", "ok removed=1 5/4=none"],
  D6: ["eq", "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved"],
  D7: ["eq", "ok added=1 replaced=1 12/2=two/scheduler last=probe app two: on call 12/2 (was probe app one)"],
  D8: ["eq", "ERR AP007 APP_DAY_STALE: 12/2 is probe app two's day - reload the calendar (nothing was saved)"],
  D9: ["eq", "ERR AP003 APP_DAY_NOT_APP: probe viewer" + AP_NOTAPP],
  D10: ["eq", "ERR AP003 APP_DAY_NOT_APP: that account" + AP_NOTAPP],
  D11: ["eq", "ERR AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)"],
  D12: ["eq", "names=2 one=app two=app"],
  D13: ["eq", "updated=1 is_app=false"],
  F1: ["eq", AP_ALLOW], F2: ["eq", "12/11=one/app"],
  E1: ["eq", "names=2 one=former two=app"],
  E2: ["eq", "ok removed=1 12/11=none"],
  E3: ["eq", "ERR AP003 APP_DAY_NOT_APP: probe app one" + AP_NOTAPP],
  E4: ["err", "23514", "violates check constraint \"user_profiles_app_viewer\""],
  E5: ["err", "23514", "violates check constraint \"user_profiles_app_viewer\""],
  N1: ["err", "42501", "permission denied for table app_call_days"],
  N2: ["err", "42501", "permission denied for function app_call_names"],
  N3: ["err", "42501", "permission denied for function save_app_days"],
  N4: ["eq", AP_ALLOW], N5: ["eq", "names=0"],
  X1: ["eq", "before=3 after=0 audit_kept=yes"],
  I1: ["err", "42501", "row-level security policy for table \"user_profiles\""],
  I2: ["eq", "ok is_app=false"],
};
const AP_CASES = Object.keys(AP_PROBE_CASES);
// the full AFTER string of every case as the probe raises it (err: the PostgreSQL message; ap: <today M/D> = the run's Central date)
const AP_FULL = {
  A9: "ERR AP006 APP_DAY_PAST: 5/4 is before today (<today M/D>) in Central time - a past day stays as it was",
  A10: "ERR AP006 APP_DAY_PAST: 5/4 is before today (<today M/D>) in Central time - a past day stays as it was",
  A13: "ERR 42501 permission denied for table app_call_days", A14: "ERR 42501 permission denied for table app_call_days", S4: "ERR 42501 permission denied for table app_call_days",
  A18: "ERR 42501 new row violates row-level security policy for table \"user_profiles\"",
  V3: "ERR 42501 new row violates row-level security policy for table \"user_profiles\"", I1: "ERR 42501 new row violates row-level security policy for table \"user_profiles\"",
  E4: "ERR 23514 new row for relation \"user_profiles\" violates check constraint \"user_profiles_app_viewer\"", E5: "ERR 23514 new row for relation \"user_profiles\" violates check constraint \"user_profiles_app_viewer\"",
  N1: "ERR 42501 permission denied for table app_call_days", N2: "ERR 42501 permission denied for function app_call_names", N3: "ERR 42501 permission denied for function save_app_days",
};
const apFull = (k) => AP_PROBE_CASES[k][0] === "eq" ? AP_PROBE_CASES[k][1] : AP_FULL[k];

step("Prompt 29: the migration = the applied file (sha256 of the body; APPLIED 2026-10-02 19:19:27Z in ONE trailer line) - user_profiles.is_app + its check + the two pinned self policies, silvis_is_app, app_call_days (authenticated read, never anon), app_call_names, save_app_days; ends with the schema-cache reload");
const apBuf = fs.existsSync(AP_MIGRATION) ? fs.readFileSync(AP_MIGRATION) : null;
ok(apBuf, "missing file " + path.relative(ROOT, AP_MIGRATION));
const apMig = apBuf.toString("utf8");
ok(!/\r/.test(apMig), "the APP call days migration has CRLF line endings");
ok(/^[\x00-\x7f]*$/.test(apMig), "the APP call days migration is ASCII only");
let apBody = apMig;
{
  // the record step (10/2): the file that ran is the file that is kept - the body hashed, the apply noted after it in ONE line
  const at = apBuf.indexOf(APPDAYS_TRAILER);
  ok(at > 0, "the APP call days migration must carry its trailer line `" + APPDAYS_TRAILER.slice(1) + " ...` after the applied body (the record step)");
  const tail = at > 0 ? apBuf.slice(at + 1).toString("utf8") : "";
  // review 10/2: strict - one non-empty line and its LF, nothing after it (no trailing blank lines either)
  ok(/^[^\n]+\n$/.test(tail), "APP call days migration: exactly ONE trailer line after the applied body, ending the file (no blank lines after it)");
  ok(tail.includes("the body above this line is the applied file, sha256 " + APPDAYS_APPLIED_SHA256) && tail.includes("apply-app-call-days.sh") && tail.includes("AI_AGENT") && tail.includes("repo HEAD 5b9964e") && tail.includes("two earlier runs stopped at the APPLY prompt and applied nothing") && tail.includes("predate the record step, which made verify-rls section 18 strict and dropped the flag") && tail.includes("docs/SCHEMA-REVIEW.md \"2026-10-02 - APP call days\""), "the trailer names the applied sha256, the script, the agent mode, the HEAD it ran at, the two stopped runs, the as-ran header wording and the record");
  eq(crypto.createHash("sha256").update(at > 0 ? apBuf.slice(0, at + 1) : apBuf).digest("hex"), APPDAYS_APPLIED_SHA256,
    "APP call days migration body sha256 must equal the applied file's (strip nothing; annotate only in the trailer line);");
  if (at > 0) apBody = apBuf.slice(0, at + 1).toString("utf8");
}
ok(migFiles.includes(AP_FILE) && !PREPARED_NOT_MIRRORED.includes(AP_FILE), "sql/migrations/" + AP_FILE + " is a mirrored migration (not exempt)");
const apHdr = apMig.slice(0, apMig.indexOf("\n-- ============================================================================\n\n"));
const apHdrFlat = apHdr.replace(/\n-- ?/g, " ");
// pin kept deliberately 10/2 (the record step): the header is the text as it ran (the body is sha256-pinned above), so it still
// says REPORT-FIRST, NOT APPLIED and its order still names SILVIS_APP_DAYS_APPLIED=1; the APPLIED note is the trailer line.
ok(apHdr.length > 1000 && /^-- REPORT-FIRST, NOT APPLIED \(/m.test(apHdr), "the migration header (as it ran) must say REPORT-FIRST, NOT APPLIED");
ok(apHdrFlat.includes("\"I want the APPs to be able to add themselves to call days - it would be a feature available to APPs or Me ... This would also show up on the calendar\"") && apHdrFlat.includes("any day; ONE APP per day; everyone signed in sees it, not the ?public=1 page; no e-mails, the Activity log only"), "the header quotes Faraz (10/1 6:33 PM) and the four decisions");
ok(apHdr.includes("\n--   bash <run folder>/apply-app-call-days.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)\n--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-02-app-call-days.sql   (what it runs)\n"), "the header carries the two apply lines (the one command - its script kept outside the repo - and what it runs)");
ok(!/bash scripts\/apply-/.test(apHdr), "the migration header names no in-repo apply script");
ok(/Blast radius/.test(apHdr) && /Who it binds/.test(apHdr) && /The decision: a FLAG, not a role/.test(apHdr) && apHdrFlat.includes("ONE implicit transaction"), "the header states the decision (a flag, not a role), whom it binds, the blast radius and that the file runs as one transaction");
ok(apHdrFlat.includes("sql/probes/app-call-days-precheck.sql") && apHdrFlat.includes("table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0") && apHdrFlat.includes("PROBE_SETUP: app_call_days is absent") && apHdrFlat.includes("69 cases") && apHdrFlat.includes("SILVIS_APP_DAYS_APPLIED=1 bash scripts/verify-rls.sh") && apHdrFlat.includes("docs/SCHEMA-REVIEW.md \"2026-10-02 - APP call days\""), "the header gives the order: pre-check (its gate), probe BEFORE (PROBE_SETUP), the file, probe AFTER (69), strict verify-rls, the record step");
AP_CODES.forEach(([c, t]) => ok(apHdrFlat.includes(c + " " + t + ": "), "the header lists " + c + " " + t + " with its message"));
{
  // the full rollback, in order, with both followers policy texts written out verbatim (the policies depend on the column)
  const rbLines = ["drop function if exists public.save_app_days(uuid, date[], date[], boolean);", "drop function if exists public.app_call_names();", "drop table if exists public.app_call_days;",
    "drop policy if exists user_profiles_self_insert on public.user_profiles;", FOLLOW_POLICIES.user_profiles_self_insert, "drop policy if exists user_profiles_self_update on public.user_profiles;", FOLLOW_POLICIES.user_profiles_self_update,
    "alter table public.user_profiles drop constraint if exists user_profiles_app_viewer;", "alter table public.user_profiles drop column if exists is_app;", "drop function if exists public.silvis_is_app();", "notify pgrst, 'reload schema';"];
  const rbText = rbLines.join("\n").split("\n").map((l) => "--   " + l).join("\n");
  ok(apHdr.includes("\n" + rbText + "\n"), "the header's rollback must read exactly (both followers policy texts in full, the policies before the column):\n" + rbText);
  ok(apHdrFlat.includes("select * from public.app_call_days order by day;"), "the rollback says to export the APP days first");
}
ok(!/^-- supersedes:/m.test(apMig) && !/^-- PREPARED FOLLOW-UP/m.test(apMig), "the APP call days migration has no supersedes line (no function is redefined) and is not a NOT-MIRRORED follow-up");
eq((apMig.match(/create or replace function/g) || []).length, 3, "the migration creates exactly three functions (silvis_is_app, app_call_names, save_app_days);");
const apCode = apMig.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
eq((apCode.match(/^create table /gm) || []).length, 1, "the migration creates exactly one table;");
eq((apCode.match(/^create policy [a-z_]+ on public\.user_profiles /gm) || []).length, 2, "two policies on user_profiles (the two self policies);");
eq((apCode.match(/^create policy [a-z_]+ on public\.app_call_days /gm) || []).length, 1, "one policy on app_call_days (app_call_days_read);");
eq((apCode.match(/^create policy /gm) || []).length, 3, "three policies in all;");
ok(!/drop function|drop table|create trigger|drop trigger|user_profiles_admin|user_profiles_read|audit_insert|audit_read|notif_insert|notif_read|read_all/.test(apCode), "the migration drops nothing and touches no trigger, user_profiles_admin / _read, audit_* or notif_* policy, nor the anon read_all loop");
// pin moved deliberately 10/2 (the record step): the applied BODY ends with the reload (the trailer line follows it)
ok(apBody.endsWith("\nnotify pgrst, 'reload schema';\n"), "the migration's applied body ends with `notify pgrst, 'reload schema';` (PostgREST must learn the new table and functions before the client push)");
const apStmts = apTopStatements(apMig);
ok(!apStmts.some((st) => /^(insert|update|delete)\b/i.test(st)), "the migration writes no row (no insert / update / delete outside function bodies)");
eq(apStmts.map((st) => st.split("\n")[0].replace(/ is '.*$/, " is ...")), [
  "alter table public.user_profiles add column if not exists is_app boolean not null default false;",
  "alter table public.user_profiles drop constraint if exists user_profiles_app_viewer;",
  "alter table public.user_profiles add constraint user_profiles_app_viewer",
  "create or replace function public.silvis_is_app() returns boolean",
  "revoke all on function public.silvis_is_app() from public;",
  "revoke all on function public.silvis_is_app() from anon;",
  "grant execute on function public.silvis_is_app() to authenticated;",
  "grant execute on function public.silvis_is_app() to service_role;",
  "comment on function public.silvis_is_app() is ...",
  "drop policy if exists user_profiles_self_insert on public.user_profiles;",
  "create policy user_profiles_self_insert on public.user_profiles for insert to authenticated",
  "drop policy if exists user_profiles_self_update on public.user_profiles;",
  "create policy user_profiles_self_update on public.user_profiles for update to authenticated",
  "create table if not exists public.app_call_days (",
  "create index if not exists app_call_days_profile_idx on public.app_call_days (profile_id, day);",
  "alter table public.app_call_days enable row level security;",
  "revoke all on table public.app_call_days from anon;",
  "revoke all on table public.app_call_days from authenticated;",
  "grant select on table public.app_call_days to authenticated;",
  "drop policy if exists app_call_days_read on public.app_call_days;",
  "create policy app_call_days_read on public.app_call_days for select to authenticated using (true);",
  "comment on table public.app_call_days is ...",
  "create or replace function public.app_call_names() returns table (profile_id uuid, display_name text, is_app boolean)",
  "revoke all on function public.app_call_names() from public;",
  "revoke all on function public.app_call_names() from anon;",
  "grant execute on function public.app_call_names() to authenticated;",
  "comment on function public.app_call_names() is ...",
  "create or replace function public.save_app_days(p_profile uuid, p_add date[], p_clear date[], p_replace boolean default false) returns jsonb",
  "revoke all on function public.save_app_days(uuid, date[], date[], boolean) from public;",
  "revoke all on function public.save_app_days(uuid, date[], date[], boolean) from anon;",
  "grant execute on function public.save_app_days(uuid, date[], date[], boolean) to authenticated;",
  "comment on function public.save_app_days(uuid, date[], date[], boolean) is ...",
  "notify pgrst, 'reload schema';",
], "the migration is exactly: the column + check, silvis_is_app + grants + comment, the two self policies, the table + index + RLS + privileges + policy + comment, app_call_names + grants + comment, save_app_days + grants + comment, the reload (in this order);");
function checkAppDays(n, s) {
  AP_COLUMN_LINES.forEach((l) => ok(s.indexOf(l) >= 0, n + ": missing the is_app line:\n" + l));
  ok(s.indexOf(AP_SELF_INSERT) >= 0, n + ": user_profiles_self_insert must read exactly:\n" + AP_SELF_INSERT);
  ok(s.indexOf(AP_SELF_UPDATE) >= 0, n + ": user_profiles_self_update must read exactly:\n" + AP_SELF_UPDATE);
  ok(s.indexOf(AP_TABLE) >= 0, n + ": the app_call_days table must read exactly:\n" + AP_TABLE);
  ok(s.indexOf(AP_INDEX) >= 0 && s.indexOf(AP_PRIVS) >= 0 && s.indexOf(AP_READ_POLICY) >= 0 && s.indexOf("drop policy if exists app_call_days_read on public.app_call_days;\n" + AP_READ_POLICY) >= 0, n + ": the index, the three privilege lines (anon and authenticated revoked, SELECT granted back) and app_call_days_read (drop if exists first)");
  ok(s.indexOf(AP_IS_APP_FN) >= 0, n + ": silvis_is_app() must read exactly:\n" + AP_IS_APP_FN);
  Object.keys(AP_GRANTS).forEach((f) => ok(s.indexOf(AP_GRANTS[f]) > s.indexOf("create or replace function public." + f + "("), n + ": " + f + "() grants must read exactly (after the function):\n" + AP_GRANTS[f]));
  ["silvis_is_app()", "app_call_names()", "save_app_days(uuid, date[], date[], boolean)"].forEach((f) => ok(new RegExp("^comment on function public\\." + apEsc(f) + " is 'Prompt 29[^\\n]*';$", "m").test(s), n + ": " + f + " carries a Prompt 29 comment"));
  ok(/^comment on table public\.app_call_days is 'Prompt 29[^\n]*never anon[^\n]*save_app_days\(\)[^\n]*';$/m.test(s), n + ": the table comment says never anon and names the write path");
  ok(/AP001 APP_DAY_NOT_ALLOWED, AP002 APP_DAY_NOT_YOURS, AP003 APP_DAY_NOT_APP, AP004 APP_DAY_BAD_DAY, AP005 APP_DAY_TAKEN, AP006 APP_DAY_PAST \(not the scheduler\), AP007 APP_DAY_STALE/.test(s), n + ": save_app_days' comment names the seven codes");
  const names = sqlFunctionText(s, "app_call_names");
  ok(names && names.startsWith(AP_NAMES_SIG) && /\n\$\$;$/.test(names), n + ": app_call_names() must read `" + AP_NAMES_SIG.trim() + "` and end at `$$;`");
  if (names) {
    ok(names.includes("   where auth.uid() is not null\n") && names.includes("(exists (select 1 from public.app_call_days a where a.profile_id = p.id)\n          or (p.is_app and p.role = 'viewer' and p.person_id is null and (p.id = auth.uid() or public.silvis_is_sched())))"), n + ": app_call_names returns the days' holders to any signed-in caller, the caller's own APP profile, every APP profile to the scheduler only - nothing without a signed-in user");
    ok(!/email|\brole\b,|person_id,/.test(names.split("\n").filter((l) => /select p\.id/.test(l)).join("")) && names.includes("  select p.id, nullif(btrim(p.display_name), ''), (p.is_app and p.role = 'viewer' and p.person_id is null)\n"), n + ": app_call_names selects the id, the trimmed display name and the APP flag only - never an email or a role");
  }
  const fn = functionText(s, "save_app_days");
  ok(fn && fn.startsWith(AP_SAVE_SIG), n + ": save_app_days must read `" + AP_SAVE_SIG.trim() + "` (security definer, search_path public, pg_temp; VOLATILE - never stable)");
  if (!fn) return;
  ok(!/\b(stable|immutable)\b/.test(fn.slice(0, fn.indexOf("$$"))), n + ": save_app_days is volatile (each statement sees the rows committed before the lock was granted)");
  const firstWrite = fn.indexOf("delete from public.app_call_days");
  ok(firstWrite > 0 && firstWrite < fn.indexOf("insert into public.app_call_days"), n + ": the first write is a delete (p_replace), before the insert");
  let last = -1;
  AP_RAISES.forEach((r, i) => {
    const at = fn.indexOf(r);
    ok(at > last, n + ": the refusal is missing or out of order (AP001 x2, AP002 x2, AP004 x4, AP003, AP006, AP007, AP002, AP005):\n" + r);
    if (i < AP_RAISES.length - 1) ok(at < firstWrite, n + ": every refusal comes BEFORE the first write (fail closed):\n" + r);
    if (at > last) last = at;
  });
  eq((fn.match(/using errcode = 'AP0/g) || []).length, AP_RAISES.length, n + ": exactly the fourteen AP raises;");
  ok(fn.includes("  if me is null or (not sched and not c_app) then\n    raise exception 'APP_DAY_NOT_ALLOWED: only an APP"), n + ": AP001 fires for no signed-in user and for a caller who is neither an APP nor the scheduler");
  ok(fn.includes("  if who is null and c_app then who := me; end if;") && fn.includes("  if not sched and who <> me then\n    raise exception 'APP_DAY_NOT_YOURS: an APP adds") && fn.includes("  if repl and not sched then\n    raise exception 'APP_DAY_NOT_YOURS: only the scheduler can replace"), n + ": an APP's null profile is itself; another profile or p_replace from an APP is AP002");
  ok(fn.includes("  if coalesce(cardinality(p_add), 0) + coalesce(cardinality(p_clear), 0) > 400 then"), n + ": the 400-day cap counts both raw lists");
  ok(fn.includes("  if exists (select 1 from unnest(coalesce(p_add, '{}'::date[]) || coalesce(p_clear, '{}'::date[])) d where not isfinite(d)) then\n    raise exception 'APP_DAY_BAD_DAY: a day in the list is not a calendar day"), n + ": AP004 refuses infinity / -infinity in either raw list (review 10/2: to_char gives NULL, so AP006 and every message would drop them)");
  ok(fn.includes("  if cardinality(adds) > 0 and not coalesce(t_app, false) then\n    raise exception 'APP_DAY_NOT_APP"), n + ": AP003 binds adds only (a former APP's days can still be cleared) - for the scheduler too");
  const lock = fn.indexOf(AP_LOCK);
  ok(lock > fn.indexOf(AP_RAISES[8]) && lock < fn.indexOf(AP_RAISES[9]) && lock < fn.indexOf("from public.app_call_days"), n + ": the advisory lock app_call_days:save comes after AP003, before AP006 and before the first read of app_call_days");
  eq((fn.match(/pg_advisory_xact_lock/g) || []).length, 1, n + ": one advisory lock;");
  const gate = fn.indexOf("  if not sched then\n"), gateEnd = fn.indexOf("\n  end if;\n", fn.indexOf("\n    end if;\n", gate));
  eq((fn.match(/  if not sched then\n/g) || []).length, 1, n + ": one scheduler exemption;");
  eq(fn.slice(gate, gateEnd).match(/errcode = 'AP0\d\d'/g), ["errcode = 'AP006'"], n + ": `not sched` exempts the scheduler from AP006 (the past day) only;");
  ok(fn.includes("  today_c   date := (now() at time zone 'America/Chicago')::date;") && fn.includes("from unnest(adds || clears) d where d < today_c;"), n + ": AP006 reads the Central date, for adds and removals");
  ok(fn.includes("   where a.day = any(clears) and a.profile_id <> who;\n  if bad is not null then\n    if sched then\n      raise exception 'APP_DAY_STALE"), n + ": a removal of a day another profile holds: AP007 for the scheduler (a stale picture), AP002 for an APP");
  ok(fn.includes("  if not repl then\n") && fn.includes("     where a.day = any(adds) and a.profile_id <> who;\n    if bad is not null then\n      raise exception 'APP_DAY_TAKEN: % - nothing was saved'"), n + ": an add on another profile's day is AP005 unless p_replace (the scheduler's change)");
  ok(fn.includes("  v_src := case when who = me then 'app' else 'scheduler' end;") && fn.includes("    select d, who, v_src, me from unnest(adds) d\n    on conflict (day) do nothing"), n + ": source app / scheduler from the caller, created_by = auth.uid(), on conflict (day) do nothing (kept)");
  ok(fn.includes("    insert into public.audit_log (actor_id, actor_name, action, detail)\n    values (coalesce(public.silvis_person_id(), me::text),") && fn.includes("            'appdays.save',\n") && fn.includes("jsonb_build_object('summary', v_sum, 'profile_id', who, 'added', to_jsonb(ins_days), 'removed', to_jsonb(del_days), 'replaced', replaced, 'source', v_src)"), n + ": the function writes the appdays.save audit row (actor = roster id, else auth uid; detail summary / profile_id / added / removed / replaced / source)");
  ok(fn.includes("  if cardinality(ins_days) + cardinality(del_days) > 0 then\n    v_sum := coalesce(t_name, 'APP') || ': ' || concat_ws('; ',") && fn.includes("' (was ' ||") && fn.includes("'removed ' ||"), n + ": one audit row only when something changed; summary '<name>: on call <days> (was <name>); removed <days>'");
  ok(!/insert into public\.notifications|notifications/.test(fn), n + ": save_app_days writes no notification row (the Activity log only)");
  ok(fn.includes(AP_RETURN), n + ": the return shape {ok, profile_id, added, removed, kept, absent, replaced, source, audit} (binding for the client)");
  eq((fn.match(/(insert into|update|delete from) public\.[a-z_]+/g) || []).map((x) => x.replace(/\s+/g, " ")).sort(), ["delete from public.app_call_days", "delete from public.app_call_days", "insert into public.app_call_days", "insert into public.audit_log"], n + ": save_app_days writes app_call_days (two deletes, one insert) and audit_log only;");
}
checkAppDays("APP call days migration", apMig);

step("Prompt 29: schema.sql mirrors the migration (every statement byte for byte, the three functions, revision v after s), the new column in the from-scratch table, app_call_days not anon-readable, the self policies replaced in place");
checkAppDays("schema.sql", schema);
["silvis_is_app", "app_call_names"].forEach((name) => ok(sqlFunctionText(schema, name) === sqlFunctionText(apMig, name), name + "(): schema.sql differs from sql/migrations/" + AP_FILE));
ok(functionText(schema, "save_app_days") === functionText(apMig, "save_app_days"), "save_app_days(): schema.sql differs from sql/migrations/" + AP_FILE);
apStmts.filter((st) => !/^notify pgrst/.test(st) && st !== AP_ENABLE).forEach((st) => ok(schemaCode.indexOf(st) >= 0, "schema.sql does not mirror this APP call days statement byte for byte:\n" + st.slice(0, 300)));
ok(/^alter table public\.app_call_days +enable row level security;$/m.test(schema), "schema.sql enables RLS on app_call_days (in the RLS list)");
{
  const at = (t) => schema.indexOf(t);
  const rls = at("-- Row Level Security");
  ok(at(AP_COLUMN_LINES[0]) > at("alter table public.user_profiles add constraint user_profiles_follows_shape") && at(AP_COLUMN_LINES[2]) < at("create or replace function public.handle_new_auth_user()"), "the is_app lines sit right after the follows lines, before handle_new_auth_user()");
  ok(/\n  follows       jsonb not null default '\[\]'::jsonb,   -- [^\n]*\n  is_app        boolean not null default false,/.test(sliceBetween(schema, "create table if not exists public.user_profiles (", "\n);") || ""), "schema.sql's user_profiles create table carries `is_app boolean not null default false` right after follows (a from-scratch schema)");
  ok(at(AP_IS_APP_FN) > at(COORD_HELPER) && at(AP_IS_APP_FN) < at("create table if not exists public.call_schedule_data ("), "silvis_is_app() sits after silvis_is_coord(), before call_schedule_data");
  ok(at(AP_TABLE) > at("grant select, insert, update, delete on table public.call_pay_logs to authenticated;") && at("create or replace function public.app_call_names(") > at(AP_TABLE) && at("create or replace function public.save_app_days(") > at("create or replace function public.app_call_names(") && at(AP_GRANTS.save_app_days) < rls, "the table block (table, index, privileges, comment), app_call_names and save_app_days sit after the call pay grants, before Row Level Security");
  ok(at(AP_ENABLE) < 0 && at("alter table public.app_call_days           enable row level security;") > rls, "the enable line sits in the RLS list (not in the table block)");
  ok(at(AP_READ_POLICY) > at("create policy call_pay_logs_delete on public.call_pay_logs") && at(AP_READ_POLICY) < at("-- Seed rows"), "app_call_days_read sits after the call pay policies");
  const upRead = at("create policy user_profiles_read on public.user_profiles"), upAdmin = at("create policy user_profiles_admin on public.user_profiles");
  ok(upRead < at(AP_SELF_INSERT) && at(AP_SELF_INSERT) < at(AP_SELF_UPDATE) && at(AP_SELF_UPDATE) < upAdmin, "the two self policies are replaced in place (between user_profiles_read and user_profiles_admin)");
  ok(AP_SELF_INSERT === FOLLOW_POLICIES.user_profiles_self_insert.replace("follows = '[]'::jsonb);", "follows = '[]'::jsonb and not is_app);") && AP_SELF_UPDATE === FOLLOW_POLICIES.user_profiles_self_update.replace("p.id = auth.uid()));", "p.id = auth.uid())\n    and is_app is not distinct from (select is_app from public.user_profiles p where p.id = auth.uid())\n    and (not is_app or display_name is not distinct from (select display_name from public.user_profiles p where p.id = auth.uid())));"), "the two self policies are the followers texts plus the is_app clause (and, in self_update, the APP display_name clause), byte for byte otherwise");
  ok(AP_SELF_UPDATE.endsWith("\n    and (not is_app or display_name is not distinct from (select display_name from public.user_profiles p where p.id = auth.uid())));") && !/display_name/.test(AP_SELF_INSERT), "review 10/2: an APP may not rename itself (its name reaches every signed-in user through app_call_names); every other account still may - the clause binds is_app rows only");
  const loop = schema.slice(schema.indexOf("-- Anon-readable tables"), schema.indexOf("end $$;", schema.indexOf("-- Anon-readable tables")));
  ok(loop.length > 0 && /foreach t in array array\['call_schedule_data','schedule_days','availability','east_feed','east_forecast','client_versions'\] loop/.test(loop) && !/app_call_days/.test(loop), "app_call_days is NOT in the anon read_all loop");
  ok(!/create policy [a-z_]+ on public\.app_call_days for [a-z]+ (using|with)/.test(schema) && (schema.match(/create policy [a-z_]+ on public\.app_call_days /g) || []).length === 1, "app_call_days carries exactly one policy, and it names `to authenticated` (never a role-less / anon policy)");
  // pins moved deliberately 10/2 (the record step): revision v and the APP block comments read applied 2026-10-02 19:19:27Z
  const vAt = header.search(/^-- Revision 2026-10-02 v \(APP call days, sql\/migrations\/2026-10-02-app-call-days\.sql, applied 2026-10-02 19:19:27Z after the probe\): /m);
  const sAt = header.search(/^-- Revision 2026-09-30 s /m);
  ok(sAt > 0 && vAt > sAt, "schema.sql's header must record revision 2026-10-02 v (APP call days; 'applied 2026-10-02 19:19:27Z after the probe' since the record step, 'report-first, NOT yet applied' before it) after revision s (index order - Prompt 28's t and the pair claim's u sit between them after their merges)");
  ok(!/app-call-days\.sql[^\n]*NOT yet applied/.test(schema) && !/Prompt 29[^\n]*NOT yet applied/.test(schema) && !/app_call_days \(Prompt 29[^\n]*NOT yet applied/.test(schema), "schema.sql no longer calls the APP call days migration 'NOT yet applied' anywhere (the record step)");
  ok(schema.includes("\n-- ---------- APP call days (Prompt 29, revision v; sql/migrations/2026-10-02-app-call-days.sql - report-first; applied 2026-10-02 19:19:27Z)\n") && schema.includes("\n-- Prompt 29 (APP call days, sql/migrations/2026-10-02-app-call-days.sql - report-first; applied 2026-10-02 19:19:27Z): the APP flag on an EXISTING\n") && (schema.match(/-- (Prompt 29 \(APP call days|app_call_days \(Prompt 29), revision v - report-first; applied 2026-10-02 19:19:27Z\)/g) || []).length === 3, "schema.sql's APP block comments (the table block, the column, silvis_is_app, the self policies, the read policy) read 'report-first; applied 2026-10-02 19:19:27Z'");
  const revV = header.slice(vAt).split("\n-- Revision ")[0].split("\n-- Two same-day migrations")[0].replace(/\n-- ?/g, " ");
  ok(/a FLAG, not a role/.test(revV) && /user_profiles_app_viewer/.test(revV) && /app_call_days \(day date PRIMARY KEY - one APP per day/.test(revV) && /AP001-AP007/.test(revV) && /never anon/.test(revV) && /Letter t is Prompt 28's no-primary days \(applied, merged ahead of this client\); u is taken by prepared, unmerged work/.test(revV) && !/Letters t and u are taken/.test(revV), "revision v names the flag decision, the check, the table, the codes, never anon and the letters t (merged - moved deliberately 10/2 at the merge with main) / u (taken)");
}

step("Prompt 29: the probe - self-rolling-back, PROBE_SETUP (absent) first, the is_app check second, the collision guard third, six throwaway users, 69 cases each stating its AFTER string in the header, readbacks filtered to the probe's own users");
const apProbe = read(AP_PROBE);
ok(!/\r/.test(apProbe) && /^[\x00-\x7f]*$/.test(apProbe), "the APP days probe is LF and ASCII");
ok(!/^\s*(begin|commit|rollback)\s*;/im.test(apProbe), "the APP days probe must not contain explicit BEGIN/COMMIT/ROLLBACK");
ok(apProbe.includes("create temp table probe_results (k text, v text);\ngrant insert, select on probe_results to authenticated;\ngrant insert, select on probe_results to anon;"), "the probe collects into probe_results, granted to authenticated and anon (N1-N3 run as anon)");
{
  const lastDo = apProbe.lastIndexOf("do $$");
  ok(lastDo > 0 && /raise exception 'PROBE_RESULTS %;END'/.test(apProbe.slice(lastDo)), "the probe's last DO block raises 'PROBE_RESULTS %;END'");
  const absentAt = apProbe.indexOf("raise exception 'PROBE_SETUP: app_call_days is absent - sql/migrations/2026-10-02-app-call-days.sql is not applied';");
  const partAt = apProbe.indexOf("raise exception 'PROBE_SETUP: user_profiles.is_app is absent - sql/migrations/2026-10-02-app-call-days.sql is partly applied';");
  const guardAt = apProbe.indexOf("raise exception 'PROBE_SETUP: live rows already sit in the probe window (app_call_days in 2030-12 or on 2020-05-04) - the probe fixtures would collide';");
  const usersAt = apProbe.indexOf("insert into auth.users");
  ok(absentAt > 0 && partAt > absentAt && guardAt > partAt && usersAt > guardAt, "the setup raises PROBE_SETUP absent first, then the partly-applied check, then the collision guard (it reads the table), before any fixture (" + [absentAt, partAt, guardAt, usersAt] + ")");
  const code = apProbe.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  ok(code.includes("if to_regclass('public.app_call_days') is null then") && code.includes("if exists (select 1 from public.app_call_days d where d.day between '2030-12-01' and '2030-12-31' or d.day = '2020-05-04') then"), "the absent check is to_regclass; the guard looks at app_call_days in 2030-12 and on 2020-05-04");
  ok(code.includes("'probe-appdays-' || u || '@example.test'") && !/'probe-appdays-[^'|]*@/.test(code), "the throwaway users are probe-appdays-<uuid>@example.test, the email built with || (no literal email in the file)");
  ok(code.includes("update public.user_profiles set display_name = 'probe app one', is_app = true where id = u1;") && code.includes("update public.user_profiles set display_name = 'probe app two', is_app = true where id = u2;") && code.includes("update public.user_profiles set person_id = 's3', role = 'surgeon', display_name = 'probe surgeon' where id = us;") && code.includes("update public.user_profiles set role = 'coordinator', display_name = 'probe office' where id = uc;") && code.includes("update public.user_profiles set display_name = 'probe viewer' where id = uv;") && code.includes("update public.user_profiles set person_id = 's1', role = 'admin', display_name = 'probe admin' where id = ua;"), "the six users: U1 / U2 viewers marked APP, US surgeon s3, UC coordinator, UV a plain viewer, UA admin s1 - display names 'probe ...' only");
  ok((code.match(/insert into public\.app_call_days/g) || []).length === 2 && code.indexOf("insert into public.app_call_days") > code.indexOf("values ('A12', "), "no app_call_days fixture row: the only direct inserts are the two refused cases (A13, S4)");
  const days = Array.from(code.matchAll(/'(20[0-9]{2}-[0-9]{2}-[0-9]{2})'/g)).map((m) => m[1]).concat(Array.from(code.matchAll(/[{,](20[0-9]{2}-[0-9]{2}-[0-9]{2})/g)).map((m) => m[1]));
  ok(days.length > 30 && days.every((d) => d.slice(0, 7) === "2030-12" || d === "2020-05-04" || d === "2031-01-01" || d === "2032-02-05"), "every day the probe touches is in 2030-12, the past day 2020-05-04 or the refused 401-day range 2031-01-01 .. 2032-02-05: " + days.filter((d) => !(d.slice(0, 7) === "2030-12" || ["2020-05-04", "2031-01-01", "2032-02-05"].includes(d))).join(", "));
  ok(!/(update|insert into|delete from)\s+public\.(call_schedule_data|schedule_days|time_off|availability|call_offers|notifications)\b/.test(code), "the probe never writes the blob, the schedule, vacations, availability, offers or the feed");
  AP_CASES.forEach((k) => ok(code.includes("values ('" + k + "', "), "the probe lacks case " + k));
  // readbacks stable against live data: names / sums / last / audit counts filtered to the probe's own users
  ok(code.includes("     where x.profile_id::text in (select c.v from probe_ctx c)\n") && (code.match(/l\.detail ->> 'profile_id' in \(select c\.v from probe_ctx c\)/g) || []).length === 3 && code.includes("order by l.detail ->> 'summary' collate \"C\""), "names= / audit= / sums= / last= read only the probe's own users (later runs with real APPs read the same); sums in text order (collate C)");
  ok(code.includes("select 'rows=' || count(*) from public.app_call_days a where a.day between '2030-12-01' and '2030-12-31';"), "rows= counts the window only (the guard keeps live rows out of it)");
  ok((code.match(/execute 'reset role';\n    insert into probe_results values \('(A2|A3|A4|D2|D7)'/g) || []).length === 5, "the audit readbacks (A2, A3, A4, D2, D7) reset the role first - read as postgres");
  ok(code.includes("execute 'set local role anon';\n  perform set_config('request.jwt.claims', '', true);") && code.includes("  execute 'reset role';\n  perform set_config('request.jwt.claims', '{}', true);\n  begin\n    r := public.save_app_days(u2::uuid, '{2030-12-13}', null);\n    insert into probe_results values ('N4', "), "N1-N3 run as anon, N4-N5 as postgres with no signed-in user");
  ok(code.includes("delete from auth.users where id = u2::uuid;") && code.includes("  delete from public.user_profiles where id = u::uuid;\n  execute 'set local role authenticated';"), "X1 deletes U2's auth user (its days cascade); I1 / I2 start from UV's deleted profile row (the self-insert door), the delete outside the cases' subtransactions");
}
const apProbeHdr = apProbe.slice(0, apProbe.indexOf("create temp table probe_results"));
// pin moved deliberately 10/2 (the record step, like the no-primary probe's header): APPLIED 2026-10-02 19:19:27Z + the as-run note
ok(/REPORT-FIRST; APPLIED 2026-10-02 19:19:27Z\)/.test(apProbeHdr) && !/NOT APPLIED/.test(apProbeHdr) && /-- As run: the migration was applied 2026-10-02 19:19:27Z/.test(apProbeHdr) && /all 69 cases below as listed after it \(<today M\/D> = 10\/2\)/.test(apProbeHdr) && /section 18 FAILs a PROBE_SETUP or an anon 404/.test(apProbeHdr) && /WITHOUT PERSISTING ANYTHING/.test(apProbeHdr) && /\n-- 69 cases\.\n/.test(apProbeHdr), "the probe header: report-first, APPLIED 2026-10-02 19:19:27Z with the as-run note (section 18 FAILs a PROBE_SETUP since the record step), nothing persisted, 69 cases");
const AP_AFTER = {};
apProbeHdr.split("\n").forEach((l) => { const m = l.match(/^--   ([A-Z][0-9]+s?)\s+.* -> (.*)$/); if (m) AP_AFTER[m[1]] = m[2]; });
eq(Object.keys(AP_AFTER).sort(), AP_CASES.slice().sort(), "the probe header lists every case once with its AFTER string (`--   <case> <what> -> <AFTER>`);");
AP_CASES.forEach((k) => ok(AP_AFTER[k] === apFull(k), "the probe header's AFTER for " + k + " (" + AP_AFTER[k] + ") must be " + apFull(k)));
eq(AP_CASES.length, 69, "69 probe cases;");
// the record step (10/2): the 69 probe AFTER lines of the live run as Faraz's log printed them (apply-app-call-days-20261002T191907Z.log,
// step 6 = verify-rls section 18 = the paste-back block): the header strings with <today M/D> = 10/2, sorted by case, a double quote
// escaped by the CLI's JSON (A18, V3, I1, E4, E5). SCHEMA-REVIEW's observed block and the faked section-18 run use them.
const AP_LIVE_LINES = AP_CASES.slice().sort().map((k) => k + "=" + (AP_AFTER[k] || "?").replace(/<today M\/D>/g, "10/2").replace(/"/g, '\\"'));

step("Prompt 29: the pre-check - ONE read-only SELECT (the objects gate, profiles per role - counts only, the appdays.save audit rows, the realtime publication facts)");
const apPre = read(AP_PRECHECK);
ok(!/\r/.test(apPre) && /^[\x00-\x7f]*$/.test(apPre), "the pre-check is LF and ASCII");
{
  const hdr = apPre.slice(0, apPre.indexOf("with objects as ("));
  ok(/READ-ONLY: one SELECT, nothing is written, locked or changed/.test(hdr) && /Run it BEFORE the apply/.test(hdr), "the pre-check's header says READ-ONLY and when to run it");
  // the record step (10/2): the header reads APPLIED with its as-run note (kept as reviewed until the apply, while the apply script
  // pinned the file's sha256)
  ok(/REPORT-FIRST; APPLIED 2026-10-02 19:19:27Z\)/.test(hdr) && !/NOT APPLIED/.test(hdr) && /-- As run \(2026-10-02\): before the apply the gate read table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0 and right\n-- after it table=yes is_app=yes is_app_fn=yes save_fn=yes names_fn=yes pins=2, rows 2-4 the same both times/.test(hdr), "the pre-check's header: APPLIED 2026-10-02 19:19:27Z, the as-run gate before / after");
  ok(hdr.includes("table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0") && hdr.includes("table=yes is_app=yes is_app_fn=yes save_fn=yes names_fn=yes pins=2"), "the header states the gate before and after the apply");
  const code = apPre.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim();
  ok(code.startsWith("with objects as (") && code.endsWith("order by ord, role;") && (code.match(/;/g) || []).length === 1, "the pre-check is ONE statement (a select with CTEs) ordered by ord, role");
  ok(!/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|lock|perform|set role|set_config)\b/i.test(code), "the pre-check writes, locks and changes nothing");
  ok(code.includes("'table=' || case when to_regclass('public.app_call_days') is null then 'no' else 'yes' end") && code.includes("a.attname = 'is_app'") && code.includes("to_regprocedure('public.silvis_is_app()')") && code.includes("to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)')") && code.includes("to_regprocedure('public.app_call_names()')") && code.includes("coalesce(p.with_check, '') like '%is_app%'"), "row 1 (the gate): the table, the column, the three functions, the two pinned policies - through catalog lookups only");
  ok(!/\bu\.is_app\b|public\.app_call_days\b(?![')])/.test(code), "the pre-check never reads the new column or table directly (it runs before the apply)");
  ["'objects'::text", "'profiles'::text", "'audit'::text", "'realtime'::text"].forEach((t) => ok(code.includes(t), "the pre-check has the section " + t));
  const NAMED_COUNT = "' named=' || count(*) filter (where nullif(btrim(coalesce(u.display_name, '')), '') is not null)";
  ok(code.includes(NAMED_COUNT) && !/\bdisplay_name\b/.test(code.split(NAMED_COUNT).join("")) && !/email/.test(code), "profiles: counts only - the display name is COUNTED in one place and never printed, no email is read");
  ok(code.includes("b.pubname = 'supabase_realtime' and b.puballtables") && code.includes("t.tablename = 'app_call_days'"), "row 4: the realtime publication facts (all tables? app_call_days published?)");
}

step("Prompt 29: verify-rls.sh section 18 - anon REST (18a the table, 18b app_call_names, 18c save_app_days, 18d a direct write), 18e as a surgeon, the graded probe, leftovers; strict since the record step (PROBE_SETUP and a 404 FAIL, no flag); graded against a faked CLI and curl");
ok(/^echo "== 18\. APP call days \(2026-10-02, Prompt 29\): app_call_days \+ save_app_days \/ app_call_names \+ user_profiles\.is_app - anon refused, rolled-back probe =="$/m.test(vr), "verify-rls.sh has no section 18 (APP call days)");
const s18 = vr.slice(vr.indexOf('echo "== 18. '), vrSectionEnd('echo "== 18. '));
ok(s18.length > 0 && vr.indexOf('echo "== 18. ') > vr.indexOf('echo "== 15. '), "verify-rls.sh section 18 could not be sliced out (after section 15, up to the next section header or the RESULT line)");
// moved deliberately 10/2 (the merge with main): section 16 sits right above section 18 in this script now
ok(/^# Section 18 \(16 = Prompt 28's no-primary days, the section above; 17 = the weekend pair claim, taken on its own branch\)\.$/m.test(s18) && vr.indexOf('echo "== 16. ') > 0 && vr.indexOf('echo "== 16. ') < vr.indexOf('echo "== 18. '), "section 18's comment says why it is 18 (16 is the section above it, 17 is on its own branch)");
const s18code = s18.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
// pins moved deliberately 10/2 (the record step): section 18 reads no flag - SILVIS_APP_DAYS_APPLIED / APSTRICT18 are gone from
// the whole script (like SILVIS_VACATION_GUARD_APPLIED and SILVIS_NO_PRIMARY_APPLIED after their record steps)
ok(!/SILVIS_APP_DAYS_APPLIED|APSTRICT18/.test(vr), "verify-rls.sh no longer reads or documents SILVIS_APP_DAYS_APPLIED (the record step dropped it; strict is the default)");
eq((s18code.match(/curl /g) || []).length, 6, "section 18 makes exactly six REST calls (18a-18d anon, 18e two as a surgeon);");
ok(s18code.includes("\"$URL/rest/v1/app_call_days?select=day&limit=1\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\" -H \"Prefer: count=exact\")"), "18a: anon GET app_call_days with Prefer: count=exact");
ok(s18code.includes("\"$URL/rest/v1/rpc/app_call_names\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\")") && !/-X POST "\$URL\/rest\/v1\/rpc\/app_call_names"/.test(s18code), "18b: anon GET rpc/app_call_names (stable: GET, never POST)");
ok(s18code.includes("-X POST \"$URL/rest/v1/rpc/save_app_days\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\" -H \"Content-Type: application/json\" -d '{\"p_profile\":null,\"p_add\":[],\"p_clear\":[],\"p_replace\":false}'"), "18c: anon POST rpc/save_app_days with the four keys and empty lists (the schema-cache gate before the client push)");
ok(s18code.includes("-X POST \"$URL/rest/v1/app_call_days\" -H \"apikey: $ANON\" -H \"Authorization: Bearer $ANON\" -H \"Content-Type: application/json\" -d '{\"day\":\"2030-12-31\",\"profile_id\":\"00000000-0000-0000-0000-000000000000\",\"source\":\"app\"}'"), "18d: anon POST app_call_days (the zero uuid names no profile)");
{
  const posts = s18code.match(/curl [^\n]*-X POST[^\n]*/g) || [];
  ok(posts.length === 3 && posts.every((p) => /Bearer \$ANON|Bearer \$SILVIS_SURGEON_JWT/.test(p)) && posts.filter((p) => /rpc\/save_app_days/.test(p)).every((p) => p.includes("\"p_add\":[],\"p_clear\":[]")), "every POST in section 18 is an anon or surgeon call; the save_app_days calls send empty lists (nothing could be written)");
  ok(!/SILVIS_JWT[^_]|\$SILVIS_JWT\b/.test(s18code), "section 18 never sends the scheduler's token");
}
// pin moved deliberately 10/2 (the record step): a 404 is a FAIL with no flag (it passed as the not-applied picture before)
ok((s18code.match(/"HTTP 401"\|"HTTP 403"\) ok /g) || []).length === 4 && (s18code.match(/"HTTP 404"\) bad "(anon|surgeon) [^"]*: HTTP 404 \([^"]*2026-10-02 apply/g) || []).length === 6 && !/HTTP 404 - not applied yet|or 404 before the apply/.test(s18code) && /"HTTP 200"\) bad "anon read of app_call_days: HTTP 200/.test(s18code), "18a-18e: 401/403 PASS; a 404 FAILs (the table and the functions exist since the 2026-10-02 apply; 18e too); an anon 200 on the table FAILs");
ok(/if \[ -n "\$\{SILVIS_SURGEON_JWT:-\}" \]; then/.test(s18code) && s18code.includes('echo "   SKIP 18e (set SILVIS_SURGEON_JWT=') && /"HTTP 400"\) if grep -q 'AP001'/.test(s18code), "18e runs only with SILVIS_SURGEON_JWT (a SKIP line otherwise): the surgeon's read 200, the surgeon's empty save 400 with AP001");
ok(/PROBE18="\$\(cd sql\/probes && \(pwd -W 2>\/dev\/null \|\| pwd\)\)\/app-call-days-probe\.sql"/.test(s18code), "18f runs sql/probes/app-call-days-probe.sql through the linked CLI");
// pin moved deliberately 10/2 (the record step): PROBE_SETUP (absent) is a FAIL with no flag - the table exists since the apply
ok(/bad "APP days probe: PROBE_SETUP - app_call_days is absent \(the table exists since the 2026-10-02 apply\)"/.test(s18code) && !/ok "APP days probe: app_call_days is absent/.test(s18code) && /bad "APP days probe: PROBE_SETUP - user_profiles\.is_app is absent/.test(s18code) && /bad "APP days probe: PROBE_SETUP - live app_call_days rows sit in the probe window/.test(s18code), "18f must FAIL a PROBE_SETUP (strict since the record step; it passed as the not-applied picture before); the partly-applied raise and the collision guard FAIL too");
ok(s18code.includes("sed 's/\\\\u003e/>/g; s/\\\\u003c/</g; s/\\\\u0026/\\&/g; s/\\\\//g'"), "section 18's case reader decodes the CLI's \\u003e / \\u003c / \\u0026 and drops the JSON backslashes before grading");
ok(s18code.includes('lines18=$(echo "$results18" | tr \';\' \'\\n\' | sed ') && s18code.includes('case_val18()   { CV18=""; local l; while IFS= read -r l; do case "$l" in "$1="*) CV18="${l#"$1="}"; return 0;; esac; done <<< "$lines18"; }'), "section 18 decodes the results ONCE and reads each case in plain bash (no process per case)");
AP_CASES.forEach((k) => {
  const [kind, a, b, c, d] = AP_PROBE_CASES[k];
  const viaVar = (v) => v === AP_ALLOW ? "\"\\$ALLOW18\"" : null;
  let re;
  if (kind === "eq") {
    const lit = a.startsWith("ERR AP003 APP_DAY_NOT_APP: ") ? "\"" + apEsc(a.slice(0, a.indexOf(AP_NOTAPP))) + "\\$NOTAPP18\"" : (viaVar(a) || "\"" + apEsc(a) + "\"");
    re = new RegExp("\\n    expect_eq18\\s+" + apEsc(k) + "\\s+" + lit + "\\s");
  } else if (kind === "ap") re = new RegExp("\\n    expect_ap18\\s+" + apEsc(k) + "\\s+" + a + "\\s+" + b + "\\s+\"" + apEsc(c) + "\"\\s+\"" + apEsc(d) + "\"\\s");
  else re = new RegExp("\\n    expect_err18\\s+" + apEsc(k) + "\\s+" + a + "\\s+[\"']" + apEsc(b) + "[\"']\\s");
  ok(re.test(s18code), "section 18 must grade " + k + " as " + AP_PROBE_CASES[k].join(" | "));
});
ok(s18code.includes('ALLOW18="' + AP_ALLOW + '"') && s18code.includes('NOTAPP18="' + AP_NOTAPP + '"'), "section 18's two shared strings are the probe's");
eq((s18code.match(/\n    expect_(eq|err|ap)18 /g) || []).length, AP_CASES.length, "section 18 grades exactly the 69 cases;");
ok(s18code.includes("LEFTOVER18_SQL=\"select ((select count(*) from auth.users where email like 'probe-appdays-%@example.test') + (select count(*) from public.audit_log where action = 'appdays.save' and detail->>'summary' like 'probe app %'))::int as tagged, (case when to_regclass('public.app_call_days') is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.app_call_days where day between ''2030-12-01'' and ''2030-12-31'' or day = ''2020-05-04''', false, true, '')))[1]::text::int end) as in_window\"") && /LEFT ROWS BEHIND/.test(s18code), "18g counts leftovers by the probe's identity (tagged: its auth users and its audit rows; in_window: app_call_days in its window, guarded by to_regclass) and fails on non-zero");
ok(s18code.includes("echo \"      delete from auth.users where email like 'probe-appdays-%@example.test';   -- profiles and their app_call_days rows cascade\"") && !/delete from public\.app_call_days/.test(s18code), "18g prints DELETEs for tagged rows only - never for an app_call_days row (a probe row and a real APP day look alike)");
ok(s18code.includes('echo "   SKIP 18f/18g (supabase CLI not linked at $WORKDIR)"'), "without a linked CLI 18f / 18g skip (18a-18e still run)");
{
  const head = vr.slice(0, vr.indexOf("case \"${1:-}\""));
  // pins moved deliberately 10/2 (the record step): the header still names section 18 and its anon checks; the header and --help
  // no longer name the flag. Pin moved deliberately 10/2 (ship review of the merge): the TAIL of --help's env-var list is pinned in
  // the Prompt 28 step only (main's rule - a record step moves one pin), so this pin keeps only its own intent: the APP flag is gone
  ok(/APP call days anon checks and probe \(18\)/.test(head) && /anon checks \([^)]*18a-18d\)/.test(head), "verify-rls.sh's header names section 18 and its anon checks");
  ok(/SILVIS_PREFS_ROWS_BEFORE/.test(vr.slice(0, vr.indexOf("set -u"))) && !/SILVIS_APP_DAYS_APPLIED/.test(vr.slice(0, vr.indexOf("set -u"))), "verify-rls.sh --help lists SILVIS_PREFS_ROWS_BEFORE and no longer SILVIS_APP_DAYS_APPLIED (dropped at the record step)");
}
{
  const code18 = vr.slice(vr.indexOf('echo "== 18. '), vrSectionEnd('echo "== 18. '));
  // pin moved deliberately 10/2 (the record step): no strict option - section 18 reads no flag (under set -u, with the variable
  // unset); `pre` adds a line before the section, e.g. a SILVIS_APP_DAYS_APPLIED left in the environment (the apply script set
  // it), which must change nothing
  const run18 = (cliOut, opts) => {
    const o = Object.assign({ tagged: 0, win: 0, shape: "envelope", a: "401", b: "401", c: "401", d: "401", surgeon: false, pre: "" }, opts || {});
    const qBody = o.shape === "error" ? "echo 'unexpected status 500: connection refused'"
      : o.shape === "bare" ? "printf '[\\n  {\\n    \"tagged\": " + o.tagged + ",\\n    \"in_window\": " + o.win + "\\n  }\\n]\\n'"
      : "printf '{\\n  \"boundary\": \"%s\",\\n  \"rows\": [\\n    {\\n      \"tagged\": " + o.tagged + ",\\n      \"in_window\": " + o.win + "\\n    }\\n  ]\\n}\\n' \"$RANDOM\"";
    const script = "set -u\nWORKDIR=/nonexistent; pass=0; fail=0; T=$(mktemp -d); URL=http://verify.invalid; ANON=x\n" +
      "ok() { echo \"PASS  $1\"; pass=$((pass+1)); }\nbad() { echo \"FAIL  $1\"; fail=$((fail+1)); }\n" +
      (o.pre ? o.pre + "\n" : "") + (o.surgeon ? "SILVIS_SURGEON_JWT=SURGEONTOKEN\n" : "") + "linked() { true; }\n" +
      "q() { " + qBody + "; }\n" +
      "curl() { local of='' prev='' code='' post='' sur='' u='' a; for a in \"$@\"; do [ \"$prev\" = '-o' ] && of=\"$a\"; [ \"$a\" = POST ] && post=1; case \"$a\" in http*) u=\"$a\";; *SURGEONTOKEN*) sur=1;; esac; prev=\"$a\"; done; [ -n \"$of\" ] && : > \"$of\"; " +
      "if [ -n \"$sur\" ]; then if [ -n \"$post\" ]; then code=400; [ -n \"$of\" ] && echo '{\"code\":\"AP001\",\"message\":\"APP_DAY_NOT_ALLOWED: ...\"}' > \"$of\"; else code=200; fi; " +
      "else case \"$u\" in *rpc/save_app_days*) code=" + o.c + ";; *rpc/app_call_names*) code=" + o.b + ";; *rest/v1/app_call_days*) if [ -n \"$post\" ]; then code=" + o.d + "; else code=" + o.a + "; fi;; esac; fi; printf 'HTTP %s' \"$code\"; }\n" +
      "supabase() { echo 'Initialising login role...'; echo '" + cliOut.replace(/'/g, "'\\''") + "'; }\n" + code18 + "\nrm -rf \"$T\"\necho \"RESULT $pass $fail\"\n";
    const r = require("child_process").spawnSync("bash", ["-s"], { cwd: ROOT, encoding: "utf8", input: script });
    ok(!r.error, "bash could not be started to run section 18: " + (r.error && r.error.message));
    return { out: r.stdout || "", result: ((r.stdout || "").match(/^RESULT (\d+) (\d+)$/m) || []).slice(1).map(Number), err: r.stderr || "" };
  };
  const fails = (x) => x.out.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") + x.err.slice(0, 200);
  const after = {};
  AP_CASES.forEach((k) => { after[k] = apFull(k).replace(/<today M\/D>/g, "10/1"); });
  // the CLI's error body as the live apply logs show it (a JSON message, a double quote escaped; CONTEXT after the sentinel)
  const msgOf = (pic, esc) => { let m = Object.keys(pic).sort().map((k) => k + "=" + pic[k]).join(";"); m = m.replace(/"/g, '\\"'); if (esc) m = m.replace(/>/g, "\\u003e"); return 'unexpected status 400: {"message":"Failed to run sql query: ERROR:  P0001: PROBE_RESULTS ' + m + ';END\\nCONTEXT:  PL/pgSQL function inline_code_block line 3 at RAISE\\n"}'; };
  const ra = run18(msgOf(after));
  eq(ra.result, [AP_CASES.length + 5, 0], "section 18 against the AFTER picture (18a-18d 401, every case, leftover 0): every check PASS (" + fails(ra) + ");");
  const re = run18(msgOf(after, true), { surgeon: true });
  eq(re.result, [AP_CASES.length + 7, 0], "section 18 decodes the CLI's \\u003e for '>'; with SILVIS_SURGEON_JWT 18e adds two PASSes (the surgeon's read 200, the empty save 400 AP001) (" + fails(re) + ");");
  // the record step (10/2): the 2026-10-02 live picture exactly as Faraz's log printed it (today 10/2; A18, V3, I1, E4, E5 with the
  // CLI's escaped quotes; the CLI's 400 envelope around it) - every check PASS, a leftover SILVIS_APP_DAYS_APPLIED=1 in the
  // environment ignored: 74 / 0 as the log's section 18 graded it
  const liveMsg = 'unexpected status 400: {"message":"Failed to run sql query: ERROR:  P0001: PROBE_RESULTS ' + AP_LIVE_LINES.join(";") + ';END\\nCONTEXT:  PL/pgSQL function inline_code_block line 3 at RAISE\\n"}';
  const rlive = run18(liveMsg, { pre: "export SILVIS_APP_DAYS_APPLIED=1" });
  eq(rlive.result, [AP_CASES.length + 5, 0], "section 18 against the 2026-10-02 AFTER picture as the log printed it (18a-18d 401, the 69 lines, leftover 0), a leftover SILVIS_APP_DAYS_APPLIED=1 ignored - 74 / 0 (" + fails(rlive) + ");");
  eq(AP_CASES.length + 5, 74, "section 18's live count is 74 (18a-18d, 69 cases, the leftover check) - the log's section 18: 74 PASS, 0 FAIL;");
  // pins moved deliberately 10/2 (the record step): the not-applied picture is a FAIL with no flag (it passed before; strict was the flag's)
  const setup = 'unexpected status 400: {"message":"Failed to run sql query: ERROR:  P0001: PROBE_SETUP: app_call_days is absent - sql/migrations/2026-10-02-app-call-days.sql is not applied\\nCONTEXT:  ..."}';
  const rb = run18(setup, { a: "404", b: "404", c: "404", d: "404" });
  eq(rb.result, [1, 5], "section 18 since the record step (four 404s, PROBE_SETUP): the four 404s and PROBE_SETUP are FAILs with no flag, the leftover check still runs (" + fails(rb) + ");");
  ok(/FAIL  APP days probe: PROBE_SETUP - app_call_days is absent \(the table exists since the 2026-10-02 apply\)/.test(rb.out) && /FAIL  anon GET app_call_days: HTTP 404/.test(rb.out) && /FAIL  anon rpc app_call_names: HTTP 404/.test(rb.out) && /FAIL  anon rpc save_app_days: HTTP 404/.test(rb.out) && /FAIL  anon POST app_call_days: HTTP 404/.test(rb.out), "section 18 names the missing table and all four 404s");
  eq(run18(setup, { a: "404", b: "404", c: "404", d: "404", pre: "SILVIS_APP_DAYS_APPLIED=" }).result, [1, 5], "section 18: an empty SILVIS_APP_DAYS_APPLIED no longer turns the 404s and PROBE_SETUP into PASSes;");
  eq(run18(setup, { a: "404", b: "404", c: "404", d: "404", surgeon: true }).result, [3, 5], "... (18e's two calls answered as after the apply do not hide them);");
  const rl = run18(msgOf(Object.assign({}, after, { B1: "ok added=1", S1: "ok added=1 source=scheduler" })), { a: "200" });
  eq(rl.result, [AP_CASES.length + 2, 3], "section 18 must fail a second APP let onto a taken day, a surgeon let through and an anon 200 - exactly those three (" + fails(rl) + ");");
  // pin moved deliberately 10/2 (the record step): an anon 200 is graded against the applied picture (kept intent: it FAILs even
  // with Content-Range */0 - the revoke did not take)
  const r200 = run18(msgOf(after), { a: "200" });
  eq(r200.result, [AP_CASES.length + 4, 1], "an anon 200 on the table FAILs (even with Content-Range */0 - the revoke did not take);");
  ok(/FAIL  anon read of app_call_days: HTTP 200/.test(r200.out), "... and says so");
  const rq = run18(msgOf(after), { tagged: 3, shape: "bare" });
  eq(rq.result, [AP_CASES.length + 4, 1], "section 18 fails a non-zero tagged leftover count (read from a plain terminal's bare-array -o json the same as the agent envelope);");
  ok(/LEFT ROWS BEHIND \(tagged=3/.test(rq.out) && rq.out.includes("delete from auth.users where email like 'probe-appdays-%@example.test';") && rq.out.includes("delete from public.audit_log where action = 'appdays.save' and detail->>'summary' like 'probe app %';"), "section 18 names the tagged leftovers and prints their DELETEs");
  const rw = run18(msgOf(after), { win: 2 });
  eq(rw.result, [AP_CASES.length + 4, 1], "section 18 fails app_call_days rows left in the window after a run that passed the collision guard;");
  ok(/LEFT ROWS BEHIND \(in_window=2/.test(rw.out) && rw.out.includes("select * from public.app_call_days where day between '2030-12-01' and '2030-12-31' or day = '2020-05-04';") && !/delete from public\.app_call_days/.test(rw.out), "... and prints a SELECT to review, never a DELETE of an untagged row");
  // pins moved deliberately 10/2 (the record step): the two 18g shape checks run against the applied picture (the not-applied one
  // FAILs by itself now); kept intent: 18g reads the bare array as the envelope and FAILs a count it cannot read
  eq(run18(msgOf(after), { shape: "bare" }).result, [AP_CASES.length + 5, 0], "18g reads a plain terminal's bare-array -o json the same as the agent envelope;");
  eq(run18(msgOf(after), { shape: "error" }).result, [AP_CASES.length + 4, 1], "18g fails a leftover count it cannot read;");
  // kept intent (the no-primary record step's form): an absent-table run passed the guard too (the absent raise comes after it), so
  // app_call_days rows in the window after it are a leftover (FAIL) beside the PROBE_SETUP FAIL
  eq(run18(setup, { win: 1 }).result, [4, 2], "an absent-table run passed the guard too: rows in the window then are a leftover (FAIL) beside the PROBE_SETUP FAIL;");
  eq(run18('{"message": "connection refused"}').result, [5, 1], "section 18 fails a run with no sentinel-terminated PROBE_RESULTS (18a-18d and the leftover check still run);");
  const collide = 'unexpected status 400: {"message":"Failed to run sql query: ERROR:  P0001: PROBE_SETUP: live rows already sit in the probe window (app_call_days in 2030-12 or on 2020-05-04) - the probe fixtures would collide\\nCONTEXT:  ..."}';
  eq(run18(collide).result, [5, 1], "the probe's collision guard is a FAIL, never 'not applied';");
  const rc = run18(collide, { win: 2 });
  eq(rc.result, [4, 1], "a collision with live rows in the window: 18f FAILs, 18g neither passes nor fails them (the probe wrote nothing) - " + fails(rc));
  ok(!/LEFT ROWS BEHIND/.test(rc.out) && /they are live rows, not leftovers/.test(rc.out) && !/delete from public\.app_call_days/.test(rc.out), "... and lists them for review only, never as leftovers and never with a DELETE");
  const part = 'unexpected status 400: {"message":"Failed to run sql query: ERROR:  P0001: PROBE_SETUP: user_profiles.is_app is absent - sql/migrations/2026-10-02-app-call-days.sql is partly applied\\nCONTEXT:  ..."}';
  eq(run18(part).result, [5, 1], "the partly-applied raise is a FAIL;");
}

step("Prompt 29: no apply script in the repo (Faraz 10/1: apply scripts live outside it) - none under scripts/, no tracked SQL / SCHEMA-REVIEW line runs one from scripts/");
{
  ok(!fs.existsSync(path.join(ROOT, "scripts", "apply-app-call-days.sh")), "scripts/apply-app-call-days.sh must not be in the repo (it lives outside it; test/ci.test.js keeps verify-rls.sh the only shell script)");
  [AP_MIGRATION, AP_PROBE, AP_PRECHECK, path.join(ROOT, "sql", "schema.sql"), path.join(ROOT, "scripts", "verify-rls.sh"), path.join(ROOT, "docs", "SCHEMA-REVIEW.md")].forEach((p) =>
    ok(!/bash scripts\/apply-|scripts\/apply-app-call-days\.sh/.test(read(p)), path.relative(ROOT, p) + " names an in-repo apply script (they live outside the repo since 10/1)"));
}

step("Prompt 29: docs - SCHEMA-REVIEW.md section (APPLIED 2026-10-02 19:19:27Z + the observed apply since the record step, the flag decision, the table + RLS and the three policies verbatim, the refusal table, the pre-check verbatim, the probe table, apply order, one command, rollback), tables (a) / (b), the helper line, guide 4.3 / 21, the rules doc, ONBOARDING, CLAUDE.md");
ok(/^## 2026-10-02 - APP call days: app_call_days \+ save_app_days \/ app_call_names \+ user_profiles\.is_app \(Faraz 10\/1, Prompt 29; `sql\/migrations\/2026-10-02-app-call-days\.sql`\)$/m.test(review), "SCHEMA-REVIEW.md lacks the '## 2026-10-02 - APP call days: ...' section");
{
  const at = review.indexOf("## 2026-10-02 - APP call days:"), end = review.indexOf("\n## ", at + 1);
  const sec = at < 0 ? "" : review.slice(at, end < 0 ? review.length : end);
  const flat = sec.replace(/\s+/g, " ");
  // pin moved deliberately 10/2 (the record step): the status reads APPLIED (it read `**Status: PREPARED - report-first, NOT APPLIED.**` before)
  ok(/^\*\*Status: APPLIED 2026-10-02 19:19:27Z\*\* \(Faraz, from PowerShell through Git's bash\.exe - `apply-app-call-days\.sh`, which exports `AI_AGENT`; the observed lines at the end\)\. Was PREPARED - report-first, NOT APPLIED until then\.$/m.test(sec) && !/^\*\*Status: PREPARED/m.test(sec), "the section's status line must read `**Status: APPLIED 2026-10-02 19:19:27Z** (Faraz, ... apply-app-call-days.sh ...)` since the record step");
  ok(flat.includes("\"I want the APPs to be able to add themselves to call days - it would be a feature available to APPs or Me ... This would also show up on the calendar\"") && flat.includes("**any day; ONE APP per day; everyone signed in sees it, not the ?public=1 page; no e-mails, the Activity log only.**"), "the section quotes Faraz and the four decisions");
  ok(flat.includes("**The decision: a flag, not a role.**") && /daily-reminder/.test(sec) && /send-notification/.test(sec) && /followsPatch/.test(sec), "the section states the flag decision with the edge-function and followsPatch reasons");
  ok(sec.includes("```sql\n" + [AP_TABLE, AP_INDEX, AP_ENABLE, AP_PRIVS, "drop policy if exists app_call_days_read on public.app_call_days;", AP_READ_POLICY].join("\n") + "\n```"), "the section carries the table and its RLS verbatim");
  ok(sec.includes("```sql\n" + AP_COLUMN_LINES.join("\n") + "\n```"), "the section carries the column and its check verbatim");
  ok(sec.includes(FOLLOW_POLICIES.user_profiles_self_insert) && sec.includes(FOLLOW_POLICIES.user_profiles_self_update) && sec.includes(AP_SELF_INSERT) && sec.includes(AP_SELF_UPDATE) && sec.includes(AP_READ_POLICY), "the section carries the three policy texts verbatim (and the two self policies before -> after)");
  AP_CODES.forEach(([c, t]) => ok(new RegExp("^\\| [0-9]+ \\| `" + c + "` \\|[^\\n]*`" + t + ": ", "m").test(sec), "the refusal table lists " + c + " with its " + t + " message"));
  ok(flat.includes("`pg_advisory_xact_lock(hashtext('app_call_days:save'))`") && flat.includes("**Idempotent:**") && flat.includes("**All or nothing:**") && flat.includes("**The audit row**") && flat.includes("`appdays.save`") && flat.includes("No notification row, no e-mail"), "the section states the lock, idempotency, all-or-nothing and the audit row");
  ok(flat.includes("**A profile that stops being an APP**") && flat.includes("**Account deletion**") && flat.includes("**Realtime.**") && flat.includes("**Blast radius.**") && flat.includes("**What could break.**") && flat.includes("observed OFFLINE only"), "the section covers a former APP, account deletion, realtime, the blast radius and what could break (offline only)");
  ok(sec.includes("```sql\n" + apPre.slice(apPre.indexOf("with objects as (")).replace(/\n+$/, "") + "\n```"), "the section carries the pre-check verbatim (= sql/probes/app-call-days-precheck.sql)");
  AP_CASES.forEach((k) => ok(new RegExp("^\\| " + apEsc(k) + " \\| [^\\n]* \\| `" + apEsc(AP_AFTER[k].replace(/\|/g, "\\|")) + "` \\|$", "m").test(sec), "the section's probe table lists case " + k + " with its AFTER string"));
  ok(flat.includes("4. Probe AFTER: every case as the table lists (69 cases).") && flat.includes("5. `SILVIS_APP_DAYS_APPLIED=1 bash scripts/verify-rls.sh`") && flat.includes("6. The record step, ONE commit:") && flat.includes("`supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-02-app-call-days.sql`") && flat.includes("7. The client push, on Faraz's go, after Prompt 28's client.") && flat.includes("8. Faraz (or Cowork on his go) sets Role = `app`"), "the apply order: pre-check, probe BEFORE, the file, probe AFTER (69), strict verify-rls, the record step, the client push, the account switch");
  ok(flat.includes("**One command (Faraz):** his apply script `apply-app-call-days.sh`, kept OUTSIDE the repo") && flat.includes("sha256") && flat.includes("--dry-run") && flat.includes("AI_AGENT=1") && flat.includes("PASTE THIS BACK TO CLAUDE CODE"), "the section names the one command (its script outside the repo), the sha256 stop, its dry run, the agent mode and the paste-back block");
  const rbBlock = "```sql\n" + apHdr.slice(apHdr.indexOf("-- Rolling back")).split("\n").filter((l) => /^--   /.test(l)).map((l) => l.replace(/^--   /, "")).join("\n") + "\n```";
  ok(sec.includes(rbBlock), "the section gives the rollback verbatim (= the migration header's)");
  ok(sec.includes("`<APP name>: on call 12/2, 12/3`"), "the section's audit examples use the placeholder <APP name>, never an APP's real name");
  // pin moved deliberately 10/2 (the record step): the placeholder is gone - the observed apply paragraph from Faraz's log
  // apply-app-call-days-20261002T191907Z.log replaces it
  ok(!/_to be filled/.test(sec), "the section has no observed placeholder since the record step");
  const at2 = sec.indexOf("observed (apply, 2026-10-02): applied 2026-10-02 19:19:27Z");
  ok(at2 > 0 && at2 > sec.indexOf("**Rolling back**"), "the section must end with the 'observed (apply, 2026-10-02): applied 2026-10-02 19:19:27Z ...' paragraph");
  const ap = at2 < 0 ? "" : sec.slice(at2);
  const apFlat = ap.replace(/\s+/g, " ");
  ok(apFlat.includes("exit 0, an empty result `\"rows\": []`") && apFlat.includes("log `apply-app-call-days-20261002T191907Z.log`, outside the repo, result `APPLIED AND VERIFIED`") && apFlat.includes("repo HEAD `5b9964e`") && apFlat.includes("`" + APPDAYS_APPLIED_SHA256 + "` = the expected one") && apFlat.includes("(`all four matched: yes`)") && apFlat.includes("supabase CLI 2.84.2") && apFlat.includes("`bzhsroegtagqhutbnsrp`"), "the observed apply names the CLI exit, the log and its result, the repo HEAD, the applied sha256 (all four matched), the CLI version and the project");
  // the observed lines, copied from the log: the gate before + its facts (counts only), the absent check, probe BEFORE, the gate after + signatures
  ok(apFlat.includes("gate before: `table=no is_app=no is_app_fn=no save_fn=no names_fn=no pins=0`") && ap.includes("```text\n2 profiles admin: n=1 linked=1 following=0 named=1\n2 profiles coordinator: n=2 linked=0 following=0 named=2\n2 profiles surgeon: n=5 linked=5 following=0 named=5\n2 profiles viewer: n=3 linked=0 following=2 named=3\n3 audit: appdays_rows=0\n4 realtime: publication=yes all_tables=no app_call_days_published=no\n```"), "the observed apply records the pre-check gate before and its six facts as the log printed them (counts only)");
  ok(apFlat.includes("`OK - none of the three functions exists` (signatures before: none)") && apFlat.includes("Step 3, probe BEFORE: `PROBE_SETUP: app_call_days is absent - sql/migrations/2026-10-02-app-call-days.sql is not applied`") && apFlat.includes("gate after: `table=yes is_app=yes is_app_fn=yes save_fn=yes names_fn=yes pins=2` (rows 2-4 unchanged)") && apFlat.includes("signatures after: `app_call_names() definer;save_app_days(uuid, date[], date[], boolean) definer;silvis_is_app() definer`"), "the observed apply records the absent check, probe BEFORE, the gate after and the signatures after");
  // the 69 AFTER lines as the log printed them, in one text block: exactly the live picture (sorted, the CLI's escaped quotes kept).
  // review 10/2: frozen on its own - the sha256 of the 69 lines (each with its LF) as step 6 of
  // apply-app-call-days-20261002T191907Z.log printed them, so a later, justified edit of a probe AFTER string (header,
  // AP_PROBE_CASES, AP_FULL) never forces a rewrite of this historical record, and the record cannot move in step with the header.
  // AP_LIVE_LINES (rebuilt from today's header) stays the input of the faked grading run only.
  const blockAt = ap.indexOf("```text\nA1=");
  const block = blockAt < 0 ? "" : ap.slice(blockAt + 8, ap.indexOf("\n```", blockAt + 8));
  eq(block.split("\n").length, 69, "the observed probe AFTER lists 69 lines (one per case);");
  eq(crypto.createHash("sha256").update(block + "\n").digest("hex"), "d7af77b4f59400f03179f307237eb35d1a1f530dc70405da5f3787fb5fdffaf4",
    "the observed probe AFTER block must be the 69 lines exactly as the 20261002T191907Z log printed them (frozen sha256);");
  ok(apFlat.includes("`RESULT: 366 passed, 0 failed`") && apFlat.includes("section 18 74 / 0") && apFlat.includes("18a `HTTP 401`") && apFlat.includes("18c `HTTP 401` (`permission denied for function save_app_days`: PostgREST knows the four keys)") && apFlat.includes("every one of the 69 cases PASS") && apFlat.includes("leftover count 0") && apFlat.includes("(3, 6, 7c-7e, 8c / 8d, 9d, 14c, 18e) skipped"), "the observed apply records verify-rls 366 / 0, section 18 74 / 0 (18a-18d 401), leftovers 0 and the skipped JWT checks");
  ok(apFlat.includes("Two earlier runs that afternoon (logs `apply-app-call-days-20261002T191239Z.log` and `apply-app-call-days-20261002T191603Z.log`) stopped at step 4 and changed nothing") && apFlat.includes("`STOPPED at step 4: not confirmed (you typed 'apply'; an unreadable terminal reads as empty)`"), "the observed apply records the two stopped runs (lower-case apply at the prompt - nothing applied)");
  ok(apFlat.includes("Not re-run against the live project after the record step") && apFlat.includes("the next plain `bash scripts/verify-rls.sh` grades section 18 strictly with no flag"), "the observed apply says nothing live was re-run by the record step");
  // review 10/2: the probe AFTER ran once live (the third script run - the first two stopped before the migration), and no case
  // reads the functions' owner (the definer's writes under RLS show it indirectly)
  ok(flat.includes("*As run (2026-10-02): the live probe AFTER (the 20261002T191907Z run - the third script run; the first two stopped at step 4's APPLY prompt, before the migration ran) read all 69 cases exactly as their header strings") && flat.includes("P1-P3 included (search_path, grants and the default-privilege revoke), A1 / A2 / D1 / D2 (the definer's writes and audit row under the live owner - RLS on, no write policy; no case reads the owner itself)") && !flat.includes("the first live run read all 69 cases") && !flat.includes("P1-P3 included (the live owner") && flat.includes("section 18 graded 74 / 0.*"), "what could break carries its as-run note (the third run's probe AFTER; P1-P3 do not read the owner)");
  ok(flat.includes("*As run (2026-10-02): items 1-5 by `apply-app-call-days.sh`") && flat.includes("kept byte for byte as it ran (sha256 `" + APPDAYS_APPLIED_SHA256 + "`") && flat.includes("`SILVIS_APP_DAYS_APPLIED` no longer exists (section 18 is strict by default).") && flat.includes("the script is one-shot; a re-apply after a rollback (or a `--dry-run`) needs its pins refreshed first, or it stops at step 0. Items 7-8 follow, on Faraz's go.*") && !flat.includes("Items 7-8 wait for Faraz's go"), "the apply order carries its as-run note (the script's steps, the file kept as it ran with its sha256, the flag gone, the apply script one-shot since the record step)");
  ok(flat.includes("Faraz ran it on 2026-10-02 at `5b9964e` (the observed lines at the end; two earlier runs that day stopped at the APPLY prompt and applied nothing)"), "the one-command paragraph says when it ran");
}
// pins moved deliberately 10/2 (the record step): tables (a) / (b) and the helper line read applied (they read "prepared 2026-10-02, NOT APPLIED" before)
ok(/^\| `app_call_days` \|[^\n]*prepared 2026-10-02 - report-first, \*\*applied live 2026-10-02 19:19 UTC\*\*[^\n]*never anon[^\n]*save_app_days/m.test(tblA), "SCHEMA-REVIEW table (a) needs an app_call_days row (applied live 2026-10-02 19:19 UTC; authenticated read, never anon; write = save_app_days only)");
ok(/^\| `user_profiles` \|[^\n]*Prompt 29 \(prepared 2026-10-02 - report-first, \*\*applied live 2026-10-02 19:19 UTC\*\*[^\n]*`is_app`/m.test(tblA) && /^\| `user_profiles` \|[^\n]*Prompt 29 \(applied 2026-10-02 19:19 UTC\)[^\n]*`is_app`/m.test(tblB), "SCHEMA-REVIEW tables (a) / (b): the user_profiles rows note is_app (admin-set, pinned in self-insert / self-update), applied 2026-10-02 19:19 UTC");
ok(/^\| `app_call_days` - applied 2026-10-02 19:19 UTC \| every signed-in role[^\n]*never anon[^\n]*\| none directly[^\n]*save_app_days/m.test(tblB), "SCHEMA-REVIEW table (b) needs an app_call_days row (applied; read: every signed-in role, never anon; write: none directly - save_app_days)");
ok(/^\| `audit_log` \|[^\n]*since 2026-10-02 19:19 UTC `appdays\.save` from `save_app_days`, Prompt 29/m.test(tblA), "SCHEMA-REVIEW table (a)'s audit_log row names appdays.save as written since the apply");
ok(/^Helper functions: `silvis_role\(\)`, `silvis_person_id\(\)`, `silvis_is_sched\(\)`[^\n]*`silvis_is_app\(\)` \(Prompt 29, applied 2026-10-02 19:19 UTC:/m.test(review), "SCHEMA-REVIEW's helper line adds silvis_is_app() (applied 2026-10-02 19:19 UTC)");
ok(!/^\|[^\n]*(app_call_days|Prompt 29|appdays\.save)[^\n]*NOT APPLIED/m.test(tblA + tblB) && !/silvis_is_app\(\)` \(Prompt 29, prepared/.test(review), "no table (a) / (b) row or helper line calls Prompt 29 NOT APPLIED since the record step");
{
  // the record step (10/2): guide 4.3's bullet and Proof line, guide 21's note and 21.4, the rules doc's row, ONBOARDING and
  // CLAUDE.md say applied
  const guideAll = read(path.join(ROOT, "docs", "SILVIS-BUILD-GUIDE.md"));
  const rulesDoc = read(path.join(ROOT, "docs", "SILVIS-CALL-RULES.md"));
  const onboarding = read(path.join(ROOT, "docs", "ONBOARDING.md"));
  const claudeMd = read(path.join(ROOT, "CLAUDE.md"));
  const apBullet = (guideAll.match(/^- \*\*APP call days \(2026-10-02, [^\n]*/m) || [""])[0];
  const apProof = (guideAll.match(/^Proof: `sql\/probes\/app-call-days-probe\.sql`[^\n]*/m) || [""])[0];
  ok(/^- \*\*APP call days \(2026-10-02, report-first, applied 2026-10-02 19:19 UTC; `sql\/migrations\/2026-10-02-app-call-days\.sql`, revision v\)\.\*\*/.test(apBullet), "guide 4.3 must carry the 'APP call days (2026-10-02, report-first, applied 2026-10-02 19:19 UTC; ..., revision v)' bullet");
  ok(/section 18 \(16 is Prompt 28's no-primary days, applied - the section before it; 17 the weekend pair claim, prepared, on its branch; the anon REST checks, the graded probe \+ leftovers; strict since the record step - a PROBE_SETUP or an anon 404 FAILs\)/.test(apProof) && !/taken by prepared work/.test(apProof) && !/SILVIS_APP_DAYS_APPLIED/.test(apProof) && !/_to be filled/.test(apProof) && !/status PREPARED/.test(apProof) && /applied: 2026-10-02 19:19:27 UTC by Faraz/.test(apProof) && /AFTER 69 \/ 69, verify-rls 366 \/ 0 with section 18 graded strictly \(74 \/ 0; 18a-18d HTTP 401\)/.test(apProof) && /the migration file kept as it ran, its sha256 pinned/.test(apProof), "guide 4.3's APP Proof line: section 18 strict (no flag; 16 applied on main, 17 prepared), 'applied: 2026-10-02 19:19:27 UTC' with probe AFTER 69 / 69 and verify-rls 366 / 0, the file kept as it ran");
  // review 10/2: the client sentences hold before and after the client push (Prompt 28's client is already live - main bc6c89e)
  ok(apProof.endsWith("APP accounts work from the build that ships Prompt 29's client (pushed on Faraz's go; Prompt 28's client, which it follows, is live since 2026-10-02 - main `bc6c89e`); then Faraz sets Role = `app` on each APP account.") && guideAll.includes("APP\naccounts work from the build that ships Prompt 29's client (pushed on Faraz's go; Prompt 28's client, which it follows, is live\nsince 2026-10-02 - main `bc6c89e`); then Faraz sets Role = `app` on each APP account in Setup > Users.*") && !/[Cc]lient ships after Prompt 28's client/.test(guideAll), "guide 4.3's Proof line and guide 21's note: APP accounts work from the build that ships Prompt 29's client (Prompt 28's client already live), not 'ships after Prompt 28's client'");
  ok(guideAll.includes("+ `user_profiles.is_app` (Prompt 29, 10/1 - report-first, applied 2026-10-02; §21) |"), "guide's table row for app_call_days says applied 2026-10-02");
  ok(guideAll.includes("*Prepared 10/1-10/2 on `feat/app-call-days`; the database part (report-first) was applied 2026-10-02 19:19 UTC by Faraz") && guideAll.includes("*As run: everything up to the record step on 2026-10-02 (applied 19:19:27\n  UTC; the record step made section 18 strict and dropped `SILVIS_APP_DAYS_APPLIED`); the client push and the account switch\n  follow, on Faraz's go.*") && !guideAll.includes("the client push and the account switch\n  wait for Faraz's go"), "guide 21's note and 21.4's apply order say applied (the flag dropped; the client push follows - true before and after the push)");
  const sec21 = guideAll.slice(guideAll.indexOf("## 21. APP call days"));
  ok(!/report-first and NOT applied|NOT applied yet/.test(sec21) && !/APP call days \(2026-10-02, report-first, NOT applied/.test(guideAll), "the guide no longer calls Prompt 29 NOT applied");
  ok(rulesDoc.includes("Schema: `sql/migrations/2026-10-02-app-call-days.sql` (report-first, **applied 2026-10-02**; `docs/SCHEMA-REVIEW.md`); the app part is Prompt 29's client build (pushed on Faraz's go) - the build guide §21. |") && !/app-call-days\.sql` \(report-first, \*\*not applied yet\*\*/.test(rulesDoc) && !/the app part ships on Faraz's go/.test(rulesDoc), "the rules doc's APP call days row says applied 2026-10-02 and names the app part in wording true before and after the client push");
  // review 10/2: worded to stay true before AND after the client push (the Prompt 28 record-step pattern) - this branch reaches
  // main only by the merge that ships the client, so a "not pushed yet" note would only ever be read on main when it is false
  ok(onboarding.includes("Prompt 29 - database applied 2026-10-02) |") && onboarding.includes("*The database part ran on 2026-10-02 (`apply-app-call-days.sh`); APP accounts work from the build that ships Prompt 29's\nclient, then Faraz marks them in Setup → Users.") && !/Prompt 29 - prepared, not applied yet|Prepared, not live yet|the app part not pushed yet|Not live yet/.test(onboarding), "ONBOARDING: the app role row and the APPs section say the database part ran 2026-10-02, in wording true before and after the client push (no 'not pushed yet' / 'Not live yet')");
  ok(/APP accounts - viewers with `user_profiles\.is_app` who put themselves on call days \(Prompt 29, applied\n2026-10-02\)/.test(claudeMd) && /Dropped: Davenport's APP shifts \(Silvis APPs only put themselves on call days - Prompt 29,\napplied 2026-10-02;/.test(claudeMd) && !/Dropped: APPs,|6 surgeons \+ 1 viewer/.test(claudeMd), "CLAUDE.md: the live users and the dropped list say what an APP is now (Prompt 29, applied 2026-10-02)");
}
console.log("- Prompt 29: user_profiles.is_app + app_call_days + silvis_is_app / app_call_names / save_app_days (report-first, applied 2026-10-02 19:19:27Z; the file kept as it ran, sha256-pinned), mirrored (revision v), probe + pre-check + verify-rls section 18 (strict) graded against a faked CLI, apply script kept outside the repo, docs pinned");

console.log("schema.test.js: " + N + " assertions passed");
