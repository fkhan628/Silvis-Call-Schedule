#!/usr/bin/env bash
# Silvis Call Schedule - RLS + trigger verification (Prompt 2).
#
#   bash scripts/verify-rls.sh                 anon checks (1-2, 5c, 7a, 8, 9a-9b, 10a, 18a-18d) + trigger checks (4) + trade-guard probe (5) + claim probe (7b) + offers probe (8e) + east-vacation probe (9c) + pre-launch probe (10c) + coordinator probe (11b) + followers probe (12b) + audit read-back probe (13) + call pay anon checks and probe (14) + vacation guard probe (15) + APP call days anon checks and probe (18) via the linked Supabase CLI
#   SILVIS_JWT=<scheduler jwt> bash scripts/verify-rls.sh   also runs the authenticated write checks (3, 8c, 8d)
#   SILVIS_SURGEON_JWT=<surgeon jwt> ...                      also runs the REST trade-guard checks (6), REST claim checks (7c-7e) and the surgeon reads (9d, 18e; a SURGEON-role user's access token)
#   SILVIS_WORKDIR=<dir linked with `supabase link`>          where the CLI's linked project lives (default: $HOME/supabase-silvis)
#   SILVIS_PREFS_ROWS_BEFORE=<n>                              the notification_preferences row count read BEFORE the followers migration; set it on the run right after the apply and 12b also requires R1 person=<n> profile=0 (later runs leave it unset: R1 is then graded by its invariants)
#
# Never put a JWT or the service-role key in a file. Reads SUPABASE_URL / anon key from config.js.
# The Supabase CLI runs in agent mode (AI_AGENT=1, exported below unless already set): q() / verdict() read its JSON envelope.
# Section 5 (Prompt 12 D) runs sql/probes/trade-guards-probe.sql, which rolls itself back: it ends by
# RAISING an exception whose message carries the per-case results, and this script grades them.
# Section 7 (Prompt 13 part 2) does the same with sql/probes/claim-open-slot-probe.sql (claim_open_slot).
#
# --help / -h prints usage and exits BEFORE anything runs (the scripts/ contract, audit 9/23 + review follow-up);
# any other argument is refused the same way - every option of this script is an environment variable, never a flag.
case "${1:-}" in
  -h|--help) echo "usage: bash scripts/verify-rls.sh   (no flags; options are the env vars SILVIS_JWT / SILVIS_SURGEON_JWT / SILVIS_WORKDIR / SILVIS_PREFS_ROWS_BEFORE - see the header of this file). Runs the live RLS / trigger probes against the Silvis project: anon REST checks, then linked-CLI probes that roll themselves back."; exit 0;;
  "") ;;
  *) echo "unknown argument: $1 (this script takes no flags; see --help)" >&2; exit 2;;
esac
set -u
# Supabase CLI agent mode (the vacation guard's record step, 10/1): `supabase db query -o json` prints the
# {"warning","boundary","rows"} envelope only in agent mode, which the CLI (2.84) auto-detects from env vars such as CLAUDECODE /
# AI_AGENT. q() prints that envelope and verdict() tells a success by its "rows" key (the trigger checks, every probe setup and
# cleanup); outside an agent shell the CLI prints a bare array, so every q() success would read as an error (Faraz's first 10/1
# apply run stopped on that shape). Set it here so any shell behaves like the tested one; an AI_AGENT already set is kept.
export AI_AGENT="${AI_AGENT:-1}"
cd "$(dirname "$0")/.." || exit 1
URL=$(grep -oE 'SUPABASE_URL\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
ANON=$(grep -oE 'SUPABASE_ANON_KEY\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "FAIL: could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js"; exit 1; }
WORKDIR="${SILVIS_WORKDIR:-$HOME/supabase-silvis}"
pass=0; fail=0
T=$(mktemp -d "${TMPDIR:-/tmp}/silvis-verify-rls.XXXXXX") || { echo "FAIL: mktemp"; exit 1; }   # every curl body lands here, never a fixed /tmp name (B10 9/23)
trap 'rm -rf "$T"' EXIT
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
# Linked-CLI helpers (sections 4, 5, 6b). q prints the CLI's JSON (a "rows" key on success) or its
# error text; "accepted" means a real success, never merely the absence of the conflict message.
linked()  { command -v supabase >/dev/null 2>&1 && [ -f "$WORKDIR/supabase/.temp/project-ref" ]; }
q()       { supabase db query --linked --workdir "$WORKDIR" -o json "$1" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising'; }
verdict() { # $1 = output; prints conflict | accepted | error
  if echo "$1" | grep -q ON_CALL_CONFLICT; then echo conflict; elif echo "$1" | grep -q '"rows"'; then echo accepted; else echo error; fi; }

echo "== 1. anon read (schedule_days) =="
line=$(curl -s -o $T/vr1.json -w 'HTTP %{http_code}' "$URL/rest/v1/schedule_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
echo "   $line  body: $(head -c 120 $T/vr1.json)"
case "$line" in "HTTP 200") ok "anon read returns 200";; *) bad "anon read: $line";; esac

echo "== 2. anon write blocked (schedule_days) =="
line=$(curl -s -o $T/vr2.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"day":"2030-01-01"}')
echo "   $line  body: $(head -c 160 $T/vr2.json)"
case "$line" in "HTTP 401"|"HTTP 403") ok "anon write blocked ($line)";; *) bad "anon write: $line (expected 401/403)";; esac

echo "== 3. scheduler JWT write (schedule_days) =="
if [ -n "${SILVIS_JWT:-}" ]; then
  line=$(curl -s -o $T/vr3.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"day":"2030-01-01","source":"verify-rls","note":"verify-rls.sh probe"}')
  echo "   $line  body: $(head -c 160 $T/vr3.json)"
  case "$line" in "HTTP 201") ok "scheduler JWT write returns 201";; *) bad "scheduler JWT write: $line";; esac
  del=$(curl -s -o /dev/null -w 'HTTP %{http_code}' -X DELETE "$URL/rest/v1/schedule_days?day=eq.2030-01-01" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT")
  echo "   cleanup DELETE: $del"
else
  echo "   SKIP  (set SILVIS_JWT=<scheduler access token> in the environment to run this check)"
fi

echo "== 4. time_off trigger (via linked Supabase CLI: $WORKDIR) =="
if linked; then
  q "delete from public.time_off where person_id = 's9test'; delete from public.schedule_days where day between '2030-01-01' and '2030-01-10';" >/dev/null
  r=$(q "insert into public.schedule_days (day, primary_id, backup_id, source) values ('2030-01-03','s9test',null,'verify-rls'), ('2030-01-06',null,'s9test','verify-rls');")
  [ "$(verdict "$r")" = "accepted" ] || { echo "   setup insert failed: $(echo "$r" | tr -d '\n' | head -c 200)"; bad "trigger checks could not be set up"; }
  r=$(q "insert into public.time_off (person_id, start_date, end_date, note) values ('s9test','2030-01-03','2030-01-03','probe')"); v=$(verdict "$r")
  echo "   over a published day  -> $v: $(echo "$r" | tr -d '\n' | grep -oE 'ON_CALL_CONFLICT[^"]{0,90}|"rows"' | head -1)"
  [ "$v" = "conflict" ] && ok "trigger refuses a vacation over a published day" || bad "trigger did not refuse a vacation over a published day ($v)"
  r=$(q "insert into public.time_off (person_id, start_date, end_date, note) values ('s9test','2030-01-04','2030-01-04','probe')"); v=$(verdict "$r")
  echo "   day after PRIMARY day -> $v: $(echo "$r" | tr -d '\n' | grep -oE 'ON_CALL_CONFLICT[^"]{0,90}|"rows"' | head -1)"
  [ "$v" = "conflict" ] && ok "trigger refuses a vacation starting the day after a PRIMARY day (trailing edge)" || bad "trailing-edge check missing ($v)"
  r=$(q "insert into public.time_off (person_id, start_date, end_date, note) values ('s9test','2030-01-07','2030-01-07','probe')"); v=$(verdict "$r")
  echo "   day after BACKUP day  -> $v"
  [ "$v" = "accepted" ] && ok "day after a BACKUP day is accepted" || bad "day after a BACKUP day: $v"
  r=$(q "insert into public.time_off (person_id, start_date, end_date, note) values ('s9test','2030-01-09','2030-01-10','probe')"); v=$(verdict "$r")
  echo "   clean range           -> $v"
  [ "$v" = "accepted" ] && ok "clean range accepted" || bad "clean range: $v"
  q "delete from public.time_off where person_id = 's9test'; delete from public.schedule_days where day between '2030-01-01' and '2030-01-10';" >/dev/null
  echo "   cleanup done"
else
  echo "   SKIP  (supabase CLI not linked at $WORKDIR; run: supabase init --workdir $WORKDIR && supabase link --project-ref bzhsroegtagqhutbnsrp --workdir $WORKDIR)"
fi

