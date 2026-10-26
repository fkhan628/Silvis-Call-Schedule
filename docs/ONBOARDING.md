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
4. The pg_cron jobs are in place — five, all active: `silvis-daily-reminder-hourly` and `silvis-office-digest-weekly`
   (created 9/22), `silvis-offers-daily` (created 9/23), the Monday open-shifts e-mail `silvis-open-shifts-weekly` (a read-only
   `cron.job` check on 2026-09-28 listed it with schedule `0 12 * * 1`; first observed run 2026-09-28 12:00Z) and, since 2026-10-20,
   `silvis-east-feed-daily` (Prompt 31 Part A - the daily East feed refresh at 10:30 UTC, jobid 8, created after `east-feed-refresh`
   was deployed and its dry run answered 200; first observed run 2026-10-20 10:30Z - its `east.refresh` audit row, `ok` true). All
   read the Vault secret `silvis_cron_secret`. For a rebuild, the `cron.schedule` statements of `edge-functions/README.md` section 4
   are the reference (section 3 the deploy order); `select jobid, jobname, schedule, active from cron.job` must show the five rows.

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
   If they open the link on a device where someone else is still signed in (a shared office computer), the app does not
   replace that session: the card names the signed-in account and the link's, and the link's account is set up only after
   **Sign out and continue** (or they choose **Keep me signed in** and the link is ignored).

2. The moment the invite is created, the database creates their `user_profiles` row (`viewer`, unlinked) — even if they
   never open the email. You can link them right away.
3. **Setup → Users** (in the app: the card titled "Users (accounts, roles, roster links)", visible only when your role is
   admin): pick the new user, set **roster id** (s1–s6) and **role** (`surgeon` for the five
   surgeons, `viewer` for the office contact, `scheduler` for anyone who should publish, `app` for an APP - no roster link;
   see "APPs: putting yourself on a call day" below). Setup → Users is the normal path; if the
   app is unreachable, the same thing in SQL:

   ```sql
   update public.user_profiles set role = 'surgeon', person_id = 's2'
    where email = '<their address>';
   ```

