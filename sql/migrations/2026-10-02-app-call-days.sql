-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-02: APP call days (Faraz 10/1 6:33 PM, Prompt 29: "I want the APPs to be able to
-- add themselves to call days - it would be a feature available to APPs or Me ... This would also show up on the calendar").
-- The four decisions (Faraz 10/1): any day; ONE APP per day; everyone signed in sees it, not the ?public=1 page; no e-mails,
-- the Activity log only.
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a new table, two re-created user_profiles policies and a write path
-- every APP Save goes through). Nothing in the repo applies it: Faraz runs the one command below and pastes the log back.
--
-- What changes. (1) user_profiles gains is_app boolean not null default false (an APP = an unlinked viewer row with the flag,
-- set by the admin in Setup > Users) and the check user_profiles_app_viewer (an APP is a viewer account, never a roster entry);
-- user_profiles_self_insert is re-created with one more clause that pins is_app against self-service, user_profiles_self_update
-- with two: the is_app pin and, on an APP's row, a display_name pin (an APP's name reaches every signed-in user through
-- app_call_names - the calendar's A line, the refusal texts, the audit summary - so the admin names APPs in Setup > Users; every
-- other account keeps renaming itself) - byte for byte the followers texts otherwise. (2) ONE new helper public.silvis_is_app() (security definer,
-- search_path public, pg_temp). (3) ONE new table public.app_call_days (day date PRIMARY KEY - one APP per day, the database
-- enforces it; profile_id -> user_profiles on delete cascade; source 'app' / 'scheduler'; created_by; created_at): read by every
-- signed-in role (policy app_call_days_read), never anon (no anon policy AND anon's table privileges revoked - an anon request is
-- refused 401 / 403, never a silent 200 + []); authenticated keeps SELECT only, so a direct INSERT / UPDATE / DELETE is 42501.
-- (4) public.app_call_names() (security definer, stable): the display names of the APP days. (5) public.save_app_days(p_profile,
-- p_add, p_clear, p_replace) (security definer, volatile): the ONLY write path; it writes the appdays.save audit row itself (an
-- unlinked viewer cannot insert audit rows - audit_insert is unchanged). No row is written by this file; no other table, policy,
-- trigger or function changes (user_profiles_read, user_profiles_admin, audit_*, notif_* untouched). sql/schema.sql mirrors every
-- statement below (header revision v, "report-first, NOT yet applied" until the record step); test/schema.test.js pins it.
--
-- The decision: a FLAG, not a role. A role 'app' would stop the follower e-mails silently (daily-reminder and send-notification
-- pick followers BY ROLE and are deployed by hand - this prompt forbids deploys), Setup's followsPatch would clear an APP's
-- follows on the role change, and every viewer branch of the client would need an edit. With is_app the account keeps role
-- 'viewer' and everything a viewer has (follows, follower e-mails, preferences, the calendar) plus this feature. Only the admin
-- writes user_profiles (user_profiles_admin; Setup > Users is admin-gated) - the admin marks APP accounts.
--
-- Refusals (custom SQLSTATEs, HTTP 400 through PostgREST like OS / OM / VG / NP; <days> as M/D in day order; <name> = the
-- holder's display name, else "another APP"), all BEFORE any write, in this order:
--   AP001 APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day
--   AP001 APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)
--   AP002 APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler
--   AP002 APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day
--   AP004 APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved
--   AP004 APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved   (infinity / -infinity)
--   AP004 APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved
--   AP004 APP_DAY_BAD_DAY: <days> is both added and removed in one save - nothing was saved
--   AP003 APP_DAY_NOT_APP: <name, else that account> is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)
--   (the transaction advisory lock app_call_days:save - one APP-day write at a time, across all profiles)
--   AP006 APP_DAY_PAST: <days> is before today (<M/D>) in Central time - a past day stays as it was
--   AP002 APP_DAY_NOT_YOURS: <M/D> is <name>'s day - only that APP or the scheduler can remove it (nothing was saved)
--   AP007 APP_DAY_STALE: <M/D> is <name>'s day - reload the calendar (nothing was saved)
--   AP005 APP_DAY_TAKEN: <M/D> already has <name> - nothing was saved
--   AP005 APP_DAY_TAKEN: a day changed hands during this save - reload and try again (nothing was saved)
-- An add of a day the profile already holds is "kept", a clear of a day nobody holds is "absent" - a Save re-sent after a lost
-- response is safe. All or nothing: one transaction (PostgREST wraps the RPC); every refusal raises before the first write.
--
-- Who it binds. An APP for its own profile (p_profile = its id, or null = itself); the scheduler (silvis_is_sched(): admin /
-- scheduler) for any profile - adds only for a current APP (AP003 binds the scheduler too), clears for any holder, p_replace
-- (scheduler only) takes over a day another APP holds (the day editor's "change"). Nobody else: not a surgeon, not the office
-- coordinator, not a plain viewer or follower, not anon (no EXECUTE), not a session with no signed-in user (AP001). The past-day
-- refusal (AP006, Central time; today is allowed) binds the APP for adds AND removals; the scheduler is exempt. A profile that
-- stops being an APP keeps its rows (they keep showing; the scheduler can clear them - AP003 binds adds only); deleting the account
-- removes them (auth.users -> user_profiles -> app_call_days, both on delete cascade); the audit rows stay (audit_log has no FK).
-- The audit row (action appdays.save, only when something changed, in the same transaction): actor_id = the caller's roster id,
-- else his auth uid (what the client's logAudit sends); actor_name = his display name, else his roster name, else Unknown;
-- detail = {summary, profile_id, added, removed, replaced, source}; summary "<APP name>: on call 12/2, 12/3; removed 12/11"
-- (display names only). No notification row, no e-mail.
--
-- Blast radius. Every self INSERT / UPDATE of user_profiles re-evaluates the two re-created policies - the shipped client sends
-- none (public sign-ups are off; the client never self-inserts or self-PATCHes a profile); the pins close a self-promotion hole
-- and keep an APP from renaming itself on everyone's calendar. The column add is NOT NULL DEFAULT false (no table rewrite; the new check passes on every existing row). A new
-- authenticated-only table and three new functions; no existing function, table or anon surface changes; the anon read_all loop
-- does not gain the table. Independent of Prompt 28 (no-primary days) and the weekend pair claim - no shared object, either apply
-- order. The client that reads and writes the APP days ships AFTER the apply (and after Prompt 28's client), on Faraz's go; it
-- reads a missing table / function as "unavailable", never as an empty list. The migration ends with a PostgREST schema-cache
-- reload (verify-rls 18c is the gate before the client push).
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-app-call-days.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-02-app-call-days.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction (observed: every probe's final raise rolls its whole batch back), and a
-- paste into the SQL editor runs as one session too - a failure anywhere changes nothing.
-- Order: 1. pre-check sql/probes/app-call-days-precheck.sql (read-only; the objects row must read table=no is_app=no
-- is_app_fn=no save_fn=no names_fn=no pins=0); 2. probe BEFORE sql/probes/app-call-days-probe.sql (expects PROBE_SETUP:
-- app_call_days is absent ...); 3. this file; 4. probe AFTER (69 cases, each as its header lists); 5. SILVIS_APP_DAYS_APPLIED=1
-- bash scripts/verify-rls.sh (sections 1-15 and 18 green); 6. the record step in docs/SCHEMA-REVIEW.md "2026-10-02 - APP call
-- days"; 7. the client push on Faraz's go, after Prompt 28's client; 8. Faraz sets Role = app on each APP account in Setup > Users.
-- Re-running: idempotent (add column if not exists, drop constraint / policy if exists, create table / index if not exists,
-- create or replace); the apply script refuses to re-run it anyway (its gate).
-- Rolling back (in this order - the policies depend on the column, so they are restored first; the APP days are lost: export
-- them first with `select * from public.app_call_days order by day;`):
--   drop function if exists public.save_app_days(uuid, date[], date[], boolean);
--   drop function if exists public.app_call_names();
--   drop table if exists public.app_call_days;
--   drop policy if exists user_profiles_self_insert on public.user_profiles;
--   create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
--     with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb);
--   drop policy if exists user_profiles_self_update on public.user_profiles;
--   create policy user_profiles_self_update on public.user_profiles for update to authenticated
--     using (id = auth.uid())
--     with check (id = auth.uid()
--       and role = (select role from public.user_profiles p where p.id = auth.uid())
--       and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
--       and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())
--       and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid()));
--   alter table public.user_profiles drop constraint if exists user_profiles_app_viewer;
--   alter table public.user_profiles drop column if exists is_app;
--   drop function if exists public.silvis_is_app();
--   notify pgrst, 'reload schema';
-- (the two policy texts are the followers texts, sql/migrations/2026-09-24-followers.sql). A rollback after the client push only
-- empties the APP features (the client reads the missing table / functions as "unavailable").
-- ============================================================================

alter table public.user_profiles add column if not exists is_app boolean not null default false;
alter table public.user_profiles drop constraint if exists user_profiles_app_viewer;
alter table public.user_profiles add constraint user_profiles_app_viewer
  check (not is_app or (role = 'viewer' and person_id is null));

create or replace function public.silvis_is_app() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_app and p.role = 'viewer' and p.person_id is null from public.user_profiles p where p.id = auth.uid()), false);
$$;
revoke all on function public.silvis_is_app() from public;
revoke all on function public.silvis_is_app() from anon;
grant execute on function public.silvis_is_app() to authenticated;
grant execute on function public.silvis_is_app() to service_role;
comment on function public.silvis_is_app() is 'Prompt 29 (APP call days): true when the signed-in account is an APP - an unlinked viewer row with is_app set by the admin in Setup > Users. Security definer (reads user_profiles past its RLS); EXECUTE for authenticated / service_role only; no policy uses it.';

