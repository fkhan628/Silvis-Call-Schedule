-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: pre-launch RLS - close the door before anyone is invited (Prompt 16 A1)
--
-- REPORT-FIRST (CLAUDE.md, guide section 4.3): this file changes row-level security on the live database. It is prepared
-- here with its probe and its verify-rls.sh section; the orchestrator reports the before / after to Faraz and applies it
-- only after his go. Nothing in the repo applies it.
--
-- What it closes (the 9/23 pre-launch review, item A; the periods report's "freeze by status" decision):
--   a) user_profiles_read      was: every signed-in account (a self-made one included) reads every profile row, email
--                                   included. now: own row, or a scheduler / admin caller, or the rows whose role
--                                   is admin / scheduler (the only other rows a surgeon's session needs: schedulerIdsLoud in
--                                   index-source.html addresses the scheduler's notifications through them).
--   b) contacts_read           was: every signed-in user reads office_contacts. now: scheduler / admin only (the client
--                                   loads the table only for isScheduler - index-source.html, the office-contacts effect).
--   c) notif_insert            was: with check (true). now: a scheduler / admin, or a caller linked to a roster entry.
--      audit_insert            was: with check (true). now: a scheduler / admin, or a linked caller whose row says
--                                   actor_id = their own roster id (the client's logAudit writes exactly that).
--      notif_delete_sched      new: scheduler / admin may delete notifications (spam removal; no UI yet - Part B).
--   d) user_profiles_self_update  the with-check also pins email: a linked surgeon can no longer re-point his own row's
--                                   email (what send-notification addresses and sends as) to an address he does not
--                                   control through the direct PostgREST PATCH. display_name stays self-editable;
--                                   role / person_id were already pinned. Corrections stay with user_profiles_admin
--                                   (admin only, unchanged: Setup -> Users is isAdmin-gated in the client).
--                                   RESIDUAL, stated on purpose: this pins the REST path only. GoTrue's self-service
--                                   email change (PUT /auth/v1/user {"email": ...} with the anon key + the own access
--                                   token - the endpoint config.js already uses for passwords; the client has no email
--                                   UI) still rewrites auth.users.email once the new mailbox confirms (and, with secure
--                                   email change on, the old one too), and handle_new_auth_user (security definer,
--                                   after insert or update of email on auth.users, on conflict do update set email =
--                                   excluded.email - unchanged by this file) copies it into user_profiles.email. Limited
--                                   to an address the caller can confirm; hardening is a separate decision for Faraz,
--                                   not baked in here (see docs/SCHEMA-REVIEW.md, 'What could break').
--   e) call_offers_guard       OF004 OFFER_IMMUTABLE: a non-scheduler UPDATE may not move an offer's day or person.
--                                   The painter clears + inserts (save_offers deletes then upserts; its ON CONFLICT
--                                   UPDATE sets role_pref / note / entered_by / source / updated_at only; claim_open_slot's
--                                   upsert sets role_pref / updated_at only), so nothing legitimate moves day or
--                                   person_id on UPDATE.
--   f) call_offers_guard + call_offers_delete_guard  freeze by STATUS as well as by date: a non-scheduler's insert,
--                                   update or delete inside a period whose status is no longer 'upcoming' is refused
--                                   (OF003) even while offers_close_at lies ahead - the published Nov 2026 - Jan 2027
--                                   period is frozen from the apply, not from 10/2. set_offer_mode already reads
--                                   (p.status <> 'upcoming' or p.offers_close_at <= today_c) - OM005 - and is untouched.
--                                   The OF003 sentence is kept as it was (the client matches token + code).
--   g) offer_status(uuid, text)  execute revoked from public and anon (kept for authenticated and service_role).
--                                   Nothing anon calls it: the client derives the status in helpers.offerRollcall, the
--                                   edge functions never name it, the share page and the ICS feed read schedule_days.
--
-- Pinning email in the self-update policy: the with-check compares the new row against a stable subselect of the
-- caller's current row - the same mechanism the policy already used for role and person_id (a subquery inside the
-- same UPDATE sees the row as it was before the statement), evaluated by PostgreSQL itself on every PostgREST PATCH
-- (a refused PATCH is HTTP 401/403 with code 42501, never a silent no-op). A trigger would do the same with more moving
-- parts; the policy is the simpler of the two, and the client has no self-update path at all today.
--
-- Idempotent (drop policy if exists / create; create or replace; the grants re-run). No table, column, index or row is
-- touched; user_profiles_admin, user_profiles_self_insert, notif_read, audit_read, contacts_write, the call_offers /
-- call_periods policies and offer_status()'s body are unchanged. Apply live with the Supabase CLI (absolute path; the
-- workdir is a directory linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`), or paste the file into the
-- SQL editor as ONE session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-prelaunch-rls.sql
-- Prove it with sql/probes/prelaunch-rls-probe.sql (rolls itself back; its header states the string every case reads
-- BEFORE and AFTER this file) and scripts/verify-rls.sh section 10; record the observed lines in docs/SCHEMA-REVIEW.md.
-- Every text below is mirrored into sql/schema.sql byte for byte (test/schema.test.js pins the identity).
-- ============================================================================

-- a) + d) user_profiles
drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read on public.user_profiles for select to authenticated
  using (id = auth.uid() or public.silvis_is_sched() or role in ('admin','scheduler'));
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
    and role = (select role from public.user_profiles p where p.id = auth.uid())
    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid()));

-- b) office_contacts
drop policy if exists contacts_read on public.office_contacts;
create policy contacts_read on public.office_contacts for select to authenticated using (public.silvis_is_sched());

-- c) notifications + audit_log
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check (public.silvis_is_sched() or public.silvis_person_id() is not null);
drop policy if exists notif_delete_sched on public.notifications;
create policy notif_delete_sched on public.notifications for delete to authenticated using (public.silvis_is_sched());
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated
  with check (public.silvis_is_sched() or (public.silvis_person_id() is not null and actor_id = public.silvis_person_id()));

-- e) + f) the two call_offers guards
create or replace function public.call_offers_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if new.day < today_c then
    raise exception 'OFFER_PAST: % is before today (%) in Central time', new.day, today_c using errcode = 'OF001';
  end if;
  if exists (select 1 from public.time_off t where t.person_id = new.person_id and new.day between t.start_date and t.end_date) then
    raise exception 'OFFER_ON_VACATION: % is inside a vacation of %', new.day, new.person_id using errcode = 'OF002';
  end if;
  if tg_op = 'UPDATE' and not public.silvis_is_sched() and (new.day <> old.day or new.person_id <> old.person_id) then
    raise exception 'OFFER_IMMUTABLE: an offer keeps its day and person (% %) - clear it and offer the other day instead', old.person_id, old.day using errcode = 'OF004';
  end if;
  if not public.silvis_is_sched() and coalesce(current_setting('silvis.claim_in_progress', true), '') <> 'on' then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where new.day between p.start_day and p.end_day and (p.offers_close_at <= today_c or p.status <> 'upcoming')
     limit 1;
    if found then
      raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen.label, frozen.offers_close_at using errcode = 'OF003';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists call_offers_guard_trg on public.call_offers;
create trigger call_offers_guard_trg
  before insert or update on public.call_offers
  for each row execute function public.call_offers_guard();

create or replace function public.call_offers_delete_guard() returns trigger
language plpgsql as $$
declare
  today_c date := (now() at time zone 'America/Chicago')::date;
  frozen  record;
begin
  if not public.silvis_is_sched() then
    select p.label, p.offers_close_at into frozen
      from public.call_periods p
     where old.day between p.start_day and p.end_day and (p.offers_close_at <= today_c or p.status <> 'upcoming')
     limit 1;
    if found then
      raise exception 'OFFER_FROZEN: offers for % closed on % - ask the scheduler', frozen.label, frozen.offers_close_at using errcode = 'OF003';
    end if;
  end if;
  return old;
end $$;
drop trigger if exists call_offers_delete_guard_trg on public.call_offers;
create trigger call_offers_delete_guard_trg
  before delete on public.call_offers
  for each row execute function public.call_offers_delete_guard();

-- g) offer_status: authenticated + service_role only
revoke execute on function public.offer_status(uuid, text) from public;
revoke execute on function public.offer_status(uuid, text) from anon;
grant execute on function public.offer_status(uuid, text) to authenticated;
grant execute on function public.offer_status(uuid, text) to service_role;
