#!/usr/bin/env bash
# Silvis Call Schedule - RLS + trigger verification (Prompt 2).
#
#   bash scripts/verify-rls.sh                 anon checks (1-2) + trigger checks (4) + trade-guard probe (5) via the linked Supabase CLI
#   SILVIS_JWT=<scheduler jwt> bash scripts/verify-rls.sh   also runs the authenticated write check (3)
#   SILVIS_SURGEON_JWT=<surgeon jwt> ...                      also runs the REST trade-guard checks (6; a SURGEON-role user's access token)
#   SILVIS_WORKDIR=<dir linked with `supabase link`>          where the CLI's linked project lives (default: $HOME/supabase-silvis)
#
# Never put a JWT or the service-role key in a file. Reads SUPABASE_URL / anon key from config.js.
# Section 5 (Prompt 12 D) runs sql/probes/trade-guards-probe.sql, which rolls itself back: it ends by
# RAISING an exception whose message carries the per-case results, and this script grades them.
set -u
cd "$(dirname "$0")/.." || exit 1
URL=$(grep -oE 'SUPABASE_URL\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
ANON=$(grep -oE 'SUPABASE_ANON_KEY\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "FAIL: could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js"; exit 1; }
WORKDIR="${SILVIS_WORKDIR:-$HOME/supabase-silvis}"
pass=0; fail=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }
# Linked-CLI helpers (sections 4, 5, 6b). q prints the CLI's JSON (a "rows" key on success) or its
# error text; "accepted" means a real success, never merely the absence of the conflict message.
linked()  { command -v supabase >/dev/null 2>&1 && [ -f "$WORKDIR/supabase/.temp/project-ref" ]; }
q()       { supabase db query --linked --workdir "$WORKDIR" -o json "$1" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising'; }
verdict() { # $1 = output; prints conflict | accepted | error
  if echo "$1" | grep -q ON_CALL_CONFLICT; then echo conflict; elif echo "$1" | grep -q '"rows"'; then echo accepted; else echo error; fi; }

echo "== 1. anon read (schedule_days) =="
line=$(curl -s -o /tmp/vr1.json -w 'HTTP %{http_code}' "$URL/rest/v1/schedule_days?select=day&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON")
echo "   $line  body: $(head -c 120 /tmp/vr1.json)"
case "$line" in "HTTP 200") ok "anon read returns 200";; *) bad "anon read: $line";; esac

echo "== 2. anon write blocked (schedule_days) =="
line=$(curl -s -o /tmp/vr2.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d '{"day":"2030-01-01"}')
echo "   $line  body: $(head -c 160 /tmp/vr2.json)"
case "$line" in "HTTP 401"|"HTTP 403") ok "anon write blocked ($line)";; *) bad "anon write: $line (expected 401/403)";; esac

echo "== 3. scheduler JWT write (schedule_days) =="
if [ -n "${SILVIS_JWT:-}" ]; then
  line=$(curl -s -o /tmp/vr3.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/schedule_days" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"day":"2030-01-01","source":"verify-rls","note":"verify-rls.sh probe"}')
  echo "   $line  body: $(head -c 160 /tmp/vr3.json)"
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
  fi
  # Did it roll back? Count every kind of fixture the probe creates (all anon-readable or auth rows).
  LEFTOVER_SQL="select ((select count(*) from public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe') + (select count(*) from public.shift_trade_requests where detail like 'probe %') + (select count(*) from public.time_off where note = 'probe') + (select count(*) from auth.users where email like 'probe-%@example.test'))::int as leftover"
  r=$(q "$LEFTOVER_SQL")
  if [ "$(verdict "$r")" != "accepted" ]; then
    bad "probe leftover count could not be read: $(echo "$r" | tr -d '\n' | head -c 200)"
  elif echo "$r" | tr -d ' \n' | grep -qE '"leftover":"?0"?[,}]'; then   # ::int, but tolerate a string-typed 0
    ok "probe persisted nothing (leftover count 0: schedule_days 2030-03 / trades / time_off / auth.users)"
  else
    bad "probe LEFT ROWS BEHIND ($(echo "$r" | tr -d ' \n' | grep -oE '"leftover":[0-9]+')): the batch did not run as one transaction. Clean up NOW, then report:"
    echo "      delete from public.shift_trade_requests where detail like 'probe %';"
    echo "      delete from public.time_off where note = 'probe';"
    echo "      delete from public.schedule_days where day between '2030-03-01' and '2030-03-31' and source = 'probe';"
    echo "      delete from auth.users where email like 'probe-%@example.test';   -- user_profiles rows cascade"
  fi
else
  echo "   SKIP  (supabase CLI not linked at $WORKDIR)"
fi

echo "== 6. trade guards over REST (JWT-gated; SILVIS_SURGEON_JWT = a surgeon-role user's access token) =="
if [ -n "${SILVIS_SURGEON_JWT:-}" ]; then
  # 6a. insert with status 'accepted' as a surgeon -> lands as 'pending' (from_surgeon_id = the caller)
  line=$(curl -s -o /tmp/vr6a.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/shift_trade_requests" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -H "Prefer: return=representation" -d '{"from_surgeon_id":"s9x","to_surgeon_id":"s9test","day":"2030-03-20","role":"primary","status":"accepted","detail":"verify-rls.sh 6a probe"}')
  st=$(grep -oE '"status":"[a-z]+"' /tmp/vr6a.json | head -1)
  echo "   $line  $st  body: $(head -c 200 /tmp/vr6a.json)"
  if [ "$line" = "HTTP 201" ] && [ "$st" = '"status":"pending"' ]; then ok "surgeon POST with status 'accepted' lands as 'pending'"; else bad "surgeon POST with status 'accepted': $line $st"; fi
  tid=$(grep -oE '"id":"[0-9a-f-]{36}"' /tmp/vr6a.json | head -1 | cut -d'"' -f4)
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
        line=$(curl -s -o /tmp/vr6b.json -w 'HTTP %{http_code}' -X POST "$URL/rest/v1/rpc/apply_trade" -H "apikey: $ANON" -H "Authorization: Bearer $SILVIS_SURGEON_JWT" -H "Content-Type: application/json" -d "{\"p_trade_id\":\"$TID6\"}")
        echo "   $line  body: $(head -c 200 /tmp/vr6b.json)"
        if [ "$line" != "HTTP 200" ] && grep -q 'TRADE_INELIGIBLE' /tmp/vr6b.json && grep -q 'vacation' /tmp/vr6b.json; then ok "apply_trade on the receiver's vacation day is refused ($line TRADE_INELIGIBLE)"; else bad "apply_trade on a vacation day: $line $(head -c 120 /tmp/vr6b.json)"; fi
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

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
