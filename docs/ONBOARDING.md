# Onboarding users — Silvis Call Schedule

*For Faraz (admin). Contact addresses live only in the private `silvis-contacts.md` in the OneDrive folder; nothing here
or in the app ever needs an address typed anywhere except the Supabase dashboard's invite box and the user's own login.*

## One-time project settings (Supabase dashboard)

1. **Authentication → URL Configuration.** Site URL: `https://fkhan628.github.io/Silvis-Call-Schedule/`. Add the same URL
   (with the trailing slash) to **Redirect URLs**. Without this, invite and password-reset links fall back to the default
   Site URL and never reach the app (the same gotcha the Davenport project had).
2. **Authentication → Email templates** (optional): the default "Invite user" and "Reset password" templates work; the app
   detects `#type=invite` / `#type=recovery` in the URL hash and opens the set-a-password form.
3. `sql/schema.sql` is applied (Prompt 2). Re-running it is safe.

## Your own account (first)

1. Open the app, **Sign up** with the address you want to use, set a password.
2. The database creates your `user_profiles` row automatically as `viewer`.
3. Promote yourself once, in the SQL editor (or the linked CLI):

   ```sql
   update public.user_profiles set role = 'admin', person_id = 's1'
    where email = '<the address you signed up with>';
   ```

4. Reload the app: you are scheduler + admin and roster `s1` (Khan).

## Inviting a surgeon or a viewer

1. **Supabase dashboard → Authentication → Users → Invite user.** Paste the person's home address from the private file.
   Supabase emails them a link; they set a password through it and land in the app.
2. The moment the invite is created, the database creates their `user_profiles` row (`viewer`, unlinked) — even if they
   never open the email. You can link them right away.
3. **Setup → Users** (in the app): pick the new user, set **roster id** (s1–s6) and **role** (`surgeon` for the five
   surgeons, `viewer` for the ER-panel author, `scheduler` for anyone who should publish). Setup → Users is the normal path; if the
   app is unreachable, the same thing in SQL:

   ```sql
   update public.user_profiles set role = 'surgeon', person_id = 's2'
    where email = '<their address>';
   ```

4. Tell them: **Time off** is self-service (no approval) and is refused over a day they are already published — trade
   first. **Trades** are by day and role. Their calendar subscription URL is in **Settings → Live Calendar Sync**.

**Open shifts (tell every surgeon).** The **Open shifts** tab lists every unfilled primary or backup slot from today to
the end of the published schedule, with the weekend or holiday unit it belongs to, why it is open, and who is eligible
right now; the count sits on the tab as a badge. **Take this shift** is immediate and logged: the moment they confirm,
the day is theirs (no approval step, no waiting for the scheduler), it shows on everyone's calendar and in the feed,
the scheduler and the surgeon each get an e-mail, and the audit log keeps the entry. The button is offered only when the
hard schedule rules allow it (their OR / outreach days, monthly and backup caps, vacations, holiday opt-outs). Soft
preferences are shown as warnings on the confirm sheet but do not block. The scheduler can still reassign the
day from the day editor afterwards. The group is also e-mailed on publish and every Monday morning while any shift in
the next 30 days is open (covered by the "Schedule published / changes affecting me" e-mail preference in Settings).

**East vacations (for the person with an East code — Khan today; tell them once).** The scheduler's **Setup → East
feed → Refresh from Davenport** also brings over that person's Davenport vacations (kind vacation only; no-call days
stay in Davenport). Nothing is mirrored blindly: every range arrives **unreviewed** and is treated as **away** — a
Silvis vacation (no primary, no backup, and the day before blocked for primary) — until the person decides. They decide
with one tap per range, **Unreviewed | Away | Home**, in **Setup → East feed** (scheduler), in their own **Time off**
view or in **My schedule**: **away** keeps it a Silvis vacation; **home** makes those days available at Silvis and
preferred for primary (no East call, no OR block, so the Tue/Thu rule is lifted there). No Silvis vacation row is ever
written for an East range — a change of mind is one tap and leaves nothing behind — and their own Silvis vacations in
**Time off** are entered exactly as before. If Davenport changes or cancels a range, the next refresh resets that range
to unreviewed and the toast says so. On the calendar an East range is a small diamond (dashed = unreviewed, outline =
away, filled green = home), the day editor names the state, and the coverage strip counts the unreviewed ranges until
they are decided.

Roles: `admin` (everything, including user links and roles), `scheduler` (generate, publish, edit, import, snapshots),
`surgeon` (own vacations, propose/accept trades, own preferences), `viewer` (read-only — the ER-panel author).

## Removing or changing someone

- Change role or roster link: Setup → Users (or the SQL above).
- Disable sign-in: Supabase dashboard → Authentication → Users → the user → **Ban** (keeps history) or delete the user
  (their `user_profiles` row cascades away; their past schedule rows keep the roster id, which is what the app stores).

## What never happens

- No address in the repo, the seed, the docs, `config.js`, tests, or any anon-readable table.
- The client never writes an email anywhere; `user_profiles.email` is maintained by the database from Supabase Auth.
- Office recipients (the ER-panel author) are entered by hand in **Setup → Office contacts** (authenticated-read table).
