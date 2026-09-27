-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-27: call pay - call_pay_settings + call_pay_logs (Faraz 9/27: a place to track
-- primary call pay; this REVERSES the 9/21 rule "no compensation logic and no $ display anywhere in this app").
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: row-level security on the live database). Two NEW tables and one
-- NEW helper function only: no existing table, column, policy, function, grant or row is touched. sql/schema.sql mirrors
-- every statement below (header revision r, "report-first, NOT yet applied" until the record step); test/schema.test.js
-- pins the identity.
--
-- What it holds. call_pay_settings: ONE row 'main' - the four rates the scheduler enters in the app (Setup > Pay rates),
-- the flags that shape the pay model (which weekdays count as weekend, whether every day of a holiday unit is a holiday,
-- whether the call-in rates need a logged call-in, whether the activation rate is per hour or per call-in), and
-- stipend_off_ids (Faraz 9/27, item 5b): the roster ids of the surgeons NOT paid by the call stipend - the per-surgeon
-- "Paid by the call stipend" switch in Setup > Pay rates, default ON for everyone (the list starts empty; switched off =
-- listed; the scheduler sets it as data, no roster id is named here). call_pay_logs: one row per call-in of the PRIMARY
-- surgeon on a call day (07:00 -> 07:00): the day, the roster id, the hours worked (quarter hours, 0-24; on a weekday the
-- after-hours hours) and an optional operational note (no contact data).
-- Backup is never paid; a day belongs to the person who is primary on it in schedule_days at the time of writing.
--
-- NO RATE FIGURE ANYWHERE. The repo is public and the anon-readable tables are public; the rates live only in this
-- authenticated table, entered by the scheduler. The 'main' row is created with every rate null ("rates not set yet").
-- wRVUs are out of scope for now; a later wrvu rate column here and a wrvus column on the logs slot in without reshaping.
--
-- silvis_pay_enabled(pid) (security definer, stable, search_path public, pg_temp; EXECUTE revoked from public / anon,
-- granted to authenticated / service_role): true when pid is not null and not listed in call_pay_settings.stipend_off_ids.
-- It reads the settings row as its owner, so the settings read policy that calls it does not recurse on itself, and the
-- guard below sees the list even for a caller who may not read the row. It answers truly only to a caller entitled to know:
-- the scheduler / admin, the office coordinator, the person pid himself, or a session with no signed-in user (auth.uid()
-- null: service_role, the SQL editor / linked CLI). Any other signed-in caller - a viewer, a follower, a surgeon asking
-- about a colleague - gets an uninformative true (9/27 review: the function is callable as /rest/v1/rpc/silvis_pay_enabled,
-- and "who is switched off" is pay status those roles never see). That true opens nothing: every policy calls it with the
-- caller's own roster id, and in the guard the scheduler and the owner get the real answer (PY005), while any other writer's
-- row is refused by the write policies anyway (42501).
--
-- Who reads / writes (RLS; `revoke all ... from anon` on both tables on top, defence in depth for pay data - an anon
-- request is then refused outright (401 / 403) rather than answered 200 + []):
--   call_pay_settings  read: scheduler / admin, the office COORDINATOR (read-only: it prepares the stipends), and a
--                      SURGEON-role account linked to a roster id that is paid by the call stipend (silvis_pay_enabled);
--                      write: scheduler / admin
--   call_pay_logs      read: scheduler / admin and the coordinator every row (a switched-off surgeon's earlier rows
--                      included); a SURGEON-role account the rows whose person_id is his own roster id while he is paid by
--                      the stipend. insert / update / delete: scheduler / admin every row; that surgeon his own rows while
--                      switched on. The coordinator writes nothing; viewer, follower and anon read and write nothing.
-- A surgeon switched OFF therefore reads no rate (0 settings rows), none of his call-ins and can write none - enforced here,
-- not only in the client (which renders no My pay card for him and leaves him out of Totals > Pay and its CSV).
-- Guards (call_pay_logs_guard, BEFORE INSERT OR UPDATE, every caller - the scheduler included; fails closed):
--   PY004 PAY_READ_ONLY    the caller is the office coordinator (read-only; the write policies do not admit it either)
--   PY005 PAY_STIPEND_OFF  the person is switched off (not paid by the call stipend) - no new or edited call-in, for anyone
--   PY001 PAY_FUTURE       the day is after today in America/Chicago (a call-in is logged once it happened)
--   PY002 PAY_NOT_PRIMARY  the person is not the primary on that day in schedule_days (backup is never paid)
--   PY003 PAY_HOURS_OVER   the person's hours on that day would exceed 24
-- The guard takes a transaction advisory lock on (person, day) before it sums the day's hours, so two concurrent call-ins of
-- one person on one day cannot both pass the 24 h check. Both trigger functions are security invoker with a pinned
-- search_path. Deletes are unguarded (RLS only): a surgeon removes his own row, also one left behind when the day's primary
-- changed; RLS on select / delete checks the owner only (not the primary), so such an orphan stays readable and deletable by
-- its owner. The guard binds the scheduler too: nobody, the scheduler included, can log a future day or a non-primary day,
-- or log / edit a call-in of a switched-off surgeon (the scheduler may still delete one).
-- Privileges: anon holds none (revoked); authenticated keeps select / insert / update / delete only (Supabase's default
-- privileges also grant TRUNCATE / REFERENCES / TRIGGER on a new table - revoked here, since RLS does not cover TRUNCATE).
--
-- Blast radius: two new tables and one new helper function; nothing that exists changes. The client shows "Pay tracking is
-- available after the next database update" until this file is applied (it reads 404 PGRST205 / 42P01 as 'unavailable',
-- never as an empty list). The only live side effect is PostgREST's schema cache (run `notify pgrst, 'reload schema';` if
-- the tables do not show). After the apply the office coordinator sees Totals > Pay (read-only, with its CSV).
--
-- Apply live with the Supabase CLI (absolute path; the workdir is a directory linked with `supabase link --project-ref
-- bzhsroegtagqhutbnsrp`), or paste the file into the SQL editor as ONE session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-27-call-pay.sql
-- Order: pre-check `select to_regclass('public.call_pay_logs');` -> null; probe BEFORE (sql/probes/call-pay-probe.sql raises
-- PROBE_SETUP: call_pay_logs is absent); this file; probe AFTER; `SILVIS_CALL_PAY_APPLIED=1 bash scripts/verify-rls.sh`
-- (sections 1-14 green); Faraz enters the rates and the stipend switches in Setup > Pay rates; the record step
-- (docs/SCHEMA-REVIEW.md).
-- Re-running: every statement is idempotent from no call pay tables or from this version of them; over an earlier draft's
-- call_pay_settings (no stipend_off_ids - a scratch or preview database) the `alter table ... add column if not exists` adds it.
-- Rolling back = `drop table if exists public.call_pay_logs; drop table if exists public.call_pay_settings;
-- drop function if exists public.silvis_pay_enabled(text); drop function if exists public.call_pay_logs_guard(); drop function if exists public.call_pay_settings_touch();`
-- (the tables' triggers and policies go with them, the helper after them; nothing else refers to either table).
-- ============================================================================

create table if not exists public.call_pay_settings (
  id                              text primary key default 'main' check (id = 'main'),
  stipend_per_shift               numeric(10,2) check (stipend_per_shift is null or stipend_per_shift between 0 and 99999),
  weekday_callin_rate             numeric(10,2) check (weekday_callin_rate is null or weekday_callin_rate between 0 and 99999),
  weekend_holiday_callin_rate     numeric(10,2) check (weekend_holiday_callin_rate is null or weekend_holiday_callin_rate between 0 and 99999),
  activation_rate                 numeric(10,2) check (activation_rate is null or activation_rate between 0 and 99999),
  activation_unit                 text not null default 'hour' check (activation_unit in ('hour','activation')),
  weekend_days                    jsonb not null default '["Sat","Sun"]'::jsonb check (jsonb_typeof(weekend_days) = 'array' and weekend_days <@ '["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]'::jsonb),
  holiday_unit_days_are_holidays  boolean not null default true,
  callin_required_weekday         boolean not null default true,
  callin_required_weekend_holiday boolean not null default true,
  stipend_off_ids                 jsonb not null default '[]'::jsonb check (case when jsonb_typeof(stipend_off_ids) = 'array' then not jsonb_path_exists(stipend_off_ids, 'strict $[*] ? (@.type() != "string" || @ == "")') else false end),
  updated_by                      text,
  updated_at                      timestamptz not null default now()
);

-- re-run over an older (pre-5b) call_pay_settings, e.g. a scratch database: create table if not exists skipped it - add the column
alter table public.call_pay_settings add column if not exists stipend_off_ids jsonb not null default '[]'::jsonb check (case when jsonb_typeof(stipend_off_ids) = 'array' then not jsonb_path_exists(stipend_off_ids, 'strict $[*] ? (@.type() != "string" || @ == "")') else false end);

create table if not exists public.call_pay_logs (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  person_id   text not null,
  hours       numeric(5,2) not null default 0 check (hours >= 0 and hours <= 24 and hours * 4 = trunc(hours * 4)),
  note        text check (note is null or (char_length(note) <= 200 and note !~ '@' and note !~ '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}')),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists call_pay_logs_person_day_idx on public.call_pay_logs(person_id, day);

create or replace function public.silvis_pay_enabled(pid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select pid is not null and (
    not coalesce(auth.uid() is null or public.silvis_is_sched() or public.silvis_is_coord() or pid = public.silvis_person_id(), false)
    or not exists (select 1 from public.call_pay_settings s where s.stipend_off_ids ? pid));
$$;
revoke execute on function public.silvis_pay_enabled(text) from public;
revoke execute on function public.silvis_pay_enabled(text) from anon;
grant execute on function public.silvis_pay_enabled(text) to authenticated;
grant execute on function public.silvis_pay_enabled(text) to service_role;

create or replace function public.call_pay_logs_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  others  numeric;
begin
  if public.silvis_is_coord() then
    raise exception 'PAY_READ_ONLY: the office reads call pay and writes none - a call-in is logged by the surgeon or the scheduler' using errcode = 'PY004';
  end if;
  if not public.silvis_pay_enabled(new.person_id) then
    raise exception 'PAY_STIPEND_OFF: % is not paid by the call stipend - no call-in is logged for him (switched off in Setup > Pay rates)', new.person_id using errcode = 'PY005';
  end if;
  if new.day > today_c then
    raise exception 'PAY_FUTURE: % is after today (%) in Central time - a call-in is logged once it happened', new.day, today_c using errcode = 'PY001';
  end if;
  if not exists (select 1 from public.schedule_days d where d.day = new.day and d.primary_id = new.person_id) then
    raise exception 'PAY_NOT_PRIMARY: % is not the primary on % - call pay is logged for the primary only', new.person_id, new.day using errcode = 'PY002';
  end if;
  -- one writer per person and day at a time: two concurrent call-ins cannot both pass the 24 h sum (read-then-write)
  perform pg_advisory_xact_lock(hashtext('call_pay:' || new.person_id || ':' || new.day::text));
  select coalesce(sum(l.hours), 0) into others
    from public.call_pay_logs l
   where l.person_id = new.person_id and l.day = new.day and l.id is distinct from new.id;
  if others + new.hours > 24 then
    raise exception 'PAY_HOURS_OVER: % already has % h logged on % - one call day holds at most 24 h', new.person_id, others, new.day using errcode = 'PY003';
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(public.silvis_person_id(), auth.uid()::text, new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists call_pay_logs_guard_trg on public.call_pay_logs;
create trigger call_pay_logs_guard_trg
  before insert or update on public.call_pay_logs
  for each row execute function public.call_pay_logs_guard();

create or replace function public.call_pay_settings_touch() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(public.silvis_person_id(), auth.uid()::text, new.updated_by);
  return new;
end $$;
drop trigger if exists call_pay_settings_touch_trg on public.call_pay_settings;
create trigger call_pay_settings_touch_trg
  before insert or update on public.call_pay_settings
  for each row execute function public.call_pay_settings_touch();

revoke all on table public.call_pay_settings from anon;
revoke all on table public.call_pay_logs from anon;
revoke truncate, references, trigger on table public.call_pay_settings from authenticated;
revoke truncate, references, trigger on table public.call_pay_logs from authenticated;
grant select, insert, update, delete on table public.call_pay_settings to authenticated;
grant select, insert, update, delete on table public.call_pay_logs to authenticated;

alter table public.call_pay_settings       enable row level security;
alter table public.call_pay_logs           enable row level security;

drop policy if exists call_pay_settings_read on public.call_pay_settings;
create policy call_pay_settings_read on public.call_pay_settings for select to authenticated
  using (public.silvis_is_sched() or public.silvis_is_coord() or (public.silvis_role() = 'surgeon' and public.silvis_pay_enabled(public.silvis_person_id())));
drop policy if exists call_pay_settings_write on public.call_pay_settings;
create policy call_pay_settings_write on public.call_pay_settings for all to authenticated
  using (public.silvis_is_sched()) with check (public.silvis_is_sched());
drop policy if exists call_pay_logs_read on public.call_pay_logs;
create policy call_pay_logs_read on public.call_pay_logs for select to authenticated
  using (public.silvis_is_sched() or public.silvis_is_coord() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));
drop policy if exists call_pay_logs_insert on public.call_pay_logs;
create policy call_pay_logs_insert on public.call_pay_logs for insert to authenticated
  with check (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));
drop policy if exists call_pay_logs_update on public.call_pay_logs;
create policy call_pay_logs_update on public.call_pay_logs for update to authenticated
  using (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)))
  with check (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));
drop policy if exists call_pay_logs_delete on public.call_pay_logs;
create policy call_pay_logs_delete on public.call_pay_logs for delete to authenticated
  using (public.silvis_is_sched() or (public.silvis_role() = 'surgeon' and person_id = public.silvis_person_id() and public.silvis_pay_enabled(person_id)));

insert into public.call_pay_settings (id) values ('main') on conflict (id) do nothing;
