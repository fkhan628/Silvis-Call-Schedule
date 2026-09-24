#!/usr/bin/env bash
# Silvis Call Schedule - RLS + trigger verification (Prompt 2).
#
#   bash scripts/verify-rls.sh                 anon checks (1-2, 7a, 8, 9a-9b, 10a) + trigger checks (4) + trade-guard probe (5) + claim probe (7b) + offers probe (8e) + east-vacation probe (9c) + pre-launch probe (10c) + coordinator probe (11b) via the linked Supabase CLI
#   SILVIS_JWT=<scheduler jwt> bash scripts/verify-rls.sh   also runs the authenticated write checks (3, 8c, 8d)
#   SILVIS_SURGEON_JWT=<surgeon jwt> ...                      also runs the REST trade-guard checks (6), REST claim checks (7c-7e) and the surgeon read (9d; a SURGEON-role user's access token)
#   SILVIS_WORKDIR=<dir linked with `supabase link`>          where the CLI's linked project lives (default: $HOME/supabase-silvis)
#
# Never put a JWT or the service-role key in a file. Reads SUPABASE_URL / anon key from config.js.
# Section 5 (Prompt 12 D) runs sql/probes/trade-guards-probe.sql, which rolls itself back: it ends by
# RAISING an exception whose message carries the per-case results, and this script grades them.
# Section 7 (Prompt 13 part 2) does the same with sql/probes/claim-open-slot-probe.sql (claim_open_slot).
#
# --help / -h prints usage and exits BEFORE anything runs (the scripts/ contract, audit 9/23 + review follow-up);
# any other argument is refused the same way - every option of this script is an environment variable, never a flag.
case "${1:-}" in
  -h|--help) echo "usage: bash scripts/verify-rls.sh   (no flags; options are the env vars SILVIS_JWT / SILVIS_SURGEON_JWT / SILVIS_WORKDIR - see the header of this file). Runs the live RLS / trigger probes against the Silvis project: anon REST checks, then linked-CLI probes that roll themselves back."; exit 0;;
  "") ;;
  *) echo "unknown argument: $1 (this script takes no flags; see --help)" >&2; exit 2;;
esac
set -u
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

echo "== 6. trade guards over REST (JWT-gated; SILVIS_SURGEON_JWT = a surgeon-role user's access token) =="
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  # 6a. insert with status 'accepted' as a surgeon -> lands as 'pending' (from_surgeon_id = the caller)
  line=$(curl -s -o $T/vr6a.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/shift_trade_requests" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"from_surgeon_id":"s9x","to_surgeon_id":"s9test","day":"2030-03-20","role":"primary","status":"accepted","detail":"verify-rls.sh 6a probe"}')
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
# audit_read_coord: own rows in the timeoff. / offers. / availability. families - a wider read would be a silent 200 + []).
# 11b runs sql/probes/coordinator-probe.sql: three throwaway users (coordinator / surgeon s3 / admin s1), fixtures in
# 2030-08 keyed 'probe-coord', acts as each of them, ends with RAISE 'PROBE_RESULTS ...;END' so everything rolls back.
# Expectations are the AFTER-migration picture; BEFORE it the fixture setup raises PROBE_SETUP (no coordinator role) and
# this section reports no sentinel - which IS the before picture.
# 11a. client gates (read from the source)
if grep -q 'const isCoordinator = userProfile?.role === "coordinator";' index-source.html && grep -q 'if (view === "settings" && isCoordinator) loadAudit();' index-source.html; then ok "client: isCoordinator is derived from user_profiles.role and the coordinator's Activity log read is its own gated effect (audit_read_coord answers own family rows only)"; else bad "client: the coordinator role flag or its Activity log effect is missing from index-source.html"; fi
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
    expect_eq11  C21 "own_family=1 others=0 own_other=0"           "a coordinator reads only its own timeoff./offers./availability. audit rows (audit_read_coord)"
    expect_eq11  C22 "updated=0"                                   "a coordinator's direct UPDATE of an offer touches nothing"
    expect_eq11  C23 "deleted=0"                                   "a coordinator's direct DELETE of an offer touches nothing"
    expect_err11 C24 42501 'row-level security policy for table "call_schedule_snapshots"' "a coordinator cannot write a snapshot"
    expect_eq11  C25 "contacts=0"                                  "a coordinator reads no office contact"
    expect_err11 C26 OS004 "OFFERS_UNKNOWN_PERSON"                 "save_offers relay for an id that is not on the roster is refused (the office relays for a roster surgeon only; no FK on call_offers.person_id)"
    expect_err11 C27 OM007 "MODE_UNKNOWN_PERSON"                   "set_offer_mode relay for an id that is not on the roster is refused"
    expect_eq11  L1  "ok"                                          "a surgeon still enters his own vacation"
    expect_eq11  L2  "ok rows=1"                                   "a surgeon still inserts his own offer directly (RLS unchanged for surgeons)"
    expect_eq11  L3  "visible=0"                                   "a surgeon still reads no audit row"
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

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