drop policy if exists user_profiles_self_insert on public.user_profiles;
create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb and not is_app);
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
    and role = (select role from public.user_profiles p where p.id = auth.uid())
    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())
    and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid())
    and is_app is not distinct from (select is_app from public.user_profiles p where p.id = auth.uid())
    and (not is_app or display_name is not distinct from (select display_name from public.user_profiles p where p.id = auth.uid())));

create table if not exists public.app_call_days (
  day         date primary key check (isfinite(day)),                                  -- one APP per day: the database enforces it (never infinity)
  profile_id  uuid not null references public.user_profiles(id) on delete cascade,     -- deleting the account removes its days
  source      text not null check (source in ('app', 'scheduler')),                    -- the APP itself / the scheduler for an APP
  created_by  uuid,                                                                    -- auth.uid() of the writer (no FK: a deleted scheduler account touches nothing)
  created_at  timestamptz not null default now()
);
create index if not exists app_call_days_profile_idx on public.app_call_days (profile_id, day);
alter table public.app_call_days enable row level security;
revoke all on table public.app_call_days from anon;
revoke all on table public.app_call_days from authenticated;
grant select on table public.app_call_days to authenticated;
drop policy if exists app_call_days_read on public.app_call_days;
create policy app_call_days_read on public.app_call_days for select to authenticated using (true);
comment on table public.app_call_days is 'Prompt 29 (Faraz 10/1): the APP on call per day - ONE APP per day (day is the primary key). Read by every signed-in role, never anon (no anon policy, anon privileges revoked); written only through save_app_days() (authenticated holds SELECT only). Deleting the account removes its days (on delete cascade); the audit_log keeps the history.';