4. Tell them: **Time off** is self-service (no approval) and is refused over a day they are already published — trade
   first. **Trades** are by day and role; every "propose a trade" shortcut lands on the trade form with the next empty
   field focused. Trades and gives (for days still ahead) waiting on their answer come first on **Time off & Trades** (**Waiting on you** - one row per
   proposal, so a weekend or holiday unit is one row naming the unit and its days; the tab badge counts only those, one per proposal; the scheduler's badge counts every pending proposal group-wide, also one per proposal) and can be accepted or declined straight from **Alerts**. Once the other surgeon accepts, the trade is applied at once - on a locked day too, holidays included, but for an East-derived day, which stays the scheduler's (revision ab, applied 2026-10-26; before it a locked day waited for the scheduler's Retry apply). A vacation starting less than
   six weeks out (the offers freeze, `groupRules.offerPeriods`) is saved as usual with a note that the schedule through
   that date is already being built - check Open shifts or propose a trade. Their calendar subscription URL is in
   **Settings → Live calendar sync**.
   Then walk them through the offers section below.

## What to tell a surgeon about offers (Prompt 14 — from the Nov 2026 – Jan 2027 period)

Silvis runs offers-first. **Paint the dates you'll cover, any time**: primary, backup or either, one tap per day on your
phone, for any date ahead, whenever you like — the app is where the offers live now (no more e-mailing lists around).
**Each period (six months since 9/30 - the next is Jan 2027 – Jun 2027) freezes six weeks before it starts**: what you
painted inside that period is what the generator places first, then it fills the gaps. **Two weeks before the freeze and
once more 3 days before, everyone in the pool gets the heads-up** (Prompt 26, 9/30 - whatever you have entered; it honours
your e-mail preference): enter your vacations for the period; if there are days you'd like to work, or can't, paint them
too; otherwise there is nothing to do - the schedule follows your rules. The same note sits on My schedule from two weeks
before the freeze (and on the Calendar while it is urgent) with "Enter vacations" and "Paint days (optional)" buttons; there
is no count on the Paint offers button any more. **Or tell the app to go by your rules** for that period ("Go by my
rules"): your recurring rules in Setup → Rules place you - you still get the heads-up, since vacations matter for everyone. When you submit,
say whether the list is **"only these days"** (you are never placed on a day you did not list) or **"my preferred days
— use my rules to fill gaps"** (the default: your days are placed first; until you reach your fair share for the month
your rules may also place you on days you did not list, and beyond your share you are kept to your list
unless no colleague can reasonably take the slot - in each month where you listed at least one day of the period; your listed weeks, or the days you listed for a month, still apply - painting only adds days; My schedule marks each day you did not list "not offered" — trade if needed). Vacations, East days, derived weeks, windows and caps still
apply on an offered day. A day is refused if it is past, on your vacation, or inside a period that has already frozen —
ask Faraz: the database lets the scheduler enter a late offer (OF003 is skipped for the scheduler role), and he does that
in the app from Setup → Generate → Periods → "Enter for someone" (the painter opens as that surgeon; the entry is stamped
as relayed by the scheduler), or the office relays the dates from Time off → "Offers - enter for a surgeon" (Prompt 16
A7, stamped `office-relay`). *Live since 9/23: the painter, the late-offer paths above, and the reminder
e-mails (14 and 3 days; the six-week one once Faraz sets `[42, 14, 3]` in Setup → Rules, 9/27) (`daily-reminder` mode `offers`, cron job `silvis-offers-daily` — `edge-functions/README.md` §3 deploy record); the
first period was relayed from the seed before the painter existed. Still to come: the publish e-mail's line naming the
days a surgeon was placed on outside his list.*

**Before each freeze: vacations in, painting optional (Faraz 9/30, Prompt 26).** Two weeks before a period freezes (and once more 3 days before) everyone in the pool gets an e-mail and a notice on My schedule: enter your vacations for the period in the app; if there are days you'd like to work, or can't, paint them too; otherwise there is nothing to do - the schedule follows your rules. The office gets the first one too, so they can enter a vacation for a surgeon who asks.

**Group call (Faraz 9/29 - the rule as it has always been, now on the Calendar).** Weekdays until 5 PM you take your own patients' calls; weeknights from 5 PM, weekends and every day of a holiday unit, the Trauma primary on call also takes the clinic's patient calls - the Calendar's On call now banner says who has group call right now (and, on a weekday between 07:00 and 5 PM, who takes it at 5 PM).

**How to paint (show them on their phone).** Open **Mine** and tap **Paint my
offers** (or the **Paint offers** button in the top bar; a reminder e-mail's link `#offers` opens it too). You get one
row per day for the month; ‹ › move ahead as far as you like. While a period is open, a **Go to <period> (freezes M/D,
in N days)** button under the month jumps straight to its first month. Tap a brush at the top — **Primary**, **Backup**, **Either**
(happy with either role), **No primary** or **Clear** — then tap the days; tap a day again with the same brush to take it
back. For a run of days switch **Range** on, tap the first day, then the last (the line under the brushes tells you which
tap you are on and has an "x cancel start"). Prefer typing? **Paste dates** takes "11/3, 11/5, 11/16-11/20".
**No primary** marks a day you cannot be on primary but can still take backup — an outreach or out-of-town day, for
example: the schedule never puts you on primary that day and may still use you as backup. It replaces a Primary or Either
offer on that day; a Backup offer stays (backup preferred that day). Painting Primary or Either on a No primary day lifts
it (the app asks once); **Clear** takes back both. A day you are already published as primary cannot be marked — trade
it first. A vacation blocks backup too, so when you can still take backup, use No primary instead of a vacation. In
**Only these days** mode a No primary day is not an offer: paint **Backup** on it as well if you want backup there.
Single No primary days are yours to change whoever entered them; a longer run Faraz entered reads "No primary (set by the
scheduler)" and only he can change it. Greyed rows
cannot be offered and say why: past, your vacation (and the day before it for primary), an East call day or a derived
East week, outside your window, a day you had Faraz mark as unavailable or no backup (ask him to change that row
first), or frozen because that period already closed (ask Faraz). A day your usual pattern excludes — a Tue/Thu
OR day, a Clinton or outreach day — is NOT greyed: the app asks once ("... is normally not one of your primary call days
- offer it anyway?") and your offer counts for that date. If a vacation you entered later covers a day you had
offered, that row greys but **Clear** can still take the offer back. Each row also shows who is already published that
day (OPEN in red if nobody) and how many colleagues offered it. Nothing is written while you tap: the footer counts
your unsaved changes; **Save** writes them all at once — your days, your No primary days and, if you changed it, your
mode, in one request;
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
preferences are shown as warnings on the confirm sheet but do not block. When Take is greyed out the reason is written
next to it (on a phone the button's tooltip never shows). The scheduler can still reassign the
day from the day editor afterwards. The group is also e-mailed on publish (from the app's Accept & Publish dialog; the 9/23 command-line publish sent
nothing) and every Monday 07:00 Central while any shift in the next 30 days is open (the Monday cron job
`silvis-open-shifts-weekly`, `edge-functions/README.md` section 4 / guide 16.4 — active; first observed run
2026-09-28 12:00Z); both are covered by the "Schedule published / changes affecting me" e-mail preference in Settings.
In between, the scheduler can announce open shifts with **Email the group now** on the Open shifts board.

**East vacations (for the person with an East code — Khan today; tell them once).** The scheduler's **Setup → East
feed → Refresh from Davenport** also brings over that person's Davenport vacations (kind vacation only; no-call days
stay in Davenport). Nothing is mirrored blindly: every range arrives **unreviewed** and is treated as **away** — a
Silvis vacation (no primary, no backup, and the day before blocked for primary) — until the person decides. They decide
with one tap per range, **Unreviewed | Away | Home**, in **Setup → East feed** (scheduler), in their own **Time off**
view or in **My schedule**: **away** keeps it a Silvis vacation; **home** makes those days available at Silvis and
preferred for primary (no East call, no OR block, so the Tue/Thu rule is lifted there). No Silvis vacation row is ever
written for an East range — a change of mind is one tap and leaves nothing behind — and their own Silvis vacations in
**Time off** are entered exactly as before. If Davenport changes or cancels a range, the next refresh resets that range
to unreviewed and the toast says so (since 2026-10-22, if every range of his vanishes from the cache at once - a blocked or emptied
Davenport read looks the same - his reviews are kept instead and the audit log says so). On the scheduler's calendar an East vacation sits in the day's vacation bar (since 10/21: "Khan?" =
unreviewed, "Khan" = away, nothing on a home day - its hover keeps the state), the day editor names the state, and the coverage strip counts the unreviewed ranges until
they are decided - since 9/25 (item E3) those three are the scheduler's view only; the person's own Time off view and
My schedule keep the list and the control. Since Prompt 31 Part A (decision 11) those two East cards are the scheduler's too -
nothing changes for Khan, who is the scheduler; an East-code surgeon who is not the scheduler would see his away / unreviewed
ranges as read-only lines "set by the scheduler" in My vacations, like everyone else (next paragraph).

**Vacations set by the scheduler - what everyone else sees (Prompt 31 Part A, Faraz 10/9; live since 2026-10-19 - tell the group).** Since
the database part was applied on 2026-10-19 (the Part A client has been live since 2026.10.18b), the East-code person's ranges that are *away* or still *unreviewed* show to
every other signed-in account - surgeons, the office coordinator, viewers, followers and APPs - exactly like a vacation: in the
calendar's vacation bar at the bottom of the day, "Off: Khan" in the day summary and "on vacation" in the open-shifts board, claim and trade reasons. Where a Time off
list shows other people's vacations - the office coordinator's, a viewer's, a follower's, an APP's - such a range is a line that
reads "set by the scheduler" (read-only: no Edit and no Remove - the office cannot change or delete it). A surgeon's own Time off
list shows no one else's vacations, as it always has, so the other surgeons see those ranges in the vacation bar and "Off: Khan", not as a
line there. They count toward the 2 surgeons around rule as they already do, so a vacation that would leave fewer than 2 around on
such a day is refused
(the scheduler gets a confirm instead). Where a range comes from stays the scheduler's: the app shows them no East or Davenport word
(the E / O / F / EV badges in Mine and Following and the offer painter's East words are the scheduler's only too - the painter says
"not available"), and *home* ranges do not show at all. Nothing changes on the public link, its share links, the printout, the
calendar feeds, the office digest, the ER export or any e-mail. A change - an away / home decision, or a range the Davenport app
changes - reaches everyone within about a minute of the next refresh, and the daily server refresh (since 2026-10-20) keeps the
ranges fresh without anyone opening the app.

**My call - Silvis + Davenport (for the person with an East code - Khan today; Prompt 31 Part B).** On their own **Mine**
page, under My pay, one card counts their call at both sites: Silvis primary and backup days (one 07:00-07:00 day = 1),
Davenport call days counted the way the Davenport app's own Stats > Billing counts them (day call, weeknights, weekend
days, holiday days; backup-week roles listed apart), the total of both sites and a weighted total in which every backup
role counts 0.5. The chips pick **This month**, **Year to date**, **Full year** or **12 months**; **Month by month** lists
the year. Days on or before the phone's own date count as worked, later days as scheduled, and only published days count -
never a Generate preview or a forecast. Nobody else sees the card: not the office, a viewer, a follower, an APP or the
public link, and when the scheduler picks another person on Mine the card is not there. A "?" means that site's numbers
are not in hand (a note under the chips says why) - never zero - and the line at the bottom says which dates the counts
cover. The Davenport numbers come from the East feed cache, so they are as fresh as the scheduler's last **Setup → East
feed → Refresh from Davenport**: the scheduler presses it once after the build that ships this card - it caches the
published Davenport weeks of the last 12 months (until then the months before the cache's first week read "?"). A month
that runs past the last Davenport week in the cache shows what is counted, as the Davenport app's own card does, and a
note under the month list names that week ("Davenport weeks are cached through ...").

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
| `app` (an APP: a `viewer` with `user_profiles.is_app`, Prompt 29 - database applied 2026-10-02) | everything a viewer has, plus putting itself on call days and taking them off (Mine → My APP days; one APP per day; from today on) | every other write; another APP's days; a roster link |

A viewer (the office viewer, and every invited account until you link *and* promote it) sees the schedule read-only with nothing broken on purpose (Prompt 16 B3): no "not linked" banner, no trade card (Time off lists the group's vacations instead), **Settings → Live calendar sync** offers the public full-schedule feed, and **Alerts** carries only the publish and open-shift notices.

A coordinator account is created like any other (invite from the dashboard), then given the role in Setup → Users with
**no roster link**; the database refuses a linked coordinator (`user_profiles_coordinator_unlinked`).

## APPs: putting yourself on a call day (Prompt 29, 10/1)

*The database part ran on 2026-10-02 (`apply-app-call-days.sh`); APP accounts work from the build that ships Prompt 29's
client, then Faraz marks them in Setup → Users. (Should the database part ever be rolled back, the APP line reads "APP days
are available after the next database update.")*

**What an APP account is.** A viewer account (read-only, no roster link) that you mark **APP**. It keeps everything a
viewer has — the calendar, follows and the follower e-mails, its preferences — and adds one thing: the APP puts itself on
call days. The decisions (Faraz 10/1): **any day** (no rules, no fairness; a past day is refused for the APP - you can fix
one); **one APP per day** (the database enforces it); **everyone signed in sees it**, not the `?public=1` page; **no
e-mails** — the Activity log only.

**How you mark one (Setup → Users).** Invite the APP like a viewer (above). Give the account a **display name** first (a
nameless APP shows as "APP" on the calendar; the calendar shows the last name - a credential such as "PA-C" after it is
dropped - and an APP cannot rename itself, so the name you set is the one everyone sees), leave the **roster link** at *none*, then set **Role** to `app`. The app
refuses `app` on a linked account (and a roster link on an APP), and the database refuses it too. The switch writes the
usual `users.link` Activity log row ("Account <APP name>: APP on"). Setting the role back to `viewer` takes the APP
feature away; that person's days stay on the calendar until you clear them (deleting the account removes them).

**What the APP does.** **Mine → My APP days**: a month of days on the phone. Tap a day to put yourself on call; tap it
again to take it off. A day with another APP's name on it is taken and cannot be picked. **Range** (tap the first and the
last day) and **Paste dates** ("12/2, 12/9, 12/14-12/16") add every free day at once and say which days they skipped and
why. Nothing is saved while tapping: **Save** sends all the changes at once (if it is refused, nothing was saved, your
other taps stay and the message says why - e.g. "12/10 already has <APP name> - nothing was saved"; a tap the refusal made
impossible, such as a day another APP just took, drops out). Past days stay as they are. A tapped day shows "*" (unsaved) until Save; leaving Mine (another tab, Sign in again, a new-version banner's reload) with unsaved taps asks first - Cancel keeps them; closing the app asks only in a desktop browser (an iPhone never asks), so Save first.

**What you do (the day editor).** Every day's editor has an **APP** line: pick any APP and **Set APP** (it replaces the
APP already on that day), or **Clear APP**. It is saved at once, apart from the day's own Save, and works on past days too.

**Who sees it.** The calendar shows the APP as a third line "A <last name>" (on a phone the first four letters, or an initial + three letters when two APPs start alike - "P.App" / "J.App") in a muted rose (the full name is in the day's
hover and in the day summary), and the legend explains it - for every signed-in account: surgeons, the office, viewers,
followers, the APPs and you. The `?public=1` page, its share links, the printable month, the ER Call Panels, the calendar
feeds, Totals, pay, the office digest and every e-mail show nothing of it. The generator, the rules, trades and the open
shifts board ignore APP days.

**The record.** No e-mail and no notification; each Save writes one Activity log row naming the days, e.g.
"<APP name>: on call 10/14, 10/21" (a change you make reads "<APP name>: on call 10/14 (was <other APP>)").

**Three lines to send an APP (phone):**
1. Open the Silvis call schedule and sign in, then tap **Mine**.
2. Under **My APP days**, tap each day you will take call (tap it again to take it off; the arrow right of the month name shows the next month) - a day showing someone else's name is taken.
3. Tap **Save** before leaving Mine (a tapped day shows "*" until then; switching tabs asks first, but closing the app does not always ask - an iPhone never does) - your days appear on the calendar of everyone signed in as "A <your last name>" (on a phone its first letters).

## Phone notifications (Prompt 30 - the database, the VAPID keys and send-notification are live since 2026-10-03; it works from the build that ships Prompt 30's client)

The app sends a phone notification for the same events it e-mails a person about (trades, open shifts, a shift taken, the
schedule published, a manual edit that touches them, offers, vacations logged), to the same people - on every device that
person turned on. It is Silvis's own Web Push (no OneSignal, nothing to install; Davenport's push is separate and unchanged).
Everyone turns it on **once per device**: Settings > **Notification settings** > **Phone notifications** > **Enable phone notifications**, then
**Send test** (a real notification to that person's own devices). **Turn off** stops it on that device; **Reset
subscription** starts that device over (then close and reopen the app - or reload the page in a browser - and tap **Enable
phone notifications**); **Diagnose** says, in one line, what the device and the server hold. Which events reach the phones is
set under "Which events reach your phones" (three switches, independent of the e-mail ones; they cover every device the person
turned on, so they stay editable even on a device that is blocked). The third, **Reminder the day before my call** (a follower's
reads "... their call"), is in Settings since the evening of 2026-10-21 (Central time) and on for everyone - turn it off to keep
the day-before shift reminder off your phones (the e-mail reminder has its own switch under Email). The reminder reaches the phones
since the `daily-reminder` update of 2026-10-22 (v10, deployed 23:18:10 UTC): a surgeon with phone notifications on and this switch on
gets it on his phones the day before his call, at his reminder hour (the hour set under Email - 17:00 Central by default), and a
follower gets it for the surgeons he follows at his own hour; turning the switch off stops it (not
observed yet - the first goes out at the first matching reminder hour, 17:00 Central by default). The **Pop-ups on this
device** box below is a different thing (pop-ups while the app is open): its buttons read **Allow pop-ups** and **Show a test pop-up**. To check that e-mail
reaches you, use **Send a test e-mail** in the Email box (surgeons linked to the roster).

**Three lines to send (iPhone / iPad - iOS 16.4 or later):**
1. Open the Silvis call schedule in Safari, tap **Share** > **Add to Home Screen**, then open **Silvis Call** from that new icon.
2. Sign in there once with your email and password - the Home Screen app has its own sign-in, separate from Safari.
3. Tap **Settings** > **Notification settings** > **Phone notifications** > **Enable phone notifications**, allow notifications, then tap **Send test**.

In Safari itself (not the Home Screen app) the card shows only that instruction - no buttons, since none of them works
outside the Home Screen app.

**Android / a computer (Chrome, Edge, Firefox):** open the app, sign in, Settings > Notification settings > Phone
notifications > **Enable phone notifications**, allow, **Send test**. If the card says "Blocked for fkhan628.github.io", notifications were
blocked for the whole site - that also affects the Davenport app: open the site settings (the icon left of the address), set
Notifications to Allow, reload, tap Enable phone notifications. In the app installed on an Android phone (opened from its
icon - no address bar) the card says instead: phone **Settings > Apps > Silvis Call** (or Chrome / the browser it was installed
from, if Silvis Call is not listed) **> Notifications**, allow them, reopen the app, tap Enable phone notifications. While
blocked, **Send test** is hidden (it cannot reach that device).

**Signing out** turns phone notifications off on that device (the next person to sign in there does not get them); a
shared office PC hands the device over when another account turns it on.

## Removing or changing someone

- Change role or roster link: Setup → Users (or the SQL above).
- Disable sign-in: Supabase dashboard → Authentication → Users → the user → **Ban** (keeps history) or delete the user
  (their `user_profiles` row cascades away; their past schedule rows keep the roster id, which is what the app stores).

## What never happens

- No address in the repo, the seed, the docs, `config.js`, tests, or any anon-readable table.
- The client never writes an email anywhere; `user_profiles.email` is maintained by the database from Supabase Auth.
- Office recipients (the office contact) are entered by hand in **Setup → Office contacts** (authenticated-read table).
