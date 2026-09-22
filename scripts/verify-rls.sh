#!/usr/bin/env bash
# Silvis Call Schedule - RLS + trigger verification (Prompt 2).
#
#   bash scripts/verify-rls.sh                 anon checks (1-2) + trigger checks (4) via the linked Supabase CLI
#   SILVIS_JWT=<scheduler jwt> bash scripts/verify-rls.sh   also runs the authenticated write check (3)
#   SILVIS_WORKDIR=<dir linked with `supabase link`>          where the CLI's linked project lives (default: $HOME/supabase-silvis)
#
# Never put a JWT or the service-role key in a file. Reads SUPABASE_URL / anon key from config.js.
set -u
cd "$(dirname "$0")/.." || exit 1
URL=$(grep -oE 'SUPABASE_URL\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
ANON=$(grep -oE 'SUPABASE_ANON_KEY\s*=\s*"[^"]+"' config.js | head -1 | sed 's/.*"\(.*\)"/\1/')
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "FAIL: could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js"; exit 1; }
WORKDIR="${SILVIS_WORKDIR:-$HOME/supabase-silvis}"
pass=0; fail=0
ok()   { echo "PASS  $1"; pass=$((pass+1)); }
bad()  { echo "FAIL  $1"; fail=$((fail+1)); }

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
if command -v supabase >/dev/null 2>&1 && [ -f "$WORKDIR/supabase/.temp/project-ref" ]; then
  # q prints the CLI's JSON (a "rows" key on success) or its error text; "accepted" means a real
  # success, never merely the absence of the conflict message.
  q() { supabase db query --linked --workdir "$WORKDIR" -o json "$1" 2>&1 | grep -v 'new version\|recommend updating\|Using workdir\|Initialising'; }
  verdict() { # $1 = output; prints conflict | accepted | error
    if echo "$1" | grep -q ON_CALL_CONFLICT; then echo conflict; elif echo "$1" | grep -q '"rows"'; then echo accepted; else echo error; fi; }
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

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