echo "== 5. trade guards (rolled-back probe via the linked CLI; Prompt 12 D) =="
# sql/probes/trade-guards-probe.sql builds fixtures in 2030-03 + throwaway auth users, acts as a
# surgeon / a scheduler, and ends with RAISE 'PROBE_RESULTS A=..;B=..;END' so the whole batch rolls
# back. The message is cut at the ';END' sentinel: whatever the CLI appends after the raised text
# (' (SQLSTATE P0001)', a CONTEXT line, a closing JSON quote) must never leak into the last case.
# Expectations below are the AFTER-migration picture; the probe's header lists BEFORE per case.
# The rollback is then OBSERVED, not assumed: a leftover count over every fixture table must be 0.
if linked; then
  PROBE="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/trade-guards-probe.sql"   # the CLI needs an absolute path (pwd -W = Windows form under Git Bash)
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results" | tr ';' '\n' | sed 's/^/   /'
    case_val()  { echo "$results" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq() { v=$(case_val "$1"); [ "$v" = "$2" ] && ok "probe $1: $3" || bad "probe $1: $3 (got '$v', expected '$2')"; }
    expect_ineligible() { v=$(case_val "$1"); if echo "$v" | grep -q 'TRADE_INELIGIBLE' && echo "$v" | grep -q -- "$2"; then ok "probe $1: $3"; else bad "probe $1: $3 (got '$v', expected TRADE_INELIGIBLE ... $2)"; fi; }
    expect_eq         A "status=pending from=s2 decided=null"    "surgeon insert with status 'accepted' + decided_at lands as 'pending', undecided"
    expect_ineligible B "vacation"                               "apply on the receiver's vacation day is refused"
    expect_ineligible C "already holds"                          "receiver already holding the other role is refused"
    expect_ineligible D "locked"                                 "locked slot is refused for a non-scheduler"
    expect_eq         E "status=applied 03-11p=s2 03-13b=s3"    "control: a clean accepted trade applies (then rolls back)"
    expect_eq         F "status=applied locked=false"            "scheduler applies a locked slot and the lock clears"
    expect_ineligible G "two different"                          "from = to is refused"
    expect_eq         H "status=pending from=s2"                 "from_surgeon_id is forced to the caller's roster id"
    # 2026-09-23 (audit RLS-6): TRADE_PAST. "today" is Central at run time, so match the token + the day, not the sentence.
    expect_past() { v=$(case_val "$1"); if echo "$v" | grep -q 'TRADE_PAST' && echo "$v" | grep -q -- "$2"; then ok "probe $1: $3"; else bad "probe $1: $3 (got '$v', expected TRADE_PAST ... $2)"; fi; }
    expect_past       I "2020-02-03"                             "surgeon applying an accepted trade on a past day is refused"
    expect_eq         J "status=applied 02-05p=s2"               "scheduler applies a past-day trade (past days are the scheduler's to change)"
    expect_past       K "2020-02-03"                             "surgeon accepting a pending trade on a past day is refused (trade_update_guard)"
    expect_eq         L "status=accepted"                        "scheduler accepts the same past-day trade"
    expect_eq         M "status=declined"                        "surgeon may still decline a past-day trade (only accept is gated)"
    # 2026-09-24 (Prompt 16 B6, sql/migrations/2026-09-24-definer-locks.sql): the time_off table lock (SHARE, seen in pg_locks after E committed) and the roster names.
    expect_eq         E2 "share_locks=1"                         "apply_trade holds SHARE on time_off (pg_locks, this backend) after E applied - a vacation inserted or edited concurrently waits (before the migration: share_locks=0)"
    expect_eq         N "from_name=Burchett to_name=Acton"       "trade_insert_guard writes the display names from the roster (the client sent Mallory / Eve; before the migration: from_name=Mallory to_name=Eve)"
    # 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit row apply_trade writes - actor_name + detail.summary.
    # E3 = E's two-way row applied by the surgeon (roster fallback: no display_name; ';' is flattened to a space by the probe's report, hence the two spaces);
    # F2 = F's one-way row applied by the scheduler (display_name 'Probe Scheduler'). Before the migration both read actor=null summary=null.
    expect_eq         E3 "actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 11 (from Acton  Acton takes Backup Wed Mar 13 in return)" "apply_trade's audit row names the actor (roster name) and carries the two-way summary"
    expect_eq         F2 "actor=Probe Scheduler summary=Trade applied: Burchett takes Primary Fri Mar 15 (from Acton, one-way)" "apply_trade's audit row takes the caller's display_name and carries the one-way summary"
    # 2026-09-24 (Prompt 19 give a day, sql/migrations/2026-09-24-give-kind.sql): shift_trade_requests.kind 'trade' | 'give'. Before the migration
    # GIVE_SETUP and every case naming kind read 'ERR column  kind  ... does not exist', P2 / T read TRADE_NOT_FOUND, T2 actor=null summary=null
    # and S3 rows=0 status=null (the probe header lists them); U, Q and Q3 are the same before and after. Q / Q3 (a member 'trade' with no or half
    # a return leg) stayed STORED under that file: the member return-leg refusal was split out into the follow-up
    # sql/migrations/2026-09-25-member-trade-return-leg.sql (old installed builds sent unit-tail rows without a return leg). That file is applied
    # (2026-09-27 00:43:01Z, the 24-hour gate; revision p) and its record step made the refused sentence the only grading of Q / Q3.
    expect_eq         GIVE_SETUP "ok"                          "the give fixtures insert (the kind column exists)"
    expect_eq         O "status=pending from=s2 kind=give return=null" "a member gives his own day with no return leg (kind 'give')"
    expect_eq         P "status=pending from=s2 kind=give"       "a member's give naming someone else's day lands FROM HIM (from forced, never refused at insert)"
    expect_eq         P2 "ERR TRADE_STALE: 2030-03-03 primary is no longer held by s2" "apply_trade refuses a give of a day the giver does not hold"
    expect_eq         Q "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead" "a member 'trade' without a return leg is refused (the return-leg follow-up, applied 2026-09-27)"
    expect_eq         Q3 "ERR TRADE_INELIGIBLE: a trade needs a return shift - pick the day and role you take in return, or give the day instead" "a member 'trade' with a half leg (return day, no return role) is refused (the return-leg follow-up, applied 2026-09-27)"
    expect_eq         Q2 "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift" "a member 'give' with a return leg is refused"
    expect_eq         Q4 "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift" "a member 'give' carrying only a return role is refused"
    expect_eq         R "ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade" "a member may not change kind on his own pending row"
    expect_eq         S "rows=0 kind=trade"                      "a member may not change kind on a row he is no party to (RLS filters it: 0 rows)"
    expect_eq         S2 "ERR TRADE_IMMUTABLE: only the scheduler may change the legs of a trade" "the receiver may not change kind on another person's row"
    expect_eq         S3 "rows=1 status=accepted"                "the receiver still ACCEPTS a pending give through the changed trade_update_guard"
    expect_eq         T "status=applied 03-25p=s2"               "the RECEIVER applies an accepted give (apply_trade unchanged)"
    expect_eq         T2 "actor=Burchett summary=Trade applied: Burchett takes Primary Mon Mar 25 (from Acton, one-way)" "the give's audit row reads the 5b one-way form"
    expect_eq         U "status=pending from=s3 return=null"     "the scheduler may still insert a one-way 'trade' (unchanged)"
    expect_eq         U2 "ERR TRADE_INELIGIBLE: a give is one-way - it carries no return shift" "a give with a return leg is refused for the scheduler too"
    expect_eq         U3 "status=pending from=s3 kind=give"      "the scheduler may insert a give (the same one-way move, labelled)"
  fi
  # Did it roll back? Count every kind of fixture the probe creates (all anon-readable or auth rows).
  LEFTOVER_SQL="select ((select count(*) from public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe') + (select count(*) from public.schedule_days where day between '2020-02-01' and '2020-02-29' and source = 'probe') + (select count(*) from public.shift_trade_requests where detail like 'probe %') + (select count(*) from public.time_off where note = 'probe') + (select count(*) from auth.users where email like 'probe-%@example.test') + (select count(*) from public.audit_log where action = 'trade.apply' and detail ->> 'trade_id' like '00000000-0000-4000-8000-0000000000%'))::int as leftover"
  r=$(q "$LEFTOVER_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then   # ::int, but tolerate a string-typed 0
    ok "probe persisted nothing (leftover count 0: schedule_days 2030-03 + 2020-02 / trades / time_off / auth.users / trade.apply audit rows)"
  else
    bad "probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.shift_trade_requests where detail like 'probe %';"
    echo "      delete from public.time_off where note = 'probe';"
    echo "      delete from public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe';"
    echo "      delete from public.schedule_days where day between '2020-02-01' and '2020-02-29' and source = 'probe';"
    echo "      delete from auth.users where email like 'probe-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP  (supabase CLI not linked at $WORKDIR)"
fi

echo "== 5c. PostgREST exposes shift_trade_requests.kind (anon; Prompt 19 give a day - the gate before the client push) =="
# The trade probe (5) runs SQL directly and never goes through PostgREST's schema cache, which the migration's
# `notify pgrst, 'reload schema'` refreshes. A client that sends `kind` before PostgREST knows the column fails every
# insert, so this anon read is the before / after signal: HTTP 400 42703 "column shift_trade_requests.kind does not
# exist" before sql/migrations/2026-09-24-give-kind.sql, HTTP 200 [] after it (anon reads no trade rows - RLS; limit=0).
line=$(curl -s -o $T/vr5c.json -w 'HTTP %{http_code}' "$URL/rest/v1/shift_trade_requests?select=kind&limit=0" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
echo "   $line  body: $(head -c 160 $T/vr5c.json)"
case "$line" in "HTTP 200") ok "PostgREST knows shift_trade_requests.kind (anon select=kind -> 200): the Prompt 19 client may send it";; *) bad "PostgREST does not expose shift_trade_requests.kind yet: $line (expected 200; 400 / 42703 = the give-kind migration is not applied or the schema cache is stale) - do NOT push the Prompt 19 client";; esac

echo "== 6. trade guards over REST (JWT-gated; SILVIS_SURGEON_JWT = a surgeon-role user's access token) =="
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  # 6a. insert with status 'accepted' as a surgeon -> lands as 'pending' (from_surgeon_id = the caller). It carries a return
  #     leg: once the Prompt 19 follow-up (sql/migrations/2026-09-25-member-trade-return-leg.sql) is applied, a member 'trade'
  #     without one is refused (TRADE_INELIGIBLE); with one, 6a passes before and after it.
  line=$(curl -s -o $T/vr6a.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/shift_trade_requests" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"from_surgeon_id":"s9x","to_surgeon_id":"s9test","day":"2030-03-20","role":"primary","return_day":"2030-03-22","return_role":"backup","status":"accepted","detail":"verify-rls.sh 6a probe"}')
  st=$(grep -oE '"status":"[a-z]+"' $T/vr6a.json | head -1)
  echo "   $line  $st  body: $(head -c 200 $T/vr6a.json)"
  if [ "$line" = "HTTP 201" ] && [ "$st" = '"status":"pending"' ]; then ok "surgeon POST with status 'accepted' lands as 'pending'"; else bad "surgeon POST with status 'accepted': $line $st"; fi
  tid=$(grep -oE '"id":"[0-9a-f-]{36}"' $T/vr6a.json | head -1 | cut -d'"' -f4)
  if [ -n "$tid" ]; then
    # cleanup: delete the row through the linked CLI (trade_read is `using (true)`, so a leftover row would
    # show in every user's trade list); members have no delete policy, so without the CLI the best the
    # proposer can do is cancel their own pending trade.
    if linked; then
      r=$(q "delete from public.shift_trade_requests where id = '$tid' and detail = 'verify-rls.sh 6a probe'")
      if [ "$(verdict "$r")" = "accepted" ]; then echo "   cleanup: 6a row deleted through the CLI"; else bad "6a cleanup delete failed: $(echo "$r" | tr -d '\n' | head -c 200)"; fi
    else
      curl -s -o /dev/null -w '   cleanup PATCH cancelled (no CLI; row stays as cancelled): HTTP %{http_code}\n' -X PATCH "$URL/rest/v1/shift_trade_requests?id=eq.$tid" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d '{"status":"cancelled"}'
    fi
  fi
  # 6b. apply_trade on the receiver's vacation day -> error. Fixtures need the CLI (postgres): the caller
  #     receives 2030-03-21 primary from the throwaway 's9test' while holding a time_off row that day.
  if linked; then
    sub=$(curl -s "$URL/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" | grep -oE '"id":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
    pid=$(curl -s "$URL/rest/v1/user_profiles?id=eq.$sub&select=person_id" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" | grep -oE '"person_id":"[^"]+"' | head -1 | cut -d'"' -f4)
    if [ -z "$sub" ] || [ -z "$pid" ]; then
      bad "6b: could not resolve the caller's roster id from the JWT (sub='$sub' person_id='$pid')"
    else
      TID6='00000000-0000-4000-8000-0000000000a6'
      q "delete from public.shift_trade_requests where id = '$TID6'; delete from public.time_off where person_id = '$pid' and note = 'verify-rls 6b'; delete from public.schedule_days where day = '2030-03-21';" >/dev/null
      r=$(q "insert into public.schedule_days (day, primary_id, source) values ('2030-03-21','s9test','verify-rls'); insert into public.shift_trade_requests (id, from_surgeon_id, to_surgeon_id, day, role, status, detail) values ('$TID6','s9test','$pid','2030-03-21','primary','accepted','verify-rls 6b'); insert into public.time_off (person_id, start_date, end_date, note, created_by) values ('$pid','2030-03-21','2030-03-21','verify-rls 6b','verify-rls');")
      if [ "$(verdict "$r")" != "accepted" ]; then
        bad "6b: fixture setup failed: $(echo "$r" | tr -d '\n' | head -c 200)"
      else
        line=$(curl -s -o $T/vr6b.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/apply_trade" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d "{\"p_trade_id\":\"$TID6\"}")
        echo "   $line  body: $(head -c 200 $T/vr6b.json)"
        if [ "$line" != "HTTP 200" ] && grep -q 'TRADE_INELIGIBLE' $T/vr6b.json && grep -q 'vacation' $T/vr6b.json; then ok "apply_trade on the receiver's vacation day is refused ($line TRADE_INELIGIBLE)"; else bad "apply_trade on a vacation day: $line $(head -c 120 $T/vr6b.json)"; fi
      fi
      q "delete from public.shift_trade_requests where id = '$TID6'; delete from public.time_off where person_id = '$pid' and note = 'verify-rls 6b'; delete from public.schedule_days where day = '2030-03-21';" >/dev/null
      echo "   cleanup done"
    fi
  else
    echo "   SKIP 6b (needs the linked supabase CLI for fixtures)"
  fi
else
  echo "   SKIP  (set SILVIS_SURGEON_JWT=<a surgeon-role user's access token> in the environment; no such user exists until invites go out)"
fi

echo "== 7. claim_open_slot (Prompt 13 part 2: a linked surgeon takes an OPEN slot) =="
# 7a. anon may not call it at all - no JWT needed. 404 = the function is not created yet (before the
#     migration); 401/403 = execute revoked from anon (after). A 400 here would mean anon reached the
#     body (CLAIM_NOT_LINKED): the revoke is missing. Nothing is written either way.
line=$(curl -s -o $T/vr7a.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/claim_open_slot" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"p_day":"2030-04-07","p_role":"backup"}')
echo "   7a anon rpc: $line  body: $(head -c 160 $T/vr7a.json)"
case "$line" in "HTTP 401"|"HTTP 403"|"HTTP 404") ok "anon rpc claim_open_slot refused ($line)";; *) bad "anon rpc claim_open_slot: $line (expected 401/403/404)";; esac
# 7b. the rolled-back probe (sql/probes/claim-open-slot-probe.sql): fixtures in 2030-04 plus a 2020-01-01 lower
#     bound, throwaway auth users probe-claim-<uuid>@example.test linked to s3 (surgeon) / s1 (scheduler), and
#     the same 'PROBE_RESULTS ...;END' sentinel as section 5. Expectations are the AFTER-migration picture;
#     before it every case but L reads 'ERR 42883 function public.claim_open_slot(date, unknown) does not exist'.
#     The rollback is then OBSERVED: a leftover count over every row the probe or the function writes must be 0.
if linked; then
  CPROBE="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/claim-open-slot-probe.sql"   # absolute path for the CLI (pwd -W = Windows form under Git Bash)
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$CPROBE" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "claim probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results" | tr ';' '\n' | sed 's/^/   /'
    case_val()    { echo "$results" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq()   { v=$(case_val "$1"); [ "$v" = "$2" ] && ok "claim probe $1: $3" || bad "claim probe $1: $3 (got '$v', expected '$2')"; }
    expect_code() { v=$(case_val "$1"); case "$v" in "ERR $2 $3"*) ok "claim probe $1: $4 ($2 $3)";; *) bad "claim probe $1: $4 (got '$v', expected 'ERR $2 $3 ...')";; esac; }
    expect_code A  42501 "permission denied for function claim_open_slot" "anon (role anon, no jwt sub) cannot execute the function"
    expect_eq   B  "ok version=2 backup=s3 source=claim audit=1 notif=Acton took 4/7 backup" "linked surgeon claims an open unlocked backup: version 2, source claim, audit row, feed row titled '<Name> took 4/7 backup'"
    # 2026-09-24 (Prompt 16 B6, sql/migrations/2026-09-24-definer-locks.sql): the time_off table lock (SHARE, seen in pg_locks after B committed).
    expect_eq   B2 "share_locks=1" "claim_open_slot holds SHARE on time_off (pg_locks, this backend) after B claimed - a vacation inserted or edited concurrently waits (before the migration: share_locks=0)"
    # 2026-09-24 (Prompt 16 follow-up 5b, sql/migrations/2026-09-24-trade-audit-names.sql): the audit row B wrote carries detail.summary = the feed title (before the migration: actor=Acton summary=null).
    expect_eq   B3 "actor=Acton summary=Acton took 4/7 backup" "claim_open_slot's audit row names the actor (roster name) and carries the summary '<Name> took <M/D> <role>'"
    expect_code C  CL005 CLAIM_HELD          "held slot is refused"
    expect_code D  CL007 CLAIM_LOCKED        "locked slot is refused"
    expect_code E  CL003 CLAIM_PAST          "past day (2020-01-01, inside the range) is refused - PAST is checked before RANGE"
    expect_code F  CL006 CLAIM_EXTERNAL      "primary under external cover is refused"
    expect_code G  CL008 CLAIM_OTHER_ROLE    "caller already holding the other role that day is refused"
    expect_code H  CL009 CLAIM_VACATION      "vacation on the day is refused"
    expect_code I  CL009 CLAIM_VACATION      "PRIMARY the day before a vacation start is refused (trailing edge)"
    expect_eq   I2 "ok version=2 backup=s3" "BACKUP the day before a vacation start is allowed"
    expect_code J  CL004 CLAIM_OUTSIDE_RANGE "day after max(day) is refused"
    expect_eq   K  "ok version=2 backup=s3 source=claim" "day inside the range with NO row gets a row (source claim) and the claim succeeds"
    expect_eq   L  "ok rows=1 primary=s4" "scheduler's direct schedule_days update (day-editor path) is untouched"
  fi
  # Did it roll back? Count every kind of row the probe creates or the function writes.
  LEFTOVER7_SQL="select ((select count(*) from public.schedule_days where day between '2030-04-01' and '2030-04-30' or day = '2020-01-01') + (select count(*) from public.time_off where note = 'probe-claim') + (select count(*) from auth.users where email like 'probe-claim-%@example.test') + (select count(*) from public.audit_log where action = 'schedule.claim' and detail ->> 'day' like '2030-04-%') + (select count(*) from public.notifications where type = 'shift_claimed' and data ->> 'day' like '2030-04-%'))::int as leftover"
  r=$(q "$LEFTOVER7_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "claim probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then   # ::int, but tolerate a string-typed 0
    ok "claim probe persisted nothing (leftover count 0: schedule_days 2030-04 + 2020-01-01 / time_off / auth.users / audit_log / notifications)"
  else
    bad "claim probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.notifications where type = 'shift_claimed' and data ->> 'day' like '2030-04-%';"
    echo "      delete from public.audit_log where action = 'schedule.claim' and detail ->> 'day' like '2030-04-%';"
    echo "      delete from public.time_off where note = 'probe-claim';"
    echo "      delete from public.schedule_days where day between '2030-04-01' and '2030-04-30' or day = '2020-01-01';"
    echo "      delete from auth.users where email like 'probe-claim-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 7b (supabase CLI not linked at $WORKDIR)"
fi
# 7c-7e. over REST as a linked SURGEON (SILVIS_SURGEON_JWT). Only refusals are exercised: a successful claim over
#        REST would be a real, persisted schedule change. 7c and 7d need no fixture and write nothing.
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  line=$(curl -s -o $T/vr7c.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/claim_open_slot" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d '{"p_day":"2020-01-01","p_role":"backup"}')
  echo "   7c past day: $line  body: $(head -c 200 $T/vr7c.json)"
  if [ "$line" != "HTTP 200" ] && grep -q 'CLAIM_PAST' $T/vr7c.json; then ok "surgeon claim of a past day is refused ($line CLAIM_PAST)"; else bad "surgeon claim of a past day: $line $(head -c 120 $T/vr7c.json)"; fi
  line=$(curl -s -o $T/vr7d.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/claim_open_slot" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d '{"p_day":"2030-04-07","p_role":"observer"}')
  echo "   7d bad role: $line  body: $(head -c 200 $T/vr7d.json)"
  if [ "$line" != "HTTP 200" ] && grep -q 'CLAIM_BAD_ROLE' $T/vr7d.json; then ok "surgeon claim with an unknown role is refused ($line CLAIM_BAD_ROLE)"; else bad "surgeon claim with an unknown role: $line $(head -c 120 $T/vr7d.json)"; fi
  # 7e. a HELD slot (fixture through the CLI: 2030-04-20 backup held by the throwaway 's9test'); deleted afterwards
  #     BY DAY ALONE (nothing real lives on 2030-04-20): if the REST claim ever succeeded - the failure this case
  #     exists to catch - the row's source becomes 'claim' and a source-filtered delete would leave it behind.
  if linked; then
    q "delete from public.schedule_days where day = '2030-04-20';" >/dev/null
    r=$(q "insert into public.schedule_days (day, backup_id, source) values ('2030-04-20','s9test','verify-rls');")
    if [ "$(verdict "$r")" != "accepted" ]; then
      bad "7e: fixture setup failed: $(echo "$r" | tr -d '\n' | head -c 200)"
    else
      line=$(curl -s -o $T/vr7e.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/claim_open_slot" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d '{"p_day":"2030-04-20","p_role":"backup"}')
      echo "   7e held slot: $line  body: $(head -c 200 $T/vr7e.json)"
      if [ "$line" != "HTTP 200" ] && grep -q 'CLAIM_HELD' $T/vr7e.json; then ok "surgeon claim of a held slot is refused ($line CLAIM_HELD)"; else bad "surgeon claim of a held slot: $line $(head -c 120 $T/vr7e.json)"; fi
    fi
    # The cleanup is verified, never assumed: a stray 2030-04-20 row widens the published range (min(day)..max(day))
    # that claim_open_slot and the Open shifts board use, and trips the claim probe's PROBE_SETUP guard.
    r=$(q "delete from public.schedule_days where day = '2030-04-20';")
    if [ "$(verdict "$r")" = "accepted" ]; then
      echo "   cleanup done"
    else
      bad "7e cleanup delete failed - a stray 2030-04-20 row widens the published range; delete it by hand: $(echo "$r" | tr -d '\n' | head -c 200)"
    fi
  else
    echo "   SKIP 7e (needs the linked supabase CLI for the fixture)"
  fi
else
  echo "   SKIP 7c-7e (set SILVIS_SURGEON_JWT=<a surgeon-role user's access token> in the environment; no such user exists until invites go out)"
fi

echo "== 8. offers + periods (Prompt 14 part 1): anon sees nothing, anon cannot insert, JWT own row, rolled-back probe =="
# call_offers / call_periods are authenticated-read only (never anon: offers carry person ids + free-text notes).
# RLS-SILENT-READ CAVEAT: an RLS-blocked anon read is NOT an error - PostgREST answers 200 + [] - so a 200 alone proves
# nothing. The assertion is the exact row count anon can see, asked for with `Prefer: count=exact` and read from the
# Content-Range header: it must be */0. A 401/403 would also mean "anon cannot read" and is accepted.
for t in call_offers call_periods; do
  hdr=$(curl -s -D - -o $T/vr8_$t.json "$URL/rest/v1/$t?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Prefer: count=exact")
  code=$(echo "$hdr" | grep -oE '^HTTP/[0-9.]+ [0-9]+' | head -1 | awk '{print $2}')
  range=$(echo "$hdr" | grep -i '^content-range:' | tr -d '\r' | awk '{print $2}')
  echo "   anon GET $t -> HTTP $code  Content-Range: ${range:-<none>}  body: $(head -c 120 $T/vr8_$t.json)"
  case "$code" in
    200) if [ "$range" = "*/0" ]; then ok "anon sees 0 rows of $t (200 + [] with count=exact -> Content-Range */0)"; else bad "anon read of $t: 200 with Content-Range '$range' (expected */0 - RLS must hide every row from anon)"; fi;;
    401|403) ok "anon read of $t refused (HTTP $code)";;
    *) bad "anon read of $t: HTTP ${code:-<none>}";;
  esac
done
line=$(curl -s -o $T/vr8b.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/call_offers" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"person_id":"s9test","day":"2030-06-20","role_pref":"either","entered_by":"s9test","source":"app"}')
echo "   anon POST call_offers -> $line  body: $(head -c 160 $T/vr8b.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon insert into call_offers refused ($line)";;
  *) if grep -q '42501' $T/vr8b.json; then ok "anon insert into call_offers refused (42501)"; else bad "anon insert into call_offers: $line (expected 401/403 or 42501)"; fi;;
esac
if [ -n "${SILVIS_JWT:-}" ]; then
  # 8c. own-row insert as the JWT's roster id (a scheduler passes either way), then DELETE by id and confirm it is gone.
  #     The fixture day 2030-07-21 sits OUTSIDE the probe's leftover window (8e counts call_offers 2030-05-01..2030-06-30),
  #     so a failed 8c DELETE is reported here, never misread as "the probe did not roll back".
  sub8=$(curl -s "$URL/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" | grep -oE '"id":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
  pid8=$(curl -s "$URL/rest/v1/user_profiles?id=eq.$sub8&select=person_id" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" | grep -oE '"person_id":"[^"]+"' | head -1 | cut -d'"' -f4)
  if [ -z "$sub8" ] || [ -z "$pid8" ]; then
    bad "8c: could not resolve the caller's roster id from SILVIS_JWT (sub='$sub8' person_id='$pid8')"
  else
    line=$(curl -s -o $T/vr8c.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/call_offers" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"person_id\":\"$pid8\",\"day\":\"2030-07-21\",\"role_pref\":\"either\",\"entered_by\":\"$pid8\",\"source\":\"app\",\"note\":\"verify-rls.sh 8c probe\"}")
    echo "   JWT POST call_offers (own row $pid8, 2030-07-21) -> $line  body: $(head -c 160 $T/vr8c.json)"
    case "$line" in "HTTP 201") ok "JWT own-row insert into call_offers returns 201";; *) bad "JWT own-row insert into call_offers: $line";; esac
    oid=$(grep -oE '"id":"[0-9a-f-]{36}"' $T/vr8c.json | head -1 | cut -d'"' -f4)
    if [ -n "$oid" ]; then
      del=$(curl -s -o /dev/null -w 'HTTP %{http_code}' -X DELETE "$URL/rest/v1/call_offers?id=eq.$oid" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT")
      left=$(curl -s "$URL/rest/v1/call_offers?id=eq.$oid&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT")
      echo "   cleanup DELETE by id: $del  still there: $left"
      [ "$left" = "[]" ] && ok "8c row deleted (read back as [])" || bad "8c row NOT deleted: $left  (delete it: delete from public.call_offers where id = '$oid')"
    else
      echo "   (no id in the response; nothing to clean up)"
    fi
    # 8d. offer_modes over REST (needs sql/migrations/2026-09-23-offer-modes.sql applied): a period with a mode map is
    #     stored and read back; a non-object is refused by the check constraint (23514); the row is deleted by id.
    line=$(curl -s -o $T/vr8d.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/call_periods" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d "{\"label\":\"verify-rls 8d\",\"start_day\":\"2030-08-01\",\"end_day\":\"2030-08-31\",\"offers_close_at\":\"2030-06-20\",\"publish_by\":\"2030-07-04\",\"status\":\"upcoming\",\"created_by\":\"verify-rls\",\"offer_modes\":{\"$pid8\":\"preferred\"}}")
    echo "   JWT POST call_periods with offer_modes -> $line  body: $(head -c 200 $T/vr8d.json)"
    if [ "$line" = "HTTP 201" ] && grep -q "\"offer_modes\":{\"$pid8\":\"preferred\"}" $T/vr8d.json; then ok "offer_modes stored and read back over REST"; elif grep -q '42703' $T/vr8d.json; then bad "offer_modes column missing live: apply sql/migrations/2026-09-23-offer-modes.sql first"; else bad "offer_modes insert: $line $(head -c 120 $T/vr8d.json)"; fi
    pid8d=$(grep -oE '"id":"[0-9a-f-]{36}"' $T/vr8d.json | head -1 | cut -d'"' -f4)
    line=$(curl -s -o $T/vr8e.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/call_periods" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" -H "Content-Type: application/json" -d '{"label":"verify-rls 8d bad","start_day":"2030-09-01","end_day":"2030-09-30","offers_close_at":"2030-07-20","publish_by":"2030-08-04","status":"upcoming","created_by":"verify-rls","offer_modes":["s1"]}')
    echo "   JWT POST call_periods with offer_modes = array -> $line  body: $(head -c 160 $T/vr8e.json)"
    if [ "$line" != "HTTP 201" ] && grep -q '23514' $T/vr8e.json; then ok "a non-object offer_modes is refused (23514 call_periods_offer_modes_object)"; else bad "non-object offer_modes: $line $(head -c 120 $T/vr8e.json)"; fi
    for lbl in "verify-rls%208d" "verify-rls%208d%20bad"; do
      del=$(curl -s -o /dev/null -w 'HTTP %{http_code}' -X DELETE "$URL/rest/v1/call_periods?label=eq.$lbl" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT")
      echo "   cleanup DELETE call_periods label=$lbl: $del"
    done
    left=$(curl -s "$URL/rest/v1/call_periods?label=like.verify-rls*&select=id" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT")
    [ "$left" = "[]" ] && ok "8d periods deleted (read back as [])" || bad "8d periods NOT deleted: $left  (id from the 201: ${pid8d:-<none>})"
  fi
else
  echo "   SKIP 8c/8d (set SILVIS_JWT=<scheduler access token> in the environment to run the authenticated checks)"
fi
# 8e. sql/probes/offers-probe.sql: fixtures in 2030-05 / 2030-06 + throwaway auth users, acts as a surgeon / the
#     scheduler / anon, ends with RAISE 'PROBE_RESULTS ...;END' so the whole batch rolls back. Expectations are the
#     picture AFTER sql/migrations/2026-09-23-offer-modes.sql (the probe header lists BEFORE for the K cases).
if linked; then
  PROBE8="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/offers-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE8" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "offers probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results8=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results8" | tr ';' '\n' | sed 's/^/   /'
    case_val8()     { echo "$results8" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq8()    { v=$(case_val8 "$1"); [ "$v" = "$2" ] && ok "offers probe $1: $3" || bad "offers probe $1: $3 (got '$v', expected '$2')"; }
    expect_err8()   { v=$(case_val8 "$1"); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -q -- "$3"; then ok "offers probe $1: $4"; else bad "offers probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    # expect_ok8: the value starts with 'ok ' and carries both substrings - used where the exact text would embed jsonb
    # quotes (K-set) that a CLI might escape in its error text; a false negative there would fail a working column.
    expect_ok8()    { v=$(case_val8 "$1"); if echo "$v" | grep -q '^ok ' && echo "$v" | grep -qF -- "$2" && echo "$v" | grep -qF -- "$3"; then ok "offers probe $1: $4"; else bad "offers probe $1: $4 (got '$v', expected ok ... $2 ... $3)"; fi; }
    expect_err8  A        OF001 "OFFER_PAST: 2020-01-01 is before today"                    "a past day is refused (OF001)"
    expect_err8  B        OF002 "OFFER_ON_VACATION: 2030-06-11 is inside a vacation of s3"  "a day inside the person's vacation is refused (OF002)"
    expect_eq8   C        "ok rows=1"                                                       "a surgeon inserts their own future offer"
    expect_err8  D        42501 "row-level security"                                        "a surgeon cannot write another surgeon's offer (RLS)"
    expect_eq8   E        "ok updated=1"                                                    "a surgeon updates their own row"
    expect_err8  F        OF003 "OFFER_FROZEN: offers for probe frozen closed on 2026-09-01" "a surgeon's insert inside a frozen period is refused (OF003)"
    expect_eq8   G        "ok rows=1 status=submitted"                                      "the scheduler may enter a late offer (email-relay); offer_status reads submitted"
    expect_err8  H        OF003 "OFFER_FROZEN: offers for probe frozen closed on 2026-09-01" "a surgeon's delete inside a frozen period is refused (OF003)"
    expect_eq8   I-read   "rows=0"                                                          "anon reads 0 rows (RLS-silent, no error)"
    expect_err8  I-insert 42501 "row-level security"                                        "anon cannot insert"
    expect_eq8   J        "s2=not_started s6=rules_only s3=submitted"                       "derived statuses not_started / rules_only / submitted"
    expect_ok8   K-set    'modes={' 's2=exhaustive s3=absent'                               "offer_modes is stored and read back (absent key = preferred, read by the client)"
    expect_err8  K-type   23514 "call_periods_offer_modes_object"                           "a non-object offer_modes is refused by the check constraint"
    expect_eq8   K-default "modes={}"                                                       "a period inserted without offer_modes reads {}"
  fi
  # Did it roll back? Count every kind of fixture the probe creates.
  LEFTOVER8_SQL="select ((select count(*) from public.call_offers where day between '2030-05-01' and '2030-06-30') + (select count(*) from public.call_periods where label in ('probe frozen', 'probe modes')) + (select count(*) from public.time_off where note = 'probe offers') + (select count(*) from auth.users where email like 'probe-offers-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER8_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "offers probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "offers probe persisted nothing (leftover count 0: call_offers 2030-05/06 / probe periods / time_off / auth.users)"
  else
    bad "offers probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.call_offers where day between '2030-05-01' and '2030-06-30';"
    echo "      delete from public.call_periods where label in ('probe frozen', 'probe modes');"
    echo "      delete from public.time_off where note = 'probe offers';"
    echo "      delete from auth.users where email like 'probe-offers-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 8e (supabase CLI not linked at $WORKDIR)"
fi

echo "== 9. east_vacation_reviews (Prompt 15 part 2: the away/home decision per mirrored East vacation range) =="
# 9a. anon READ. The table has no anon policy, so an anon GET is a silent HTTP 200 + [] - exactly the
#     Davenport-lesson shape; the probe (9c) is what proves rows exist and stay invisible. Before the
#     migration the table is missing and PostgREST answers 404 (accepted, named). A 200 with a non-empty
#     body means anon can read decisions: FAIL.
line=$(curl -s -o $T/vr9a.json -w 'HTTP %{http_code}' "$URL/rest/v1/east_vacation_reviews?select=person_id,start,end,decision&limit=5" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
body9a=$(tr -d ' \n\r' < $T/vr9a.json)
echo "   9a anon GET: $line  body: $(head -c 160 $T/vr9a.json)"
case "$line" in
  "HTTP 200") if [ "$body9a" = "[]" ]; then ok "anon read of east_vacation_reviews is a silent empty list (no anon policy)"; else bad "anon read of east_vacation_reviews returned rows: $(head -c 120 $T/vr9a.json)"; fi;;
  "HTTP 404") ok "east_vacation_reviews not created yet (404 - before the migration); apply sql/migrations/2026-09-23-east-vacation-reviews.sql";;
  *) bad "anon read of east_vacation_reviews: $line (expected 200 + [] after the migration, 404 before)";;
esac
# 9b. anon WRITE (nothing can land: no anon insert policy; 404 before the migration)
line=$(curl -s -o $T/vr9b.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/east_vacation_reviews" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"person_id":"s9test","start":"2030-05-01","end":"2030-05-02","decision":"home","decided_by":"verify-rls"}')
echo "   9b anon POST: $line  body: $(head -c 160 $T/vr9b.json)"
case "$line" in "HTTP 401"|"HTTP 403"|"HTTP 404") ok "anon write to east_vacation_reviews blocked ($line)";; *) bad "anon write to east_vacation_reviews: $line (expected 401/403; 404 before the migration)";; esac
# 9c. the rolled-back probe (sql/probes/east-vacation-reviews-probe.sql): fixtures in 2030-05 (decided_by
#     'probe-eastvac'), throwaway auth users probe-eastvac-<uuid>@example.test linked to s3 (surgeon) / s1
#     (scheduler), the same 'PROBE_RESULTS ...;END' sentinel as sections 5 and 7. Expectations are the
#     AFTER-migration picture; before it the setup raises PROBE_SETUP (no table) and this reports no sentinel.
#     The rollback is then OBSERVED: a leftover count over the fixture rows and the auth users must be 0.
if linked; then
  VPROBE="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/east-vacation-reviews-probe.sql"   # absolute path for the CLI (pwd -W = Windows form under Git Bash)
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$VPROBE" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "east-vacation-reviews probe reported no sentinel-terminated PROBE_RESULTS (table missing - apply the migration first - or a setup error: $(echo "$out" | head -c 400))"
  else
    results=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results" | tr ';' '\n' | sed 's/^/   /'
    case_val()    { echo "$results" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq()   { v=$(case_val "$1"); [ "$v" = "$2" ] && ok "eastvac probe $1: $3" || bad "eastvac probe $1: $3 (got '$v', expected '$2')"; }
    expect_code() { v=$(case_val "$1"); case "$v" in "ERR $2 "*) ok "eastvac probe $1: $3 ($2)";; *) bad "eastvac probe $1: $3 (got '$v', expected 'ERR $2 ...')";; esac; }
    expect_eq   A1 "rows=0"                              "anon sees none of the fixture rows (RLS: silent, not an error)"
    expect_code A2 42501                                 "anon insert is refused by RLS"
    expect_eq   B  "ok visible=3"                        "a linked surgeon inserts his own review and reads every row (authenticated read-all)"
    expect_code C  42501                                 "a surgeon cannot review someone else's range"
    expect_eq   D  "updated=0 decision=home"             "a surgeon's update of someone else's row touches nothing (USING filter, silent)"
    expect_eq   E  "deleted=0"                           "a surgeon's delete of someone else's row touches nothing"
    expect_eq   F  "updated=1 decision=home"             "a surgeon updates his own row"
    expect_eq   G  "updated=1 decision=away deleted=1"   "the scheduler updates and deletes anyone's row"
    expect_code H  23514                                 "decision outside away/home is refused by the check constraint"
    expect_code I  23505                                 "a second review of the same exact range is refused by the unique constraint"
    expect_code J  23514                                 "end before start is refused by the check constraint"
  fi
  LEFTOVER9_SQL="select ((select count(*) from public.east_vacation_reviews where decided_by = 'probe-eastvac') + (select count(*) from auth.users where email like 'probe-eastvac-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER9_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "eastvac probe leftover count could not be read (table missing before the migration is expected): $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then   # ::int, but tolerate a string-typed 0
    ok "eastvac probe persisted nothing (leftover count 0: east_vacation_reviews probe-eastvac rows / auth.users)"
  else
    bad "eastvac probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.east_vacation_reviews where decided_by = 'probe-eastvac';"
    echo "      delete from auth.users where email like 'probe-eastvac-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 9c (supabase CLI not linked at $WORKDIR)"
fi
# 9d. authenticated READ over REST as a linked SURGEON (SILVIS_SURGEON_JWT): a 200 with an array. Read only -
#     a REST write here would be a real, persisted decision.
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  line=$(curl -s -o $T/vr9d.json -w 'HTTP %{http_code}' "$URL/rest/v1/east_vacation_reviews?select=person_id,start,end,decision&limit=5" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT")
  echo "   9d surgeon GET: $line  body: $(head -c 160 $T/vr9d.json)"
  if [ "$line" = "HTTP 200" ] && head -c 1 $T/vr9d.json | grep -q '\['; then ok "a linked surgeon reads east_vacation_reviews ($line, array)"; else bad "surgeon read of east_vacation_reviews: $line $(head -c 120 $T/vr9d.json)"; fi
else
  echo "   SKIP 9d (set SILVIS_SURGEON_JWT=<a surgeon-role user's access token> in the environment; no such user exists until invites go out)"
fi

echo "== 10. pre-launch RLS (Prompt 16 A1): profiles / contacts / feed / audit / email pin / offer immutability / freeze by status / offer_status grant =="
# sql/migrations/2026-09-24-prelaunch-rls.sql (report-first; applied only after Faraz's go). Client reads checked for
# a) user_profiles_read and b) contacts_read - the reads the new policies must not turn into a silent 200 + [] (file:line
# as of build 2026.09.23n; test/schema.test.js pins the same gates against the source):
#   index-source.html:656   fetchProfile           user_profiles?id=eq.<own uid>                 own row - readable by everyone
#   index-source.html:1077  schedulerIdsLoud       user_profiles?...&role=in.(scheduler,admin)   those rows stay readable to every signed-in user
#   index-source.html:874   loadClientVersions     user_profiles?select=*                        called only at :904 (view settings && isScheduler)
#   index-source.html:2077  loadAllProfilesLoud    user_profiles?select=*                        called only at :2115 (view setup && isAdmin); saveUserProfile :2088 refuses a non-admin
#   index-source.html:3272  office_contacts?select=*                                             the effect returns at :3269 unless isScheduler
#   index-source.html:828   logAudit               audit_log.actor_id = userProfile.person_id     what audit_insert now requires of a non-scheduler
#   index-source.html:2786  addNotification        notifications insert                          reached only from linked-person / scheduler actions
#   scripts/verify-rls.sh:157 and :300             user_profiles?id=eq.<own uid>&select=person_id own row
#   edge-functions/*        read user_profiles / office_contacts with the service role (RLS bypassed) - unaffected
# 10a. anon may not execute offer_status(uuid, text). 401/403 = the grant is revoked (after). A 200 = anon still runs it
#      (before: it answers "not_started" - anon sees no offers). Nothing is written either way.
line=$(curl -s -o $T/vr10a.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/offer_status" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"p_period":"00000000-0000-0000-0000-000000000000","p_person":"s3"}')
echo "   10a anon rpc offer_status: $line  body: $(head -c 160 $T/vr10a.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon rpc offer_status refused ($line - execute revoked from anon)";;
  "HTTP 200") bad "anon can still execute offer_status ($line, body $(head -c 60 $T/vr10a.json)) - apply sql/migrations/2026-09-24-prelaunch-rls.sql";;
  *) bad "anon rpc offer_status: $line (expected 401/403)";;
esac
# 10b. the client gates for a) / b), read from the source (a regression here would make the new policies 200 + [] a live read)
n10=$(grep -n 'rest/v1/office_contacts?select=\*' index-source.html | head -1 | cut -d: -f1)
if [ -n "$n10" ] && sed -n "$((n10-4)),${n10}p" index-source.html | grep -q 'if (!loaded || !isScheduler) return;'; then ok "client: the office_contacts read (index-source.html:$n10) is behind the isScheduler gate"; else bad "client: the office_contacts read is not behind 'if (!loaded || !isScheduler) return;' (line ${n10:-?})"; fi
if grep -q 'if (view === "settings" && isScheduler) { loadAudit(); loadSnapshots(); loadClientVersions(); }' index-source.html && grep -q 'if (view === "setup" && isAdmin) loadAllProfilesLoud();' index-source.html; then ok "client: both whole-table user_profiles reads are role-gated (loadClientVersions: isScheduler; loadAllProfilesLoud: isAdmin)"; else bad "client: a whole-table user_profiles read lost its role gate"; fi
if grep -q 'user_profiles?select=person_id,role&role=in.(scheduler,admin)&person_id=not.is.null' index-source.html; then ok "client: schedulerIdsLoud reads scheduler/admin rows only (kept readable for every signed-in user)"; else bad "client: schedulerIdsLoud no longer filters to role=in.(scheduler,admin)"; fi
# 10c. sql/probes/prelaunch-rls-probe.sql: three throwaway users (stranger / surgeon s3 / admin s1), fixtures in 2030-07 keyed
#      'probe-prelaunch', acts as each of them and as anon, ends with RAISE 'PROBE_RESULTS ...;END' so everything rolls back.
#      Expectations are the AFTER-migration picture; the probe header lists the BEFORE string of every case (the holes).
#      L4 inserts the surgeon's audit row WITHOUT RETURNING, so it never asked for the read-back the client's db.insert does
#      (Prefer: return=representation) - the gap Acton's 9/24 vacations fell into; section 13 (Prompt 21 step 1) probes that shape.
if linked; then
  PROBE10="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/prelaunch-rls-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE10" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "prelaunch probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results10=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results10" | tr ';' '\n' | sed 's/^/   /'
    case_val10()   { echo "$results10" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq10()  { v=$(case_val10 "$1"); [ "$v" = "$2" ] && ok "prelaunch probe $1: $3" || bad "prelaunch probe $1: $3 (got '$v', expected '$2')"; }
    # expect_err10: the CLI escapes the quotes around identifiers in its error text ("table \"x\""), so the value is unescaped first
    expect_err10() { v=$(case_val10 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "prelaunch probe $1: $4"; else bad "prelaunch probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    expect_eq10  S1  "own=1 leak=0 sched_ok=t"                       "a stranger (unlinked viewer) reads own row + scheduler/admin rows, no other row"
    expect_eq10  S2  "contacts=0"                                     "a stranger reads no office contact"
    expect_err10 S3  42501 'row-level security policy for table "notifications"' "a stranger cannot insert into the feed"
    expect_err10 S4  42501 'row-level security policy for table "audit_log"'     "a stranger cannot insert into the audit log"
    expect_eq10  L1  "own=1 leak=0 sched_ok=t"                       "a linked surgeon reads own row + scheduler/admin rows, no other row"
    expect_eq10  L2  "contacts=0"                                     "a linked surgeon reads no office contact"
    expect_eq10  L3  "ok"                                             "a linked surgeon inserts a notification"
    expect_eq10  L4  "ok"                                             "a linked surgeon writes an audit row as himself (actor_id = his roster id)"
    expect_err10 L5  42501 'row-level security policy for table "audit_log"'     "a linked surgeon cannot write an audit row as someone else"
    expect_err10 L6  42501 'row-level security policy for table "user_profiles"' "a surgeon cannot change his own email (pinned)"
    expect_eq10  L7  "updated=1"                                      "a surgeon still changes his own display_name"
    expect_eq10  L8  "deleted=0"                                      "a surgeon's delete of a notification touches nothing (no policy: silent)"
    expect_err10 L9  OF004 "OFFER_IMMUTABLE"                          "a surgeon's UPDATE may not move an offer to another day"
    expect_err10 L10 OF004 "OFFER_IMMUTABLE"                          "a surgeon's UPDATE may not re-point an offer to another person"
    expect_eq10  L11 "updated=1"                                      "a surgeon's UPDATE of role_pref alone is fine"
    expect_err10 L12 OF003 "closed on 2030-06-20"                     "insert inside a PUBLISHED period whose close date lies ahead is refused (freeze by status)"
    expect_err10 L13 OF003 "closed on 2030-06-20"                     "delete inside a PUBLISHED period whose close date lies ahead is refused (freeze by status)"
    expect_eq10  L14 "ok rows=1"                                      "insert inside an upcoming period is fine"
    expect_err10 L15 OM005 "MODE_FROZEN"                              "set_offer_mode on a published period was already refused (control)"
    expect_eq10  A1  "own=1 sees_surgeon=1 sees_stranger=1"          "the admin reads every profile"
    expect_eq10  A2  "contacts=1"                                     "the admin reads office contacts"
    expect_eq10  A3  "ok deleted=3"                                   "the admin inserts a notification and deletes the probe's three (notif_delete_sched)"
    expect_eq10  A4  "ok"                                             "the admin writes an audit row for another actor"
    expect_eq10  A5  "updated=1"                                      "the admin corrects a surgeon's email (user_profiles_admin, unchanged)"
    expect_eq10  A6  "updated=1"                                      "the admin moves a surgeon's offer to another day"
    expect_eq10  A7  "ok rows=1"                                      "the admin enters a late offer inside the published period (email relay)"
    expect_err10 N1  42501 "permission denied for function offer_status" "anon cannot execute offer_status()"
  fi
  LEFTOVER10_SQL="select ((select count(*) from public.office_contacts where name = 'probe-prelaunch') + (select count(*) from public.notifications where title = 'probe-prelaunch') + (select count(*) from public.audit_log where action = 'probe.prelaunch') + (select count(*) from public.call_offers where note = 'probe-prelaunch') + (select count(*) from public.call_periods where label like 'probe prelaunch%') + (select count(*) from auth.users where email like 'probe-prelaunch-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER10_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "prelaunch probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "prelaunch probe persisted nothing (leftover count 0: office_contacts / notifications / audit_log / call_offers / call_periods / auth.users)"
  else
    bad "prelaunch probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.call_offers where note = 'probe-prelaunch';"
    echo "      delete from public.call_periods where label like 'probe prelaunch%';"
    echo "      delete from public.audit_log where action = 'probe.prelaunch';"
    echo "      delete from public.notifications where title = 'probe-prelaunch';"
    echo "      delete from public.office_contacts where name = 'probe-prelaunch';"
    echo "      delete from auth.users where email like 'probe-prelaunch-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 10c (supabase CLI not linked at $WORKDIR)"
fi

echo "== 11. coordinator role (Prompt 16 A7): office users - vacations / availability / offers relay, no scheduler power =="
# sql/migrations/2026-09-24-coordinator-role.sql (report-first; applied by the orchestrator after A1). Nothing here writes
# over REST. 11a checks the client gates the new role reads on (the Activity log read for a coordinator is
# audit_read_coord: own rows in the timeoff. / offers. / availability. families - a wider read would be a silent 200 + [];
# since Prompt 21 step 1 audit_read_own also answers its own rows outside the families, and still no one else's).
# 11b runs sql/probes/coordinator-probe.sql: three throwaway users (coordinator / surgeon s3 / admin s1), fixtures in
# 2030-08 keyed 'probe-coord', acts as each of them, ends with RAISE 'PROBE_RESULTS ...;END' so everything rolls back.
# Expectations are the AFTER-migration picture; BEFORE it the fixture setup raises PROBE_SETUP (no coordinator role) and
# this section reports no sentinel - which IS the before picture. C21 grades the picture after
# sql/migrations/2026-09-25-audit-read-own.sql (Prompt 21 step 1): own_other=1 - the coordinator reads its own 'probe.coord'
# row through audit_read_own. Until that file is applied C21 reads own_other=0 and is RED here (expected; section 13 is the
# same apply's own probe). The 24-hour gate runs the 33e529d copy of this file, which still expects own_other=0.
# 11a. client gates (read from the source)
if grep -q 'const isCoordinator = userProfile?.role === "coordinator";' index-source.html && grep -q 'if (view === "settings" && isCoordinator) loadAudit();' index-source.html; then ok "client: isCoordinator is derived from user_profiles.role and the coordinator's Activity log read is its own gated effect (audit_read_coord / audit_read_own answer its own rows only)"; else bad "client: the coordinator role flag or its Activity log effect is missing from index-source.html"; fi
if grep -qE '\{!isPublicMode && isUnlinked && !isCoordinator( && !isViewer)? && \(' index-source.html; then ok "client: the unlinked-account banner is not shown to a coordinator (an office account has no roster link by design)"; else bad "client: the unlinked banner is not gated off for a coordinator"; fi
if grep -q 'created_by: userProfile?.person_id || authUser?.id || null,' index-source.html; then ok "client: time_off.created_by carries the caller's roster id or profile id (a coordinator's profile id)"; else bad "client: time_off.created_by no longer falls back to the profile id"; fi
# 11b. the rolled-back probe
if linked; then
  PROBE11="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/coordinator-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE11" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    if echo "$out" | grep -q 'PROBE_SETUP: the role check refuses coordinator'; then bad "coordinator probe: the role check still refuses 'coordinator' - sql/migrations/2026-09-24-coordinator-role.sql is not applied (the BEFORE picture)"; else bad "coordinator probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"; fi
  else
    results11=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results11" | tr ';' '\n' | sed 's/^/   /'
    case_val11()   { echo "$results11" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq11()  { v=$(case_val11 "$1"); [ "$v" = "$2" ] && ok "coordinator probe $1: $3" || bad "coordinator probe $1: $3 (got '$v', expected '$2')"; }
    # expect_err11: the CLI escapes the quotes around identifiers in its error text, so the value is unescaped first
    expect_err11() { v=$(case_val11 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "coordinator probe $1: $4"; else bad "coordinator probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    expect_eq11  C1  "ok created_by=self"                          "a coordinator adds another person's vacation; created_by = the coordinator's profile id"
    expect_eq11  C2  "updated=1"                                   "a coordinator edits that vacation"
    expect_eq11  C3  "deleted=1"                                   "a coordinator deletes that vacation"
    expect_err11 C4  P0001 "ON_CALL_CONFLICT"                      "a coordinator's vacation over a published on-call day is refused by the trigger (untouched)"
    expect_eq11  C5  "ok"                                          "a coordinator writes an availability row for another person"
    expect_eq11  C6  "ok entered_by=self source=office-relay"      "save_offers for another person: entered_by = the coordinator's id, source office-relay"
    expect_err11 C7  42501 'row-level security policy for table "call_offers"' "a direct insert into call_offers by a coordinator is refused (RLS: the relay flag exists only inside save_offers)"
    expect_eq11  C8  "ok mode=preferred"                           "set_offer_mode relay in an upcoming period"
    expect_err11 C9  OM005 "MODE_FROZEN"                           "set_offer_mode relay in a published period is refused (a coordinator is not a scheduler)"
    expect_err11 C10 OF003 "closed on 2030-07-20"                  "save_offers into a published period is refused (freeze by status, close date still ahead)"
    expect_eq11  C11 "updated=0"                                   "a coordinator's schedule_days update touches nothing (no policy: silent)"
    expect_eq11  C12 "updated=0"                                   "a coordinator's call_schedule_data update touches nothing"
    expect_err11 C13 42501 'row-level security policy for table "call_periods"' "a coordinator cannot insert a period"
    expect_err11 C14 P0001 "TRADE_FORBIDDEN"                       "a coordinator cannot propose a trade (the insert guard: no roster link)"
    expect_eq11  C15 "updated=1"                                   "a coordinator changes its own display_name"
    expect_err11 C16 42501 'row-level security policy for table "user_profiles"' "a coordinator cannot change its own role (pinned by A1's self-update policy)"
    expect_eq11  C17 "own=1 leak=0 sched_ok=t"                     "a coordinator reads own row + scheduler/admin rows, no surgeon row"
    expect_eq11  C18 "ok"                                          "a coordinator writes audit rows as itself (actor_id = its profile id)"
    expect_err11 C19 42501 'row-level security policy for table "audit_log"' "a coordinator cannot write an audit row as a surgeon"
    expect_eq11  C20 "ok"                                          "a coordinator inserts a notification (the vacation-logged feed row)"
    expect_eq11  C21 "own_family=1 others=0 own_other=1"           "a coordinator reads its own audit rows - the timeoff./offers./availability. family (audit_read_coord) and outside it (audit_read_own, Prompt 21 step 1) - and no one else's"
    expect_eq11  C22 "updated=0"                                   "a coordinator's direct UPDATE of an offer touches nothing"
    expect_eq11  C23 "deleted=0"                                   "a coordinator's direct DELETE of an offer touches nothing"
    expect_err11 C24 42501 'row-level security policy for table "call_schedule_snapshots"' "a coordinator cannot write a snapshot"
    expect_eq11  C25 "contacts=0"                                  "a coordinator reads no office contact"
    expect_err11 C26 OS004 "OFFERS_UNKNOWN_PERSON"                 "save_offers relay for an id that is not on the roster is refused (the office relays for a roster surgeon only; no FK on call_offers.person_id)"
    expect_err11 C27 OM007 "MODE_UNKNOWN_PERSON"                   "set_offer_mode relay for an id that is not on the roster is refused"
    expect_eq11  L1  "ok"                                          "a surgeon still enters his own vacation"
    expect_eq11  L2  "ok rows=1"                                   "a surgeon still inserts his own offer directly (RLS unchanged for surgeons)"
    expect_eq11  L3  "visible=0"                                   "a surgeon reads none of the probe's audit rows (he wrote none of them; audit_read_own shows him his own only)"
    expect_eq11  A1  "ok entered_by=scheduler source=email-relay"  "the scheduler's relay keeps entered_by scheduler / source email-relay"
    expect_eq11  A2  "ok"                                          "the scheduler sets a mode on a published period (never frozen)"
    expect_err11 A3  23514 "user_profiles_coordinator_unlinked"    "the admin cannot link a coordinator to a roster id (check constraint)"
  fi
  LEFTOVER11_SQL="select ((select count(*) from public.schedule_days where day between '2030-08-01' and '2030-08-31' and source = 'probe-coord') + (select count(*) from public.time_off where note = 'probe-coord') + (select count(*) from public.availability where note = 'probe-coord') + (select count(*) from public.call_offers where note = 'probe-coord') + (select count(*) from public.call_periods where label like 'probe coord%') + (select count(*) from public.audit_log where action = 'probe.coord' or detail ->> 'probe' = 'probe-coord') + (select count(*) from public.notifications where title = 'probe-coord') + (select count(*) from public.call_schedule_snapshots where reason = 'probe-coord') + (select count(*) from auth.users where email like 'probe-coord-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER11_SQL")
  if ! echo "$r" | grep -q '"leftover"'; then
    bad "coordinator probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "coordinator probe persisted nothing (leftover count 0: schedule_days 2030-08 / time_off / availability / call_offers / call_periods / audit_log / notifications / snapshots / auth.users)"
  else
    bad "coordinator probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.call_offers where note = 'probe-coord';"
    echo "      delete from public.call_periods where label like 'probe coord%';"
    echo "      delete from public.time_off where note = 'probe-coord';"
    echo "      delete from public.availability where note = 'probe-coord';"
    echo "      delete from public.schedule_days where day between '2030-08-01' and '2030-08-31' and source = 'probe-coord';"
    echo "      delete from public.audit_log where action = 'probe.coord' or detail ->> 'probe' = 'probe-coord';"
    echo "      delete from public.notifications where title = 'probe-coord';"
    echo "      delete from public.call_schedule_snapshots where reason = 'probe-coord';"
    echo "      delete from auth.users where email like 'probe-coord-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 11b (supabase CLI not linked at $WORKDIR)"
fi

echo "== 12. followers (Prompt 20 F1): user_profiles.follows (admin-set) + notification_preferences keyed by id (person_id unique, profile_id for an unlinked follower) =="
# sql/migrations/2026-09-24-followers.sql (report-first; applied by the orchestrator after Faraz's go, AFTER the client that
# names on_conflict=person_id is live). Nothing here writes over REST. 12a checks that client pin from the source (without it
# PostgREST merges the surgeons' prefs upsert on the primary key, which moves to id: 23505 / HTTP 409 - probe S2).
# 12b runs sql/probes/followers-probe.sql: four throwaway users (follower / second follower / surgeon linked to the NON-roster
# id 'probe-follow' / admin), acts as each of them, ends with RAISE 'PROBE_RESULTS ...;END' so everything rolls back.
# Expectations are the AFTER-migration picture; BEFORE it the first block raises PROBE_SETUP carrying the prefs row count
# (this section prints it - pass it back as SILVIS_PREFS_ROWS_BEFORE=<n> after the apply and R1 is compared with it).
# 12a. client pin (read from the source). Since P20 R2 the one prefs upsert is config.js notifPrefsDb.save (db.upsert with the
# request's own onConflict), the row is helpers.js notifPrefSaveRequest's (a surgeon's -> on_conflict=person_id), and Settings
# saves a surgeon through notifPrefsDb.save({ personId }. test/schema.test.js checks every string below exists in its file.
if grep -qF 'notifPrefsDb.save({ personId }' index-source.html && grep -qF 'db.upsert("notification_preferences", req.row, { onConflict: req.onConflict })' config.js && grep -qF 'on_conflict=${encodeURIComponent(opts.onConflict)}' config.js && grep -qF '? { onConflict: "person_id", row: { person_id: personId' helpers.js; then ok "client: the prefs upsert names on_conflict=person_id (valid before and after the key move)"; else bad "client: the prefs upsert does not name on_conflict=person_id - after the migration PostgREST would merge on the new id key and 409 every existing surgeon's save"; fi
# 12a'. the LIVE client (three anon GETs of the Pages build - read-only; review 9/24, helpers.js added P20 R2): the source pin
# above says nothing about what the surgeons' browsers run. The migration may be applied only once the served config.js sends
# ?on_conflict= through notifPrefsDb.save, the served helpers.js builds a surgeon's row with on_conflict=person_id and the
# served index.html saves a surgeon through notifPrefsDb.save({ personId } (babel splits that call over lines, hence tr -d)
# (the push merged, CI built, Pages redeployed). Red before the push - expected.
PAGES="https://fkhan628.github.io/Silvis-Call-Schedule"
c12a=$(curl -s -o "$T/vr12-config.js" -w '%{http_code}' "$PAGES/config.js?vr=$$")
c12b=$(curl -s -o "$T/vr12-index.html" -w '%{http_code}' "$PAGES/index.html?vr=$$")
c12c=$(curl -s -o "$T/vr12-helpers.js" -w '%{http_code}' "$PAGES/helpers.js?vr=$$")
if [ "$c12a" = "200" ] && [ "$c12b" = "200" ] && [ "$c12c" = "200" ] && grep -qF 'on_conflict=${encodeURIComponent(opts.onConflict)}' "$T/vr12-config.js" && grep -qF 'db.upsert("notification_preferences", req.row, { onConflict: req.onConflict })' "$T/vr12-config.js" && grep -qF '? { onConflict: "person_id", row: { person_id: personId' "$T/vr12-helpers.js" && tr -d ' \r\n' < "$T/vr12-index.html" | grep -qF 'notifPrefsDb.save({personId}'; then ok "live client: the served build sends the prefs upsert with on_conflict=person_id (config.js + helpers.js + index.html from $PAGES)"; else bad "live client: the served build (config.js HTTP $c12a, index.html HTTP $c12b, helpers.js HTTP $c12c) does not carry the on_conflict=person_id prefs upsert - do NOT apply sql/migrations/2026-09-24-followers.sql until Pages serves it (the CDN can lag a few minutes after the deploy)"; fi
# grade_r1_12 <R1> [<count before>]: R1 counts EVERY live prefs row, so it is graded by what stays true once followers own rows -
# ids = rows (each row its own id) and person + profile = rows (exactly one owner each). The apply-time run
# (SILVIS_PREFS_ROWS_BEFORE=<N> set) adds the strict picture: profile=0 and person=N (no follower row can exist yet; no row lost
# or added by the key move). Without the variable the strict half is skipped, so a later run on healthy data stays green.
grade_r1_12() {
  r1v="$1"; r1b="$2"
  r1f=$(echo "$r1v" | sed -n 's/^rows=\([0-9][0-9]*\) person=\([0-9][0-9]*\) profile=\([0-9][0-9]*\) ids=\([0-9][0-9]*\)$/\1 \2 \3 \4/p')
  if [ -z "$r1f" ]; then bad "followers probe R1: expected rows=N person=P profile=F ids=N (got '$r1v')"; return 0; fi
  set -- $r1f
  if [ "$4" -eq "$1" ] && [ $(($2 + $3)) -eq "$1" ]; then ok "followers probe R1: every prefs row has its own id and exactly one owner ($r1v)"; else bad "followers probe R1: ids must equal rows and person + profile must equal rows (got '$r1v')"; fi
  if [ -n "$r1b" ]; then
    if [ "$3" -eq 0 ] 2>/dev/null && [ "$2" -eq "$r1b" ] 2>/dev/null; then ok "followers probe R1 (apply-time run): no follower row yet and the $2 surgeon rows equal the count before ($r1b)"; else bad "followers probe R1 (apply-time run): expected person=$r1b profile=0, got '$r1v' - a row was lost or added by the key move (or SILVIS_PREFS_ROWS_BEFORE is stale)"; fi
  else
    echo "   (R1 graded by its lasting invariants; on the run right after the apply set SILVIS_PREFS_ROWS_BEFORE=<the count the BEFORE run printed> to also require person=N profile=0)"
  fi
}
# 12b. the rolled-back probe
if linked; then
  PROBE12="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/followers-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE12" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    if echo "$out" | grep -q 'PROBE_SETUP: user_profiles.follows'; then bad "followers probe: sql/migrations/2026-09-24-followers.sql is not applied (the BEFORE picture; $(echo "$out" | grep -oE 'notification_preferences rows=[0-9]+' | head -1) - keep that count for SILVIS_PREFS_ROWS_BEFORE)"; else bad "followers probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"; fi
  else
    results12=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results12" | tr ';' '\n' | sed 's/^/   /'
    case_val12()   { echo "$results12" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    # expect_eq12 / expect_err12: the CLI escapes the quotes inside the probe's text, so the value is unescaped first
    expect_eq12()  { v=$(case_val12 "$1" | sed 's/\\//g'); [ "$v" = "$2" ] && ok "followers probe $1: $3" || bad "followers probe $1: $3 (got '$v', expected '$2')"; }
    expect_err12() { v=$(case_val12 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "followers probe $1: $4"; else bad "followers probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    grade_r1_12 "$(case_val12 R1)" "${SILVIS_PREFS_ROWS_BEFORE:-}"
    expect_eq12  K1  "pk=id unique=person_id,profile_id"             "the key is id; person_id and profile_id are each UNIQUE (on_conflict=person_id / profile_id resolve)"
    expect_err12 F1  42501 'for table "user_profiles"'               "a follower cannot set his own follows (user_profiles_self_update pins it)"
    expect_eq12  F2  "updated=1"                                     "a follower still changes his own display_name"
    expect_eq12  P1  "ok rows=1 schedule=false"                      "a follower upserts his own prefs row by profile_id"
    expect_eq12  P2  "updated=1"                                     "a follower updates his own prefs row"
    expect_eq12  P3  "own=1 others=0"                                "a follower reads his own prefs row and no other"
    expect_eq12  P4  "updated=0"                                     "a follower's update of another person's prefs touches nothing (RLS is silent)"
    expect_eq12  P5  "deleted=0"                                     "a follower's delete of another person's prefs touches nothing"
    expect_err12 P6  42501 'for table "notification_preferences"'    "a follower cannot insert a prefs row for a roster id"
    expect_err12 P7  42501 'for table "notification_preferences"'    "a follower cannot insert a prefs row for another profile"
    expect_err12 P8  42501 'for table "notification_preferences"'    "a follower cannot re-point his row to a roster id"
    expect_err12 P9  23514 "notification_preferences_one_owner"      "a prefs row never carries both keys"
    expect_eq12  A1  "updated=1 follows=[\"s2\"]"                    "the admin sets a follower's follows (user_profiles_admin - the Setup > Users path)"
    expect_err12 A2  23514 "user_profiles_follows_shape"             "follows must be an array of strings ([1] refused)"
    expect_err12 A3  23514 "user_profiles_follows_shape"             "follows must be an array (an object refused)"
    expect_err12 A4  23514 "user_profiles_follows_shape"             "follows may not nest arrays (strict jsonpath)"
    expect_eq12  A5  "probe_rows=3"                                  "the admin reads every prefs row (surgeon's and followers')"
    expect_err12 A6  23514 "notification_preferences_one_owner"      "a prefs row never carries neither key"
    expect_eq12  F3  "follows=[\"s2\"]"                              "a follower reads whom he follows"
    expect_err12 F4  42501 'for table "user_profiles"'               "a follower cannot clear his own follows"
    expect_eq12  S1  "ok rows=1 schedule=false"                      "a surgeon's upsert on person_id still resolves on his existing row (the client's on_conflict=person_id)"
    expect_err12 S2  23505 "notification_preferences_person_id_key"  "an upsert on the primary key (no on_conflict) now hits the person_id key - why the client names on_conflict=person_id"
    expect_eq12  S3  "own=1 others=0"                                "a surgeon reads his own prefs row and no follower's"
    expect_err12 S4  42501 'for table "user_profiles"'               "a surgeon cannot set his own follows"
    expect_err12 I1  42501 'for table "user_profiles"'               "a self-insert may not choose whom it follows (user_profiles_self_insert pins follows = [])"
    expect_eq12  I2  "ok follows=[]"                                 "a self-insert still lands as a viewer following nobody"
    expect_eq12  X1  "before=1 after=0"                              "deleting a follower's account removes his prefs row (profile_id on delete cascade)"
  fi
  LEFTOVER12_SQL="select ((select count(*) from auth.users where email like 'probe-follow-%@example.test') + (select count(*) from public.user_profiles where display_name like 'probe follow%') + (select count(*) from public.notification_preferences where person_id = 'probe-follow'))::int as leftover"
  r=$(q "$LEFTOVER12_SQL")
  if ! echo "$r" | grep -q '"leftover"'; then
    bad "followers probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "followers probe persisted nothing (leftover count 0: auth.users / user_profiles / notification_preferences)"
  else
    bad "followers probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.notification_preferences where person_id = 'probe-follow';"
    echo "      delete from auth.users where email like 'probe-follow-%@example.test';   -- user_profiles rows cascade, and the followers' prefs rows with them"
    echo "      delete from public.user_profiles where display_name like 'probe follow%';"
  fi
else
  echo "   SKIP 12b (supabase CLI not linked at $WORKDIR)"
fi

echo "== 13. audit_log read-back (Prompt 21 step 1): a user reads back the audit rows he wrote (audit_read_own) =="
# sql/migrations/2026-09-25-audit-read-own.sql (report-first; applied by the orchestrator only AFTER the 24-hour gate and
# Faraz's go). The client's db.insert sends Prefer: return=representation, so logAudit runs INSERT ... RETURNING; without a
# SELECT policy that sees the new row a linked surgeon's audit insert is refused with 42501 (HTTP 403) - Acton's two vacations
# of 9/24 never reached audit_log. Section 10's L4 inserts WITHOUT RETURNING, which is why it stayed green. Nothing here writes
# over REST. sql/probes/audit-read-own-probe.sql: six throwaway users probe-auditown-<uuid>@example.test (surgeon s3, second
# surgeon s2, coordinator, second coordinator, unlinked viewer, admin s1), every audit row tagged detail.probe =
# 'probe-auditown', inserts WITH RETURNING * and in PostgREST's return=representation shape (RLS-equivalent: a column-reading
# RETURNING inside a CTE pgrst_source - not PostgREST's byte-identical statement, and no REST call), fixture rows for a CLI
# writer (actor_id null) and the daily-reminder ('cron') that no non-scheduler may read, ends with RAISE
# 'PROBE_RESULTS ...;END' so everything rolls back.
# Expectations are the AFTER-apply picture (precedent: sections 11 / 12 grade the AFTER picture and are red before their
# apply). BEFORE the apply the probe runs clean and nine cases are RED - expected: P1 (the policy list lacks audit_read_own),
# S1 and S2 (the surgeon's RETURNING insert: ERR 42501), S5 (own=0), T1 (own=0 s3=0), C2 and C4 (the coordinator's prefs.save
# RETURNING insert: ERR 42501), C5 (own_other=0), D1 (own_other=0). Every other case reads the same before and after.
if linked; then
  PROBE13="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/audit-read-own-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE13" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "audit read-back probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results13=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results13" | tr ';' '\n' | sed 's/^/   /'
    case_val13()   { echo "$results13" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    # expect_eq13 / expect_err13: the CLI escapes the quotes inside the probe's text, so the value is unescaped first
    expect_eq13()  { v=$(case_val13 "$1" | sed 's/\\//g'); [ "$v" = "$2" ] && ok "audit read-back probe $1: $3" || bad "audit read-back probe $1: $3 (got '$v', expected '$2')"; }
    expect_err13() { v=$(case_val13 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "audit read-back probe $1: $4"; else bad "audit read-back probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    if ! case_val13 P1 | grep -q 'audit_read_own'; then echo "   (the BEFORE picture: audit_read_own is not live - sql/migrations/2026-09-25-audit-read-own.sql is not applied; P1 S1 S2 S5 T1 C2 C4 C5 D1 below are red until it is)"; fi
    expect_eq13  P1  "policies=audit_insert,audit_read,audit_read_coord,audit_read_own" "audit_log carries the three policies it had plus audit_read_own, nothing else"
    expect_eq13  S1  "ok"                                            "a linked surgeon's own audit row inserts WITH RETURNING * (what the client's db.insert asks for)"
    expect_eq13  S2  "ok rows=1"                                     "the same insert in PostgREST's return=representation shape (CTE pgrst_source ... returning public.audit_log.*) returns its row"
    expect_eq13  S3  "ok"                                            "RETURNING 1 (reads no column) was never refused (control)"
    expect_eq13  S4  "ok"                                            "a plain insert (section 10's L4) was never refused (control)"
    expect_eq13  S5  "own=5"                                         "the surgeon reads back every probe row he wrote (the fixture, S1-S4)"
    expect_eq13  S6  "s2=0 s1=0 coord=0 cli=0 cron=0"                "the surgeon reads no row another author wrote (s2, s1, the coordinators, a CLI row - actor_id null - and a daily-reminder 'cron' row)"
    expect_err13 S7  42501 'row-level security policy for table "audit_log"' "a surgeon still cannot write an audit row as another surgeon (audit_insert unchanged)"
    expect_eq13  T1  "own=1 s3=0"                                    "a second surgeon reads his own row and none of s3's"
    expect_eq13  C1  "ok"                                            "a coordinator's timeoff.add row with RETURNING * (audit_read_coord already covered the family)"
    expect_eq13  C2  "ok"                                            "a coordinator's prefs.save row with RETURNING * (outside the three families: audit_read_own)"
    expect_eq13  C3  "ok"                                            "a coordinator's prefs.save row without RETURNING (control)"
    expect_eq13  C4  "ok rows=1"                                     "a coordinator's prefs.save in PostgREST's return=representation shape returns its row"
    expect_eq13  C5  "own_family=1 own_other=4"                      "a coordinator reads back its own rows in and outside the three families"
    expect_eq13  C6  "coord2=0 surgeons=0 cli=0 cron=0"              "a coordinator reads no other coordinator's row, no surgeon's, no CLI row and no 'cron' row"
    expect_err13 C7  42501 'row-level security policy for table "audit_log"' "a coordinator still cannot write an audit row as a surgeon (audit_insert unchanged)"
    expect_eq13  D1  "own_family=1 own_other=1 coord=0"              "a second coordinator reads its own rows and none of the first coordinator's"
    expect_err13 V1  42501 'row-level security policy for table "audit_log"' "an unlinked viewer (a follower) writes no audit row (audit_insert unchanged; decision 1c)"
    expect_err13 V2  42501 'row-level security policy for table "audit_log"' "an unlinked viewer's RETURNING insert is refused by the same WITH CHECK"
    expect_eq13  V3  "visible=0"                                     "an unlinked viewer reads no audit row"
    expect_eq13  A1  "ok"                                            "the admin's audit row with RETURNING * (control: audit_read)"
    expect_eq13  A2  "sees_all=t"                                    "the admin reads every probe row (audit_read unchanged)"
  fi
  LEFTOVER13_SQL="select ((select count(*) from public.audit_log where detail ->> 'probe' = 'probe-auditown') + (select count(*) from auth.users where email like 'probe-auditown-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER13_SQL")
  if ! echo "$r" | grep -q '"leftover"'; then
    bad "audit read-back probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "audit read-back probe persisted nothing (leftover count 0: audit_log detail.probe = probe-auditown / auth.users)"
  else
    bad "audit read-back probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.audit_log where detail ->> 'probe' = 'probe-auditown';"
    echo "      delete from auth.users where email like 'probe-auditown-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 13 (supabase CLI not linked at $WORKDIR)"
fi

echo "== 14. call pay (2026-09-27): anon sees neither table, anon cannot write, rolled-back probe =="
# sql/migrations/2026-09-27-call-pay.sql (report-first; applied 2026-09-28 01:15:26Z, revision r): call_pay_settings (the rates +
# flags + the per-surgeon stipend switch; scheduler / office coordinator (read-only) / switched-on linked-surgeon read) and
# call_pay_logs (the primary's call-ins; own rows while switched on / scheduler; the coordinator reads every row). Neither table is
# anon-readable and anon's table privileges are revoked, so an anon request is refused (401 / 403 / 42501); an anon 200 is a FAIL
# even with Content-Range */0 - it would mean the revoke did not take. Nothing here writes over REST except the anon POST that must
# be refused, and nothing reads or prints a rate. The tables exist since the apply, so a 404 (PGRST205 / 42P01) or the probe's
# PROBE_SETUP is a FAIL (strict since the record step, which dropped SILVIS_CALL_PAY_APPLIED; before it they passed as not applied).
for t in call_pay_settings call_pay_logs; do
  hdr=$(curl -s -D - -o $T/vr14_$t.json "$URL/rest/v1/$t?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Prefer: count=exact")
  code=$(echo "$hdr" | grep -oE '^HTTP/[0-9.]+ [0-9]+' | head -1 | awk '{print $2}')
  range=$(echo "$hdr" | grep -i '^content-range:' | tr -d '\r' | awk '{print $2}')
  echo "   anon GET $t -> HTTP $code  Content-Range: ${range:-<none>}  body: $(head -c 120 $T/vr14_$t.json)"
  case "$code" in
    200) bad "anon read of $t: HTTP 200 (Content-Range '${range:-<none>}') - anon's privileges are revoked, so a refusal (401 / 403) is expected, not an answer (pay data must never reach anon)";;
    401|403) ok "anon read of $t refused (HTTP $code)";;
    404) bad "anon read of $t: HTTP 404 (the table exists since the 2026-09-28 apply)";;
    *) bad "anon read of $t: HTTP ${code:-<none>}";;
  esac
done
line=$(curl -s -o $T/vr14b.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/call_pay_logs" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"person_id":"s9test","day":"2020-03-02","hours":1,"note":"verify-rls anon"}')
echo "   anon POST call_pay_logs -> $line  body: $(head -c 160 $T/vr14b.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon insert into call_pay_logs refused ($line)";;
  "HTTP 404") bad "anon POST call_pay_logs: HTTP 404 (the table exists since the 2026-09-28 apply)";;
  *) if grep -q '42501' $T/vr14b.json; then ok "anon insert into call_pay_logs refused (42501)"; else bad "anon insert into call_pay_logs: $line (expected 401/403 or 42501)"; fi;;
esac
# 14c. As a surgeon (read-only): every call_pay_logs row he can read is his own
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  line=$(curl -s -o $T/vr14c.json -w 'HTTP %{http_code}' "$URL/rest/v1/call_pay_logs?select=person_id" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT")
  echo "   surgeon GET call_pay_logs -> $line  distinct person_id: $(grep -oE '"person_id":"[^"]*"' $T/vr14c.json | sort -u | tr '\n' ' ')"
  n14c=$(grep -oE '"person_id":"[^"]*"' $T/vr14c.json | sort -u | wc -l | tr -d ' ')
  case "$line" in
    "HTTP 200") if [ "$n14c" -le 1 ]; then ok "a surgeon reads only his own call-in rows ($n14c distinct person_id)"; else bad "a surgeon reads call-in rows of $n14c people (expected his own only)"; fi;;
    "HTTP 404") bad "surgeon GET call_pay_logs: HTTP 404 (the table exists since the 2026-09-28 apply)";;
    *) bad "surgeon GET call_pay_logs: $line";;
  esac
else
  echo "   SKIP 14c (set SILVIS_SURGEON_JWT=<a surgeon-role user's access token> in the environment)"
fi
# 14d. sql/probes/call-pay-probe.sql through the linked CLI (rolls itself back; never reads a rate). Expectations are the
# AFTER-apply picture; the probe's header lists every case. The probe flips the stipend switches of s2 / s3 inside its own
# transaction; the switch list (roster ids, never a rate) is read before and after and must be unchanged. Only the "off_ids"
# value is compared: the CLI's JSON carries a random "boundary" per call (CLI 2.84+), so two whole outputs never match
# (the 9/28 apply run's false FAIL, stipend_off_ids [] both times).
if linked; then
  PROBE14="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/call-pay-probe.sql"
  OFF14_SQL="select coalesce((select stipend_off_ids::text from public.call_pay_settings where id = 'main'), 'none') as off_ids"
  off14_val() { q "$OFF14_SQL" | tr -d ' \n' | grep -oE '"off_ids":"([^"\\]|[\\].)*"' | head -1; }   # [\\]. = one backslash then any char (an escaped quote inside the value)
  off14_before=$(off14_val)
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE14" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  applied14=1
  if echo "$out" | grep -q 'PROBE_SETUP: call_pay_logs is absent'; then
    applied14=0
    bad "call pay probe: PROBE_SETUP - call_pay_logs is absent (the tables exist since the 2026-09-28 apply)"
  elif ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "call pay probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results14=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results14" | tr ';' '\n' | sed 's/^/   /'
    case_val14()   { echo "$results14" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq14()  { v=$(case_val14 "$1" | sed 's/\\//g'); [ "$v" = "$2" ] && ok "call pay probe $1: $3" || bad "call pay probe $1: $3 (got '$v', expected '$2')"; }
    expect_err14() { v=$(case_val14 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "call pay probe $1: $4"; else bad "call pay probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    expect_eq14  P1  "policies=call_pay_logs_delete,call_pay_logs_insert,call_pay_logs_read,call_pay_logs_update,call_pay_settings_read,call_pay_settings_write" "the two tables carry exactly the six call pay policies"
    expect_eq14  P2  "anon_logs=f anon_settings=f auth_truncate=f"   "anon holds no privilege on either table; authenticated no TRUNCATE / REFERENCES / TRIGGER (revoked)"
    expect_eq14  P3  "rows=1"                                        "the settings table holds the one 'main' row"
    expect_eq14  P4  "anon_exec=f auth_exec=t definer=t"             "silvis_pay_enabled is security definer, executable by authenticated, not by anon"
    expect_err14 N1  42501 "permission denied for table call_pay_logs"      "anon cannot read the call-ins"
    expect_err14 N2  42501 "permission denied for table call_pay_settings"  "anon cannot read the rates"
    expect_err14 N3  42501 "permission denied for table call_pay_logs"      "anon cannot log a call-in"
    expect_eq14  S1  "ok created_by=s3 hours=1.50"                   "a surgeon logs a call-in on his primary day and reads it back (RETURNING)"
    expect_err14 S2  PY002 "PAY_NOT_PRIMARY"                          "a surgeon cannot log his backup day (backup is never paid)"
    expect_err14 S3  42501 'row-level security policy for table "call_pay_logs"' "a surgeon cannot log a call-in for another surgeon"
    expect_err14 S4  PY001 "PAY_FUTURE"                               "a call-in is not logged ahead of the day"
    expect_err14 S5  23514 "call_pay_logs_hours_check"                "hours are quarter hours"
    expect_eq14  S6  "ok"                                            "23 h on one call day is accepted"
    expect_err14 S7  PY003 "PAY_HOURS_OVER"                           "a call day holds at most 24 h across its rows"
    expect_err14 S8  23514 "call_pay_logs_note_check"                 "a note carries no contact data ('@')"
    expect_err14 S9  PY003 "PAY_HOURS_OVER"                           "24.25 h in one row is refused"
    expect_eq14  S10 "own=2 others=0"                                "a surgeon reads his own call-ins and nobody else's"
    expect_eq14  S11 "updated=1 hours=2.25 created_by=s3"            "a surgeon edits his own call-in"
    expect_eq14  S12 "updated=0"                                     "a surgeon cannot edit another surgeon's call-in"
    expect_eq14  S13 "deleted=0"                                     "a surgeon cannot delete another surgeon's call-in"
    expect_eq14  S14 "rows=1"                                        "a linked surgeon reads the settings row (the rates his pay is computed with)"
    expect_eq14  S15 "updated=0"                                     "a surgeon cannot change the settings"
    expect_err14 S16 42501 'row-level security policy for table "call_pay_settings"' "a surgeon cannot insert a settings row"
    expect_eq14  S17 "updated=1 created_by=s3"                       "created_by is pinned on update"
    expect_err14 X1  PY002 "PAY_NOT_PRIMARY"                          "a row on a day the surgeon no longer holds cannot be edited"
    expect_eq14  X2  "deleted=1"                                     "but its owner can delete it"
    expect_eq14  T1  "own=1 s3=0"                                    "a second surgeon reads his own call-in and none of s3's"
    expect_eq14  C1  "sees_all=t"                                    "the office coordinator reads every call-in (read-only, for preparing the stipends)"
    expect_eq14  C2  "rows=1"                                        "the office coordinator reads the settings row"
    expect_err14 C3  PY004 "PAY_READ_ONLY"                            "the office coordinator cannot log a call-in (the guard refuses it before RLS)"
    expect_eq14  C4  "updated=0"                                     "the office coordinator cannot edit a call-in"
    expect_eq14  C5  "deleted=0"                                     "the office coordinator cannot delete a call-in"
    expect_eq14  C6  "updated=0"                                     "the office coordinator cannot change the rates or the stipend switches"
    expect_err14 C7  42501 'row-level security policy for table "call_pay_settings"' "the office coordinator cannot insert a settings row"
    expect_eq14  V1  "visible=0"                                     "a viewer (a follower) reads no call-in"
    expect_eq14  V2  "rows=0"                                        "a viewer reads no rate"
    expect_eq14  A1  "sees_all=t"                                    "the admin reads every call-in"
    expect_eq14  A2  "updated=1 updated_by=s1"                       "the admin writes the settings row (updated_by stamped)"
    expect_eq14  A3  "ok created_by=s1"                              "the admin logs a call-in for a surgeon on his primary day"
    expect_err14 A4  PY002 "PAY_NOT_PRIMARY"                          "the primary-only guard applies to the admin too"
    expect_eq14  O1  "rows=0"                                        "a surgeon switched off the stipend reads no rate (RLS)"
    expect_eq14  O2  "own=0"                                         "a switched-off surgeon reads none of his call-ins (RLS)"
    expect_err14 O3  PY005 "PAY_STIPEND_OFF"                          "a switched-off surgeon cannot log a call-in"
    expect_eq14  O4  "updated=0"                                     "a switched-off surgeon cannot edit his call-ins"
    expect_eq14  O5  "deleted=0"                                     "a switched-off surgeon cannot delete his call-ins"
    expect_eq14  O6  "settings=1 own=1"                              "a switched-on surgeon is unchanged (the rates and his own row)"
    expect_eq14  O7  "sees_s3=t"                                     "the admin still reads a switched-off surgeon's call-ins"
    expect_err14 O8  PY005 "PAY_STIPEND_OFF"                          "nobody, the admin included, logs a call-in for a switched-off surgeon"
    expect_err14 O9  PY005 "PAY_STIPEND_OFF"                          "nobody, the admin included, edits a switched-off surgeon's call-in"
    expect_eq14  O10 "sees_s3=t"                                     "the office coordinator still reads a switched-off surgeon's call-ins"
    expect_eq14  O11 "viewer=t colleague=t"                          "silvis_pay_enabled over RPC tells a viewer / follower or a colleague nothing (true for a switched-off id)"
    expect_eq14  O12 "admin=f coord=f self=f nojwt=f"                "silvis_pay_enabled gives the real answer to the admin, the coordinator, the person himself and a no-user session"
  fi
  if [ "$applied14" = "1" ]; then
    LEFTOVER14_SQL="select ((select count(*) from auth.users where email like 'probe-pay-%@example.test') + (select count(*) from public.schedule_days where source = 'probe-pay') + (select count(*) from public.call_pay_logs where note like 'probe-pay%'))::int as leftover"
  else
    LEFTOVER14_SQL="select ((select count(*) from auth.users where email like 'probe-pay-%@example.test') + (select count(*) from public.schedule_days where source = 'probe-pay'))::int as leftover"
  fi
  r=$(q "$LEFTOVER14_SQL")
  if ! echo "$r" | grep -q '"leftover"'; then
    bad "call pay probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "call pay probe persisted nothing (leftover count 0: auth.users probe-pay-* / schedule_days source probe-pay / call_pay_logs probe-pay notes)"
  else
    bad "call pay probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.call_pay_logs where note like 'probe-pay%';"
    echo "      delete from public.schedule_days where source = 'probe-pay';"
    echo "      delete from auth.users where email like 'probe-pay-%@example.test';   -- user_profiles rows cascade"
  fi
  if [ "$applied14" = "1" ]; then
    off14_after=$(off14_val)
    if [ -z "$off14_before" ]; then
      bad "call pay probe: the stipend switch list could not be read before the probe (no \"off_ids\" in the CLI output)"
    elif [ -z "$off14_after" ]; then
      bad "call pay probe: the stipend switch list could not be read after the probe (no \"off_ids\" in the CLI output)"
    elif [ "$off14_before" = "$off14_after" ]; then
      ok "call pay probe left the stipend switches as they were (stipend_off_ids read before and after: unchanged, $off14_after)"
    else
      bad "call pay probe CHANGED the stipend switches (before $off14_before, after $off14_after): the batch did not run as one transaction - Faraz resets them in Setup > Pay rates"
    fi
  fi
else
  echo "   SKIP 14d (supabase CLI not linked at $WORKDIR)"
fi

echo "== 15. vacation guard (2026-09-30, Prompt 27): at least minSurgeonsAround surgeons around - the time_off trigger, rolled-back probe =="
# sql/migrations/2026-09-30-vacation-guard.sql (report-first; applied 2026-10-01 16:53:33Z, revision s): time_off_vacation_guard, a
# BEFORE INSERT OR UPDATE trigger on time_off that fires after the on-call trigger - VG001 VACATION_TOO_FEW_AROUND when, on a day the
# row takes the person off, fewer than groupRules.vacations.minSurgeonsAround (default 2) active roster surgeons would stay around
# (off = a time_off row or an East vacation not reviewed 'home'); the scheduler and a session with no signed-in user pass, the office
# coordinator is refused like a surgeon. Nothing here goes over REST: sql/probes/vacation-guard-probe.sql exercises the trigger
# through the linked CLI and rolls itself back. Its expected strings rest on the live picture P1 'active=6 min=2' / P2 'east=yes'
# (graded first, by name). The trigger exists since the apply, so the probe's PROBE_SETUP (time_off_vacation_guard is absent) is a
# FAIL - strict since the record step, which dropped the flag for the run right after the apply (before the apply PROBE_SETUP
# passed as the not-applied picture). The leftover count runs either way.
if linked; then
  PROBE15="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/vacation-guard-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE15" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if echo "$out" | grep -q 'PROBE_SETUP: time_off_vacation_guard is absent'; then
    bad "vacation guard probe: PROBE_SETUP - time_off_vacation_guard is absent (the trigger exists since the 2026-10-01 apply)"
  elif ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "vacation guard probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results15=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results15" | tr ';' '\n' | sed 's/^/   /'
    case_val15()   { echo "$results15" | tr ';' '\n' | grep "^$1=" | head -1 | sed "s/^$1=//"; }
    expect_eq15()  { v=$(case_val15 "$1" | sed 's/\\//g'); [ "$v" = "$2" ] && ok "vacation guard probe $1: $3" || bad "vacation guard probe $1: $3 (got '$v', expected '$2')"; }
    expect_err15() { v=$(case_val15 "$1" | sed 's/\\//g'); if echo "$v" | grep -q "^ERR $2 " && echo "$v" | grep -qF -- "$3"; then ok "vacation guard probe $1: $4"; else bad "vacation guard probe $1: $4 (got '$v', expected ERR $2 ... $3)"; fi; }
    vg15()         { echo "ERR VG001 VACATION_TOO_FEW_AROUND: on $1 only 1 of 6 surgeons would be around (minimum 2) - pick other dates or ask the scheduler"; }
    expect_eq15  P1 "active=6 min=2"                    "the live roster has six active surgeons and the default minimum 2 (the expected strings below rest on it)"
    expect_eq15  P2 "east=yes"                          "the live roster has an East person (the E cases exercise his East vacations)"
    expect_eq15  P3 "triggers=time_off_no_call_conflict_trg,time_off_vacation_guard_trg definer=t" "time_off carries the on-call trigger then the vacation guard (name order = firing order); the guard is security definer"
    p4_15=$(case_val15 P4)
    case "$p4_15" in
      "inactive=roster"|"inactive=non-roster") ok "vacation guard probe P4: the I case uses a $(echo "$p4_15" | sed 's/^inactive=//') id that is not an active surgeon";;
      *) bad "vacation guard probe P4: expected inactive=roster or inactive=non-roster (got '$p4_15')";;
    esac
    expect_eq15  S1 "ok"                                "a surgeon may be the 4th off (2 of 6 stay around)"
    expect_eq15  S2 "$(vg15 '10/16, 10/17')"            "the 5th off is refused, naming only the days over the limit (10/18 is only the 4th) with the count"
    expect_eq15  S3 "$(vg15 '10/19')"                   "an update that widens into an over-limit day is refused (only its new days are checked)"
    expect_eq15  S4 "updated=1"                         "an update that narrows a vacation is never checked"
    expect_eq15  E1 "$(vg15 '10/1')"                    "an East vacation reviewed away counts as off"
    expect_eq15  E2 "ok"                                "an East vacation reviewed home does not count"
    expect_eq15  E3 "$(vg15 '10/7')"                    "an unreviewed East vacation counts as off (like away - the app's rule)"
    expect_eq15  I1 "ok"                                "a vacation row of an inactive / outside / unknown id is not counted"
    expect_err15 K1 P0001 "ON_CALL_CONFLICT"            "a range over the surgeon's own call day is refused by the on-call trigger FIRST (it would also be the 5th off)"
    expect_err15 K2 P0001 "ON_CALL_CONFLICT"            "the on-call rule still fires on its own (an uncrowded range over a backup day)"
    expect_eq15  C1 "$(vg15 '10/9, 10/10')"             "the office coordinator entering for a surgeon is refused the same way"
    expect_eq15  M1 "$(vg15 '10/25')"                   "a multi-row insert (the painter's bulk shape) counts its earlier rows: the second row is the 5th"
    expect_eq15  A1 "ok"                                "the scheduler may enter the 5th (the client asks him first)"
    expect_eq15  N1 "ok"                                "a session with no signed-in user (SQL editor / linked CLI / service_role) passes"
    expect_eq15  D1 "ok"                                "a surgeon already off that day (his other row) may enter another row over it - not refused even at the limit (Decision 4)"
    expect_eq15  U1 "$(vg15 '10/10')"                   "the coordinator moving a row to another surgeon onto a day at the limit is refused (a person change checks every day of the row)"
  fi
  LEFTOVER15_SQL="select ((select count(*) from auth.users where email like 'probe-vacguard-%@example.test') + (select count(*) from public.time_off where note like 'probe-vacguard%') + (select count(*) from public.schedule_days where source = 'probe-vacguard') + (select count(*) from public.east_feed where data->>'probe' = 'vacguard') + (select count(*) from public.east_vacation_reviews where decided_by = 'probe-vacguard'))::int as leftover"
  r=$(q "$LEFTOVER15_SQL")
  if ! echo "$r" | grep -q '"leftover"'; then
    bad "vacation guard probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then
    ok "vacation guard probe persisted nothing (leftover count 0: auth.users probe-vacguard-* / time_off probe-vacguard notes / schedule_days source probe-vacguard / east_feed data.probe vacguard / east_vacation_reviews decided_by probe-vacguard)"
  else
    bad "vacation guard probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.time_off where note like 'probe-vacguard%';"
    echo "      delete from public.schedule_days where source = 'probe-vacguard';"
    echo "      delete from public.east_feed where data->>'probe' = 'vacguard';"
    echo "      delete from public.east_vacation_reviews where decided_by = 'probe-vacguard';"
    echo "      delete from auth.users where email like 'probe-vacguard-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP 15 (supabase CLI not linked at $WORKDIR)"
fi

echo "== 18. APP call days (2026-10-02, Prompt 29): app_call_days + save_app_days / app_call_names + user_profiles.is_app - anon refused, rolled-back probe =="
# Section 18 (16 = Prompt 28's no-primary days and 17 = the weekend pair claim are taken on other branches).
# sql/migrations/2026-10-02-app-call-days.sql (report-first; applied 2026-10-02 19:19:27Z, revision v): app_call_days (one APP per
# day - day is the primary key; read by every signed-in role through app_call_days_read, never anon: no anon policy AND anon's table
# privileges revoked, so an anon request is refused 401 / 403 - a 200 is a FAIL even with Content-Range */0, it would mean the revoke
# did not take); save_app_days (security definer, the only write path; AP001-AP007 APP_DAY_* refuse before any write) and
# app_call_names (security definer, stable) - EXECUTE for authenticated, never anon; user_profiles.is_app (admin-set, pinned in the
# two self policies). 18a-18d go over REST as anon and write nothing (each is refused before a row or a body is used): 401/403 = the
# object exists and anon holds no privilege; a 404 is a FAIL (18c: PGRST202 - the schema cache does not know the four keys, the gate
# before the Prompt 29 client push). 18e (only with SILVIS_SURGEON_JWT) reads as a surgeon and sends an empty save (refused AP001 at
# the first check). 18f runs sql/probes/app-call-days-probe.sql through the linked CLI (rolls itself back; 69 cases graded by name -
# its header lists each AFTER string). The table and the functions exist since the apply, so the probe's PROBE_SETUP (app_call_days
# is absent) and a 404 are FAILs - strict since the record step, which dropped the flag for the run right after the apply (before
# the apply they passed as the not-applied picture); its partly-applied raise and its collision guard (PROBE_SETUP: live rows
# already sit in the probe window) are FAILs too. 18g counts the probe's leftovers either way, by the probe's identity only: its
# auth users and its audit rows (tagged), and app_call_days rows in its window (in_window).
# 18a. anon may not read app_call_days (revoked: a refusal, never 200 + [])
line=$(curl -s -o $T/vr18a.json -w 'HTTP %{http_code}' "$URL/rest/v1/app_call_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Prefer: count=exact")
echo "   18a anon GET app_call_days: $line  body: $(head -c 160 $T/vr18a.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon read of app_call_days refused ($line - the table exists, anon holds no privilege)";;
  "HTTP 404") bad "anon GET app_call_days: HTTP 404 (the table exists since the 2026-10-02 apply - or the schema cache is stale)";;
  "HTTP 200") bad "anon read of app_call_days: HTTP 200 - anon's privileges are revoked, so a refusal (401 / 403) is expected, not an answer (an APP day must never reach anon)";;
  *) bad "anon GET app_call_days: $line (expected 401/403)";;
esac
# 18b. anon may not execute app_call_names (GET: the function is stable)
line=$(curl -s -o $T/vr18b.json -w 'HTTP %{http_code}' "$URL/rest/v1/rpc/app_call_names" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
echo "   18b anon GET rpc/app_call_names: $line  body: $(head -c 160 $T/vr18b.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon rpc app_call_names refused ($line - the function exists, execute revoked from anon)";;
  "HTTP 404") bad "anon rpc app_call_names: HTTP 404 (the function exists since the 2026-10-02 apply - or the schema cache is stale)";;
  *) bad "anon rpc app_call_names: $line (expected 401/403; anything else - a 200 included - means anon reached the names)";;
esac
# 18c. anon may not execute save_app_days; PostgREST must know its four keys before the Prompt 29 client is pushed
line=$(curl -s -o $T/vr18c.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/save_app_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"p_profile":null,"p_add":[],"p_clear":[],"p_replace":false}')
echo "   18c anon rpc save_app_days: $line  body: $(head -c 160 $T/vr18c.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon rpc save_app_days refused ($line): PostgREST knows the four keys - the Prompt 29 client may be pushed";;
  "HTTP 404") bad "anon rpc save_app_days: HTTP 404 (PGRST202: the schema cache does not know the function or its four keys, which exist since the 2026-10-02 apply) - do NOT push the Prompt 29 client";;
  *) bad "anon rpc save_app_days: $line (expected 401/403; anything else - a 200 included - means anon reached the body)";;
esac
# 18d. anon may not write app_call_days directly (no privilege; the zero uuid names no profile, so even an acceptance could not land)
line=$(curl -s -o $T/vr18d.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/app_call_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"day":"2030-12-31","profile_id":"00000000-0000-0000-0000-000000000000","source":"app"}')
echo "   18d anon POST app_call_days: $line  body: $(head -c 160 $T/vr18d.json)"
case "$line" in
  "HTTP 401"|"HTTP 403") ok "anon insert into app_call_days refused ($line)";;
  "HTTP 404") bad "anon POST app_call_days: HTTP 404 (the table exists since the 2026-10-02 apply - or the schema cache is stale)";;
  *) if grep -q '42501' $T/vr18d.json; then ok "anon insert into app_call_days refused (42501)"; else bad "anon POST app_call_days: $line (expected 401/403 or 42501)"; fi;;
esac
# 18e. as a surgeon (read-only): the table answers 200; an (empty) save is refused at the first check, AP001
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  line=$(curl -s -o $T/vr18e.json -w 'HTTP %{http_code}' "$URL/rest/v1/app_call_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT")
  echo "   18e surgeon GET app_call_days: $line"
  case "$line" in
    "HTTP 200") ok "a surgeon reads app_call_days (every signed-in role sees the APP days)";;
    "HTTP 404") bad "surgeon GET app_call_days: HTTP 404 (the table exists since the 2026-10-02 apply - or the schema cache is stale)";;
    *) bad "surgeon GET app_call_days: $line (expected 200)";;
  esac
  line=$(curl -s -o $T/vr18f.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/save_app_days" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d '{"p_profile":null,"p_add":[],"p_clear":[],"p_replace":false}')
  echo "   18e surgeon rpc save_app_days (empty lists): $line  body: $(head -c 160 $T/vr18f.json)"
  case "$line" in
    "HTTP 400") if grep -q 'AP001' $T/vr18f.json; then ok "a surgeon's save_app_days is refused AP001 (only an APP or the scheduler)"; else bad "surgeon rpc save_app_days: HTTP 400 without AP001 ($(head -c 160 $T/vr18f.json))"; fi;;
    "HTTP 404") bad "surgeon rpc save_app_days: HTTP 404 (the function exists since the 2026-10-02 apply - or the schema cache is stale)";;
    *) bad "surgeon rpc save_app_days: $line (expected 400 AP001)";;
  esac
