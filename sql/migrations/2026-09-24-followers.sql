-- ============================================================================
-- Silvis Call Schedule - migration 2026-09-24: FOLLOWERS (Prompt 20 F1, Faraz 9/24). A viewer (or coordinator) account
-- follows one or more surgeons and receives what they receive, read-only. No new role: viewer + follows. Data only.
-- supersedes: sql/migrations/2026-09-24-prelaunch-rls.sql
--   (same-day file order: A1's user_profiles_self_update text is re-created below with the follows pin; A1 is applied live
--    already - this file runs AFTER it (and after Prompt 19's revision n) and builds on its final text)
--
-- REPORT-FIRST (CLAUDE.md, guide section 4.3): this file changes row-level security and a primary key on the live database.
-- Prepared with its probe (sql/probes/followers-probe.sql, rolls itself back) and scripts/verify-rls.sh section 12; the
-- orchestrator applies it after Faraz's go. Nothing in the repo applies it.
--
-- a) user_profiles.follows jsonb not null default '[]' - the roster ids (e.g. ["s2"]) whose notifications this account
--    receives. user_profiles_follows_shape: a JSON array of non-empty strings (strict jsonpath: a nested array is refused,
--    lax mode would unwrap it). Who writes it: the ADMIN, through user_profiles_admin (for all, silvis_role() = 'admin') -
--    the policy Setup > Users' saveUserProfile PATCH already passes (the client refuses a non-admin before the request:
--    `if (!isAdmin)`). A non-admin scheduler cannot save an account in the client today, so the policy is
--    not widened to schedulers. user_profiles_self_update pins follows exactly like email (a follower cannot add a surgeon to
--    his own list, nor a surgeon to his); user_profiles_self_insert pins follows = '[]' (that door - reachable only when a profile row is
--    missing - lands as an unlinked viewer following nobody, like person_id is null).
-- b) notification_preferences: person_id was the PRIMARY KEY (not null), so an account with no roster link could not own a
--    row. Now: id uuid not null default gen_random_uuid() is the primary key (the constraint keeps the name
--    notification_preferences_pkey); person_id stays UNIQUE (notification_preferences_person_id_key, added BEFORE the key
--    moves) and becomes nullable; profile_id uuid null UNIQUE references public.user_profiles(id) on delete cascade is a
--    follower's key; notification_preferences_one_owner: exactly one of person_id / profile_id is set. Every existing row
--    keeps its person_id and its flags, gets a fresh id and profile_id null (the check holds for all of them); no row is
--    written, none deleted. prefs_own gains `or profile_id = auth.uid()`: a follower reads / writes his own row only.
--    If the live key constraint had another name, the `add constraint notification_preferences_pkey primary key (id)` line
--    fails ("multiple primary keys") and the whole file rolls back - the pre-check below reads the names first.
--
-- The surgeons' prefs save: the client's upsert (db.upsert -> POST rest/v1/notification_preferences, Prefer
-- resolution=merge-duplicates) sent NO on_conflict, so PostgREST merged on the PRIMARY KEY - person_id until now. After the
-- move the key is id, and a payload without id would hit notification_preferences_person_id_key instead (23505 -> HTTP 409,
-- probe S2). The same branch makes the client name the column (?on_conflict=person_id - valid BEFORE this file too, where
-- person_id is the key): DEPLOY THAT CLIENT FIRST (merge + CI + Pages), then apply this file. A PWA still running an older
-- build gets a loud "Couldn't save notification settings" toast (never a silent loss) until it reloads.
-- The edge functions read prefs with the service role by person_id - send-notification (select=*, keyed by person_id, a row
-- without one skipped) and daily-reminder (select=person_id,schedule_updates_email for the open-shifts / close paths;
-- select=*&person_id=in.(...) for the day-before reminder): both stay valid; a follower's row (person_id null) is ignored by
-- both until a later Prompt 20 step teaches them to read it (that step also rewords the functions' "keyed by person_id" comments).
--
-- Idempotent: add column if not exists; drop constraint if exists / add; drop policy if exists / create. No function, table,
-- trigger or row is created, dropped or written. Apply live with the Supabase CLI (absolute path; the workdir is a directory
-- linked with `supabase link --project-ref bzhsroegtagqhutbnsrp`), or paste the file into the SQL editor as ONE session:
--   supabase db query --linked --workdir <dir> -f <abs>/sql/migrations/2026-09-24-followers.sql
-- Pre-checks (read-only, BEFORE; the probe's R1 must report the same count after):
--   select count(*) from public.notification_preferences;
--   select conname, contype from pg_constraint where conrelid = 'public.notification_preferences'::regclass order by 1;   -- notification_preferences_pkey (p) only
-- Prove it with sql/probes/followers-probe.sql (rolls itself back; BEFORE this file it raises PROBE_SETUP carrying the row
-- count, AFTER it every case reads the string its header states) and scripts/verify-rls.sh section 12
-- (SILVIS_PREFS_ROWS_BEFORE=<the pre-count> compares R1 with it); record the observed lines in docs/SCHEMA-REVIEW.md.
-- Every text below is mirrored into sql/schema.sql byte for byte (test/schema.test.js pins the identity).
-- Blast radius: every user_profiles row gains follows = [] (nothing reads it yet); notification_preferences gets a new
-- primary key and two columns - the surgeons' rows keep their person_id and flags, both edge functions' person_id reads stay
-- valid, and the one write path affected is the client's prefs upsert, which this branch pins to on_conflict=person_id.
-- ============================================================================

-- a) user_profiles.follows: the column, its shape, the two self-service pins (the admin writes it through user_profiles_admin)
alter table public.user_profiles add column if not exists follows jsonb not null default '[]'::jsonb;
alter table public.user_profiles drop constraint if exists user_profiles_follows_shape;
alter table public.user_profiles add constraint user_profiles_follows_shape
  check (case when jsonb_typeof(follows) = 'array' then not jsonb_path_exists(follows, 'strict $[*] ? (@.type() != "string" || @ == "")') else false end);

drop policy if exists user_profiles_self_insert on public.user_profiles;
create policy user_profiles_self_insert on public.user_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'viewer' and person_id is null and follows = '[]'::jsonb);   -- signup lands as viewer, unlinked, following nobody; admin links + promotes
drop policy if exists user_profiles_self_update on public.user_profiles;
create policy user_profiles_self_update on public.user_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
    and role = (select role from public.user_profiles p where p.id = auth.uid())
    and person_id is not distinct from (select person_id from public.user_profiles p where p.id = auth.uid())
    and email is not distinct from (select email from public.user_profiles p where p.id = auth.uid())
    and follows is not distinct from (select follows from public.user_profiles p where p.id = auth.uid()));   -- self-service may not re-point person_id or email, nor choose whom it follows

