-- ============================================================================
-- Silvis Call Schedule - migration 2026-10-03: phone push (Faraz 10/2, Prompt 30: Fierce's trade request reached his e-mail but
-- nothing showed on his phone; Faraz 6:40 PM: "Davenport's look, Silvis's own push" - Web Push with VAPID keys, the app's own
-- sw.js, no OneSignal). The database half: where each device's push subscription is kept and the two per-category switches.
-- REPORT-FIRST, NOT APPLIED (CLAUDE.md, guide section 4.3: a new table holding capability secrets, two new columns on
-- notification_preferences and three security definer functions every phone's Enable goes through). Nothing in the repo applies
-- it: Faraz runs the one command below and pastes the log back.
--
-- What changes. (1) notification_preferences gains trade_updates_push and schedule_updates_push (boolean not null default true,
-- mirroring the *_email columns and Davenport's *_push naming; a missing row or key = on; independent of the e-mail switches).
-- (2) ONE new table public.push_subscriptions - one row per device that turned phone notifications on: id, profile_id ->
-- user_profiles on delete cascade, endpoint (unique; https on a known push service only - the edge function POSTs to whatever is
-- stored, so a free-form endpoint would be a server-side request forgery lever), p256dh, auth (the browser's two keys, shape
-- checked), device_label (1-40 of letters, digits, spaces and . ( ) / -), created_at, last_ok_at, last_error_at, fail_count (the
-- edge function's bookkeeping, service role). RLS on; authenticated SELECTs only the non-secret columns (a column grant: never
-- endpoint / p256dh / auth - the capability never comes back in any response) and DELETEs its own rows; it never INSERTs or
-- UPDATEs; anon holds nothing (revoked, no policy). Not in the realtime publication, not in the anon read_all loop. (3) THREE new
-- functions (security definer, search_path public, pg_temp, volatile - PostgREST refuses GET, so an endpoint never lands in a
-- URL): save_push_subscription(p_endpoint, p_p256dh, p_auth, p_label) - the ONLY write path (added / kept / refreshed / moved, the
-- 10-device cap, the push.save audit row); delete_push_subscription(p_endpoint) - the caller's own row for that endpoint (the
-- push.delete audit row); push_subscription_status(p_endpoint) - whether THIS endpoint is saved for the caller, and how many
-- devices he has. EXECUTE for authenticated, never anon. No row is written by this file; no existing table, policy, function or
-- trigger changes (prefs_own covers the two new columns unchanged). sql/schema.sql mirrors every statement below (header revision
-- w, "report-first, NOT yet applied" until the record step); test/schema.test.js pins it.
--
-- Refusals (custom SQLSTATEs, HTTP 400 through PostgREST like AP / NP / VG; the client's words match these byte for byte), all
-- BEFORE any write:
--   PS001 PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account   (all three functions)
--   PS002 PUSH_NO_PROFILE: this account has no profile yet - ask the scheduler (nothing was saved)
--   PS003 PUSH_BAD_ENDPOINT: this browser's push address is not one the app sends to - nothing was saved
--   PS004 PUSH_BAD_KEYS: this browser's push keys are malformed - tap Reset subscription, then Enable (nothing was saved)
--   PS005 PUSH_BAD_LABEL: a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)
--   (the transaction advisory lock push_subscriptions:save - one save at a time: the cap and a move read other rows)
--   PS006 PUSH_HELD: this browser's push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)
--   PS007 PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)
-- Return shapes (binding, the client reads them): save {ok, action: added|kept|refreshed|moved, devices, audit}; delete {ok,
-- removed, devices, audit}; status {ok, saved, devices}. Never the endpoint or the keys.
--
-- Who it binds. Every signed-in account with a profile row - surgeon, scheduler, coordinator, viewer / follower, APP - for its OWN
-- devices only (auth.uid()); nobody acts for another account, not even the scheduler. An endpoint held by another account moves to
-- the caller ONLY when the caller sends the same p256dh and auth (what the browser hands over to whoever holds the subscription -
-- a shared office PC), else PS006; the same account re-saving the same endpoint is kept (no write) or refreshed (keys / label
-- changed). A session with no signed-in user is refused (PS001); anon has no EXECUTE. Deleting the account removes its rows (auth.users
-- -> user_profiles -> push_subscriptions, on delete cascade); the audit rows stay (audit_log has no FK). The audit row (push.save on
-- added / moved, push.delete when a row went, in the same transaction): actor_id = the caller's roster id, else his auth uid (what
-- the client's logAudit sends); actor_name = his display name, else his roster name, else Unknown; detail = {summary, profile_id,
-- device_label, action}; summary "<name>: phone notifications on (<device>)" (" - moved from another account" on a move, never
-- naming it) / "<name>: phone notifications off (<device>)". Profile id and device label only - never an endpoint or a key. No
-- notification row, no e-mail.
--
-- Blast radius. One new table nobody else reads (no anon surface, not realtime); two NOT NULL DEFAULT true columns on
-- notification_preferences (constant defaults: no table rewrite; every existing row reads true = on, a follower's row keyed by
-- profile_id the same; an upsert without the keys takes the defaults, so today's client is unaffected); three new functions. No
-- existing policy, function, trigger or anon surface changes; the anon read_all loop does not gain the table. Independent of the
-- weekend pair claim (revision u, prepared on its own branch) - no shared object, either apply order. The edge function
-- (send-notification with the push fan-out) is deployed AFTER this apply and the VAPID keys (setup-push-keys.sh); the client that
-- saves subscriptions ships after both, on Faraz's go; both read a missing table / function / column as "unavailable" (the edge
-- function answers push.error and keeps mailing). The migration ends with a PostgREST schema-cache reload (verify-rls 19b-19e are
-- the gate before the client push).
--
-- Apply live (Faraz, one command, run from the repo root; the CLI dir linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`):
--   bash <run folder>/apply-push-notifications.sh       (Faraz, one command; the apply script lives OUTSIDE the repo - Faraz 10/1)
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-10-03-push-notifications.sql   (what it runs)
-- The CLI's -f runs the file as ONE implicit transaction (observed: every probe's final raise rolls its whole batch back), and a
-- paste into the SQL editor runs as one session too - a failure anywhere changes nothing.
-- Order: 1. pre-check sql/probes/push-notifications-precheck.sql (read-only; the objects row must read table=no push_cols=0
-- save_fn=no delete_fn=no status_fn=no); 2. the function-absent check; 3. probe BEFORE sql/probes/push-notifications-probe.sql
-- (expects PROBE_SETUP: push_subscriptions is absent ...); 4. this file; 5. the gate after (table=yes push_cols=2 save_fn=yes
-- delete_fn=yes status_fn=yes); 6. probe AFTER (51 cases, each as its header lists); 7. SILVIS_PUSH_APPLIED=1 bash
-- scripts/verify-rls.sh (every section green, 19 strict); 8. bash setup-push-keys.sh (the VAPID secrets); 9. the send-notification
-- deploy (edge-functions/README.md) and SILVIS_PUSH_DEPLOYED=1 bash scripts/verify-rls.sh (19i); 10. the record step in
-- docs/SCHEMA-REVIEW.md "2026-10-03 - phone push"; 11. the client push on Faraz's go.
-- Re-running: idempotent (add column if not exists, create table / index if not exists, drop policy if exists, create or replace);
-- the apply script refuses to re-run it anyway (its gate).
-- Rolling back (in this order; every saved subscription is lost - each device taps Enable again after a re-apply; the client reads
-- the missing objects as "unavailable", the edge function answers push.error and keeps mailing):
--   drop function if exists public.push_subscription_status(text);
--   drop function if exists public.delete_push_subscription(text);
--   drop function if exists public.save_push_subscription(text, text, text, text);
--   drop table if exists public.push_subscriptions;
--   alter table public.notification_preferences drop column if exists schedule_updates_push;
--   alter table public.notification_preferences drop column if exists trade_updates_push;
--   notify pgrst, 'reload schema';
-- (redeploy the backed-up send-notification v9 too if the function must go back - edge-functions/README.md).
-- ============================================================================

alter table public.notification_preferences add column if not exists trade_updates_push boolean not null default true;
alter table public.notification_preferences add column if not exists schedule_updates_push boolean not null default true;
comment on column public.notification_preferences.trade_updates_push is 'Prompt 30: phone notifications for trade proposed / accepted / declined / applied (a give included). Default on; only an explicit false opts out. Independent of trade_updates_email.';
comment on column public.notification_preferences.schedule_updates_push is 'Prompt 30: phone notifications for schedule published, manual edit, open shifts, shift taken, vacation logged, offers heads-up / frozen. Default on; only an explicit false opts out. Independent of schedule_updates_email.';

create table if not exists public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.user_profiles(id) on delete cascade,
  endpoint       text not null,
  p256dh         text not null,
  auth           text not null,
  device_label   text,
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  fail_count     integer not null default 0,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_shape check (length(endpoint) <= 2048 and endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)/[!-~]*$'),
  constraint push_subscriptions_p256dh_shape check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  constraint push_subscriptions_auth_shape check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_label_shape check (device_label is null or device_label ~ '^[A-Za-z0-9 .()/-]{1,40}$'),
  constraint push_subscriptions_fail_count_check check (fail_count >= 0)
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public;
revoke all on table public.push_subscriptions from anon;
revoke all on table public.push_subscriptions from authenticated;
grant select (id, profile_id, device_label, created_at, last_ok_at, last_error_at, fail_count) on table public.push_subscriptions to authenticated;
grant delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
drop policy if exists push_subscriptions_own_read on public.push_subscriptions;
create policy push_subscriptions_own_read on public.push_subscriptions for select to authenticated using (profile_id = auth.uid());
drop policy if exists push_subscriptions_own_delete on public.push_subscriptions;
create policy push_subscriptions_own_delete on public.push_subscriptions for delete to authenticated using (profile_id = auth.uid());
comment on table public.push_subscriptions is 'Prompt 30: one row per device that turned phone notifications on (Web Push, VAPID). Own rows only: authenticated SELECTs the non-secret columns and DELETEs its own rows; it never INSERTs or UPDATEs (save_push_subscription is the only write path; the edge function keeps last_ok_at / last_error_at / fail_count and removes 404 / 410 rows with the service role). endpoint / p256dh / auth are capability secrets: never in a response, a log, an anon-readable table or a URL. Not in the realtime publication. Deleting the account removes its rows (on delete cascade).';

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me        uuid := auth.uid();
  v_label   text := nullif(btrim(coalesce(p_label, '')), '');
  cur       record;
  v_found   boolean := false;
  v_action  text;
  v_dev     text;
  v_name    text;
  n         integer;
begin
  if me is null then
    raise exception 'PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account' using errcode = 'PS001';
  end if;
  if not exists (select 1 from public.user_profiles u where u.id = me) then
    raise exception 'PUSH_NO_PROFILE: this account has no profile yet - ask the scheduler (nothing was saved)' using errcode = 'PS002';
  end if;
  if p_endpoint is null or length(p_endpoint) > 2048 or p_endpoint !~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)/[!-~]*$' then
    raise exception 'PUSH_BAD_ENDPOINT: this browser''s push address is not one the app sends to - nothing was saved' using errcode = 'PS003';
  end if;
  if p_p256dh is null or p_p256dh !~ '^B[A-Za-z0-9_-]{86}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'PUSH_BAD_KEYS: this browser''s push keys are malformed - tap Reset subscription, then Enable (nothing was saved)' using errcode = 'PS004';
  end if;
  if v_label is not null and v_label !~ '^[A-Za-z0-9 .()/-]{1,40}$' then
    raise exception 'PUSH_BAD_LABEL: a device name is 1-40 letters, digits, spaces or . ( ) / - (nothing was saved)' using errcode = 'PS005';
  end if;
  -- one save at a time (the cap and a move read other rows); the volume is a handful of devices
  perform pg_advisory_xact_lock(hashtext('push_subscriptions:save'));
  select s.id, s.profile_id, s.p256dh, s.auth, s.device_label into cur from public.push_subscriptions s where s.endpoint = p_endpoint;
  v_found := found;
  if v_found and cur.profile_id = me then
    if cur.p256dh = p_p256dh and cur.auth = p_auth and (v_label is null or v_label = cur.device_label) then
      v_action := 'kept';
    else
      update public.push_subscriptions
         set p256dh = p_p256dh, auth = p_auth, device_label = coalesce(v_label, cur.device_label), fail_count = 0, last_error_at = null
       where id = cur.id;
      v_action := 'refreshed';
    end if;
    v_dev := coalesce(v_label, cur.device_label);
  elsif v_found then
    if cur.p256dh <> p_p256dh or cur.auth <> p_auth then
      raise exception 'PUSH_HELD: this browser''s push address is registered to another account - tap Reset subscription, then Enable (nothing was saved)' using errcode = 'PS006';
    end if;
    select count(*) into n from public.push_subscriptions s where s.profile_id = me;
    if n >= 10 then
      raise exception 'PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)' using errcode = 'PS007';
    end if;
    update public.push_subscriptions
       set profile_id = me, device_label = coalesce(v_label, cur.device_label), created_at = now(), last_ok_at = null, last_error_at = null, fail_count = 0
     where id = cur.id;
    v_action := 'moved';
    v_dev := coalesce(v_label, cur.device_label);
  else
    select count(*) into n from public.push_subscriptions s where s.profile_id = me;
    if n >= 10 then
      raise exception 'PUSH_TOO_MANY: this account has phone notifications on 10 devices already - turn one off first (nothing was saved)' using errcode = 'PS007';
    end if;
    insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, device_label) values (me, p_endpoint, p_p256dh, p_auth, v_label);
    v_action := 'added';
    v_dev := v_label;
  end if;
  if v_action in ('added', 'moved') then
    v_name := coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                       (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                         where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                       'Unknown');
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (coalesce(public.silvis_person_id(), me::text), v_name, 'push.save',
            jsonb_build_object('summary', v_name || ': phone notifications on (' || coalesce(v_dev, 'a device') || ')' || case when v_action = 'moved' then ' - moved from another account' else '' end,
                               'profile_id', me, 'device_label', v_dev, 'action', v_action));
  end if;
  select count(*) into n from public.push_subscriptions s where s.profile_id = me;
  return jsonb_build_object('ok', true, 'action', v_action, 'devices', n, 'audit', v_action in ('added', 'moved'));
end $$;
revoke all on function public.save_push_subscription(text, text, text, text) from public;
revoke all on function public.save_push_subscription(text, text, text, text) from anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
comment on function public.save_push_subscription(text, text, text, text) is 'Prompt 30: the only write path into push_subscriptions - the caller''s own device (auth.uid()). added / kept (no write) / refreshed (keys or label changed) / moved (an endpoint held by another account, only with the same p256dh and auth). Refusals before any write: PS001 PUSH_NOT_SIGNED_IN, PS002 PUSH_NO_PROFILE, PS003 PUSH_BAD_ENDPOINT, PS004 PUSH_BAD_KEYS, PS005 PUSH_BAD_LABEL, PS006 PUSH_HELD, PS007 PUSH_TOO_MANY (10 devices). One push.save audit row on added / moved (profile id + device label only). Never returns the endpoint or the keys.';

create or replace function public.delete_push_subscription(p_endpoint text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me      uuid := auth.uid();
  v_n     integer := 0;
  v_label text;
  v_name  text;
  n       integer;
begin
  if me is null then
    raise exception 'PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account' using errcode = 'PS001';
  end if;
  with del as (
    delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.profile_id = me returning s.device_label
  ) select count(*), max(del.device_label) into v_n, v_label from del;
  if v_n > 0 then
    v_name := coalesce((select nullif(btrim(u.display_name), '') from public.user_profiles u where u.id = me),
                       (select r ->> 'name' from public.call_schedule_data c, jsonb_array_elements(case when jsonb_typeof(c.data -> 'roster') = 'array' then c.data -> 'roster' else '[]'::jsonb end) r
                         where c.id = 'main' and r ->> 'id' = public.silvis_person_id() limit 1),
                       'Unknown');
    insert into public.audit_log (actor_id, actor_name, action, detail)
    values (coalesce(public.silvis_person_id(), me::text), v_name, 'push.delete',
            jsonb_build_object('summary', v_name || ': phone notifications off (' || coalesce(v_label, 'a device') || ')',
                               'profile_id', me, 'device_label', v_label, 'action', 'removed'));
  end if;
  select count(*) into n from public.push_subscriptions s where s.profile_id = me;
  return jsonb_build_object('ok', true, 'removed', v_n, 'devices', n, 'audit', v_n > 0);
end $$;
revoke all on function public.delete_push_subscription(text) from public;
revoke all on function public.delete_push_subscription(text) from anon;
grant execute on function public.delete_push_subscription(text) to authenticated;
comment on function public.delete_push_subscription(text) is 'Prompt 30: removes the caller''s own row for this endpoint (another account''s row is never touched and answers removed 0, like an absent one). POST only (volatile): the endpoint travels in the body, never in a URL. One push.delete audit row when a row went. PS001 PUSH_NOT_SIGNED_IN.';

create or replace function public.push_subscription_status(p_endpoint text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'PUSH_NOT_SIGNED_IN: sign in first - phone notifications belong to an account' using errcode = 'PS001';
  end if;
  return jsonb_build_object('ok', true,
    'saved', exists (select 1 from public.push_subscriptions s where s.profile_id = me and s.endpoint = p_endpoint),
    'devices', (select count(*) from public.push_subscriptions s where s.profile_id = me));
end $$;
revoke all on function public.push_subscription_status(text) from public;
revoke all on function public.push_subscription_status(text) from anon;
grant execute on function public.push_subscription_status(text) to authenticated;
comment on function public.push_subscription_status(text) is 'Prompt 30: whether THIS endpoint is saved for the caller, and how many devices the caller has (Settings > Diagnose, the start-up ownership check). Volatile on purpose: PostgREST refuses GET, so the endpoint never lands in a URL. PS001 PUSH_NOT_SIGNED_IN.';

notify pgrst, 'reload schema';
-- applied 2026-10-03 16:30:43Z by Faraz (apply-push-notifications.sh, the script exports AI_AGENT; repo HEAD 04c2245; an earlier --dry-run (20261003T163001Z) stopped after the probe BEFORE and applied nothing); the body above this line is the applied file, sha256 cfac281e51d365ac5b702829028d9b4cd763ea61348c9a6d6f0f57e6e37f4df0 - its header is the text as it ran (its "REPORT-FIRST, NOT APPLIED", "NOT yet applied", SILVIS_PUSH_APPLIED=1 and SILVIS_PUSH_DEPLOYED=1 predate the record step, which made verify-rls section 19 strict, grades 19i on every run and dropped both flags; the "backed-up send-notification v9" is the code deployed as v9 on 2026-10-01, listed v11 on 2026-10-03 and replaced by v12 at 16:37:59 UTC - edge-functions/README.md; test/schema.test.js pins it; docs/SCHEMA-REVIEW.md "2026-10-03 - phone push" quotes the probe observed right after)
