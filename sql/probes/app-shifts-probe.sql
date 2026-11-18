-- ============================================================================
-- Silvis Call Schedule - APP shifts PROBE (2026-11-17, revision ac - Faraz 11/17, Prompt 35: the APPs put themselves on shifts that have
-- hours and enter their own vacations; sql/migrations/2026-11-17-app-shifts.sql, REPORT-FIRST, NOT APPLIED). Proves the typed
-- app_call_days, app_time_off, save_app_days(), save_app_vacations(), app_call_names() and silvis_app_shift_types() on the LIVE database
-- WITHOUT PERSISTING ANYTHING.
--
-- Same mechanism as the other probes: run the whole file as ONE batch through the linked Supabase CLI (the Management API runs it in a
-- single implicit transaction; there is no BEGIN/COMMIT here on purpose). Every case records its observation in a temp table and the
-- LAST statement raises an exception whose message carries the results ('PROBE_RESULTS A1=...;END' - the ';END' sentinel marks where
-- the CLI's own suffix begins), so the throwaway auth users, their profiles, every row and audit row a case wrote AND the probe's edit
-- of the blob (below) roll back. After every run verify-rls.sh section 25 counts leftovers by the probe's identity - its auth users, its
-- audit rows, app_call_days / app_time_off rows in its window and any probe shift type or probe holiday left in the live blob (must be 0).
--
--   supabase db query --linked --workdir <dir> -f <abs>/sql/probes/app-shifts-probe.sql
--   (scripts/verify-rls.sh section 25 runs it, grades each case by name and checks nothing persisted)
--
-- THE BLOB. The shift types are Setup data (groupRules.appShiftTypes), so the probe cannot depend on what the scheduler saved: its setup
-- block (as postgres, inside the rolled-back transaction) sets the blob's groupRules.appShiftTypes to the list below and appends one
-- probe holiday unit (name 'probe holiday', days 2031-03-12 and 2031-03-15) to holidays.units.2031 - the first probe to edit the blob.
-- The final raise rolls the edit back with everything else; while the probe runs, a scheduler's blob save waits for it (a few seconds).
-- The list: inbox (the decided type: Inbox 07:00-17:00 Mon-Fri, not on holidays, perDay 1), probe-night (17:00-07:00 Mon-Fri, perDay 2 -
-- crosses midnight), probe-day (06:00-06:00 Sat/Sun, runs on holidays - 24 hours), probe-long (12:00-20:00 Mon-Fri, perDay given as the
-- string "3" - read as 1), probe-old (inbox's hours, retired) and six junk entries the reader must skip (a second inbox, an id with
-- capitals, hours without a leading zero, an empty and a 7 in weekdays, a string). probe-gone is NOT listed: W1 writes a row of it as
-- postgres - a type Setup has since removed, which the checks count as its whole calendar day.
--
-- The setup raises, in this order and before any fixture is written: BEFORE the migration 'PROBE_SETUP: app_call_days.shift_type is
-- absent - sql/migrations/2026-11-17-app-shifts.sql is not applied' (nothing else runs - that is every case's BEFORE result); a typed
-- table without the vacation table or function 'PROBE_SETUP: app_time_off or save_app_vacations is absent - ... is partly applied'; no
-- blob row 'PROBE_SETUP: the blob row main is absent ...'; then the collision guard (it reads the tables, so it cannot run before they
-- exist): any app_call_days row in 2031-03, in 7031-03 or on 2020-06-01, or any app_time_off row touching 2031-03 or 2020-06, raises
-- 'PROBE_SETUP: live rows already sit in the probe window ...'. AFTER the migration every case below must read as listed.
--
-- Fixtures: no app_call_days or app_time_off row is written by the setup. Every day a case touches is FAR-FUTURE (2031-03 - 3/1 is a
-- Saturday, 3/3 a Monday, 3/12 and 3/15 the probe holiday; 2031-04-01 .. 2032-05-05 for the refused 401-shift case; 2031-03-24 ..
-- 2032-03-24 for the refused 366-day vacation) or the past day 2020-06-01 (a Monday) and the past vacation 2020-06-01 .. 06-05, and
-- 7031-03 for W5-W9 (a far-future typo's vacation 7031-03-03 .. 03-05 and U1's inbox 7031-03-04 / 03-10 - past the int4 minute range;
-- the collision guard and verify-rls 25h's in_window count cover app_call_days in 7031-03 too - a live shift there, an APP's year typo,
-- would answer W7 / W8 AP005 - and the vacation reads only U1's own, so a live vacation there changes nothing).
-- The acting users are seven throwaway auth.users rows (email probe-appshifts-<uuid>@example.test) whose user_profiles rows the
-- handle_new_auth_user trigger creates; postgres then sets them: U1 / U2 / U3 viewer + is_app 'probe shifts one' / 'two' / 'three';
-- US surgeon linked to s3 'probe shifts surgeon'; UC coordinator 'probe shifts office'; UV viewer (not an APP) 'probe shifts viewer';
-- UA admin linked to s1 'probe shifts admin'. Acting as a user: SET LOCAL ROLE authenticated + request.jwt.claims.sub; anon: SET LOCAL
-- ROLE anon + claims ''; no signed-in user = postgres with request.jwt.claims '{}'. Errors are recorded as 'ERR <SQLSTATE> <message>';
-- every ';' in a recorded value becomes ',' (the case separator). State accumulates from case to case (each case is its own
-- subtransaction: a refused case leaves nothing). sad(...) = public.save_app_days(p_profile, p_add, p_clear[, p_replace]) and svac(...) =
-- public.save_app_vacations(p_profile, p_add, p_remove), positional; a shift is written <M/D type> (2031 unless a year is given).
-- Readbacks - stable against live data (verify-rls 25 runs this probe on every later run, when real APP shifts and vacations exist):
-- '<M/D>=<type>:<tag>/<source>+...' with tag one / two / three (U1 / U2 / U3) / other, or '<M/D>=none'; 'by=' the writer of the named days'
-- rows (admin = UA, self = the caller, else other) of the days the case names; 'rows=' / 'vrows=' = the app_call_days rows in 2031-03 / the app_time_off rows
-- touching 2031-03 or 2020-06 the acting role can see; 'vac=' those vacations as <M/D-M/D>:<tag>/<source> in start order; 'names=' =
-- the rows of app_call_names() as the acting role whose profile_id is a probe user ('self=yes' when the caller's own id is among them;
-- one= / two= / three= = U1's / U2's / U3's display name, or app / former for the flag readbacks). Audit readbacks are read AS POSTGRES
-- (the role reset inside the case) over the appdays.save / appvac.save rows whose detail->>'profile_id' is a probe user: 'audit=' /
-- 'vaudit=' / 'audit_rows=' the count; 'actor=' (self = the caller's uuid, else the actor_id), 'name=' the actor_name, 'sums=' the
-- summaries of that actor (or of U1 for A4 / A39) joined by ' | ' in text order; 'last=' the summary of the row whose detail->'replaced'
-- is not empty. P4 / P5 read silvis_app_shift_types() as '<id> <label> <start>-<end> d=<weekdays> h=<t|f> n=<perDay> r=<t|f>' joined by ' | '.
--
-- Cases (BEFORE the migration: every case - PROBE_SETUP, nothing runs; AFTER the migration - the string after '->'; <today M/D> = the
-- run's Central date):
--   P1   postgres: app_call_days - RLS, key, shape check, cascade, policy, privileges -> table=yes rls=yes pk=day,shift_type,profile_id shape=app_call_days_shift_type_shape fk=cascade policies=app_call_days_read/select/authenticated anon_sel=no auth_sel=yes auth_write=no
--   P2   postgres: app_time_off - RLS, key, range check, cascade, policy, privileges -> table=yes rls=yes pk=id range=app_time_off_range fk=cascade policies=app_time_off_read/select/authenticated anon_sel=no auth_sel=yes auth_write=no
--   P3   postgres: the four functions - security, volatility, search_path, grants; the old save_app_days signature is gone -> save=definer/volatile vac=definer/volatile names=definer/stable types=invoker/immutable paths=4 old_save=no save_anon=no save_auth=yes vac_anon=no vac_auth=yes names_anon=no names_auth=yes types_anon=no types_auth=no types_service=yes
--   P4   postgres: silvis_app_shift_types over the blob the probe set (junk entries skipped, a string perDay read as 1) -> inbox Inbox 420-1020 d=1,2,3,4,5 h=f n=1 r=f | probe-night Probe night 1020-420 d=1,2,3,4,5 h=f n=2 r=f | probe-day Probe day 360-360 d=0,6 h=t n=1 r=f | probe-long Probe long 720-1200 d=1,2,3,4,5 h=f n=1 r=f | probe-old Probe old 420-1020 d=1,2,3,4,5 h=f n=1 r=t
--   P5   postgres: the default - no key, a null blob, a key that is not a list, an empty list -> absent=inbox Inbox 420-1020 d=1,2,3,4,5 h=f n=1 r=f null=inbox Inbox 420-1020 d=1,2,3,4,5 h=f n=1 r=f notlist=inbox Inbox 420-1020 d=1,2,3,4,5 h=f n=1 r=f empty=none
--   A1   U1 sad(null, inbox 3/3 + 3/4) -> ok added=2 removed=0 kept=0 source=app 3/3=inbox:one/app 3/4=inbox:one/app by=self
--   A2   its audit row (read as postgres) -> audit=1 actor=self name=probe shifts one sums=probe shifts one: inbox 3/3, 3/4
--   A3   U1 the same two again (idempotent) -> ok added=0 kept=2 audit=false audit_rows=1
--   A4   U1 clears inbox 3/4 -> ok removed=1 3/4=none sums=probe shifts one: inbox 3/3, 3/4 | probe shifts one: removed inbox 3/4
--   A5   U1 clears inbox 3/5 (nobody holds it) -> ok removed=0 absent=1 audit=false
--   A6   U1 adds and clears inbox 3/5 in one call -> ERR AP004 APP_DAY_BAD_DAY: 3/5 inbox is both added and removed in one save - nothing was saved
--   A7   U1 sends a bare day string (no type) -> ERR AP004 APP_DAY_BAD_DAY: a shift in the list is not a day and a shift type - nothing was saved
--   A8   U1 sends 2031-02-30 -> ERR AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved
--   A9   U1 sends 401 shifts -> ERR AP004 APP_DAY_BAD_DAY: at most 400 shifts in one save - nothing was saved
--   A10  U1 adds inbox 2020-06-01 (a past day) -> ERR AP006 APP_DAY_PAST: 6/1 is before today (<today M/D>) in Central time - a past day stays as it was
--   A11  U1 sad(U2, inbox 3/5) -> ERR AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own shifts - ask the scheduler
--   A12  U1 sad(U1, inbox 3/5, null, U2) - a change -> ERR AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a shift
--   A13  U1 direct insert into app_call_days -> ERR 42501 permission denied for table app_call_days
--   A14  U1 adds inbox Saturday 3/1 -> ERR AP008 APP_DAY_NO_SHIFT: 3/1 is a Saturday (Inbox does not run that day) - nothing was saved
--   A15  U1 adds inbox Wednesday 3/12 (the probe's holiday) -> ERR AP008 APP_DAY_NO_SHIFT: 3/12 is a holiday (Inbox does not run on holidays) - nothing was saved
--   A16  U1 adds a type the blob does not list -> ERR AP008 APP_DAY_NO_SHIFT: there is no nosuch shift type - nothing was saved
--   A17  U1 adds the retired probe-old 3/5 (and inbox 3/6 with it) -> ERR AP008 APP_DAY_NO_SHIFT: the probe-old shift is retired - nothing was saved
--   A17s state of 3/6 after A17 (all or nothing) -> 3/6=none
--   A18  U1 adds probe-night 3/3 (5p-7a; its inbox 7a-5p only touches it at 5p) -> ok added=1 3/3=inbox:one/app+probe-night:one/app
--   A19  U1 adds probe-long 3/3 (12p-8p) over both -> ERR AP009 APP_DAY_OVERLAP: 3/3 probe-long overlaps 3/3 inbox, 3/3 probe-long overlaps 3/3 probe-night - one APP holds one shift at a time (nothing was saved)
--   A20  U1 adds probe-night Fri 3/7 (to 7a Sat) and probe-day Sat 3/8 (from 6a) in one call -> ERR AP009 APP_DAY_OVERLAP: 3/7 probe-night overlaps 3/8 probe-day - one APP holds one shift at a time (nothing was saved)
--   A21  U1 adds probe-day Sat 3/15 (a probe holiday; the type runs on holidays) -> ok added=1 3/15=probe-day:one/app
--   A22  U1 adds probe-night Fri 3/14 (to 7a Sat) - over the kept probe-day 3/15 (from 6a) -> ERR AP009 APP_DAY_OVERLAP: 3/14 probe-night overlaps 3/15 probe-day - one APP holds one shift at a time (nothing was saved)
--   A23  U1 reads the window -> rows=3
--   A24  U1 app_call_names() -> names=1 self=yes
--   A25  U1 calls silvis_app_shift_types (internal) -> ERR 42501 permission denied for function silvis_app_shift_types
--   A26  U1 svac(null, 3/17-3/21) -> ok added=1 removed=0 kept=0 source=app vac=3/17-3/21:one/app
--   A27  its audit row (read as postgres) -> vaudit=1 actor=self name=probe shifts one sums=probe shifts one: vacation 3/17-3/21
--   A28  U1 the same vacation again (idempotent) -> ok added=0 kept=1 audit=false
--   A29  U1 adds inbox 3/18 (inside its vacation) -> ERR AP010 APP_DAY_VACATION: 3/18 inbox is on probe shifts one's vacation - change the vacation first (nothing was saved)
--   A30  U1 adds probe-day Sun 3/16 (6a to 6a Mon 3/17 - into the vacation) -> ERR AP010 APP_DAY_VACATION: 3/16 probe-day is on probe shifts one's vacation - change the vacation first (nothing was saved)
--   A31  U1 svac 3/3 over its own inbox and probe-night 3/3 -> ERR AV005 APP_VACATION_ON_SHIFT: probe shifts one holds 3/3 inbox, 3/3 probe-night - remove the shift first (nothing was saved)
--   A32  U1 svac 3/4-3/5 (its probe-night 3/3 runs to 7a 3/4) -> ERR AV005 APP_VACATION_ON_SHIFT: probe shifts one holds 3/3 probe-night - remove the shift first (nothing was saved)
--   A33  U1 svac 3/20-3/25 (touches its 3/17-3/21) -> ERR AV008 APP_VACATION_OVERLAP: probe shifts one is already away 3/17-3/21 - change that vacation instead (nothing was saved)
--   A34  U1 svac 3/25-3/24 -> ERR AV004 APP_VACATION_BAD_RANGE: 3/25-3/24 ends before it starts - nothing was saved
--   A35  U1 svac 3/24-3/26 and 3/26-3/28 in one call -> ERR AV004 APP_VACATION_BAD_RANGE: 3/24-3/26 and 3/26-3/28 overlap - nothing was saved
--   A36  U1 svac 2031-03-24 to 2032-03-24 (366 days) -> ERR AV004 APP_VACATION_BAD_RANGE: 3/24-3/24 is longer than a year - nothing was saved
--   A37  U1 svac(U2, 3/24-3/26) -> ERR AV002 APP_VACATION_NOT_YOURS: an APP enters, changes or removes only their own vacations - ask the scheduler or the office
--   A38  U1 direct insert into app_time_off -> ERR 42501 permission denied for table app_time_off
--   A39  U1 changes 3/17-3/21 to 3/17-3/22 (remove + add, one call) -> ok added=1 removed=1 vac=3/17-3/22:one/app sums=probe shifts one: vacation 3/17-3/21 | probe shifts one: vacation 3/17-3/22, removed vacation 3/17-3/21
--   A40  U1 removes an id that does not exist -> ERR AV007 APP_VACATION_STALE: a vacation in the list is gone or is not probe shifts one's - reload Time off (nothing was saved)
--   A41  U1 sends a vacation that is a bare string -> ERR AV004 APP_VACATION_BAD_RANGE: a vacation in the list is not a first and a last day - nothing was saved
--   A42  U1 reads the APP vacations of the window -> vrows=1
--   A43  U1 svac 2031-02-30 -> ERR AV004 APP_VACATION_BAD_RANGE: a day in the list is not a calendar day - nothing was saved
--   A44  U1 (an APP) renames itself -> ERR 42501 new row violates row-level security policy for table "user_profiles"
--   A45  U1 sets its own display_name to the same value -> updated=1
--   B1   U2 adds inbox 3/3 (U1 holds it; perDay 1) -> ERR AP005 APP_DAY_TAKEN: 3/3 inbox already has probe shifts one - nothing was saved
--   B1s  state of 3/3 after B1 -> 3/3=inbox:one/app+probe-night:one/app
--   B2   U2 adds probe-night 3/3 (U1 holds 1 of 2) -> ok added=1 3/3=inbox:one/app+probe-night:one/app+probe-night:two/app
--   B3   U2 clears U1's inbox 3/3 -> ERR AP002 APP_DAY_NOT_YOURS: 3/3 inbox is probe shifts one's shift - only that APP or the scheduler can remove it (nothing was saved)
--   B4   U2 adds inbox 3/10, 3/3, 3/11 -> ERR AP005 APP_DAY_TAKEN: 3/3 inbox already has probe shifts one - nothing was saved
--   B4s  state of 3/10 after B4 (all or nothing) -> 3/10=none
--   B5   U2 removes U1's vacation by its id -> ERR AV007 APP_VACATION_STALE: a vacation in the list is gone or is not probe shifts two's - reload Time off (nothing was saved)
--   B6   U2 svac(null, 3/27-3/28) -> ok added=1 source=app vac=3/17-3/22:one/app+3/27-3/28:two/app
--   B7   U2 reads the APP vacations of the window -> vrows=2
--   B8   U2 app_call_names() -> names=2
--   S1   US sad(null, inbox 3/10) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   S2   US svac(U1, 3/24-3/26) -> ERR AV001 APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation
--   S3   US reads the window -> rows=4
--   S4   US reads the APP vacations of the window -> vrows=2
--   S5   US app_call_names() -> names=2 one=probe shifts one two=probe shifts two three=-
--   S6   US direct insert into app_time_off -> ERR 42501 permission denied for table app_time_off
--   C1   UC sad(U1, inbox 3/10) - shifts are not the office's -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   C2   UC svac(U2, 3/24-3/26) -> ok added=1 source=office vac=3/17-3/22:one/app+3/24-3/26:two/office+3/27-3/28:two/app
--   C3   its audit row (read as postgres) -> actor=self name=probe shifts office sums=probe shifts two: vacation 3/24-3/26
--   C4   UC removes it again -> ok removed=1 source=office vac=3/17-3/22:one/app+3/27-3/28:two/app
--   C5   UC svac(null, 3/24-3/26) -> ERR AV001 APP_VACATION_NOT_ALLOWED: name the APP (pick one in Time off)
--   C6   UC svac(UV - not an APP, 3/24-3/26) -> ERR AV003 APP_VACATION_NOT_APP: probe shifts viewer is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   C7   UC app_call_names() - every APP, U3 holding nothing included -> names=3 one=app two=app three=app
--   C8   UC reads the window and the vacations -> rows=4 vrows=2
--   C9   UC svac(U3, 3/29-3/30) - U3 holds no shift yet -> ok added=1 source=office
--   S7   US app_call_names() - U3 holds only a vacation (the vacation clause names it) -> names=3 one=probe shifts one two=probe shifts two three=probe shifts three
--   T1   U3 adds probe-night 3/3 (U1 and U2 hold both of its 2) -> ERR AP005 APP_DAY_TAKEN: 3/3 probe-night already has probe shifts one and probe shifts two (2 a day) - nothing was saved
--   T2   U3 adds inbox 3/6 -> ok added=1 3/6=inbox:three/app
--   V1   UV sad(null, inbox 3/10) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   V2   UV svac(null, 3/24-3/26) -> ERR AV001 APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation
--   V3   UV reads the window and the vacations -> rows=5 vrows=3
--   D1   UA sad(U2, inbox 3/10) -> ok added=1 source=scheduler 3/10=inbox:two/scheduler by=admin
--   D2   its audit row (read as postgres) -> actor=s1 name=probe shifts admin sums=probe shifts two: inbox 3/10
--   D3   UA clears it -> ok removed=1 3/10=none
--   D4   UA sad(U1, inbox 2020-06-01) - a past day (the scheduler is exempt) -> ok added=1 6/1=inbox:one/scheduler
--   D5   UA clears it -> ok removed=1 6/1=none
--   D6   UA sad(U2, inbox 3/3) - U1 holds it -> ERR AP005 APP_DAY_TAKEN: 3/3 inbox already has probe shifts one - nothing was saved
--   D7   UA's change: sad(U2, inbox 3/3, null, U1) -> ok added=1 replaced=1 3/3=inbox:two/scheduler+probe-night:one/app+probe-night:two/app last=probe shifts two: inbox 3/3 (was probe shifts one)
--   D8   UA's change again from U1 - U1 no longer holds it -> ERR AP007 APP_DAY_STALE: 3/3 inbox is no longer probe shifts one's shift - reload the calendar (nothing was saved)
--   D9   UA clears U1's inbox 3/3 - U2 holds it now -> ERR AP007 APP_DAY_STALE: 3/3 inbox is probe shifts two's shift - reload the calendar (nothing was saved)
--   D10  UA sad(UV, inbox 3/11) - not an APP -> ERR AP003 APP_DAY_NOT_APP: probe shifts viewer is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   D11  UA sad(<a random uuid>, inbox 3/11) -> ERR AP003 APP_DAY_NOT_APP: that account is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   D12  UA sad(null, inbox 3/11) -> ERR AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)
--   D13  UA's change naming the same APP twice: sad(U2, inbox 3/11, null, U2) -> ERR AP004 APP_DAY_BAD_DAY: a change takes a shift over from another APP - name the shift and that APP (nothing was saved)
--   D14  UA svac(U1, 2020-06-01 to 2020-06-05) - a past vacation (no past check on an add) -> ok added=1 source=scheduler vac=6/1-6/5:one/scheduler+3/17-3/22:one/app+3/27-3/28:two/app+3/29-3/30:three/office
--   D15  UA svac(U2, 3/3) over U2's inbox and probe-night 3/3 -> ERR AV005 APP_VACATION_ON_SHIFT: probe shifts two holds 3/3 inbox, 3/3 probe-night - remove the shift first (nothing was saved)
--   D16  UA sad(U1, inbox 3/19) - inside U1's vacation -> ERR AP010 APP_DAY_VACATION: 3/19 inbox is on probe shifts one's vacation - change the vacation first (nothing was saved)
--   D17  UA app_call_names() -> names=3 one=app two=app three=app
--   D18  UA sets is_app = false on U3 -> updated=1 is_app=false
--   D19  UA's change of probe-night 3/3 from U1 to U2 - U2 holds it already (perDay 2) -> ERR AP007 APP_DAY_STALE: 3/3 probe-night is already probe shifts two's shift - reload the calendar (nothing was saved)
--   D19s state of 3/3 after D19 (U1's row stays) -> 3/3=inbox:two/scheduler+probe-night:one/app+probe-night:two/app
--   F1   U1 removes its 2020-06-01 to 06-05 vacation -> ERR AV006 APP_VACATION_PAST: 6/1-6/5 has started or passed (today is <today M/D> in Central time) - it stays on record, ask the scheduler if it needs to go (nothing was saved)
--   G1   UC removes U1's 2020-06-01 to 06-05 vacation -> ERR AV006 APP_VACATION_PAST: 6/1-6/5 has started or passed (today is <today M/D> in Central time) - it stays on record, ask the scheduler if it needs to go (nothing was saved)
--   H1   U3 sad(null, inbox 3/13) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   H2   U3 svac(null, 3/24-3/26) -> ERR AV001 APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation
--   H3   U3 reads 3/6 (its shift stays) -> 3/6=inbox:three/app
--   E1   UA app_call_names() -> names=3 one=app two=app three=former
--   E2   UA removes U1's started vacation (the scheduler is exempt) -> ok removed=1 vac=3/17-3/22:one/app+3/27-3/28:two/app+3/29-3/30:three/office
--   E3   UA clears the former APP's inbox 3/6 (AP003 binds adds only) -> ok removed=1 3/6=none
--   E4   UA svac(U3, 3/24-3/26) - a former APP -> ERR AV003 APP_VACATION_NOT_APP: probe shifts three is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   E5   UA sad(U3, inbox 3/13) - a former APP -> ERR AP003 APP_DAY_NOT_APP: probe shifts three is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   E6   UA sets is_app = true on US (a surgeon) -> ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_app_viewer"
--   E7   UA sets is_app = true on UC (the coordinator) -> ERR 23514 new row for relation "user_profiles" violates check constraint "user_profiles_app_viewer"
--   W1   postgres writes U1 a row of a type the blob does not list (probe-gone, Thu 3/27) -> inserted 3/27=probe-gone:one/scheduler
--   W2   U1 adds inbox 3/27 (the unlisted row counts as its whole day) -> ERR AP009 APP_DAY_OVERLAP: 3/27 inbox overlaps 3/27 probe-gone - one APP holds one shift at a time (nothing was saved)
--   W3   U1 svac 3/27 over it -> ERR AV005 APP_VACATION_ON_SHIFT: probe shifts one holds 3/27 probe-gone - remove the shift first (nothing was saved)
--   W4   U1 svac 3/28 (the whole day ends at midnight - touching, not overlapping) -> ok added=1 source=app
--   W5   U1 svac(null, 7031-03-03 to 7031-03-05) - a far-future typo (the minutes are bigint) -> ok added=1 source=app
--   W6   U1 adds inbox Mon 3/31 (AP010 reads the 7031 vacation) -> ok added=1 3/31=inbox:one/app
--   W7   U1 adds inbox Fri 7031-03-04 (inside that vacation) -> ERR AP010 APP_DAY_VACATION: 3/4 inbox is on probe shifts one's vacation - change the vacation first (nothing was saved)
--   W8   U1 adds inbox Thu 7031-03-10 (AP009 places it against U1's other shifts) -> ok added=1 3/10=inbox:one/app
--   W9   U1 svac 7031-03-10 over it -> ERR AV005 APP_VACATION_ON_SHIFT: probe shifts one holds 3/10 inbox - remove the shift first (nothing was saved)
--   N1   anon: select count(*) from app_call_days -> ERR 42501 permission denied for table app_call_days
--   N2   anon: select count(*) from app_time_off -> ERR 42501 permission denied for table app_time_off
--   N3   anon: app_call_names() -> ERR 42501 permission denied for function app_call_names
--   N4   anon: sad(U2, inbox 3/13) -> ERR 42501 permission denied for function save_app_days
--   N5   anon: svac(U2, 3/24-3/26) -> ERR 42501 permission denied for function save_app_vacations
--   N6   anon: silvis_app_shift_types('{}') -> ERR 42501 permission denied for function silvis_app_shift_types
--   N7   postgres, no signed-in user: sad(U2, inbox 3/13) -> ERR AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   N8   postgres, no signed-in user: svac(U2, 3/24-3/26) -> ERR AV001 APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation
--   N9   postgres, no signed-in user: app_call_names() -> names=0
--   X1   postgres deletes U2's auth user (U2 holds inbox and probe-night 3/3 and the vacation 3/27-3/28) -> before=2/1 after=0/0 audit_kept=yes
--   I1   postgres deletes UV's profile; UV self-inserts with is_app = true -> ERR 42501 new row violates row-level security policy for table "user_profiles"
--   I2   UV self-inserts (viewer, no is_app key) -> ok is_app=false
-- 135 cases.
-- ============================================================================

create temp table probe_results (k text, v text);
grant insert, select on probe_results to authenticated;
grant insert, select on probe_results to anon;
create temp table probe_ctx (k text primary key, v text);
grant select on probe_ctx to authenticated;

-- ---------- setup (as postgres: RLS bypassed, no signed-in user)
do $$
declare
  u1   uuid := gen_random_uuid();
  u2   uuid := gen_random_uuid();
  u3   uuid := gen_random_uuid();
  us   uuid := gen_random_uuid();
  uc   uuid := gen_random_uuid();
  uv   uuid := gen_random_uuid();
  ua   uuid := gen_random_uuid();
begin
  if to_regclass('public.app_call_days') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.app_call_days'::regclass and a.attname = 'shift_type' and not a.attisdropped) then
    raise exception 'PROBE_SETUP: app_call_days.shift_type is absent - sql/migrations/2026-11-17-app-shifts.sql is not applied';
  end if;
  if to_regclass('public.app_time_off') is null or to_regprocedure('public.save_app_vacations(uuid, jsonb, uuid[])') is null then
    raise exception 'PROBE_SETUP: app_time_off or save_app_vacations is absent - sql/migrations/2026-11-17-app-shifts.sql is partly applied';
  end if;
  if not exists (select 1 from public.call_schedule_data c where c.id = 'main') then
    raise exception 'PROBE_SETUP: the blob row main is absent - the probe sets its shift types there';
  end if;
  -- the collision guard (after the absent checks: it reads the tables)
  if exists (select 1 from public.app_call_days d where d.day between '2031-03-01' and '2031-03-31' or d.day between '7031-03-01' and '7031-03-31' or d.day = '2020-06-01')
     or exists (select 1 from public.app_time_off v where (v.start_date <= '2031-03-31' and v.end_date >= '2031-03-01') or (v.start_date <= '2020-06-30' and v.end_date >= '2020-06-01')) then
    raise exception 'PROBE_SETUP: live rows already sit in the probe window (app_call_days in 2031-03, in 7031-03 or on 2020-06-01, app_time_off touching 2031-03 or 2020-06) - the probe fixtures would collide';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'probe-appshifts-' || u || '@example.test', '', now(),
         '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', false
    from unnest(array[u1, u2, u3, us, uc, uv, ua]) as u;
  if (select count(*) from public.user_profiles where id in (u1, u2, u3, us, uc, uv, ua)) <> 7 then
    raise exception 'PROBE_SETUP: handle_new_auth_user did not create the profile rows';
  end if;
  update public.user_profiles set display_name = 'probe shifts one', is_app = true where id = u1;
  update public.user_profiles set display_name = 'probe shifts two', is_app = true where id = u2;
  update public.user_profiles set display_name = 'probe shifts three', is_app = true where id = u3;
  update public.user_profiles set person_id = 's3', role = 'surgeon', display_name = 'probe shifts surgeon' where id = us;
  update public.user_profiles set role = 'coordinator', display_name = 'probe shifts office' where id = uc;
  update public.user_profiles set display_name = 'probe shifts viewer' where id = uv;
  update public.user_profiles set person_id = 's1', role = 'admin', display_name = 'probe shifts admin' where id = ua;
  insert into probe_ctx values ('u1', u1::text), ('u2', u2::text), ('u3', u3::text), ('us', us::text), ('uc', uc::text), ('uv', uv::text), ('ua', ua::text);
  -- the probe's shift types and holiday, set inside the rolled-back transaction (see THE BLOB above)
  update public.call_schedule_data c
     set data = c.data
       || jsonb_build_object('groupRules', (case when jsonb_typeof(c.data -> 'groupRules') = 'object' then c.data -> 'groupRules' else '{}'::jsonb end)
            || jsonb_build_object('appShiftTypes', '[
                 {"id":"inbox","label":"Inbox","start":"07:00","end":"17:00","weekdays":[1,2,3,4,5],"holidays":false,"perDay":1},
                 {"id":"probe-night","label":"Probe night","start":"17:00","end":"07:00","weekdays":[1,2,3,4,5],"perDay":2},
                 {"id":"probe-day","label":"Probe day","start":"06:00","end":"06:00","weekdays":[0,6],"holidays":true,"perDay":1},
                 {"id":"probe-long","label":"Probe long","start":"12:00","end":"20:00","weekdays":[1,2,3,4,5],"perDay":"3"},
                 {"id":"probe-old","label":"Probe old","start":"07:00","end":"17:00","weekdays":[1,2,3,4,5],"retired":true},
                 {"id":"inbox","label":"A second inbox","start":"08:00","end":"09:00","weekdays":[1]},
                 {"id":"Probe-caps","start":"07:00","end":"17:00","weekdays":[1]},
                 {"id":"probe-hours","start":"7:00","end":"17:00","weekdays":[1]},
                 {"id":"probe-nodays","start":"07:00","end":"17:00","weekdays":[]},
                 {"id":"probe-day7","start":"07:00","end":"17:00","weekdays":[7]},
                 "probe-string"]'::jsonb))
       || jsonb_build_object('holidays', (case when jsonb_typeof(c.data -> 'holidays') = 'object' then c.data -> 'holidays' else '{}'::jsonb end)
            || jsonb_build_object('units', (case when jsonb_typeof(c.data #> '{holidays,units}') = 'object' then c.data #> '{holidays,units}' else '{}'::jsonb end)
                 || jsonb_build_object('2031', (case when jsonb_typeof(c.data #> '{holidays,units,2031}') = 'array' then c.data #> '{holidays,units,2031}' else '[]'::jsonb end)
                      || '[{"name":"probe holiday","tier":"minor","days":["2031-03-12","2031-03-15"]}]'::jsonb)))
   where c.id = 'main';
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- readbacks (plain SQL in pg_temp; an acting role reads the tables through their select policies)
create or replace function pg_temp.as_tag(p uuid) returns text language sql as $$
  select case p::text when (select c.v from probe_ctx c where c.k = 'u1') then 'one' when (select c.v from probe_ctx c where c.k = 'u2') then 'two'
                      when (select c.v from probe_ctx c where c.k = 'u3') then 'three' else 'other' end;
$$;
create or replace function pg_temp.as_day(p_day date) returns text language sql as $$
  select to_char(p_day, 'FMMM/FMDD') || '=' || coalesce((select string_agg(a.shift_type || ':' || pg_temp.as_tag(a.profile_id) || '/' || a.source, '+'
                                                                            order by a.shift_type collate "C", pg_temp.as_tag(a.profile_id) collate "C")
                                                           from public.app_call_days a where a.day = p_day), 'none');
$$;
create or replace function pg_temp.as_by(p_days date[]) returns text language sql as $$
  select 'by=' || coalesce(string_agg(distinct case when a.created_by::text = (select c.v from probe_ctx c where c.k = 'ua') then 'admin' when a.created_by = auth.uid() then 'self' else 'other' end, ','), 'none')
    from public.app_call_days a where a.day = any(p_days);
$$;
create or replace function pg_temp.as_rows() returns text language sql as $$
  select 'rows=' || count(*) from public.app_call_days a where a.day between '2031-03-01' and '2031-03-31';
$$;
create or replace function pg_temp.as_vrows() returns text language sql as $$
  select 'vrows=' || count(*) from public.app_time_off v
   where (v.start_date <= '2031-03-31' and v.end_date >= '2031-03-01') or (v.start_date <= '2020-06-30' and v.end_date >= '2020-06-01');
$$;
create or replace function pg_temp.as_vacs() returns text language sql as $$
  select 'vac=' || coalesce(string_agg(to_char(v.start_date, 'FMMM/FMDD') || case when v.end_date > v.start_date then '-' || to_char(v.end_date, 'FMMM/FMDD') else '' end
                                       || ':' || pg_temp.as_tag(v.profile_id) || '/' || v.source, '+' order by v.start_date, v.end_date, pg_temp.as_tag(v.profile_id) collate "C"), 'none')
    from public.app_time_off v
   where (v.start_date <= '2031-03-31' and v.end_date >= '2031-03-01') or (v.start_date <= '2020-06-30' and v.end_date >= '2020-06-01');
$$;
create or replace function pg_temp.as_names(p_mode text) returns text language sql as $$
  with n as (
    select x.profile_id, x.display_name, x.is_app from public.app_call_names() x
     where x.profile_id::text in (select c.v from probe_ctx c)
  )
  select 'names=' || (select count(*) from n)
      || case p_mode
           when 'self' then ' self=' || case when exists (select 1 from n where n.profile_id = auth.uid()) then 'yes' else 'no' end
           when 'names' then ' one=' || coalesce((select n.display_name from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u1')), '-')
                          || ' two=' || coalesce((select n.display_name from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u2')), '-')
                          || ' three=' || coalesce((select n.display_name from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u3')), '-')
           when 'flags' then ' one=' || coalesce((select case when n.is_app then 'app' else 'former' end from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u1')), '-')
                          || ' two=' || coalesce((select case when n.is_app then 'app' else 'former' end from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u2')), '-')
                          || ' three=' || coalesce((select case when n.is_app then 'app' else 'former' end from n where n.profile_id::text = (select c.v from probe_ctx c where c.k = 'u3')), '-')
           else '' end;
$$;
create or replace function pg_temp.as_types(p_data jsonb) returns text language sql as $$
  select coalesce(string_agg(t.id || ' ' || t.label || ' ' || t.start_min || '-' || t.end_min || ' d=' || array_to_string(t.weekdays, ',')
                             || ' h=' || case when t.holidays then 't' else 'f' end || ' n=' || t.per_day || ' r=' || case when t.retired then 't' else 'f' end, ' | ' order by t.ord), 'none')
    from public.silvis_app_shift_types(p_data) with ordinality as t(id, label, start_min, end_min, weekdays, holidays, per_day, retired, ord);
$$;
-- audit readbacks: read as postgres (the cases reset the role first), over the appdays.save / appvac.save rows naming a probe user only
create or replace function pg_temp.as_audit_n(p_action text) returns bigint language sql as $$
  select count(*) from public.audit_log l where l.action = p_action and l.detail ->> 'profile_id' in (select c.v from probe_ctx c);
$$;
create or replace function pg_temp.as_sums(p_action text, p_actor text) returns text language sql as $$
  select 'sums=' || coalesce(string_agg(l.detail ->> 'summary', ' | ' order by l.detail ->> 'summary' collate "C"), 'none')
    from public.audit_log l where l.action = p_action and l.detail ->> 'profile_id' in (select c.v from probe_ctx c) and l.actor_id = p_actor;
$$;
create or replace function pg_temp.as_audit(p_action text, p_target text, p_source text, p_self text) returns text language sql as $$
  with t as (
    select l.actor_id, l.actor_name from public.audit_log l
     where l.action = p_action and l.detail ->> 'profile_id' = p_target and l.detail ->> 'source' = p_source
  )
  select 'actor=' || coalesce((select string_agg(distinct case when t.actor_id = p_self then 'self' else t.actor_id end, ',') from t), 'none')
      || ' name=' || coalesce((select string_agg(distinct t.actor_name, ',') from t), 'none')
      || ' ' || pg_temp.as_sums(p_action, (select min(t.actor_id) from t));
$$;
create or replace function pg_temp.as_last() returns text language sql as $$
  select 'last=' || coalesce(string_agg(l.detail ->> 'summary', ' | ' order by l.detail ->> 'summary' collate "C"), 'none')
    from public.audit_log l where l.action = 'appdays.save' and l.detail ->> 'profile_id' in (select c.v from probe_ctx c)
     and jsonb_typeof(l.detail -> 'replaced') = 'array' and jsonb_array_length(l.detail -> 'replaced') > 0;
$$;

-- P1-P5: as postgres - the objects as the migration leaves them
do $$ declare s regprocedure; vf regprocedure; n regprocedure; t regprocedure; begin
  perform set_config('request.jwt.claims', '{}', true);
  begin
    insert into probe_results values ('P1', replace('table=' || case when to_regclass('public.app_call_days') is not null then 'yes' else 'no' end
      || ' rls=' || case when (select c.relrowsecurity from pg_class c where c.oid = 'public.app_call_days'::regclass) then 'yes' else 'no' end
      || ' pk=' || coalesce((select string_agg(a.attname, ',' order by array_position(k.conkey, a.attnum)) from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                             where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'p'), 'none')
      || ' shape=' || coalesce((select string_agg(k.conname, ',' order by k.conname) from pg_constraint k where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%shift_type%'), 'none')
      || ' fk=' || coalesce((select case k.confdeltype when 'c' then 'cascade' else k.confdeltype::text end from pg_constraint k
                             where k.conrelid = 'public.app_call_days'::regclass and k.contype = 'f' and k.confrelid = 'public.user_profiles'::regclass limit 1), 'none')
      || ' policies=' || coalesce((select string_agg(p.policyname || '/' || lower(p.cmd) || '/' || array_to_string(p.roles, ','), ',' order by p.policyname)
                                   from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_call_days'), 'none')
      || ' anon_sel=' || case when has_table_privilege('anon', 'public.app_call_days', 'select') then 'yes' else 'no' end
      || ' auth_sel=' || case when has_table_privilege('authenticated', 'public.app_call_days', 'select') then 'yes' else 'no' end
      || ' auth_write=' || case when has_table_privilege('authenticated', 'public.app_call_days', 'insert') or has_table_privilege('authenticated', 'public.app_call_days', 'update')
                                  or has_table_privilege('authenticated', 'public.app_call_days', 'delete') or has_table_privilege('authenticated', 'public.app_call_days', 'truncate') then 'yes' else 'no' end, ';', ','));
  exception when others then insert into probe_results values ('P1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P2', replace('table=' || case when to_regclass('public.app_time_off') is not null then 'yes' else 'no' end
      || ' rls=' || case when (select c.relrowsecurity from pg_class c where c.oid = 'public.app_time_off'::regclass) then 'yes' else 'no' end
      || ' pk=' || coalesce((select string_agg(a.attname, ',' order by array_position(k.conkey, a.attnum)) from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
                             where k.conrelid = 'public.app_time_off'::regclass and k.contype = 'p'), 'none')
      || ' range=' || coalesce((select string_agg(k.conname, ',' order by k.conname) from pg_constraint k where k.conrelid = 'public.app_time_off'::regclass and k.contype = 'c' and k.conname = 'app_time_off_range'), 'none')
      || ' fk=' || coalesce((select case k.confdeltype when 'c' then 'cascade' else k.confdeltype::text end from pg_constraint k
                             where k.conrelid = 'public.app_time_off'::regclass and k.contype = 'f' and k.confrelid = 'public.user_profiles'::regclass limit 1), 'none')
      || ' policies=' || coalesce((select string_agg(p.policyname || '/' || lower(p.cmd) || '/' || array_to_string(p.roles, ','), ',' order by p.policyname)
                                   from pg_policies p where p.schemaname = 'public' and p.tablename = 'app_time_off'), 'none')
      || ' anon_sel=' || case when has_table_privilege('anon', 'public.app_time_off', 'select') then 'yes' else 'no' end
      || ' auth_sel=' || case when has_table_privilege('authenticated', 'public.app_time_off', 'select') then 'yes' else 'no' end
      || ' auth_write=' || case when has_table_privilege('authenticated', 'public.app_time_off', 'insert') or has_table_privilege('authenticated', 'public.app_time_off', 'update')
                                  or has_table_privilege('authenticated', 'public.app_time_off', 'delete') or has_table_privilege('authenticated', 'public.app_time_off', 'truncate') then 'yes' else 'no' end, ';', ','));
  exception when others then insert into probe_results values ('P2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    s := to_regprocedure('public.save_app_days(uuid, jsonb, jsonb, uuid)');
    vf := to_regprocedure('public.save_app_vacations(uuid, jsonb, uuid[])');
    n := to_regprocedure('public.app_call_names()');
    t := to_regprocedure('public.silvis_app_shift_types(jsonb)');
    insert into probe_results values ('P3', replace('save=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = s), 'none')
      || ' vac=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = vf), 'none')
      || ' names=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = n), 'none')
      || ' types=' || coalesce((select case when p.prosecdef then 'definer' else 'invoker' end || '/' || case p.provolatile when 'v' then 'volatile' when 's' then 'stable' else 'immutable' end from pg_proc p where p.oid = t), 'none')
      || ' paths=' || (select count(*) from pg_proc p where p.oid in (s, vf, n, t) and 'search_path=public, pg_temp' = any(p.proconfig))
      || ' old_save=' || case when to_regprocedure('public.save_app_days(uuid, date[], date[], boolean)') is null then 'no' else 'yes' end
      || ' save_anon=' || case when has_function_privilege('anon', s, 'execute') then 'yes' else 'no' end
      || ' save_auth=' || case when has_function_privilege('authenticated', s, 'execute') then 'yes' else 'no' end
      || ' vac_anon=' || case when has_function_privilege('anon', vf, 'execute') then 'yes' else 'no' end
      || ' vac_auth=' || case when has_function_privilege('authenticated', vf, 'execute') then 'yes' else 'no' end
      || ' names_anon=' || case when has_function_privilege('anon', n, 'execute') then 'yes' else 'no' end
      || ' names_auth=' || case when has_function_privilege('authenticated', n, 'execute') then 'yes' else 'no' end
      || ' types_anon=' || case when has_function_privilege('anon', t, 'execute') then 'yes' else 'no' end
      || ' types_auth=' || case when has_function_privilege('authenticated', t, 'execute') then 'yes' else 'no' end
      || ' types_service=' || case when has_function_privilege('service_role', t, 'execute') then 'yes' else 'no' end, ';', ','));
  exception when others then insert into probe_results values ('P3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P4', replace(pg_temp.as_types((select c.data from public.call_schedule_data c where c.id = 'main')), ';', ','));
  exception when others then insert into probe_results values ('P4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('P5', replace('absent=' || pg_temp.as_types('{}'::jsonb) || ' null=' || pg_temp.as_types(null) || ' notlist=' || pg_temp.as_types('{"groupRules":{"appShiftTypes":"inbox"}}'::jsonb) || ' empty=' || pg_temp.as_types('{"groupRules":{"appShiftTypes":[]}}'::jsonb), ';', ','));
  exception when others then insert into probe_results values ('P5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- A1-A45: as the APP U1
do $$ declare u text; u2 text; vid uuid; n int; r jsonb; begin
  select v into u from probe_ctx where k = 'u1';
  select v into u2 from probe_ctx where k = 'u2';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-03","type":"inbox"},{"day":"2031-03-04","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A1', replace('ok added=' || (r ->> 'added') || ' removed=' || (r ->> 'removed') || ' kept=' || (r ->> 'kept') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_day('2031-03-03') || ' ' || pg_temp.as_day('2031-03-04') || ' ' || pg_temp.as_by('{2031-03-03,2031-03-04}'), ';', ','));
  exception when others then insert into probe_results values ('A1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('A2', replace('audit=' || pg_temp.as_audit_n('appdays.save') || ' ' || pg_temp.as_audit('appdays.save', u, 'app', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-03","type":"inbox"},{"day":"2031-03-04","type":"inbox"}]'::jsonb, null);
    execute 'reset role';
    insert into probe_results values ('A3', replace('ok added=' || (r ->> 'added') || ' kept=' || (r ->> 'kept') || ' audit=' || (r ->> 'audit') || ' audit_rows=' || pg_temp.as_audit_n('appdays.save'), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '[{"day":"2031-03-04","type":"inbox"}]'::jsonb);
    execute 'reset role';
    insert into probe_results values ('A4', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.as_day('2031-03-04') || ' ' || pg_temp.as_sums('appdays.save', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '[{"day":"2031-03-05","type":"inbox"}]'::jsonb);
    insert into probe_results values ('A5', replace('ok removed=' || (r ->> 'removed') || ' absent=' || (r ->> 'absent') || ' audit=' || (r ->> 'audit'), ';', ','));
  exception when others then insert into probe_results values ('A5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-05","type":"inbox"}]'::jsonb, '[{"day":"2031-03-05","type":"inbox"}]'::jsonb);
    insert into probe_results values ('A6', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '["2031-03-05"]'::jsonb, null);
    insert into probe_results values ('A7', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-02-30","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A8', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, (select jsonb_agg(jsonb_build_object('day', g::date, 'type', 'inbox')) from generate_series('2031-04-01'::date, '2032-05-05'::date, interval '1 day') g), null);
    insert into probe_results values ('A9', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2020-06-01","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A10', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-05","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A11', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-05","type":"inbox"}]'::jsonb, null, u2::uuid);
    insert into probe_results values ('A12', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.app_call_days (day, shift_type, profile_id, source) values ('2031-03-05', 'inbox', u::uuid, 'app');
    insert into probe_results values ('A13', replace('inserted (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-01","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A14', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-12","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A15', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-05","type":"nosuch"}]'::jsonb, null);
    insert into probe_results values ('A16', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A16', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-05","type":"probe-old"},{"day":"2031-03-06","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A17', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A17', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A17s', replace(pg_temp.as_day('2031-03-06'), ';', ','));
  exception when others then insert into probe_results values ('A17s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-03","type":"probe-night"}]'::jsonb, null);
    insert into probe_results values ('A18', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2031-03-03'), ';', ','));
  exception when others then insert into probe_results values ('A18', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-03","type":"probe-long"}]'::jsonb, null);
    insert into probe_results values ('A19', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A19', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-07","type":"probe-night"},{"day":"2031-03-08","type":"probe-day"}]'::jsonb, null);
    insert into probe_results values ('A20', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A20', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-15","type":"probe-day"}]'::jsonb, null);
    insert into probe_results values ('A21', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2031-03-15'), ';', ','));
  exception when others then insert into probe_results values ('A21', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-14","type":"probe-night"}]'::jsonb, null);
    insert into probe_results values ('A22', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A22', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A23', replace(pg_temp.as_rows(), ';', ','));
  exception when others then insert into probe_results values ('A23', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A24', replace(pg_temp.as_names('self'), ';', ','));
  exception when others then insert into probe_results values ('A24', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.silvis_app_shift_types('{}'::jsonb);
    insert into probe_results values ('A25', replace('read (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A25', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-17","end":"2031-03-21"}]'::jsonb, null);
    insert into probe_results values ('A26', replace('ok added=' || (r ->> 'added') || ' removed=' || (r ->> 'removed') || ' kept=' || (r ->> 'kept') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('A26', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('A27', replace('vaudit=' || pg_temp.as_audit_n('appvac.save') || ' ' || pg_temp.as_audit('appvac.save', u, 'app', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A27', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-17","end":"2031-03-21"}]'::jsonb, null);
    insert into probe_results values ('A28', replace('ok added=' || (r ->> 'added') || ' kept=' || (r ->> 'kept') || ' audit=' || (r ->> 'audit'), ';', ','));
  exception when others then insert into probe_results values ('A28', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-18","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('A29', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A29', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-16","type":"probe-day"}]'::jsonb, null);
    insert into probe_results values ('A30', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A30', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-03","end":"2031-03-03"}]'::jsonb, null);
    insert into probe_results values ('A31', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A31', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-04","end":"2031-03-05"}]'::jsonb, null);
    insert into probe_results values ('A32', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A32', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-20","end":"2031-03-25"}]'::jsonb, null);
    insert into probe_results values ('A33', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A33', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-25","end":"2031-03-24"}]'::jsonb, null);
    insert into probe_results values ('A34', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A34', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-24","end":"2031-03-26"},{"start":"2031-03-26","end":"2031-03-28"}]'::jsonb, null);
    insert into probe_results values ('A35', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A35', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-24","end":"2032-03-24"}]'::jsonb, null);
    insert into probe_results values ('A36', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A36', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u2::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('A37', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A37', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.app_time_off (profile_id, start_date, end_date, source) values (u::uuid, '2031-03-24', '2031-03-26', 'app');
    insert into probe_results values ('A38', replace('inserted (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A38', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u::uuid and v.start_date = '2031-03-17';
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-03-17","end":"2031-03-22"}]'::jsonb, array[vid]);
    execute 'reset role';
    insert into probe_results values ('A39', replace('ok added=' || (r ->> 'added') || ' removed=' || (r ->> 'removed') || ' ' || pg_temp.as_vacs() || ' ' || pg_temp.as_sums('appvac.save', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('A39', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, null, array[gen_random_uuid()]);
    insert into probe_results values ('A40', replace('removed (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A40', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '["2031-03-24"]'::jsonb, null);
    insert into probe_results values ('A41', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A41', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('A42', replace(pg_temp.as_vrows(), ';', ','));
  exception when others then insert into probe_results values ('A42', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u::uuid, '[{"start":"2031-02-30","end":"2031-03-01"}]'::jsonb, null);
    insert into probe_results values ('A43', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A43', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe shifts one renamed' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('A44', replace('updated=' || n || ' (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('A44', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set display_name = 'probe shifts one' where id = auth.uid();
    get diagnostics n = row_count;
    insert into probe_results values ('A45', replace('updated=' || n, ';', ','));
  exception when others then insert into probe_results values ('A45', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- B1-B8: as the second APP U2
do $$ declare u text; u1 text; vid uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'u2';
  select v into u1 from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('B1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('B1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B1s', replace(pg_temp.as_day('2031-03-03'), ';', ','));
  exception when others then insert into probe_results values ('B1s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-03","type":"probe-night"}]'::jsonb, null);
    insert into probe_results values ('B2', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2031-03-03'), ';', ','));
  exception when others then insert into probe_results values ('B2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, null, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb);
    insert into probe_results values ('B3', replace('removed (NO refusal) removed=' || (r ->> 'removed'), ';', ','));
  exception when others then insert into probe_results values ('B3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u::uuid, '[{"day":"2031-03-10","type":"inbox"},{"day":"2031-03-03","type":"inbox"},{"day":"2031-03-11","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('B4', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('B4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B4s', replace(pg_temp.as_day('2031-03-10'), ';', ','));
  exception when others then insert into probe_results values ('B4s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u1::uuid limit 1;
    r := public.save_app_vacations(u::uuid, null, array[vid]);
    insert into probe_results values ('B5', replace('removed (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('B5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-27","end":"2031-03-28"}]'::jsonb, null);
    insert into probe_results values ('B6', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('B6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B7', replace(pg_temp.as_vrows(), ';', ','));
  exception when others then insert into probe_results values ('B7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('B8', replace(pg_temp.as_names(''), ';', ','));
  exception when others then insert into probe_results values ('B8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- S1-S6: as the SURGEON US (linked s3) - reads, never writes
do $$ declare u text; u1 text; r jsonb; begin
  select v into u from probe_ctx where k = 'us';
  select v into u1 from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-10","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('S1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('S1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u1::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('S2', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('S2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S3', replace(pg_temp.as_rows(), ';', ','));
  exception when others then insert into probe_results values ('S3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S4', replace(pg_temp.as_vrows(), ';', ','));
  exception when others then insert into probe_results values ('S4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('S5', replace(pg_temp.as_names('names'), ';', ','));
  exception when others then insert into probe_results values ('S5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.app_time_off (profile_id, start_date, end_date, source) values (u1::uuid, '2031-03-24', '2031-03-26', 'scheduler');
    insert into probe_results values ('S6', replace('inserted (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('S6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- C1-C9: as the office COORDINATOR UC
do $$ declare u text; u1 text; u2 text; u3 text; uv text; vid uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'uc';
  select v into u1 from probe_ctx where k = 'u1'; select v into u2 from probe_ctx where k = 'u2'; select v into u3 from probe_ctx where k = 'u3'; select v into uv from probe_ctx where k = 'uv';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(u1::uuid, '[{"day":"2031-03-10","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('C1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('C1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u2::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('C2', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('C2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('C3', replace(pg_temp.as_audit('appvac.save', u2, 'office', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('C3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u2::uuid and v.start_date = '2031-03-24';
    r := public.save_app_vacations(u2::uuid, null, array[vid]);
    insert into probe_results values ('C4', replace('ok removed=' || (r ->> 'removed') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('C4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('C5', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('C5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(uv::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('C6', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('C6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('C7', replace(pg_temp.as_names('flags'), ';', ','));
  exception when others then insert into probe_results values ('C7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('C8', replace(pg_temp.as_rows() || ' ' || pg_temp.as_vrows(), ';', ','));
  exception when others then insert into probe_results values ('C8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u3::uuid, '[{"start":"2031-03-29","end":"2031-03-30"}]'::jsonb, null);
    insert into probe_results values ('C9', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source'), ';', ','));
  exception when others then insert into probe_results values ('C9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- S7: as the SURGEON US again - U3 holds only a vacation (app_call_names' vacation clause, for a caller with no special role)
do $$ declare u text; begin
  select v into u from probe_ctx where k = 'us';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into probe_results values ('S7', replace(pg_temp.as_names('names'), ';', ','));
  exception when others then insert into probe_results values ('S7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- T1-T2: as the third APP U3
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'u3';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-03","type":"probe-night"}]'::jsonb, null);
    insert into probe_results values ('T1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('T1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-06","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('T2', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2031-03-06'), ';', ','));
  exception when others then insert into probe_results values ('T2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- V1-V3: as the plain VIEWER UV (not an APP)
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'uv';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-10","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('V1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('V1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('V2', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('V2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('V3', replace(pg_temp.as_rows() || ' ' || pg_temp.as_vrows(), ';', ','));
  exception when others then insert into probe_results values ('V3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- D1-D18: as the ADMIN UA (the scheduler, linked s1)
do $$ declare u text; u1 text; u2 text; u3 text; uv text; n int; r jsonb; begin
  select v into u from probe_ctx where k = 'ua';
  select v into u1 from probe_ctx where k = 'u1'; select v into u2 from probe_ctx where k = 'u2'; select v into u3 from probe_ctx where k = 'u3'; select v into uv from probe_ctx where k = 'uv';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-10","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D1', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_day('2031-03-10') || ' ' || pg_temp.as_by('{2031-03-10}'), ';', ','));
  exception when others then insert into probe_results values ('D1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    execute 'reset role';
    insert into probe_results values ('D2', replace(pg_temp.as_audit('appdays.save', u2, 'scheduler', u), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('D2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, null, '[{"day":"2031-03-10","type":"inbox"}]'::jsonb);
    insert into probe_results values ('D3', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.as_day('2031-03-10'), ';', ','));
  exception when others then insert into probe_results values ('D3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, '[{"day":"2020-06-01","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D4', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2020-06-01'), ';', ','));
  exception when others then insert into probe_results values ('D4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, null, '[{"day":"2020-06-01","type":"inbox"}]'::jsonb);
    insert into probe_results values ('D5', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.as_day('2020-06-01'), ';', ','));
  exception when others then insert into probe_results values ('D5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D6', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb, null, u1::uuid);
    execute 'reset role';
    insert into probe_results values ('D7', replace('ok added=' || (r ->> 'added') || ' replaced=' || (r ->> 'replaced') || ' ' || pg_temp.as_day('2031-03-03') || ' ' || pg_temp.as_last(), ';', ','));
    execute 'set local role authenticated';
  exception when others then insert into probe_results values ('D7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u3::uuid, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb, null, u1::uuid);
    insert into probe_results values ('D8', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, null, '[{"day":"2031-03-03","type":"inbox"}]'::jsonb);
    insert into probe_results values ('D9', replace('removed (NO refusal) removed=' || (r ->> 'removed'), ';', ','));
  exception when others then insert into probe_results values ('D9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(uv::uuid, '[{"day":"2031-03-11","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D10', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D10', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(gen_random_uuid(), '[{"day":"2031-03-11","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D11', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D11', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-11","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D12', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D12', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-11","type":"inbox"}]'::jsonb, null, u2::uuid);
    insert into probe_results values ('D13', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D13', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u1::uuid, '[{"start":"2020-06-01","end":"2020-06-05"}]'::jsonb, null);
    insert into probe_results values ('D14', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('D14', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u2::uuid, '[{"start":"2031-03-03","end":"2031-03-03"}]'::jsonb, null);
    insert into probe_results values ('D15', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D15', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u1::uuid, '[{"day":"2031-03-19","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('D16', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('D16', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('D17', replace(pg_temp.as_names('flags'), ';', ','));
  exception when others then insert into probe_results values ('D17', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = false where id = u3::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('D18', replace('updated=' || n || ' is_app=' || coalesce((select p.is_app::text from public.user_profiles p where p.id = u3::uuid), 'none'), ';', ','));
  exception when others then insert into probe_results values ('D18', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-03","type":"probe-night"}]'::jsonb, null, u1::uuid);
    insert into probe_results values ('D19', replace('saved (NO refusal) added=' || (r ->> 'added') || ' replaced=' || (r ->> 'replaced'), ';', ','));
  exception when others then insert into probe_results values ('D19', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('D19s', replace(pg_temp.as_day('2031-03-03'), ';', ','));
  exception when others then insert into probe_results values ('D19s', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- F1: as U1 - its vacation that has started
do $$ declare u text; vid uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u::uuid and v.start_date = '2020-06-01';
    r := public.save_app_vacations(u::uuid, null, array[vid]);
    insert into probe_results values ('F1', replace('removed (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('F1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- G1: as the coordinator UC - the same started vacation
do $$ declare u text; u1 text; vid uuid; r jsonb; begin
  select v into u from probe_ctx where k = 'uc';
  select v into u1 from probe_ctx where k = 'u1';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u1::uuid and v.start_date = '2020-06-01';
    r := public.save_app_vacations(u1::uuid, null, array[vid]);
    insert into probe_results values ('G1', replace('removed (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('G1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- H1-H3: as U3 - a FORMER APP (is_app false since D18)
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'u3';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-13","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('H1', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('H1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('H2', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('H2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('H3', replace(pg_temp.as_day('2031-03-06'), ';', ','));
  exception when others then insert into probe_results values ('H3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- E1-E7: as the ADMIN UA again - a started vacation, a former APP, the flag's rule
do $$ declare u text; u1 text; u3 text; us text; uc text; vid uuid; n int; r jsonb; begin
  select v into u from probe_ctx where k = 'ua';
  select v into u1 from probe_ctx where k = 'u1'; select v into u3 from probe_ctx where k = 'u3'; select v into us from probe_ctx where k = 'us'; select v into uc from probe_ctx where k = 'uc';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into probe_results values ('E1', replace(pg_temp.as_names('flags'), ';', ','));
  exception when others then insert into probe_results values ('E1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select v.id into vid from public.app_time_off v where v.profile_id = u1::uuid and v.start_date = '2020-06-01';
    r := public.save_app_vacations(u1::uuid, null, array[vid]);
    insert into probe_results values ('E2', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.as_vacs(), ';', ','));
  exception when others then insert into probe_results values ('E2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u3::uuid, null, '[{"day":"2031-03-06","type":"inbox"}]'::jsonb);
    insert into probe_results values ('E3', replace('ok removed=' || (r ->> 'removed') || ' ' || pg_temp.as_day('2031-03-06'), ';', ','));
  exception when others then insert into probe_results values ('E3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u3::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('E4', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('E4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u3::uuid, '[{"day":"2031-03-13","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('E5', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('E5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = true where id = us::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('E6', replace('updated=' || n || ' (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('E6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    update public.user_profiles set is_app = true where id = uc::uuid;
    get diagnostics n = row_count;
    insert into probe_results values ('E7', replace('updated=' || n || ' (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('E7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- W1: as postgres - U1 gets a row of a type the blob does not list (Setup removed it); W2-W9: as U1 - that row counts as its whole
-- calendar day, and a far-future vacation and shift (7031: past the int4 minute range) are placed in bigint minutes
do $$ declare u text; r jsonb; begin
  select v into u from probe_ctx where k = 'u1';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    insert into public.app_call_days (day, shift_type, profile_id, source, created_by) values ('2031-03-27', 'probe-gone', u::uuid, 'scheduler', null);
    insert into probe_results values ('W1', replace('inserted ' || pg_temp.as_day('2031-03-27'), ';', ','));
  exception when others then insert into probe_results values ('W1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-27","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('W2', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('W2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-27","end":"2031-03-27"}]'::jsonb, null);
    insert into probe_results values ('W3', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('W3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"2031-03-28","end":"2031-03-28"}]'::jsonb, null);
    insert into probe_results values ('W4', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source'), ';', ','));
  exception when others then insert into probe_results values ('W4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"7031-03-03","end":"7031-03-05"}]'::jsonb, null);
    insert into probe_results values ('W5', replace('ok added=' || (r ->> 'added') || ' source=' || (r ->> 'source'), ';', ','));
  exception when others then insert into probe_results values ('W5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '[{"day":"2031-03-31","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('W6', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('2031-03-31'), ';', ','));
  exception when others then insert into probe_results values ('W6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '[{"day":"7031-03-04","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('W7', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('W7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(null, '[{"day":"7031-03-10","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('W8', replace('ok added=' || (r ->> 'added') || ' ' || pg_temp.as_day('7031-03-10'), ';', ','));
  exception when others then insert into probe_results values ('W8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(null, '[{"start":"7031-03-10","end":"7031-03-10"}]'::jsonb, null);
    insert into probe_results values ('W9', replace('saved (NO refusal)', ';', ','));
  exception when others then insert into probe_results values ('W9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- N1-N6: as ANON (no privilege on the tables, no EXECUTE); N7-N9: as postgres with NO signed-in user (the SQL editor / the linked CLI)
do $$ declare u2 text; r jsonb; n bigint; begin
  select v into u2 from probe_ctx where k = 'u2';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
  begin
    select count(*) into n from public.app_call_days;
    insert into probe_results values ('N1', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.app_time_off;
    insert into probe_results values ('N2', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.app_call_names();
    insert into probe_results values ('N3', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N3', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-13","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('N4', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N4', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u2::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('N5', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N5', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    select count(*) into n from public.silvis_app_shift_types('{}'::jsonb);
    insert into probe_results values ('N6', 'read (NO refusal) n=' || n);
  exception when others then insert into probe_results values ('N6', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    r := public.save_app_days(u2::uuid, '[{"day":"2031-03-13","type":"inbox"}]'::jsonb, null);
    insert into probe_results values ('N7', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N7', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    r := public.save_app_vacations(u2::uuid, '[{"start":"2031-03-24","end":"2031-03-26"}]'::jsonb, null);
    insert into probe_results values ('N8', 'saved (NO refusal)');
  exception when others then insert into probe_results values ('N8', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into probe_results values ('N9', replace(pg_temp.as_names(''), ';', ','));
  exception when others then insert into probe_results values ('N9', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- X1: as postgres - deleting the account removes its shifts and vacations (auth.users -> user_profiles -> app_call_days / app_time_off);
-- the audit rows stay
do $$ declare u2 text; bs bigint; bv bigint; s2 bigint; v2 bigint; begin
  select v into u2 from probe_ctx where k = 'u2';
  perform set_config('request.jwt.claims', '{}', true);
  begin
    select count(*) into bs from public.app_call_days where profile_id = u2::uuid;
    select count(*) into bv from public.app_time_off where profile_id = u2::uuid;
    delete from auth.users where id = u2::uuid;
    select count(*) into s2 from public.app_call_days where profile_id = u2::uuid;
    select count(*) into v2 from public.app_time_off where profile_id = u2::uuid;
    insert into probe_results values ('X1', 'before=' || bs || '/' || bv || ' after=' || s2 || '/' || v2 || ' audit_kept='
      || case when exists (select 1 from public.audit_log l where l.action in ('appdays.save', 'appvac.save') and l.detail ->> 'profile_id' = u2) then 'yes' else 'no' end);
  exception when others then insert into probe_results values ('X1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
end $$;

-- I1-I2: the self-insert door - postgres deletes UV's profile row, then UV inserts its own (never an APP)
do $$ declare u text; begin
  select v into u from probe_ctx where k = 'uv';
  perform set_config('request.jwt.claims', '{}', true);
  delete from public.user_profiles where id = u::uuid;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  begin
    insert into public.user_profiles (id, role, is_app) values (u::uuid, 'viewer', true);
    insert into probe_results values ('I1', 'inserted (NO refusal)');
  exception when others then insert into probe_results values ('I1', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  begin
    insert into public.user_profiles (id, role) values (u::uuid, 'viewer');
    insert into probe_results values ('I2', 'ok is_app=' || coalesce((select p.is_app::text from public.user_profiles p where p.id = auth.uid()), 'none'));
  exception when others then insert into probe_results values ('I2', 'ERR ' || sqlstate || ' ' || replace(sqlerrm, ';', ',')); end;
  execute 'reset role';
end $$;

-- ---------- report + ROLL BACK EVERYTHING (this raise aborts the batch's transaction - the blob edit included)
do $$ declare msg text; begin
  select string_agg(k || '=' || v, ';' order by k) into msg from probe_results;
  raise exception 'PROBE_RESULTS %;END', coalesce(msg, '(no results)');
end $$;
