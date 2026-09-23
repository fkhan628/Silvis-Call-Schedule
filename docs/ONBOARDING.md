# Onboarding users — Silvis Call Schedule

*For Faraz (admin). Contact addresses live only in the private `silvis-contacts.md` in the OneDrive folder; nothing here
or in the app ever needs an address typed anywhere except the Supabase dashboard's invite box, the user's own login and — only
as a fallback when Setup → Users is unreachable — the one-line SQL below, run once in the SQL editor (delete the saved snippet
afterwards; the editor keeps query history).*

## One-time project settings (Supabase dashboard)

1. **Authentication → URL Configuration.** Site URL: `https://fkhan628.github.io/Silvis-Call-Schedule/`. Add the same URL
   (with the trailing slash) to **Redirect URLs**. Without this, invite and password-reset links fall back to the default
   Site URL and never reach the app (the same gotcha the Davenport project had).
2. **Authentication → Email templates** (optional): the default "Invite user" and "Reset password" templates work; the app
   detects `#type=invite` / `#type=recovery` in the URL hash and opens the set-a-password form.
3. `sql/schema.sql` is applied (Prompt 2). Re-running it is safe.
4. After approving live mail (`edge-functions/README.md` section 6): the Vault secret `silvis_cron_secret` is already in place;
   paste the `cron.schedule` of README section 4 for `silvis-open-shifts-weekly` and confirm
   `select jobid, jobname, schedule, active from cron.job` shows three rows — before telling the surgeons about the Monday
   e-mail (the job is NOT created yet as of 2026-09-23).

## Your own account (first — already done for Faraz per `docs/STATUS-2026-09-23.md`: `admin`, roster `s1`; kept for a rebuild)

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
3. **Setup → Users** (in the app: the card titled "Users (accounts, roles, roster links)", visible only when your role is
   admin): pick the new user, set **roster id** (s1–s6) and **role** (`surgeon` for the five
   surgeons, `viewer` for the ER-panel author, `scheduler` for anyone who should publish). Setup → Users is the normal path; if the
   app is unreachable, the same thing in SQL:

   ```sql
   update public.user_profiles set role = 'surgeon', person_id = 's2'
    where email = '<their address>';
   ```

4. Tell them: **Time off** is self-service (no approval) and is refused over a day they are already published — trade
   first. **Trades** are by day and role. Their calendar subscription URL is in **Settings → Live calendar sync**.
   Then walk them through the offers section below.

## What to tell a surgeon about offers (Prompt 14 — from the Nov 2026 – Jan 2027 period)

Silvis runs offers-first. **Paint the dates you'll cover, any time**: primary, backup or either, one tap per day on your
phone, for any date ahead, whenever you like — the app is where the offers live now (no more e-mailing lists around).
**The next three months freeze six weeks before the current period ends**: what you painted inside that period is what
the generator places first, then it fills the gaps; the app e-mails you 14 and 3 days before the freeze if you have
entered nothing for that period (it honours your e-mail preference). **Or tell the app to go by your rules** for that
period ("Go by my rules"): your recurring rules in Setup → Rules place you and you hear nothing more. When you submit,
say whether the list is **"only these days"** (you are never placed on a day you did not list) or **"my preferred days
— use my rules to fill gaps"** (the default: your days first, your rules cover what is still open, and your publish
e-mail names every day you did not list — trade if needed). Vacations, East days, derived weeks, windows and caps still
apply on an offered day. A day is refused if it is past, on your vacation, or inside a period that has already frozen —
ask Faraz: the database lets the scheduler enter a late offer (OF003 is skipped for the scheduler role), and he will be
able to do that from the Periods section once the UI wave ships; until then the only late path is a scheduler-JWT REST
write, because the seed CLI runs as postgres and is refused by OF003 from 2026-10-02. *Until the UI wave ships, Faraz
relays e-mailed dates as the scheduler (the first period's lists went in that way from the seed); the 14- and 3-day
reminder e-mails start once the offers cron is live (target 9/29, `edge-functions/README.md` §3 deploy record); and the publish e-mail's
off-list line arrives with the UI wave.*

**Open shifts (tell every surgeon).** The **Open shifts** tab lists every unfilled primary or backup slot from today to
the end of the published schedule, with the weekend or holiday unit it belongs to, why it is open, and who is eligible
right now; the count sits on the tab as a badge. **Take this shift** is immediate and logged: the moment they confirm,
the day is theirs (no approval step, no waiting for the scheduler), it shows on everyone's calendar and in the feed,
the scheduler and the surgeon each get an e-mail, and the audit log keeps the entry. The button is offered only when the
hard schedule rules allow it (their OR / outreach days, monthly and backup caps, vacations, holiday opt-outs). Soft
preferences are shown as warnings on the confirm sheet but do not block. The scheduler can still reassign the
day from the day editor afterwards. The group is also e-mailed on publish (from the app's Accept & Publish dialog; the 9/23 command-line publish sent
nothing) and — once the Monday cron job `silvis-open-shifts-weekly` is created (`edge-functions/README.md` section 4 / guide
16.4–16.5 step 3; NOT created yet as of 2026-09-23) — every Monday 07:00 Central while any shift in the next 30 days is open
(both covered by the "Schedule published / changes affecting me" e-mail preference in Settings). Until then, announce open
shifts with **Email the group now** on the Open shifts board.

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