-- b) notification_preferences: a surrogate key, person_id UNIQUE + nullable, profile_id for an unlinked follower
alter table public.notification_preferences add column if not exists id uuid not null default gen_random_uuid();
alter table public.notification_preferences add column if not exists profile_id uuid references public.user_profiles(id) on delete cascade;
alter table public.notification_preferences drop constraint if exists notification_preferences_person_id_key;
alter table public.notification_preferences add constraint notification_preferences_person_id_key unique (person_id);
alter table public.notification_preferences drop constraint if exists notification_preferences_pkey;
alter table public.notification_preferences add constraint notification_preferences_pkey primary key (id);
alter table public.notification_preferences alter column person_id drop not null;
alter table public.notification_preferences drop constraint if exists notification_preferences_profile_id_key;
alter table public.notification_preferences add constraint notification_preferences_profile_id_key unique (profile_id);
alter table public.notification_preferences drop constraint if exists notification_preferences_one_owner;
alter table public.notification_preferences add constraint notification_preferences_one_owner
  check (num_nonnulls(person_id, profile_id) = 1);   -- a surgeon's row (person_id) or a follower's row (profile_id), never both, never neither

drop policy if exists prefs_own on public.notification_preferences;
create policy prefs_own on public.notification_preferences for all to authenticated
  using (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched())
  with check (person_id = public.silvis_person_id() or profile_id = auth.uid() or public.silvis_is_sched());
