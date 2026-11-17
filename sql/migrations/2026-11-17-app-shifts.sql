-- ============================================================================
-- Silvis Call Schedule - migration 2026-11-17 (revision ac): APP shifts with hours and APP vacations (Faraz 11/17, Prompt 35: the APPs
-- enter their own vacations and put themselves on shifts that have hours; "for now there is one shift: the weekday inbox shift, 7a-5p";
-- "weekends and weeknights may come later, so shift types are data in Setup, not code").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md: a table's key changes, a new authenticated-only table, the write path every APP Save goes
-- through). Nothing in the repo applies it: Faraz runs his apply script (kept outside the repo) and pastes the log back.
--
-- The decisions (Faraz 11/17): shift types are Setup data { id, label, start, end, weekdays, holidays, perDay } - today ONE, Inbox,
-- 07:00-17:00, Mon-Fri, not on the six holidays, perDay 1; later types may cross midnight (a 5p-7a weeknight) or run 24 hours (a 7a-7a
-- weekend day). perDay = how many APPs may hold that shift on one day, and the database enforces it (1 = Prompt 29's one APP per day).
-- An APP cannot hold two overlapping shifts, nor take a shift on one of their own vacation days. APP vacations are self-entered with no
-- approval, like the surgeons'; the scheduler and the office coordinators can add, change or remove one for any APP; a vacation over the
-- APP's own shift is refused ("remove the shift first"); the surgeons' vacation guard (at least 2 around) does not apply to APPs. Everyone
-- signed in sees APP shifts and APP vacations; the ?public=1 page, share, print and every anon-readable table show nothing of them. No
-- e-mails and no notices: audit rows only, as in Prompt 29.
--
-- The choice (least new machinery): EXTEND app_call_days, do not replace it. Its 0 live rows (Cowork's read-only check 11/17) make either
-- cheap; extending keeps the table's read policy, grants, cascade, index and app_call_names() as they are, and the live client keeps
-- reading the rows between this apply and the client push (only its Save path is gone - see Blast radius). Replacing it would add a
-- second table, policy and grant set and a new names function for the same result. The shift TYPES stay in the blob (Setup data:
-- call_schedule_data.data.groupRules.appShiftTypes - the vacation guard's precedent: the database reads a groupRules key with the same
-- default the client uses); APP vacations get their OWN table, because time_off is anon-readable.
--
-- What changes:
--   (0) a guard: a Prompt 29 row (a whole call day, no type) is never typed by this file - with app_call_days not yet typed and holding
--       any row, the file raises before its first change (live 11/17: 0 rows);
--   (1) app_call_days gains shift_type text not null (the type's id; the check app_call_days_shift_type_shape) and its primary key
--       becomes (day, shift_type, profile_id) - ONE row per APP per shift per day; perDay is the save function's count, not the key;
--   (2) ONE new table app_time_off (id, profile_id -> user_profiles on delete cascade, start_date, end_date, source 'app' / 'scheduler' /
--       'office', created_by, created_at; the check app_time_off_range: end on or after start, at most a year): read by every signed-in
--       role (policy app_time_off_read), never anon (no anon policy AND anon's privileges revoked); authenticated keeps SELECT only;
--   (3) ONE new internal function silvis_app_shift_types(p_data jsonb) (sql, immutable, security invoker; EXECUTE for service_role only):
--       the shift types of the blob it is given - groupRules.appShiftTypes, absent or not a list = the one decided type (helpers.js
--       APP_SHIFT_TYPES_DEFAULT, the same object) - one row per valid entry: id, label, start_min, end_min, weekdays, holidays, per_day,
--       retired (the ONE SQL reading; helpers.js appShiftTypesOf is the same rule in JS);
--   (4) save_app_days is re-created with a new signature: save_app_days(p_profile uuid, p_add jsonb, p_clear jsonb, p_replace uuid
--       default null) - the lists are JSON arrays of {"day": "YYYY-MM-DD", "type": "<shift type id>"}, p_replace names the APP a
--       scheduler's change takes over from; the old save_app_days(uuid, date[], date[], boolean) is dropped (an old build's call is
--       refused with HTTP 400 - its true / false replace flag is no uuid - never a write without a type);
--   (5) ONE new function save_app_vacations(p_profile uuid, p_add jsonb, p_remove uuid[]) (security definer, volatile): the ONLY write
--       path into app_time_off - p_add a JSON array of {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, p_remove the ids to remove (a
--       change = remove + add in one Save); it writes the appvac.save audit row itself (an APP cannot insert audit rows);
--   (6) app_call_names() is re-created (same signature): it also names the holders of APP vacations, and the office coordinator gets
--       every APP profile too (its APP pick list in Time off).
-- No other table, policy, trigger or function changes; user_profiles, audit_*, notif_*, time_off and its triggers, the anon read_all
-- loop and every existing row are untouched. sql/schema.sql mirrors every statement below (header revision ac, "report-first, NOT yet
-- applied" until the record step); test/schema.test.js pins it.
--
-- How a shift is placed in time. A shift of type T on day D runs from D at T.start to T.end - the same day when end > start, the next
-- day when end < start (a 5p-7a weeknight), and 24 hours when end = start (a 7a-7a day); times are Central wall clock. Two shifts of one
-- APP OVERLAP when their spans share a minute (an inbox 7a-5p and a weeknight 5p-7a touch at 5p and do not overlap). A shift conflicts
-- with an APP vacation when its span reaches into any vacation day (a weeknight the evening before the first vacation day ends at 7a ON
-- that day and is refused - the surgeons' "primary the day before" reading). A row whose type the blob no longer lists counts as its
-- whole calendar day. A day is a holiday when it is a day of a stored holiday unit (call_schedule_data.data.holidays.units - the
-- Thanksgiving Friday, the eves and absorbed weekend days included; a year with no stored units has none - the app's own reading).
--
-- Refusals of save_app_days (custom SQLSTATEs, HTTP 400 through PostgREST; <M/D> in day order; <t> = the shift type id; <name> = the
-- APP's display name, else "another APP"), every one BEFORE any write, in this order:
--   AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift
--   AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)
--   AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own shifts - ask the scheduler
--   AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a shift
--   AP004 APP_DAY_BAD_DAY: the shifts must come as a list - nothing was saved
--   AP004 APP_DAY_BAD_DAY: a shift in the list is not a day and a shift type - nothing was saved
--   AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved
--   AP004 APP_DAY_BAD_DAY: at most 400 shifts in one save - nothing was saved
--   AP004 APP_DAY_BAD_DAY: <M/D t> is both added and removed in one save - nothing was saved
--   AP004 APP_DAY_BAD_DAY: a change takes a shift over from another APP - name the shift and that APP (nothing was saved)
--   AP003 APP_DAY_NOT_APP: <name, else that account> is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   (the transaction advisory lock app_call_days:save - one APP write at a time, shifts and vacations, across all profiles)
--   AP006 APP_DAY_PAST: <M/D> is before today (<M/D>) in Central time - a past day stays as it was        (not the scheduler)
--   AP008 APP_DAY_NO_SHIFT: <there is no t shift type | the t shift is retired | M/D is a <weekday> (<label> does not run that day) |
--         M/D is a holiday (<label> does not run on holidays)> - nothing was saved
--   AP002 APP_DAY_NOT_YOURS: <M/D t> is <name>'s shift - only that APP or the scheduler can remove it (nothing was saved)
--   AP007 APP_DAY_STALE: <M/D t> is <name>'s shift - reload the calendar (nothing was saved)                (the scheduler)
--   AP007 APP_DAY_STALE: <M/D t> is no longer <name>'s shift - reload the calendar (nothing was saved)     (a change)
--   AP005 APP_DAY_TAKEN: <M/D t> already has <name>[ and <name>][ (<n> a day)] - nothing was saved
--   AP010 APP_DAY_VACATION: <M/D t> is on <name>'s vacation - change the vacation first (nothing was saved)
--   AP009 APP_DAY_OVERLAP: <M/D t> overlaps <M/D t> - one APP holds one shift at a time (nothing was saved)
--   AP005 APP_DAY_TAKEN: a shift filled up during this save - reload and try again (nothing was saved)     (defence in depth)
-- An add the APP already holds is "kept", a clear of a shift nobody holds is "absent" - a Save re-sent after a lost response is safe.
-- Refusals of save_app_vacations (<A-B> = M/D-M/D, one day = M/D), every one BEFORE any write, in this order:
--   AV001 APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation
--   AV001 APP_VACATION_NOT_ALLOWED: name the APP (pick one in Time off)
--   AV002 APP_VACATION_NOT_YOURS: an APP enters, changes or removes only their own vacations - ask the scheduler or the office
--   AV004 APP_VACATION_BAD_RANGE: the vacations must come as a list - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: a vacation in the remove list is empty - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: a vacation in the list is not a first and a last day - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: at most 50 vacations in one save - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: a day in the list is not a calendar day - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: <A-B> ends before it starts - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: <A-B> is longer than a year - nothing was saved
--   AV004 APP_VACATION_BAD_RANGE: <A-B> and <A-B> overlap - nothing was saved
--   AV003 APP_VACATION_NOT_APP: <name, else that account> is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   (the same advisory lock)
--   AV007 APP_VACATION_STALE: a vacation in the list is gone or is not <name>'s - reload Time off (nothing was saved)
--   AV006 APP_VACATION_PAST: <A-B> has started or passed (today is <M/D> in Central time) - it stays on record; ask the scheduler if it
--         needs to go (nothing was saved)                                       (a removal - and so a change - by anyone but the scheduler)
--   AV008 APP_VACATION_OVERLAP: <name> is already away <A-B> - change that vacation instead (nothing was saved)
--   AV005 APP_VACATION_ON_SHIFT: <name> holds <M/D t> - remove the shift first (nothing was saved)
-- An add equal to a vacation the APP already has (and does not remove) is "kept". The surgeons' rules carried over: no past check on an
-- add, and a vacation that has started stays for everyone but the scheduler (the client's Time off rule for surgeons - here in SQL).
--
-- Who it binds. Shifts: an APP for its own profile (p_profile = its id, or null = itself); the scheduler (silvis_is_sched(): admin /
-- scheduler) for any APP (adds only for a current APP - AP003 binds the scheduler too; clears for any holder; p_replace is his alone);
-- nobody else (a surgeon, the office coordinator, a viewer, a follower, anon - no EXECUTE - and a session with no signed-in user: AP001).
-- AP006 (Central time; today is allowed) binds the APP for adds and removals; the scheduler is exempt. AP005 / AP008 / AP009 / AP010 bind
-- everyone, the scheduler included. Vacations: the APP for itself; the scheduler and the office coordinator (silvis_is_coord()) for any
-- APP (adds only for a current APP); nobody else. AV006 binds the APP and the coordinator, never the scheduler; AV005 / AV008 bind
-- everyone. A profile that stops being an APP keeps its rows (they keep showing; the scheduler clears its shifts, the scheduler or the
-- office its vacations); deleting the account removes both (auth.users -> user_profiles -> app_call_days / app_time_off, on delete
-- cascade); the audit rows stay (audit_log has no FK).
-- The audit rows (in the same transaction, only when something changed): appdays.save - detail {summary, profile_id, added, removed,
-- replaced, source}, summary "<APP name>: inbox 11/18, 11/19; removed inbox 11/25" (display names and type ids only; a change reads
-- "inbox 11/18 (was <name>)"); appvac.save - detail {summary, profile_id, added, removed, source}, summary "<APP name>: vacation
-- 12/1-12/5; removed vacation 12/2-12/4". actor_id = the caller's roster id, else his auth uid; actor_name = his display name, else his
-- roster name, else Unknown. No notification row, no e-mail.
--
-- Blast radius. app_call_days' key changes (0 rows; nothing else references it). The old save_app_days signature is dropped: the live
-- client (2026.11.12c) keeps drawing any APP row it reads, but its My APP days Save and the day editor's APP Set / Clear are refused
-- with HTTP 400 - PostgREST matches their four keys to the new signature and their true / false replace flag fails the uuid cast
-- (22P02) before the body runs, so nothing is written; the old words read "Couldn't save the APP days: invalid input syntax for type
-- uuid" - until the Prompt 35 client is pushed: apply and push the same day. A new
-- authenticated-only table, two new functions and two re-created ones; no anon surface gains anything (verify-rls section 25). The
-- probe (sql/probes/app-shifts-probe.sql) sets the blob's shift types and one holiday unit INSIDE its rolled-back transaction - the first
-- probe to edit the blob; verify-rls 25b checks that the live blob carries none of them afterwards. Prompt 29's probe
-- (sql/probes/app-call-days-probe.sql) can no longer run once this file is applied: its setup now raises 'PROBE_SETUP: superseded by
-- revision ac' when app_call_days has the shift_type column, and verify-rls section 18 reads that as the superseded picture. The client
-- that reads and writes the typed shifts and the APP vacations ships AFTER the apply, on Faraz's go; it reads a missing table, column or
-- function as "unavailable", never as an empty list. The migration ends with a PostgREST schema-cache reload (verify-rls 25c / 25d are the
-- gate before the client push).
--
-- Apply live (Faraz, one command, from a clean checkout of the commit the script pins - the branch feat/app-shifts, since the client
-- ships after the apply; the CLI dir linked to bzhsroegtagqhutbnsrp):
--   bash <run folder>/apply-app-shifts.sh --dry-run      then      bash <run folder>/apply-app-shifts.sh   (the script lives OUTSIDE the repo)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-11-17-app-shifts.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction; a failure anywhere changes nothing.
-- Order: 1. pre-check sql/probes/app-shifts-precheck.sql (read-only; the gate row must read shift_type=no pk=day vac_table=no types_fn=no
-- save_sig=old vac_fn=no names_vac=no, and appdays_rows=0); 2. Prompt 29's probe BEFORE (its 69 cases as applied); 3. this file's probe
-- BEFORE (PROBE_SETUP: app_call_days.shift_type is absent); 4. this file; 5. the gate after; 6. the probe AFTER (every case as its
-- header lists) and its leftovers; 7. Prompt 29's probe AFTER (PROBE_SETUP: superseded by revision ac); 8. SILVIS_APP_SHIFTS_APPLIED=1
-- bash scripts/verify-rls.sh (sections 1-24 as before, 18f superseded, section 25 strict); 9. the record step in docs/SCHEMA-REVIEW.md
-- "2026-11-17 - APP shifts"; 10. the client push on Faraz's go.
-- Re-running: idempotent (the guard passes once the column exists; add column if not exists, drop constraint / policy if exists,
-- create table / index if not exists, create or replace); the apply script refuses to re-run it anyway (its gate).
-- Rolling back (the APP shifts and vacations are lost - export them first: select * from public.app_call_days order by day, shift_type;
-- select * from public.app_time_off order by start_date;), in this order:
--   drop function if exists public.save_app_vacations(uuid, jsonb, uuid[]);
--   drop function if exists public.save_app_days(uuid, jsonb, jsonb, uuid);
--   drop function if exists public.silvis_app_shift_types(jsonb);
--   drop table if exists public.app_time_off;
--   drop table if exists public.app_call_days;
--   notify pgrst, 'reload schema';
-- then re-run sql/migrations/2026-10-02-app-call-days.sql (revision v, idempotent: it re-creates app_call_days with day as its key,
-- save_app_days(uuid, date[], date[], boolean) and app_call_names() as applied 2026-10-02, and re-runs the is_app column, its check and
-- the two self policies the same). A rollback after the client push only empties the APP features (the client reads the missing column,
-- table or function as "unavailable").
-- ============================================================================

-- (0) the guard: Prompt 29's rows are whole call days, not typed shifts - never type them here
do $$
begin
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.app_call_days'::regclass and a.attname = 'shift_type' and not a.attisdropped)
     and exists (select 1 from public.app_call_days) then
    raise exception 'APP_SHIFTS_MIGRATION: app_call_days holds % Prompt 29 call day(s) - nothing was changed; export them (select * from public.app_call_days order by day;), clear them in the day editor, then run this file again',
      (select count(*) from public.app_call_days);
  end if;
end $$;

-- (1) app_call_days: one row per APP per shift per day; perDay is save_app_days' count, not the key
alter table public.app_call_days add column if not exists shift_type text not null;
alter table public.app_call_days drop constraint if exists app_call_days_shift_type_shape;
alter table public.app_call_days add constraint app_call_days_shift_type_shape check (shift_type ~ '^[a-z][a-z0-9-]{0,23}$');
alter table public.app_call_days drop constraint if exists app_call_days_pkey;
alter table public.app_call_days add constraint app_call_days_pkey primary key (day, shift_type, profile_id);
comment on table public.app_call_days is 'Prompt 29 (Faraz 10/1) / revision ac (Prompt 35, Faraz 11/17): the APP shifts - one row per APP per shift type per day (primary key day, shift_type, profile_id); how many APPs a shift may hold on one day is its type''s perDay (groupRules.appShiftTypes), counted by save_app_days. Read by every signed-in role, never anon (no anon policy, anon privileges revoked); written only through save_app_days() (authenticated holds SELECT only). Deleting the account removes its shifts (on delete cascade); the audit_log keeps the history.';

-- (2) app_time_off: the APPs' vacations - never in time_off, which anon reads
create table if not exists public.app_time_off (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.user_profiles(id) on delete cascade,     -- deleting the account removes its vacations
  start_date  date not null check (isfinite(start_date)),
  end_date    date not null check (isfinite(end_date)),
  source      text not null check (source in ('app', 'scheduler', 'office')),          -- the APP itself / the scheduler / the office coordinator
  created_by  uuid,                                                                    -- auth.uid() of the writer (no FK)
  created_at  timestamptz not null default now(),
  constraint app_time_off_range check (end_date >= start_date and end_date - start_date <= 365)
);
create index if not exists app_time_off_profile_idx on public.app_time_off (profile_id, start_date);
alter table public.app_time_off enable row level security;
revoke all on table public.app_time_off from anon;
revoke all on table public.app_time_off from authenticated;
grant select on table public.app_time_off to authenticated;
drop policy if exists app_time_off_read on public.app_time_off;
create policy app_time_off_read on public.app_time_off for select to authenticated using (true);
comment on table public.app_time_off is 'Revision ac (Prompt 35, Faraz 11/17): the APPs'' vacations - self-entered, no approval; the scheduler and the office coordinator for any APP. Read by every signed-in role, never anon (no anon policy, anon privileges revoked; time_off stays the surgeons'' and anon-readable); written only through save_app_vacations() (authenticated holds SELECT only). Deleting the account removes its vacations (on delete cascade).';

-- (3) the shift types the database reads: groupRules.appShiftTypes of the blob it is given (absent / not a list = the one decided type)
create or replace function public.silvis_app_shift_types(p_data jsonb)
returns table (id text, label text, start_min int, end_min int, weekdays int[], holidays boolean, per_day int, retired boolean)
language sql immutable security invoker set search_path = public, pg_temp as $$
  with list as (
    select case when jsonb_typeof(p_data #> '{groupRules,appShiftTypes}') = 'array' then p_data #> '{groupRules,appShiftTypes}'
                else '[{"id":"inbox","label":"Inbox","start":"07:00","end":"17:00","weekdays":[1,2,3,4,5],"holidays":false,"perDay":1}]'::jsonb end as l
  ),
  valid as (
    select e.t, e.ord
      from list, jsonb_array_elements(list.l) with ordinality as e(t, ord)
     where jsonb_typeof(e.t) = 'object'
       and jsonb_typeof(e.t -> 'id') = 'string' and (e.t ->> 'id') ~ '^[a-z][a-z0-9-]{0,23}$'
       and jsonb_typeof(e.t -> 'start') = 'string' and (e.t ->> 'start') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and jsonb_typeof(e.t -> 'end') = 'string' and (e.t ->> 'end') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and jsonb_typeof(e.t -> 'weekdays') = 'array' and jsonb_array_length(e.t -> 'weekdays') > 0
       and not exists (select 1 from jsonb_array_elements(e.t -> 'weekdays') w
                        where jsonb_typeof(w) <> 'number' or (w #>> '{}')::numeric not in (0, 1, 2, 3, 4, 5, 6))
  ),
  firsts as (
    select distinct on (v.t ->> 'id') v.t, v.ord from valid v order by v.t ->> 'id', v.ord
  )
  select f.t ->> 'id',
         coalesce(nullif(btrim(case when jsonb_typeof(f.t -> 'label') = 'string' then f.t ->> 'label' end), ''), f.t ->> 'id'),
         split_part(f.t ->> 'start', ':', 1)::int * 60 + split_part(f.t ->> 'start', ':', 2)::int,
         split_part(f.t ->> 'end', ':', 1)::int * 60 + split_part(f.t ->> 'end', ':', 2)::int,
         (select array_agg(distinct (w #>> '{}')::numeric::int order by (w #>> '{}')::numeric::int) from jsonb_array_elements(f.t -> 'weekdays') w),
         coalesce(f.t -> 'holidays' = 'true'::jsonb, false),
         case when jsonb_typeof(f.t -> 'perDay') = 'number' and (f.t ->> 'perDay')::numeric = trunc((f.t ->> 'perDay')::numeric)
                   and (f.t ->> 'perDay')::numeric between 1 and 20 then (f.t ->> 'perDay')::numeric::int else 1 end,
         coalesce(f.t -> 'retired' = 'true'::jsonb, false)
    from firsts f
   order by f.ord;
$$;
revoke all on function public.silvis_app_shift_types(jsonb) from public;
revoke all on function public.silvis_app_shift_types(jsonb) from anon;
revoke all on function public.silvis_app_shift_types(jsonb) from authenticated;
grant execute on function public.silvis_app_shift_types(jsonb) to service_role;
comment on function public.silvis_app_shift_types(jsonb) is 'Revision ac (Prompt 35): the APP shift types of a blob - groupRules.appShiftTypes; absent or not a list = the one decided type (Inbox 07:00-17:00 Mon-Fri, not on holidays, perDay 1 - helpers.js APP_SHIFT_TYPES_DEFAULT). One row per valid entry (id ^[a-z][a-z0-9-]{0,23}$, start / end HH:MM, a non-empty weekdays list of 0-6 with 0 = Sunday; the first entry of an id wins; label = the trimmed label, else the id; holidays only when exactly true; perDay a whole number 1-20, else 1; retired only when exactly true). Minutes from midnight; end = start is 24 hours, end < start ends the next day. Internal: EXECUTE for the service role only; save_app_days and save_app_vacations call it as their owner.';

-- (4) save_app_days, re-created with typed shifts: the old date-list signature is dropped (an old build is refused, never an untyped row)
drop function if exists public.save_app_days(uuid, date[], date[], boolean);
create or replace function public.save_app_days(p_profile uuid, p_add jsonb, p_clear jsonb, p_replace uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me        uuid := auth.uid();
  sched     boolean := public.silvis_is_sched();
  c_app     boolean := public.silvis_is_app();
  who       uuid := p_profile;
  today_c   date := (now() at time zone 'America/Chicago')::date;
  blob      jsonb;
  a_day     date[];
  a_type    text[];
  c_day     date[];
  c_type    text[];
  t_app     boolean;
  t_name    text;
  r_name    text;
  v_src     text;
  bad       text;
  ins       jsonb := '[]'::jsonb;
  del       jsonb := '[]'::jsonb;
  replaced  jsonb := '[]'::jsonb;
  v_sum     text;
begin
  if me is null or (not sched and not c_app) then
    raise exception 'APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a shift' using errcode = 'AP001';
  end if;
  if who is null and c_app then who := me; end if;
  if who is null then
    raise exception 'APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)' using errcode = 'AP001';
  end if;
  if not sched and who <> me then
    raise exception 'APP_DAY_NOT_YOURS: an APP adds or removes only their own shifts - ask the scheduler' using errcode = 'AP002';
  end if;
  if p_replace is not null and not sched then
    raise exception 'APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a shift' using errcode = 'AP002';
  end if;
  -- the lists: JSON arrays of {"day": "YYYY-MM-DD", "type": "<shift type id>"}
  if (p_add is not null and jsonb_typeof(p_add) <> 'array') or (p_clear is not null and jsonb_typeof(p_clear) <> 'array') then
    raise exception 'APP_DAY_BAD_DAY: the shifts must come as a list - nothing was saved' using errcode = 'AP004';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_add, '[]'::jsonb) || coalesce(p_clear, '[]'::jsonb)) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'day') is distinct from 'string'
                 or jsonb_typeof(x -> 'type') is distinct from 'string' or (x ->> 'type') !~ '^[a-z][a-z0-9-]{0,23}$') then
    raise exception 'APP_DAY_BAD_DAY: a shift in the list is not a day and a shift type - nothing was saved' using errcode = 'AP004';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_add, '[]'::jsonb) || coalesce(p_clear, '[]'::jsonb)) x
              where (x ->> 'day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    raise exception 'APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved' using errcode = 'AP004';
  end if;
  if coalesce(jsonb_array_length(p_add), 0) + coalesce(jsonb_array_length(p_clear), 0) > 400 then
    raise exception 'APP_DAY_BAD_DAY: at most 400 shifts in one save - nothing was saved' using errcode = 'AP004';
  end if;
  begin
    select coalesce(array_agg(s.d order by s.d, s.t), '{}'), coalesce(array_agg(s.t order by s.d, s.t), '{}') into a_day, a_type
      from (select distinct (x ->> 'day')::date as d, x ->> 'type' as t from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) x) s;
    select coalesce(array_agg(s.d order by s.d, s.t), '{}'), coalesce(array_agg(s.t order by s.d, s.t), '{}') into c_day, c_type
      from (select distinct (x ->> 'day')::date as d, x ->> 'type' as t from jsonb_array_elements(coalesce(p_clear, '[]'::jsonb)) x) s;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved' using errcode = 'AP004';
  end;
  select string_agg(to_char(a.d, 'FMMM/FMDD') || ' ' || a.t, ', ' order by a.d, a.t) into bad
    from unnest(a_day, a_type) a(d, t)
   where exists (select 1 from unnest(c_day, c_type) c(d, t) where c.d = a.d and c.t = a.t);
  if bad is not null then
    raise exception 'APP_DAY_BAD_DAY: % is both added and removed in one save - nothing was saved', bad using errcode = 'AP004';
  end if;
  if p_replace is not null and (p_replace = who or cardinality(a_day) = 0) then
    raise exception 'APP_DAY_BAD_DAY: a change takes a shift over from another APP - name the shift and that APP (nothing was saved)' using errcode = 'AP004';
  end if;
  select (p.is_app and p.role = 'viewer' and p.person_id is null), nullif(btrim(p.display_name), '')
    into t_app, t_name from public.user_profiles p where p.id = who;
  if cardinality(a_day) > 0 and not coalesce(t_app, false) then
    raise exception 'APP_DAY_NOT_APP: % is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)', coalesce(t_name, 'that account') using errcode = 'AP003';
  end if;
  -- One APP write at a time - shifts AND vacations (save_app_vacations takes the same lock): every read below sees the other's commit.
  perform pg_advisory_xact_lock(hashtext('app_call_days:save'));
  if not sched then
    select string_agg(to_char(x.d, 'FMMM/FMDD'), ', ' order by x.d) into bad
      from (select distinct d from unnest(a_day || c_day) d where d < today_c) x;
    if bad is not null then
      raise exception 'APP_DAY_PAST: % is before today (%) in Central time - a past day stays as it was', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'AP006';
    end if;
  end if;
  select c.data into blob from public.call_schedule_data c where c.id = 'main';
  -- every added shift's type: known, not retired, running that weekday and - unless it runs on holidays - not on a holiday unit's day
  select string_agg(x.msg, ', ' order by x.d, x.t) into bad
    from (select a.d, a.t,
                 case when st.id is null then 'there is no ' || a.t || ' shift type'
                      when st.retired then 'the ' || a.t || ' shift is retired'
                      when not (extract(dow from a.d)::int = any(st.weekdays))
                        then to_char(a.d, 'FMMM/FMDD') || ' is a ' || trim(to_char(a.d, 'Day')) || ' (' || st.label || ' does not run that day)'
                      when not st.holidays and exists (
                        select 1
                          from jsonb_each(case when jsonb_typeof(blob #> '{holidays,units}') = 'object' then blob #> '{holidays,units}' else '{}'::jsonb end) y(k, v),
                               jsonb_array_elements(case when jsonb_typeof(y.v) = 'array' then y.v else '[]'::jsonb end) u,
                               jsonb_array_elements(case when jsonb_typeof(u) = 'object' and jsonb_typeof(u -> 'days') = 'array' then u -> 'days' else '[]'::jsonb end) hd
                         where hd = to_jsonb(to_char(a.d, 'YYYY-MM-DD')))
                        then to_char(a.d, 'FMMM/FMDD') || ' is a holiday (' || st.label || ' does not run on holidays)'
                 end as msg
            from unnest(a_day, a_type) a(d, t)
            left join public.silvis_app_shift_types(blob) st on st.id = a.t) x
   where x.msg is not null;
  if bad is not null then
    raise exception 'APP_DAY_NO_SHIFT: % - nothing was saved', bad using errcode = 'AP008';
  end if;
  -- a clear names the APP's own shift: one that another APP holds instead (and this one does not) is a stale picture
  select string_agg(to_char(c.d, 'FMMM/FMDD') || ' ' || c.t || ' is ' || h.names || ' shift', ', ' order by c.d, c.t)
    into bad
    from unnest(c_day, c_type) c(d, t)
    cross join lateral (select string_agg(coalesce(nullif(btrim(p.display_name), ''), 'another APP') || '''s', ' and '
                                          order by coalesce(nullif(btrim(p.display_name), ''), 'another APP')) as names
                          from public.app_call_days x left join public.user_profiles p on p.id = x.profile_id
                         where x.day = c.d and x.shift_type = c.t and x.profile_id <> who) h
   where h.names is not null
     and not exists (select 1 from public.app_call_days x where x.day = c.d and x.shift_type = c.t and x.profile_id = who);
  if bad is not null then
    if sched then
      raise exception 'APP_DAY_STALE: % - reload the calendar (nothing was saved)', bad using errcode = 'AP007';
    end if;
    raise exception 'APP_DAY_NOT_YOURS: % - only that APP or the scheduler can remove it (nothing was saved)', bad using errcode = 'AP002';
  end if;
  -- the scheduler's change: the APP it takes over from must still hold every shift added
  if p_replace is not null then
    select nullif(btrim(p.display_name), '') into r_name from public.user_profiles p where p.id = p_replace;
    select string_agg(to_char(a.d, 'FMMM/FMDD') || ' ' || a.t, ', ' order by a.d, a.t) into bad
      from unnest(a_day, a_type) a(d, t)
     where not exists (select 1 from public.app_call_days x where x.day = a.d and x.shift_type = a.t and x.profile_id = p_replace);
    if bad is not null then
      raise exception 'APP_DAY_STALE: % is no longer %''s shift - reload the calendar (nothing was saved)', bad, coalesce(r_name, 'another APP') using errcode = 'AP007';
    end if;
  end if;
  -- perDay: an added shift that other APPs already fill (the one taken over from does not count) is refused, naming them
  select string_agg(to_char(a.d, 'FMMM/FMDD') || ' ' || a.t || ' already has ' || h.names
                    || case when st.per_day > 1 then ' (' || st.per_day || ' a day)' else '' end, '; ' order by a.d, a.t)
    into bad
    from unnest(a_day, a_type) a(d, t)
    join public.silvis_app_shift_types(blob) st on st.id = a.t
    cross join lateral (select count(*) as n,
                               string_agg(coalesce(nullif(btrim(p.display_name), ''), 'another APP'), ' and '
                                          order by coalesce(nullif(btrim(p.display_name), ''), 'another APP')) as names
                          from public.app_call_days x left join public.user_profiles p on p.id = x.profile_id
                         where x.day = a.d and x.shift_type = a.t and x.profile_id <> who and x.profile_id is distinct from p_replace) h
   where h.n >= st.per_day
     and not exists (select 1 from public.app_call_days x where x.day = a.d and x.shift_type = a.t and x.profile_id = who);
  if bad is not null then
    raise exception 'APP_DAY_TAKEN: % - nothing was saved', bad using errcode = 'AP005';
  end if;
  -- an added shift reaching into one of the APP's own vacation days (any minute of it) is refused
  select string_agg(to_char(x.d, 'FMMM/FMDD') || ' ' || x.t, ', ' order by x.d, x.t) into bad
    from (select distinct a.d, a.t
            from unnest(a_day, a_type) a(d, t)
            join public.silvis_app_shift_types(blob) st on st.id = a.t
            join public.app_time_off v on v.profile_id = who
           where (a.d - date '2000-01-01') * 1440 + st.start_min < (v.end_date - date '2000-01-01' + 1) * 1440
             and (v.start_date - date '2000-01-01') * 1440 < (a.d - date '2000-01-01') * 1440 + st.start_min
                   + case when st.end_min > st.start_min then st.end_min - st.start_min else st.end_min - st.start_min + 1440 end) x;
  if bad is not null then
    raise exception 'APP_DAY_VACATION: % is on %''s vacation - change the vacation first (nothing was saved)', bad, coalesce(t_name, 'the APP') using errcode = 'AP010';
  end if;
  -- two shifts of one APP may not overlap: the added ones against each other and against the shifts the APP keeps
  -- (a kept row whose type the blob no longer lists counts as its whole calendar day)
  with mine as (
    select a.d, a.t, true as added from unnest(a_day, a_type) a(d, t)
    union all
    select x.day, x.shift_type, false from public.app_call_days x
     where x.profile_id = who
       and not exists (select 1 from unnest(c_day, c_type) c(d, t) where c.d = x.day and c.t = x.shift_type)
       and not exists (select 1 from unnest(a_day, a_type) a(d, t) where a.d = x.day and a.t = x.shift_type)
  ),
  iv as (
    select m.d, m.t, m.added,
           (m.d - date '2000-01-01') * 1440 + coalesce(st.start_min, 0) as s,
           (m.d - date '2000-01-01') * 1440 + coalesce(st.start_min, 0)
             + coalesce(case when st.end_min > st.start_min then st.end_min - st.start_min else st.end_min - st.start_min + 1440 end, 1440) as e
      from mine m left join public.silvis_app_shift_types(blob) st on st.id = m.t
  )
  select string_agg(to_char(p.d, 'FMMM/FMDD') || ' ' || p.t || ' overlaps ' || to_char(q.d, 'FMMM/FMDD') || ' ' || q.t, ', ' order by p.d, p.t, q.d, q.t)
    into bad
    from iv p join iv q on p.added and (q.d, q.t) <> (p.d, p.t) and (not q.added or (p.d, p.t) < (q.d, q.t)) and p.s < q.e and q.s < p.e;
  if bad is not null then
    raise exception 'APP_DAY_OVERLAP: % - one APP holds one shift at a time (nothing was saved)', bad using errcode = 'AP009';
  end if;

  v_src := case when who = me then 'app' else 'scheduler' end;
  if p_replace is not null then
    with d as (
      delete from public.app_call_days x using unnest(a_day, a_type) a(d, t)
       where x.day = a.d and x.shift_type = a.t and x.profile_id = p_replace
      returning x.day, x.shift_type
    ) select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'type', d.shift_type, 'profile_id', p_replace, 'name', coalesce(r_name, 'another APP')) order by d.day, d.shift_type), '[]'::jsonb)
        into replaced from d;
  end if;
  with d as (
    delete from public.app_call_days x using unnest(c_day, c_type) c(d, t)
     where x.day = c.d and x.shift_type = c.t and x.profile_id = who
    returning x.day, x.shift_type
  ) select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'type', d.shift_type) order by d.day, d.shift_type), '[]'::jsonb) into del from d;
  with i as (
    insert into public.app_call_days (day, shift_type, profile_id, source, created_by)
    select a.d, a.t, who, v_src, me from unnest(a_day, a_type) a(d, t)
    on conflict (day, shift_type, profile_id) do nothing
    returning day, shift_type
  ) select coalesce(jsonb_agg(jsonb_build_object('day', i.day, 'type', i.shift_type) order by i.day, i.shift_type), '[]'::jsonb) into ins from i;
  -- defence in depth (the lock makes it unreachable through this function): no shift this save inserted may now hold more APPs than
  -- its perDay (a shift the APP already held is not counted again: a perDay lowered in Setup keeps a day's holders)
  if exists (select 1 from jsonb_array_elements(ins) x join public.silvis_app_shift_types(blob) st on st.id = x ->> 'type'
              where (select count(*) from public.app_call_days d where d.day = (x ->> 'day')::date and d.shift_type = x ->> 'type') > st.per_day) then
    raise exception 'APP_DAY_TAKEN: a shift filled up during this save - reload and try again (nothing was saved)' using errcode = 'AP005';
  end if;

  if jsonb_array_length(ins) + jsonb_array_length(del) > 0 then
    v_sum := coalesce(t_name, 'APP') || ': ' || concat_ws('; ',
      (select string_agg(g.txt, '; ' order by g.first_day, g.t)
         from (select x ->> 'type' as t, min((x ->> 'day')::date) as first_day,
                      (x ->> 'type') || ' ' || string_agg(to_char((x ->> 'day')::date, 'FMMM/FMDD')
                        || coalesce(' (was ' || (select r ->> 'name' from jsonb_array_elements(replaced) r
                                                  where r ->> 'day' = x ->> 'day' and r ->> 'type' = x ->> 'type' limit 1) || ')', ''),
                        ', ' order by (x ->> 'day')::date) as txt
                 from jsonb_array_elements(ins) x group by x ->> 'type') g),
      (select string_agg('removed ' || g.txt, '; ' order by g.first_day, g.t)
         from (select x ->> 'type' as t, min((x ->> 'day')::date) as first_day,
                      (x ->> 'type') || ' ' || string_agg(to_char((x ->> 'day')::date, 'FMMM/FMDD'), ', ' order by (x ->> 'day')::date) as txt
                 from jsonb_array_elements(del) x group by x ->> 'type') g));
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (coalesce(public.silvis_person_id(), me::text),
            coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                     (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                       where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                     'Unknown'),
            'appdays.save',
            jsonb_build_object('summary', v_sum, 'profile_id', who, 'added', ins, 'removed', del, 'replaced', replaced, 'source', v_src));
  end if;
  return jsonb_build_object('ok', true, 'profile_id', who, 'added', jsonb_array_length(ins), 'removed', jsonb_array_length(del),
                            'kept', cardinality(a_day) - jsonb_array_length(ins), 'absent', cardinality(c_day) - jsonb_array_length(del),
                            'replaced', jsonb_array_length(replaced), 'source', v_src, 'audit', jsonb_array_length(ins) + jsonb_array_length(del) > 0);
end $$;
revoke all on function public.save_app_days(uuid, jsonb, jsonb, uuid) from public;
revoke all on function public.save_app_days(uuid, jsonb, jsonb, uuid) from anon;
grant execute on function public.save_app_days(uuid, jsonb, jsonb, uuid) to authenticated;
comment on function public.save_app_days(uuid, jsonb, jsonb, uuid) is 'Prompt 29 / revision ac (Prompt 35): the only write path into app_call_days - typed shifts, the lists JSON arrays of {day, type}. An APP for its own profile, the scheduler (admin / scheduler) for any APP (adds) or any holder (clears; p_replace = the APP a change takes a shift over from). All or nothing; refusals before any write: AP001 APP_DAY_NOT_ALLOWED, AP002 APP_DAY_NOT_YOURS, AP003 APP_DAY_NOT_APP, AP004 APP_DAY_BAD_DAY, AP005 APP_DAY_TAKEN (perDay), AP006 APP_DAY_PAST (not the scheduler), AP007 APP_DAY_STALE, AP008 APP_DAY_NO_SHIFT (type, weekday, holiday, retired), AP009 APP_DAY_OVERLAP, AP010 APP_DAY_VACATION. Writes one appdays.save audit row per Save that changed something (the client writes none); no notification row, no e-mail.';

-- (5) save_app_vacations: the only write path into app_time_off
create or replace function public.save_app_vacations(p_profile uuid, p_add jsonb, p_remove uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me        uuid := auth.uid();
  sched     boolean := public.silvis_is_sched();
  coord     boolean := public.silvis_is_coord();
  c_app     boolean := public.silvis_is_app();
  who       uuid := p_profile;
  today_c   date := (now() at time zone 'America/Chicago')::date;
  blob      jsonb;
  a_s       date[];
  a_e       date[];
  rm        uuid[];
  t_app     boolean;
  t_name    text;
  v_src     text;
  bad       text;
  ins       jsonb := '[]'::jsonb;
  del       jsonb := '[]'::jsonb;
  n_kept    int := 0;
  v_sum     text;
begin
  if me is null or not (sched or coord or c_app) then
    raise exception 'APP_VACATION_NOT_ALLOWED: only an APP account, the scheduler or the office can enter an APP vacation' using errcode = 'AV001';
  end if;
  if who is null and c_app then who := me; end if;
  if who is null then
    raise exception 'APP_VACATION_NOT_ALLOWED: name the APP (pick one in Time off)' using errcode = 'AV001';
  end if;
  if not (sched or coord) and who <> me then
    raise exception 'APP_VACATION_NOT_YOURS: an APP enters, changes or removes only their own vacations - ask the scheduler or the office' using errcode = 'AV002';
  end if;
  -- the lists: p_add a JSON array of {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, p_remove the ids of the APP's vacations to remove
  if p_add is not null and jsonb_typeof(p_add) <> 'array' then
    raise exception 'APP_VACATION_BAD_RANGE: the vacations must come as a list - nothing was saved' using errcode = 'AV004';
  end if;
  if array_position(p_remove, null) is not null then
    raise exception 'APP_VACATION_BAD_RANGE: a vacation in the remove list is empty - nothing was saved' using errcode = 'AV004';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x -> 'start') is distinct from 'string' or jsonb_typeof(x -> 'end') is distinct from 'string') then
    raise exception 'APP_VACATION_BAD_RANGE: a vacation in the list is not a first and a last day - nothing was saved' using errcode = 'AV004';
  end if;
  if coalesce(jsonb_array_length(p_add), 0) + coalesce(cardinality(p_remove), 0) > 50 then
    raise exception 'APP_VACATION_BAD_RANGE: at most 50 vacations in one save - nothing was saved' using errcode = 'AV004';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) x
              where (x ->> 'start') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (x ->> 'end') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
    raise exception 'APP_VACATION_BAD_RANGE: a day in the list is not a calendar day - nothing was saved' using errcode = 'AV004';
  end if;
  begin
    select coalesce(array_agg(s.a order by s.a, s.b), '{}'), coalesce(array_agg(s.b order by s.a, s.b), '{}') into a_s, a_e
      from (select distinct (x ->> 'start')::date as a, (x ->> 'end')::date as b from jsonb_array_elements(coalesce(p_add, '[]'::jsonb)) x) s;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'APP_VACATION_BAD_RANGE: a day in the list is not a calendar day - nothing was saved' using errcode = 'AV004';
  end;
  select string_agg(to_char(a.s, 'FMMM/FMDD') || '-' || to_char(a.e, 'FMMM/FMDD'), ', ' order by a.s, a.e) into bad
    from unnest(a_s, a_e) a(s, e) where a.e < a.s;
  if bad is not null then
    raise exception 'APP_VACATION_BAD_RANGE: % ends before it starts - nothing was saved', bad using errcode = 'AV004';
  end if;
  select string_agg(to_char(a.s, 'FMMM/FMDD') || '-' || to_char(a.e, 'FMMM/FMDD'), ', ' order by a.s, a.e) into bad
    from unnest(a_s, a_e) a(s, e) where a.e - a.s > 365;
  if bad is not null then
    raise exception 'APP_VACATION_BAD_RANGE: % is longer than a year - nothing was saved', bad using errcode = 'AV004';
  end if;
  select string_agg(to_char(p.s, 'FMMM/FMDD') || case when p.e > p.s then '-' || to_char(p.e, 'FMMM/FMDD') else '' end || ' and '
                    || to_char(q.s, 'FMMM/FMDD') || case when q.e > q.s then '-' || to_char(q.e, 'FMMM/FMDD') else '' end, ', ' order by p.s, p.e, q.s, q.e)
    into bad
    from unnest(a_s, a_e) with ordinality p(s, e, i) join unnest(a_s, a_e) with ordinality q(s, e, i) on p.i < q.i and p.s <= q.e and q.s <= p.e;
  if bad is not null then
    raise exception 'APP_VACATION_BAD_RANGE: % overlap - nothing was saved', bad using errcode = 'AV004';
  end if;
  select coalesce(array_agg(distinct r), '{}') into rm from unnest(coalesce(p_remove, '{}'::uuid[])) r;
  select (p.is_app and p.role = 'viewer' and p.person_id is null), nullif(btrim(p.display_name), '')
    into t_app, t_name from public.user_profiles p where p.id = who;
  if cardinality(a_s) > 0 and not coalesce(t_app, false) then
    raise exception 'APP_VACATION_NOT_APP: % is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)', coalesce(t_name, 'that account') using errcode = 'AV003';
  end if;
  -- One APP write at a time - the same lock as save_app_days (a vacation and a shift of one APP are checked against each other).
  perform pg_advisory_xact_lock(hashtext('app_call_days:save'));
  if exists (select 1 from unnest(rm) r where not exists (select 1 from public.app_time_off v where v.id = r and v.profile_id = who)) then
    raise exception 'APP_VACATION_STALE: a vacation in the list is gone or is not %''s - reload Time off (nothing was saved)', coalesce(t_name, 'this APP') using errcode = 'AV007';
  end if;
  if not sched then
    select string_agg(to_char(v.start_date, 'FMMM/FMDD') || case when v.end_date > v.start_date then '-' || to_char(v.end_date, 'FMMM/FMDD') else '' end,
                      ', ' order by v.start_date, v.end_date)
      into bad
      from public.app_time_off v where v.id = any(rm) and v.start_date <= today_c;
    if bad is not null then
      raise exception 'APP_VACATION_PAST: % has started or passed (today is % in Central time) - it stays on record, ask the scheduler if it needs to go (nothing was saved)', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'AV006';
    end if;
  end if;
  -- an add equal to a vacation the APP keeps is kept (a re-sent Save); any other add touching a kept vacation is refused
  select count(*) into n_kept
    from unnest(a_s, a_e) a(s, e)
   where exists (select 1 from public.app_time_off v where v.profile_id = who and not (v.id = any(rm)) and v.start_date = a.s and v.end_date = a.e);
  select string_agg(x.txt, ', ' order by x.s, x.e) into bad
    from (select distinct v.start_date as s, v.end_date as e,
                 to_char(v.start_date, 'FMMM/FMDD') || case when v.end_date > v.start_date then '-' || to_char(v.end_date, 'FMMM/FMDD') else '' end as txt
            from unnest(a_s, a_e) a(s, e)
            join public.app_time_off v on v.profile_id = who and not (v.id = any(rm)) and v.start_date <= a.e and a.s <= v.end_date
           where not (v.start_date = a.s and v.end_date = a.e)) x;
  if bad is not null then
    raise exception 'APP_VACATION_OVERLAP: % is already away % - change that vacation instead (nothing was saved)', coalesce(t_name, 'the APP'), bad using errcode = 'AV008';
  end if;
  -- the APP's own shifts: a vacation reaching any minute of one is refused (a shift whose type the blob no longer lists counts as its day)
  select c.data into blob from public.call_schedule_data c where c.id = 'main';
  select string_agg(x.txt, ', ' order by x.day, x.shift_type) into bad
    from (select distinct s.day, s.shift_type, to_char(s.day, 'FMMM/FMDD') || ' ' || s.shift_type as txt
            from public.app_call_days s
            left join public.silvis_app_shift_types(blob) st on st.id = s.shift_type
            join unnest(a_s, a_e) a(s, e) on true
           where s.profile_id = who
             and (s.day - date '2000-01-01') * 1440 + coalesce(st.start_min, 0) < (a.e - date '2000-01-01' + 1) * 1440
             and (a.s - date '2000-01-01') * 1440 < (s.day - date '2000-01-01') * 1440 + coalesce(st.start_min, 0)
                   + coalesce(case when st.end_min > st.start_min then st.end_min - st.start_min else st.end_min - st.start_min + 1440 end, 1440)) x;
  if bad is not null then
    raise exception 'APP_VACATION_ON_SHIFT: % holds % - remove the shift first (nothing was saved)', coalesce(t_name, 'the APP'), bad using errcode = 'AV005';
  end if;

  v_src := case when who = me then 'app' when sched then 'scheduler' else 'office' end;
  with d as (
    delete from public.app_time_off v where v.id = any(rm) and v.profile_id = who returning v.id, v.start_date, v.end_date
  ) select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'start', d.start_date, 'end', d.end_date) order by d.start_date, d.end_date), '[]'::jsonb) into del from d;
  with i as (
    insert into public.app_time_off (profile_id, start_date, end_date, source, created_by)
    select who, a.s, a.e, v_src, me from unnest(a_s, a_e) a(s, e)
     where not exists (select 1 from public.app_time_off v where v.profile_id = who and v.start_date = a.s and v.end_date = a.e)
    returning id, start_date, end_date
  ) select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'start', i.start_date, 'end', i.end_date) order by i.start_date, i.end_date), '[]'::jsonb) into ins from i;
  if jsonb_array_length(ins) + jsonb_array_length(del) > 0 then
    v_sum := coalesce(t_name, 'APP') || ': ' || concat_ws('; ',
      (select 'vacation ' || string_agg(to_char((x ->> 'start')::date, 'FMMM/FMDD')
                 || case when (x ->> 'end')::date > (x ->> 'start')::date then '-' || to_char((x ->> 'end')::date, 'FMMM/FMDD') else '' end,
               ', ' order by (x ->> 'start')::date)
         from jsonb_array_elements(ins) x having count(*) > 0),
      (select 'removed vacation ' || string_agg(to_char((x ->> 'start')::date, 'FMMM/FMDD')
                 || case when (x ->> 'end')::date > (x ->> 'start')::date then '-' || to_char((x ->> 'end')::date, 'FMMM/FMDD') else '' end,
               ', ' order by (x ->> 'start')::date)
         from jsonb_array_elements(del) x having count(*) > 0));
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (coalesce(public.silvis_person_id(), me::text),
            coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                     (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                       where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                     'Unknown'),
            'appvac.save',
            jsonb_build_object('summary', v_sum, 'profile_id', who, 'added', ins, 'removed', del, 'source', v_src));
  end if;
  return jsonb_build_object('ok', true, 'profile_id', who, 'added', jsonb_array_length(ins), 'removed', jsonb_array_length(del),
                            'kept', n_kept, 'source', v_src, 'audit', jsonb_array_length(ins) + jsonb_array_length(del) > 0);
end $$;
revoke all on function public.save_app_vacations(uuid, jsonb, uuid[]) from public;
revoke all on function public.save_app_vacations(uuid, jsonb, uuid[]) from anon;
grant execute on function public.save_app_vacations(uuid, jsonb, uuid[]) to authenticated;
comment on function public.save_app_vacations(uuid, jsonb, uuid[]) is 'Revision ac (Prompt 35): the only write path into app_time_off - p_add a JSON array of {start, end}, p_remove the ids to remove (a change = remove + add in one Save). An APP for itself; the scheduler and the office coordinator for any APP (adds only for a current APP). All or nothing; refusals before any write: AV001 APP_VACATION_NOT_ALLOWED, AV002 APP_VACATION_NOT_YOURS, AV003 APP_VACATION_NOT_APP, AV004 APP_VACATION_BAD_RANGE, AV005 APP_VACATION_ON_SHIFT (remove the shift first), AV006 APP_VACATION_PAST (a started vacation; not the scheduler), AV007 APP_VACATION_STALE, AV008 APP_VACATION_OVERLAP. No vacation guard (the surgeons'' minimum does not count APPs). Writes one appvac.save audit row per Save that changed something; no notification row, no e-mail.';

-- (6) app_call_names(), re-created: the holders of APP vacations too, and every APP profile for the office coordinator
create or replace function public.app_call_names() returns table (profile_id uuid, display_name text, is_app boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, nullif(btrim(p.display_name), ''), (p.is_app and p.role = 'viewer' and p.person_id is null)
    from public.user_profiles p
   where auth.uid() is not null
     and (exists (select 1 from public.app_call_days a where a.profile_id = p.id)
          or exists (select 1 from public.app_time_off v where v.profile_id = p.id)
          or (p.is_app and p.role = 'viewer' and p.person_id is null
              and (p.id = auth.uid() or public.silvis_is_sched() or public.silvis_is_coord())))
   order by p.id;
$$;
revoke all on function public.app_call_names() from public;
revoke all on function public.app_call_names() from anon;
grant execute on function public.app_call_names() to authenticated;
comment on function public.app_call_names() is 'Prompt 29 / revision ac (Prompt 35): the display names of the APP shifts and vacations - every profile that holds a shift or a vacation (any signed-in caller), the caller''s own APP profile and, for the scheduler and the office coordinator, every APP profile (the day editor''s and Time off''s pick lists). Display name and the APP flag only - never an email, never a role. Stable: the client calls it with GET.';

notify pgrst, 'reload schema';
