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
   `select jobid, jobname, schedule, active from cron.job` shows four rows — the three that exist today
   (`silvis-daily-reminder-hourly`, `silvis-office-digest-weekly`, `silvis-offers-daily`, created 9/23) plus the new one — before
   telling the surgeons about the Monday e-mail (that job is the one NOT created yet as of 2026-09-23).

## Your own account (first — already done for Faraz on 9/23 - `admin`, roster `s1`; kept for a rebuild)

1. Public sign-ups are off and the app has no sign-up form (Prompt 16 A2): invite your own address from the dashboard (**Authentication → Users → Invite user**), open the link, set a password.
2. The database creates your `user_profiles` row automatically as `viewer`.
3. Promote yourself once, in the SQL editor (or the linked CLI):

   ```sql
   update public.user_profiles set role = 'admin', person_id = 's1'
    where email = '<the address you signed up with>';
   ```

4. Reload the app: you are scheduler + admin and roster `s1` (Khan).

## Inviting a surgeon or a viewer

1. **Supabase dashboard → Authentication → Users → Invite user.** Paste the person's home address from the private file.
   Supabase emails them a link; they set a password through it and land in the app. Accounts exist by invitation only, and
   if they open an invite or reset link that has expired or was already used the app says so in one line ("This invite or
   reset link has expired or was already used - ask the scheduler for a new invite, or use Forgot your password") — send a
   fresh invite from the same dashboard page, or, once they have a password, they use **Forgot your password?** on the card.
2. The moment the invite is created, the database creates their `user_profiles` row (`viewer`, unlinked) — even if they
   never open the email. You can link them right away.
3. **Setup → Users** (in the app: the card titled "Users (accounts, roles, roster links)", visible only when your role is
   admin): pick the new user, set **roster id** (s1–s6) and **role** (`surgeon` for the five
   surgeons, `viewer` for the office contact, `scheduler` for anyone who should publish). Setup → Users is the normal path; if the
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
ask Faraz: the database lets the scheduler enter a late offer (OF003 is skipped for the scheduler role), and he does that
in the app from Setup → Generate → Periods → "Enter for someone" (the painter opens as that surgeon; the entry is stamped
as relayed by the scheduler), or the office relays the dates from Time off → "Offers - enter for a surgeon" (Prompt 16
A7, stamped `office-relay`). *Live since 9/23: the painter, the late-offer paths above, and the 14- and 3-day reminder
e-mails (`daily-reminder` mode `offers`, cron job `silvis-offers-daily` — `edge-functions/README.md` §3 deploy record); the
first period was relayed from the seed before the painter existed. Still to come: the publish e-mail's line naming the
days a surgeon was placed on outside his list.*

**How to paint (show them on their phone).** Open **Mine** and tap **Paint my
offers** (or the **Paint offers** button in the top bar; a reminder e-mail's link `#offers` opens it too). You get one
row per day for the month; ‹ › move ahead as far as you like. Tap a brush at the top — **Primary**, **Backup**, **Either**
(happy with either role) or **Clear** — then tap the days; tap a day again with the same brush to take it back. For a
run of days switch **Range** on, tap the first day, then the last (the line under the brushes tells you which tap you
are on and has an "x cancel start"). Prefer typing? **Paste dates** takes "11/3, 11/5, 11/16-11/20". Greyed rows
cannot be offered and say why: past, your vacation (and the day before it for primary), an East call day or a derived
East week, outside your window, a day you had Faraz mark as unavailable / no backup / backup only (ask him to change
that row first), or frozen because that period already closed (ask Faraz). A day your usual pattern excludes — a Tue/Thu
OR day, a Clinton or outreach day — is NOT greyed: the app asks once ("... is normally not one of your primary call days
- offer it anyway?") and your offer counts for that date. If a vacation you entered later covers a day you had
offered, that row greys but **Clear** can still take the offer back. Each row also shows who is already published that
day (OPEN in red if nobody) and how many colleagues offered it. Nothing is written while you tap: the footer counts
your unsaved changes; **Save** writes them all at once — your days and, if you changed it, your mode, in one request;
if it fails nothing at all was saved, the list of what is still pending stays on screen, and you just Save again —
**Discard** drops them. Above Save, one line names the next period, its freeze date, where you stand and your mode;
**Change** opens the choice: **Only these days** or **These are my preferred days - use my rules to fill gaps** (the
default), or **Go by my rules for <period>** if you would rather not paint at all — it lists your rules in plain words
before you confirm. Once a period has frozen that line only reads "closed <date> - ask the scheduler" until the next
period exists. The header keeps a running count of what you offered this month and in the next period against your
monthly cap.

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
`surgeon` (own vacations, propose/accept trades, own preferences), `viewer` (read-only — the office contact).
Roles (`user_profiles.role`, set in Setup → Users by the admin):

| role | can | cannot |
|---|---|---|
| `admin` | everything, including user links and roles | — |
| `scheduler` | generate, publish, edit days, import, snapshots, Periods, enter vacations / offers for anyone (relayed as the scheduler) | change accounts (admin only) |
| `surgeon` | own vacations, paint own offers, propose / accept trades, claim open shifts, own e-mail preferences | anything for another surgeon |
| `coordinator` (office users, Prompt 16 A7) | see the schedule read-only (calendar, open shifts, totals, alerts), enter / edit / remove **any surgeon's upcoming vacation** (Time off → person picker; the on-call refusal applies exactly as for the surgeon; a started or past vacation stays on record - the scheduler corrects it), relay **any surgeon's offered dates** into the painter (Time off → "Offers - enter for a surgeon"; saved as `entered_by` the office account, `source office-relay`; frozen periods stay frozen), read its **own** Activity log entries | Setup, Generate, the day editor, trades, Mine, publishing, accounts, snapshots, e-mail sends (the notification function answers 403); it is never linked to a roster id |
| `viewer` | read-only — the office viewer | every write |

A coordinator account is created like any other (invite from the dashboard), then given the role in Setup → Users with
**no roster link**; the database refuses a linked coordinator (`user_profiles_coordinator_unlinked`).

## Removing or changing someone

- Change role or roster link: Setup → Users (or the SQL above).
- Disable sign-in: Supabase dashboard → Authentication → Users → the user → **Ban** (keeps history) or delete the user
  (their `user_profiles` row cascades away; their past schedule rows keep the roster id, which is what the app stores).

## What never happens

- No address in the repo, the seed, the docs, `config.js`, tests, or any anon-readable table.
- The client never writes an email anywhere; `user_profiles.email` is maintained by the database from Supabase Auth.
- Office recipients (the office contact) are entered by hand in **Setup → Office contacts** (authenticated-read table).