create or replace function public.app_call_names() returns table (profile_id uuid, display_name text, is_app boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, nullif(btrim(p.display_name), ''), (p.is_app and p.role = 'viewer' and p.person_id is null)
    from public.user_profiles p
   where auth.uid() is not null
     and (exists (select 1 from public.app_call_days a where a.profile_id = p.id)
          or (p.is_app and p.role = 'viewer' and p.person_id is null and (p.id = auth.uid() or public.silvis_is_sched())))
   order by p.id;
$$;
revoke all on function public.app_call_names() from public;
revoke all on function public.app_call_names() from anon;
grant execute on function public.app_call_names() to authenticated;
comment on function public.app_call_names() is 'Prompt 29: the display names of the APP days - every profile that holds a day (any signed-in caller), the caller''s own APP profile and, for the scheduler, every APP profile (the day editor''s pick list). Display name and the APP flag only - never an email, never a role. Stable: the client calls it with GET.';

create or replace function public.save_app_days(p_profile uuid, p_add date[], p_clear date[], p_replace boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me        uuid := auth.uid();
  sched     boolean := public.silvis_is_sched();
  c_app     boolean := public.silvis_is_app();
  who       uuid := p_profile;
  repl      boolean := coalesce(p_replace, false);
  today_c   date := (now() at time zone 'America/Chicago')::date;
  adds      date[];
  clears    date[];
  t_app     boolean;
  t_name    text;
  v_src     text;
  bad       text;
  ins_days  date[] := '{}';
  del_days  date[] := '{}';
  replaced  jsonb := '[]'::jsonb;
  v_sum     text;
begin
  if me is null or (not sched and not c_app) then
    raise exception 'APP_DAY_NOT_ALLOWED: only an APP account or the scheduler can put an APP on a call day' using errcode = 'AP001';
  end if;
  if who is null and c_app then who := me; end if;
  if who is null then
    raise exception 'APP_DAY_NOT_ALLOWED: name the APP (pick one in the day editor)' using errcode = 'AP001';
  end if;
  if not sched and who <> me then
    raise exception 'APP_DAY_NOT_YOURS: an APP adds or removes only their own days - ask the scheduler' using errcode = 'AP002';
  end if;
  if repl and not sched then
    raise exception 'APP_DAY_NOT_YOURS: only the scheduler can replace another APP on a day' using errcode = 'AP002';
  end if;
  if array_position(p_add, null) is not null or array_position(p_clear, null) is not null then
    raise exception 'APP_DAY_BAD_DAY: a day in the list is empty - nothing was saved' using errcode = 'AP004';
  end if;
  -- infinity / -infinity are dates to PostgreSQL but no calendar day: to_char gives NULL, so every message below would drop them
  if exists (select 1 from unnest(coalesce(p_add, '{}'::date[]) || coalesce(p_clear, '{}'::date[])) d where not isfinite(d)) then
    raise exception 'APP_DAY_BAD_DAY: a day in the list is not a calendar day - nothing was saved' using errcode = 'AP004';
  end if;
  if coalesce(cardinality(p_add), 0) + coalesce(cardinality(p_clear), 0) > 400 then
    raise exception 'APP_DAY_BAD_DAY: at most 400 days in one save - nothing was saved' using errcode = 'AP004';
  end if;
  select coalesce(array_agg(distinct d order by d), '{}') into adds from unnest(coalesce(p_add, '{}'::date[])) d;
  select coalesce(array_agg(distinct d order by d), '{}') into clears from unnest(coalesce(p_clear, '{}'::date[])) d;
  select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) into bad from unnest(adds) d where d = any(clears);
  if bad is not null then
    raise exception 'APP_DAY_BAD_DAY: % is both added and removed in one save - nothing was saved', bad using errcode = 'AP004';
  end if;
  select (p.is_app and p.role = 'viewer' and p.person_id is null), nullif(btrim(p.display_name), '')
    into t_app, t_name from public.user_profiles p where p.id = who;
  if cardinality(adds) > 0 and not coalesce(t_app, false) then
    raise exception 'APP_DAY_NOT_APP: % is not an APP account - the admin marks APP accounts in Setup > Users (nothing was saved)', coalesce(t_name, 'that account') using errcode = 'AP003';
  end if;
  -- One APP-day write at a time, across every profile (a conflict is cross-profile): every read below sees the other's commit.
  perform pg_advisory_xact_lock(hashtext('app_call_days:save'));
  if not sched then
    select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) into bad from unnest(adds || clears) d where d < today_c;
    if bad is not null then
      raise exception 'APP_DAY_PAST: % is before today (%) in Central time - a past day stays as it was', bad, to_char(today_c, 'FMMM/FMDD') using errcode = 'AP006';
    end if;
  end if;
  select string_agg(to_char(a.day, 'FMMM/FMDD') || ' is ' || coalesce(nullif(btrim(p.display_name), ''), 'another APP') || '''s day', ', ' order by a.day)
    into bad
    from public.app_call_days a left join public.user_profiles p on p.id = a.profile_id
   where a.day = any(clears) and a.profile_id <> who;
  if bad is not null then
    if sched then
      raise exception 'APP_DAY_STALE: % - reload the calendar (nothing was saved)', bad using errcode = 'AP007';
    end if;
    raise exception 'APP_DAY_NOT_YOURS: % - only that APP or the scheduler can remove it (nothing was saved)', bad using errcode = 'AP002';
  end if;
  if not repl then
    select string_agg(to_char(a.day, 'FMMM/FMDD') || ' already has ' || coalesce(nullif(btrim(p.display_name), ''), 'another APP'), '; ' order by a.day)
      into bad
      from public.app_call_days a left join public.user_profiles p on p.id = a.profile_id
     where a.day = any(adds) and a.profile_id <> who;
    if bad is not null then
      raise exception 'APP_DAY_TAKEN: % - nothing was saved', bad using errcode = 'AP005';
    end if;
  end if;

  v_src := case when who = me then 'app' else 'scheduler' end;
  if repl then
    select coalesce(jsonb_agg(jsonb_build_object('day', a.day, 'profile_id', a.profile_id, 'name', coalesce(nullif(btrim(p.display_name), ''), 'another APP')) order by a.day), '[]'::jsonb)
      into replaced
      from public.app_call_days a left join public.user_profiles p on p.id = a.profile_id
     where a.day = any(adds) and a.profile_id <> who;
    delete from public.app_call_days a where a.day = any(adds) and a.profile_id <> who;
  end if;
  with del as (
    delete from public.app_call_days a where a.profile_id = who and a.day = any(clears) returning a.day
  ) select coalesce(array_agg(del.day order by del.day), '{}') into del_days from del;
  with ins as (
    insert into public.app_call_days (day, profile_id, source, created_by)
    select d, who, v_src, me from unnest(adds) d
    on conflict (day) do nothing
    returning day
  ) select coalesce(array_agg(ins.day order by ins.day), '{}') into ins_days from ins;
  if exists (select 1 from public.app_call_days a where a.day = any(adds) and a.profile_id <> who) then
    raise exception 'APP_DAY_TAKEN: a day changed hands during this save - reload and try again (nothing was saved)' using errcode = 'AP005';
  end if;

  if cardinality(ins_days) + cardinality(del_days) > 0 then
    v_sum := coalesce(t_name, 'APP') || ': ' || concat_ws('; ',
      case when cardinality(ins_days) > 0 then 'on call ' || (select string_agg(to_char(d, 'FMMM/FMDD')
             || coalesce(' (was ' || (select x ->> 'name' from jsonb_array_elements(replaced) x where (x ->> 'day')::date = d limit 1) || ')', ''),
             ', ' order by d) from unnest(ins_days) d) end,
      case when cardinality(del_days) > 0 then 'removed ' || (select string_agg(to_char(d, 'FMMM/FMDD'), ', ' order by d) from unnest(del_days) d) end);
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (coalesce(public.silvis_person_id(), me::text),
            coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                     (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                       where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                     'Unknown'),
            'appdays.save',
            jsonb_build_object('summary', v_sum, 'profile_id', who, 'added', to_jsonb(ins_days), 'removed', to_jsonb(del_days), 'replaced', replaced, 'source', v_src));
  end if;
  return jsonb_build_object('ok', true, 'profile_id', who, 'added', cardinality(ins_days), 'removed', cardinality(del_days),
                            'kept', cardinality(adds) - cardinality(ins_days), 'absent', cardinality(clears) - cardinality(del_days),
                            'replaced', jsonb_array_length(replaced), 'source', v_src, 'audit', cardinality(ins_days) + cardinality(del_days) > 0);
end $$;
revoke all on function public.save_app_days(uuid, date[], date[], boolean) from public;
revoke all on function public.save_app_days(uuid, date[], date[], boolean) from anon;
grant execute on function public.save_app_days(uuid, date[], date[], boolean) to authenticated;
comment on function public.save_app_days(uuid, date[], date[], boolean) is 'Prompt 29: the only write path into app_call_days - an APP for its own profile, the scheduler (admin / scheduler) for any APP profile (adds) or any holder (clears; p_replace takes a day over). All or nothing; refusals before any write: AP001 APP_DAY_NOT_ALLOWED, AP002 APP_DAY_NOT_YOURS, AP003 APP_DAY_NOT_APP, AP004 APP_DAY_BAD_DAY, AP005 APP_DAY_TAKEN, AP006 APP_DAY_PAST (not the scheduler), AP007 APP_DAY_STALE. Writes one appdays.save audit row per Save that changed something (the client writes none); no notification row, no e-mail.';

notify pgrst, 'reload schema';
-- applied 2026-10-02 19:19:27Z by Faraz (apply-app-call-days.sh through Git's bash.exe, the script exports AI_AGENT; repo HEAD 5b9964e; two earlier runs stopped at the APPLY prompt and applied nothing); the body above this line is the applied file, sha256 9a03c834010cbb1a8eee5fa4b36fb57ada091c89364172709c6a5da800d27880 - its header is the text as it ran (its "REPORT-FIRST, NOT APPLIED", "NOT yet applied" and SILVIS_APP_DAYS_APPLIED=1 predate the record step, which made verify-rls section 18 strict and dropped the flag; test/schema.test.js pins it; docs/SCHEMA-REVIEW.md "2026-10-02 - APP call days" quotes the probe observed right after)