else
  echo "   SKIP 18e (set SILVIS_SURGEON_JWT=<a surgeon-role user's access token> in the environment)"
fi
if linked; then
  PROBE18="$(cd sql/probes && (pwd -W 2>/dev/null || pwd))/app-call-days-probe.sql"
  out=$(supabase db query --linked --workdir "$WORKDIR" -f "$PROBE18" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising' | tr -d '\n')
  if echo "$out" | grep -q 'PROBE_SETUP: app_call_days is absent'; then
    bad "APP days probe: PROBE_SETUP - app_call_days is absent (the table exists since the 2026-10-02 apply)"
  elif echo "$out" | grep -q 'PROBE_SETUP: user_profiles.is_app is absent'; then
    bad "APP days probe: PROBE_SETUP - user_profiles.is_app is absent while app_call_days exists (the migration is partly applied - ask Claude Code)"
  elif echo "$out" | grep -q 'PROBE_SETUP: live rows already sit in the probe window'; then
    bad "APP days probe: PROBE_SETUP - live app_call_days rows sit in the probe window (2030-12 or 2020-05-04): the probe could not run - review them (18g lists them)"
  elif ! echo "$out" | grep -q 'PROBE_RESULTS .*;END'; then
    bad "APP days probe reported no sentinel-terminated PROBE_RESULTS (setup error or truncated output: $(echo "$out" | head -c 400))"
  else
    results18=$(echo "$out" | grep -oE 'PROBE_RESULTS .*' | head -1 | sed 's/^PROBE_RESULTS //; s/;END.*$//; s/[[:space:]]*$//')
    echo "$results18" | tr ';' '\n' | sed 's/^/   /'
    # one case per line, the CLI's JSON escapes decoded ONCE: an HTML character (> for '>', <, &) and the backslashes
    # (an escaped double quote); the graders then read a case in plain bash (no process per case - 69 of them)
    lines18=$(echo "$results18" | tr ';' '\n' | sed 's/\\u003e/>/g; s/\\u003c/</g; s/\\u0026/\&/g; s/\\//g')
    case_val18()   { CV18=""; local l; while IFS= read -r l; do case "$l" in "$1="*) CV18="${l#"$1="}"; return 0;; esac; done <<< "$lines18"; }
    expect_eq18()  { case_val18 "$1"; v="$CV18"; [ "$v" = "$2" ] && ok "APP days probe $1: $3" || bad "APP days probe $1: $3 (got '$v', expected '$2')"; }
    expect_err18() { case_val18 "$1"; v="$CV18"; case "$v" in "ERR $2 "*"$3"*) ok "APP days probe $1: $4";; *) bad "APP days probe $1: $4 (got '$v', expected ERR $2 ... $3)";; esac; }
    # expect_ap18 <case> <code> <token> <head> <tail> <words>: the exact text with the run's Central date (M/D) between head and tail
    expect_ap18()  { case_val18 "$1"; v="$CV18"; case "$v" in "ERR $2 $3: $4"[0-9]*/[0-9]*"$5") ok "APP days probe $1: $6";; *) bad "APP days probe $1: $6 (got '$v', expected ERR $2 $3: $4<M/D>$5)";; esac; }
    NOTAPP18=" is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)"
    ALLOW18="ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day"
    expect_eq18  P1  "table=yes rls=yes pk=day fk=cascade policies=app_call_days_read/select/authenticated anon_sel=no auth_sel=yes auth_write=no" "app_call_days: RLS on, day the primary key, profile_id cascades, one select policy for authenticated; anon holds nothing, authenticated SELECT only"
    expect_eq18  P2  "save_definer=yes names_definer=yes isapp_definer=yes paths=3 names_stable=yes save_volatile=yes save_anon=no save_auth=yes names_anon=no names_auth=yes isapp_anon=no isapp_auth=yes" "the three functions are security definer with search_path public, pg_temp; app_call_names stable, save_app_days volatile; EXECUTE for authenticated, never anon"
    expect_eq18  P3  "is_app=boolean not_null=yes default=false check=user_profiles_app_viewer self_pins=2" "user_profiles.is_app boolean not null default false, the APP-is-a-viewer check, pinned in both self policies"
    expect_eq18  A1  "ok added=3 removed=0 kept=0 source=app 12/2=one/app 12/3=one/app 12/11=one/app by=self" "an APP adds three days for itself (source app, created_by itself)"
    expect_eq18  A2  "audit=1 actor=self name=probe app one sums=probe app one: on call 12/2, 12/3, 12/11" "... and the function writes ONE appdays.save audit row as the APP (an APP cannot insert audit rows itself)"
    expect_eq18  A3  "ok added=0 kept=2 audit=false audit_rows=1" "the same days again: kept, nothing written, no audit row (a re-sent Save is safe)"
    expect_eq18  A4  "ok removed=1 12/3=none sums=probe app one: on call 12/2, 12/3, 12/11 | probe app one: removed 12/3" "an APP removes its own day (its own audit row)"
    expect_eq18  A5  "ok removed=0 absent=1 audit=false" "removing a day nobody holds is absent, not an error"
    expect_eq18  A6  "ERR AP004 APP_DAY_BAD_DAY: 12/4 is both added and removed in one save - nothing was saved" "a day both added and removed is refused"
    expect_eq18  A7  "ERR AP004 APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved" "an empty day in the list is refused"
    expect_eq18  A8  "ERR AP004 APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved" "more than 400 days in one save are refused"
    expect_ap18  A9  AP006 APP_DAY_PAST "5/4 is before today (" ") in Central time - a past day stays as it was" "a past day (Central time) is refused for an APP"
    expect_ap18  A10 AP006 APP_DAY_PAST "5/4 is before today (" ") in Central time - a past day stays as it was" "removing a past day is refused too, and the whole save with it"
    expect_eq18  A10s "12/5=none" "... and its other day was not written (all or nothing)"
    expect_eq18  A11 "ERR AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler" "an APP cannot add days for another APP"
    expect_eq18  A12 "ERR AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day" "an APP cannot replace (p_replace is the scheduler's)"
    expect_err18 A13 42501 "permission denied for table app_call_days" "an APP cannot insert into app_call_days directly (authenticated holds SELECT only)"
    expect_err18 A14 42501 "permission denied for table app_call_days" "an APP cannot delete from app_call_days directly, not even its own row"
    expect_eq18  A15 "rows=2" "an APP reads the APP days"
    expect_eq18  A16 "names=1 self=yes" "app_call_names gives an APP its own name (and the names of the days' holders)"
    expect_eq18  A17 "ERR AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved" "infinity / -infinity are refused (no calendar day)"
    expect_err18 A18 42501 'row-level security policy for table "user_profiles"' "an APP cannot rename itself (every signed-in user sees its name; the admin names APPs)"
    expect_eq18  A19 "updated=1" "... while an update to its own name, unchanged, still lands"
    expect_eq18  B1  "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved" "a second APP is refused on a taken day, naming the holder (one APP per day)"
    expect_eq18  B1s "12/2=one/app" "... and the day keeps its APP"
    expect_eq18  B2  "ok added=2 source=app 12/7=two/app 12/8=two/app" "the second APP adds free days"
    expect_eq18  B3  "ERR AP002 APP_DAY_NOT_YOURS: 12/2 is probe app one's day - only that APP or the scheduler can remove it (nothing was saved)" "an APP cannot remove another APP's day"
    expect_eq18  B4  "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one, 12/11 already has probe app one - nothing was saved" "every taken day is named; the save writes nothing"
    expect_eq18  B4s "12/9=none" "... its free day was not written (all or nothing)"
    expect_eq18  B5  "names=2" "the second APP sees both holders' names"
    expect_eq18  S1  "$ALLOW18" "a surgeon cannot put an APP on a day"
    expect_eq18  S2  "$ALLOW18" "... not for a named APP either"
    expect_eq18  S3  "rows=4" "a surgeon reads every APP day"
    expect_err18 S4  42501 "permission denied for table app_call_days" "a surgeon cannot write app_call_days directly"
    expect_eq18  S5  "names=2 one=probe app one two=probe app two" "a surgeon sees the holders' display names (through app_call_names - user_profiles stays unreadable to him)"
    expect_eq18  C1  "$ALLOW18" "the office coordinator cannot put an APP on a day"
    expect_eq18  C2  "rows=4" "the office coordinator reads every APP day"
    expect_eq18  V1  "$ALLOW18" "a plain viewer (not an APP) cannot put an APP on a day"
    expect_eq18  V2  "rows=4" "a plain viewer reads every APP day"
    expect_err18 V3  42501 'row-level security policy for table "user_profiles"' "a viewer cannot make itself an APP (user_profiles_self_update pins is_app)"
    expect_eq18  V4  "updated=1" "... while its own display_name stays editable"
    expect_eq18  D1  "ok added=1 source=scheduler 12/10=two/scheduler by=admin" "the scheduler puts an APP on a day (source scheduler, created_by the scheduler)"
    expect_eq18  D2  "actor=s1 name=probe admin sums=probe app two: on call 12/10" "... with the same audit row, as the scheduler (his roster id)"
    expect_eq18  D3  "ok removed=1 12/10=none" "the scheduler clears an APP's day"
    expect_eq18  D4  "ok added=1 5/4=one/scheduler" "the scheduler may set a past day (exempt from AP006)"
    expect_eq18  D5  "ok removed=1 5/4=none" "... and clear one"
    expect_eq18  D6  "ERR AP005 APP_DAY_TAKEN: 12/2 already has probe app one - nothing was saved" "the scheduler is refused a taken day without p_replace"
    expect_eq18  D7  "ok added=1 replaced=1 12/2=two/scheduler last=probe app two: on call 12/2 (was probe app one)" "the scheduler's change replaces the holder in one call; the audit row names the APP replaced"
    expect_eq18  D8  "ERR AP007 APP_DAY_STALE: 12/2 is probe app two's day - reload the calendar (nothing was saved)" "the scheduler clearing a day another APP now holds is refused (a stale picture)"
    expect_eq18  D9  "ERR AP003 APP_DAY_NOT_APP: probe viewer$NOTAPP18" "the scheduler cannot put a non-APP account on a day"
    expect_eq18  D10 "ERR AP003 APP_DAY_NOT_APP: that account$NOTAPP18" "... nor a profile that does not exist"
    expect_eq18  D11 "ERR AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)" "the scheduler must name the APP"
    expect_eq18  D12 "names=2 one=app two=app" "the scheduler sees every APP (the day editor's pick list) with the APP flag"
    expect_eq18  D13 "updated=1 is_app=false" "the admin switches an APP off"
    expect_eq18  F1  "$ALLOW18" "a former APP can no longer save"
    expect_eq18  F2  "12/11=one/app" "... and its days stay"
    expect_eq18  E1  "names=2 one=former two=app" "app_call_names marks the former APP (its day still shows)"
    expect_eq18  E2  "ok removed=1 12/11=none" "the scheduler clears a former APP's day (AP003 binds adds only)"
    expect_eq18  E3  "ERR AP003 APP_DAY_NOT_APP: probe app one$NOTAPP18" "the scheduler cannot add days for a former APP"
    expect_err18 E4  23514 'violates check constraint "user_profiles_app_viewer"' "a surgeon (a roster entry) cannot be an APP"
    expect_err18 E5  23514 'violates check constraint "user_profiles_app_viewer"' "the office coordinator cannot be an APP"
    expect_err18 N1  42501 "permission denied for table app_call_days" "anon cannot read app_call_days"
    expect_err18 N2  42501 "permission denied for function app_call_names" "anon cannot execute app_call_names"
    expect_err18 N3  42501 "permission denied for function save_app_days" "anon cannot execute save_app_days"
    expect_eq18  N4  "$ALLOW18" "a session with no signed-in user is refused"
    expect_eq18  N5  "names=0" "app_call_names gives a session with no signed-in user nothing"
    expect_eq18  X1  "before=3 after=0 audit_kept=yes" "deleting the account removes its APP days; the audit rows stay"
    expect_err18 I1  42501 'row-level security policy for table "user_profiles"' "a self-insert cannot make an APP (user_profiles_self_insert pins is_app)"
    expect_eq18  I2  "ok is_app=false" "a plain self-insert lands as a viewer, not an APP"
  fi
  # 18g. leftovers, by the probe's identity only: tagged = its auth users (profiles and their app_call_days rows cascade) and its
  # appdays.save audit rows (summaries 'probe app ...'); in_window = app_call_days rows in 2030-12 or on 2020-05-04 (read through
  # query_to_xml, guarded by to_regclass: before the apply - or after a rollback - the table does not exist). The collision guard
  # refuses to start while an in_window row exists, so after a run that got past it (PROBE_RESULTS, or the absent raise - a FAIL
  # itself since the record step) such rows can only be the probe's; after a run that stopped at the guard (or at the
  # partly-applied raise) they are live rows it never wrote - listed for review, never counted as a leftover and never given a
  # DELETE (a probe row and a real APP day look alike).
  LEFTOVER18_SQL="select ((select count(*) from auth.users where email like 'probe-appdays-%@example.test') + (select count(*) from public.audit_log where action = 'appdays.save' and detail->>'summary' like 'probe app %'))::int as tagged, (case when to_regclass('public.app_call_days') is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.app_call_days where day between ''2030-12-01'' and ''2030-12-31'' or day = ''2020-05-04''', false, true, '')))[1]::text::int end) as in_window"
  r=$(q "$LEFTOVER18_SQL")
  rflat18=$(echo "$r" | tr -d ' \n')
  tagged18=$(echo "$rflat18" | grep -oE '"tagged":"?[0-9]+' | head -1 | tr -cd '0-9')
  win18=$(echo "$rflat18" | grep -oE '"in_window":"?[0-9]+' | head -1 | tr -cd '0-9')
  passed18=""; echo "$out" | grep -qE 'PROBE_RESULTS .*;END|PROBE_SETUP: app_call_days is absent' && passed18=1
  if [ -z "$tagged18" ] || [ -z "$win18" ]; then
    bad "APP days probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif [ "$tagged18" = "0" ] && [ "$win18" = "0" ]; then
    ok "APP days probe persisted nothing (leftover count 0: auth.users probe-appdays-* / audit_log appdays.save 'probe app ...' / app_call_days in 2030-12 or on 2020-05-04)"
  else
    if [ "$tagged18" != "0" ]; then
      bad "APP days probe LEFT ROWS BEHIND (tagged=$tagged18 - rows only the probe writes): the batch did not run as one transaction. Clean up NOW, then report:"
      echo "      delete from public.audit_log where action = 'appdays.save' and detail->>'summary' like 'probe app %';"
      echo "      delete from auth.users where email like 'probe-appdays-%@example.test';   -- profiles and their app_call_days rows cascade"
    fi
    if [ "$win18" != "0" ]; then
      if [ "$passed18" = "1" ]; then
        bad "APP days probe LEFT ROWS BEHIND (in_window=$win18 - app_call_days rows in the probe window after a run that passed its collision guard): the batch did not run as one transaction. Review them before removing anything (an untagged probe row and a real APP day look alike), then report:"
      else
        echo "   18g: $win18 app_call_days row(s) sit in the probe window - the probe stopped before writing anything (18f), so they are live rows, not leftovers; review them:"
      fi
      echo "      select * from public.app_call_days where day between '2030-12-01' and '2030-12-31' or day = '2020-05-04';"
    fi
  fi
else
  echo "   SKIP 18f/18g (supabase CLI not linked at $WORKDIR)"
fi

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
