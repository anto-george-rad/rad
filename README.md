# RAD Workspace

Raidefend’s self-hosted workspace with two modules that share one customer database:

- **CRM** — leads, multi-pipeline deals, contacts, companies, distributor and reseller partners, activities, automations and a Power BI-style report builder.
- **Helpdesk** — a Zoho Desk-style ticketing system: email, customer portal and web form channels, departments and teams, permission-based assignment, SLAs with business hours, a knowledge base, canned replies, satisfaction ratings and helpdesk reports.

Each person gets access to one or both modules (see *Roles and access*).

**Stack:** Next.js 14 (App Router, server actions) · TypeScript · Tailwind CSS · PostgreSQL 16 · Drizzle ORM · Chart.js · dnd-kit

---

## Quick start with Docker (recommended)

You need Docker Desktop (or Docker Engine with Compose).

```bash
cp .env.example .env
# edit .env: set AUTH_SECRET (run: openssl rand -base64 48), ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build
```

Open http://localhost:3000 and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

On first start the app creates the database tables, your admin account, three pipelines (Sales, Delivery, Renewals), stage rules, scoring rules, email templates, automations, report pages, and the helpdesk (a Support department, ticket statuses, two SLA policies, help-centre articles and canned replies). Upgrading an older install moves any records in the old Service pipeline into helpdesk tickets and removes that pipeline. With `SEED_SAMPLE_DATA=true` it also loads example records marked “Sample:” / “Example”. Remove them any time in **Settings → Import & data**.

Data lives in the `pgdata` Docker volume; uploaded files in the `uploads` volume.

**Backups.** The `backup` service writes a compressed database dump to `./backups` every day at 02:00 (company time) and keeps 14 days (`BACKUP_KEEP_DAYS`). Copy that folder off the server regularly. To back up by hand:

```bash
docker compose exec db pg_dump -U crm raidefend | gzip > backup-$(date +%F).sql.gz
```

Restore into an empty database with `gunzip -c backup.sql.gz | docker compose exec -T db psql -U crm raidefend`.

**Logs.** `docker compose logs -f app` shows one JSON line per event (sign-ins, scheduler runs, errors with a reference code). `GET /api/health` returns 200 only when the database answers.

## Run without Docker

You need Node.js 20+ and PostgreSQL 14+.

```bash
createdb raidefend                      # or create it in your Postgres tool
cp .env.example .env                    # set DATABASE_URL, AUTH_SECRET, admin details
npm install
npm run setup                           # migrations + seed
npm run dev                             # http://localhost:3000
# production:
npm run build && npm start
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Long random string that signs login sessions. Keep it secret. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | First admin account, created on setup if it does not exist |
| `SEED_SAMPLE_DATA` | `true` loads example records on the first setup |
| `ANTHROPIC_API_KEY` | Optional. Turns on the AI features: deal summaries, risk checks, email drafts, and in the helpdesk suggested replies, thread summaries, automatic category/priority and angry-customer alerts. Without it the helpdesk uses keyword rules for category, priority, language and tone |
| `ANTHROPIC_MODEL` | Model used by the AI assistant (default `claude-sonnet-5-5`) |
| `INSECURE_COOKIES` | `true` only when serving over plain HTTP on a private network. Use HTTPS in production. |
| `APP_URL` | Address people open RAD Workspace at; used in reset emails, ticket emails, portal invites and rating links |
| `APP_TIMEZONE` | Company time zone for “today”, due dates and the hourly jobs (default `Asia/Dubai`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Outgoing email: password resets, ticket replies and acknowledgements, portal invites, rating requests. Without it the helpdesk still works, but customers see replies only in the portal |
| `SUPPORT_EMAIL` | Support address for the default *Support* department created at setup |
| `UPLOAD_DIR` | Where attachments are stored (`/data/uploads` volume in Docker) |
| `CRON_SECRET` | Optional. Lets an outside scheduler call `POST /api/cron` with `Authorization: Bearer …`. The app already runs its jobs hourly by itself |
| `DISABLE_SCHEDULER` | `true` to turn off the built-in jobs (hourly CRM jobs; SLA checks and mailbox polling every 2 minutes), e.g. when running several app servers |

## Roles and access

Settings are split by module. **CRM settings** (`/settings`) hold only CRM things: company and rules, branding, users and their CRM role, pipelines, custom fields, CRM automations, lead scoring, email templates, products, import and data, the CRM recycle bin and audit log. **Helpdesk settings** (`/desk/settings`) hold only helpdesk things: departments and teams, agents and their helpdesk access, ticket statuses, SLAs and business hours, ticket fields, ticket automations, canned responses, helpdesk and portal options, deleted tickets and the helpdesk audit log. *My account* is in both. Helpdesk admins manage agents themselves; for people who also use the CRM they change only the helpdesk side.

Set each person’s CRM access in **CRM settings → Users & access** and their helpdesk access in **Helpdesk settings → Agents & access**. Every page, server action, API route, export and search result checks it on the server; a person only sees the modules they have.

| | CRM | Helpdesk |
|---|---|---|
| **Admin** (workspace role) | Everything, all settings and users | Helpdesk admin, sees all tickets |
| **Manager** | Edits all records, reassigns and merges; sees the tasks of everyone who reports to them | — |
| **Sales rep** | Sees all records, edits only what they own, sees only their own tasks; no import/export | — |
| **Helpdesk admin** | — | Sets up departments, teams, statuses, SLAs, business hours, portal, canned replies, knowledge base publishing; sees and assigns all tickets; deletes tickets |
| **Agent** | — | Works tickets inside their **ticket scope**: *all*, *all of their departments*, *their team’s* or *assigned to them* (team and own scopes also see the unassigned queue of their departments, so they can pick up work). Managers also see tickets assigned to people who report to them. Assigns tickets to agents of the ticket’s department |
| **Light agent** | — | Reads tickets in their departments and adds private notes; never assigned tickets |

CRM access and the helpdesk role are independent: a support engineer can be *helpdesk agent only* (they land on the helpdesk and never see CRM data), a sales rep *CRM only*, and an account manager both. The workspace role (admin / manager / rep) also sets CRM rights.

Customers sign in to the **portal** (`/portal`) with a separate account an agent invites them to from a ticket; they see their own tickets, or every ticket of their company if “company access” is ticked. The public **web form** is at `/support`.

Add people in **CRM settings → Users & access** (or **Helpdesk settings → Agents & access** for support staff) with a temporary password; they change it under **My account**. Give each person a monthly target to see them on the Home leaderboard. When you deactivate someone you can hand their records and open tasks to another person; anyone reporting to them moves up to their manager. Removing someone’s helpdesk access returns their open tickets to the unassigned queue.

**Security.** Passwords need 10+ characters with letters and numbers. Five wrong passwords lock an account for 15 minutes; sign-in, reset and web-form requests are rate limited. **Two-step sign-in** (authenticator app codes, with 8 one-time recovery codes) is set up under My account; admins can reset it for someone who lost their phone. **My account** lists every signed-in device and can sign out any of them. Changing or resetting a password, or “Sign out on all devices”, ends every other session. The app refuses to start in production without a strong `AUTH_SECRET`. **Settings → Audit log** records sign-ins, failed sign-ins, user and settings changes, exports, imports, deletions, merges and file uploads.

## What is included

**Leads** — status tabs, rule-based lead scoring (Hot / Warm / Cold), bulk status, owner and tags, one-click conversion into contact + company + deal.

**Leads** also carry industry, emirate, website, size, budget, timeline, product of interest, campaign, consent and do-not-contact. Unqualified leads need a reason. The list shows each open lead’s age and flags ones nobody has contacted; the lead page shows time to first contact. Adding a lead whose email or phone already belongs to a contact warns you first.

**Deals** — any number of pipelines, each with its own record name (Deal, Project, Renewal, Ticket…), sub-pipelines and stages with win probability and idle limits. Kanban board with drag and drop and a quick-add “+” on every column, list view with bulk actions and click-to-edit cells, and a forecast board by closing month. Stage rules require details before a deal can enter a stage. Won deals ask for a win reason, lost deals for a loss reason, and the AED value is fixed at the moment the deal closes. Deals carry deal type, lead source (carried over from the lead), next step (shown on the card), contract start/term/end and recurring value, tender/RFP number and submission deadline (countdown chip), PO number and payment terms. Clone a deal in one click. Product line items with discounts.

**Renewals** — 90 days (configurable) before a won deal’s contract ends, a renewal deal opens automatically in the Renewals pipeline with a task for the owner.

**Partners** — deals carry a distributor and a reseller, the deal registration number and expiry (the owner is reminded before it lapses), the margin against cost (flagged below the minimum margin set in Company & rules), and a forecast category (Pipeline, Best case, Commit, Omitted). The deal page suggests **who to call at the distributor** for the deal’s products. A *Partners* report page shows pipeline and wins by distributor and reseller. Deals can have several people with roles (decision maker, technical evaluator…). Companies can have a parent; the parent shows its subsidiaries and group totals.

**Recycle bin** — deleted records (with their notes, activities and files) stay in Settings → Recycle bin for 30 days and can be restored.

**History** — leads, contacts and companies record every field change (who, when, old → new), like deals.

### Helpdesk

**Channels** — *Email*: connect each department’s mailbox (IMAP, checked every 2 minutes) or forward to it; replies thread onto the right ticket by the `[#RD-1042]` subject tag or the email headers, auto-replies are ignored and quoted history is trimmed. *Portal*: customers sign in, open tickets, reply, attach files, mark resolved and search the help centre. *Web form* at `/support` (spam-protected). Agents also log phone, WhatsApp and walk-in requests. Requesters are matched to CRM contacts (and their company by email domain), or created.

**Tickets** — views for Open, My tickets, Unassigned, Overdue, Due today, On hold, Escalated, My team, Watching, Closed, Spam; filters and bulk assign / status / priority / department / merge / spam / delete. The ticket page has the full conversation, public replies and private notes with @mentions, canned replies and knowledge-base links in the composer, CC, “send and set status”, collision warning when someone else is viewing or replying, properties, SLA timers, time tracking (timer or manual, billable), watchers, merge, split, clone, child tickets, history, the customer’s other tickets and CRM deals, and “create a deal from this ticket”.

**Assignment** — manual, round robin or least busy per department, among agents who are marked available (agents toggle *Available* in the top bar). Automations can assign by department, priority, channel or keywords.

**SLAs** — first-response and resolution targets per priority, per department and customer tier, counted in business hours (days, hours and holidays in Helpdesk settings → SLAs & hours). The clock pauses while the ticket is *on hold*. Agents are warned before the deadline; breaches flag the ticket as escalated and notify the agent’s manager and/or helpdesk admins.

**Statuses** — custom statuses in three categories: open, on hold (SLA paused) and closed. Resolved tickets close automatically after N days; a customer reply reopens them.

**Knowledge base** — categories and articles (Markdown) with draft/published and public/internal visibility; public articles appear in the portal with search and “Was this helpful?”. The portal suggests articles while a customer types a new request.

**Satisfaction** — the resolution email asks the customer to rate the support (good / okay / bad, with a comment), one click, no sign-in.

**Reports** — the helpdesk home and Reports show open and overdue tickets, first-response and resolution times, SLA compliance, satisfaction, per-agent workload and performance, and tickets by channel, priority and department. Tickets are also a data source in **Insights**.

**Customers** — a helpdesk view of contacts and companies with their tickets; agents with CRM access jump to the CRM record.


**Contacts & companies** — mobile, office and WhatsApp numbers (UAE numbers saved as +971 and shown as “+971 50 123 4567”), department, buying role, LinkedIn, language, birthday, consent, do-not-contact and last-contacted date (updated when a call, meeting, email or WhatsApp is completed). Companies have account type (Prospect, Customer, Distributor, Reseller, Partner…), tier, sector, emirate, mainland/free zone, trade licence number and expiry (the owner is reminded before it expires), TRN check (15 digits), employees, revenue and customer-since (set automatically on the first win).

**Distributors** — when a contact works at a company whose account type is *Distributor*, you choose which of your products that person handles. The company page shows a **Product coverage** table (each product → who handles it) and lists products nobody covers yet. Filter contacts by product handled to find the right person fast.

**Lists** — leads, contacts and companies are paged on the server (50 per page) with fast search, filters, sort and **saved views**. Click a cell to edit it in place. Star any record to pin it to the sidebar; recently opened records are listed there too.

**Files** — attach proposals, contracts, POs or licences (up to 15 MB) to any lead, deal, contact or company.

**Activities** — tasks, calls, meetings (duration, location, attendees), emails and WhatsApp follow-ups, optionally repeating daily, weekly, monthly or yearly; a private **calendar feed** (My account) shows them in Outlook or Google Calendar; completing a call or meeting asks for the outcome. Grouped list and month calendar with hover details; “My day” on Home. A person’s manager is notified when their task is overdue by 2 days (configurable).

**Notifications** — the bell shows assignments, renewals, licence expiries, overdue alerts and automation messages.

**Automations** — CRM and helpdesk automations (ticket created, status changed, customer replied, no update for N days) run on the server whenever the change happens, or on a schedule (checked hourly): when a closing date is within N days, a deal sits in its stage for N days, a contract ends within N days, or a new lead is not contacted for N days. Actions: create follow-up activities, assign owners round-robin, tag, set priority or status, add notes, open a record in another pipeline, or send an in-app notification to the owner or their manager. Every run is listed under Settings → Automations.

**Home** — KPIs, charts, my day, deals that need attention, hot leads, a setup checklist for admins, and for managers and admins a **Team this month** leaderboard (won vs personal target, open pipeline, due today, overdue).

**Branding** — upload your logo (light and dark versions), pick a brand colour (contrast is checked automatically for both themes) and set the sign-in page headline and background. Each person’s light/dark/system theme is saved to their account.

**Keyboard** — ⌘K / Ctrl+K search, `?` for the shortcut list, `G` then `H/L/D/C/O/A/I/S` to jump, `N` then `L/D/C/O/A` to create.

**Insights** — report pages of tiles you build yourself: cards, column, bar, stacked, line, area, donut, funnel and table visuals over deals, leads, activities, contacts and companies. Period, pipeline and owner slicers; click any bar, slice or row to cross-filter the page; focus mode, view data, CSV export, drag to reorder.

**Email** — templates with merge fields, AI drafting, copy into your mail client and log as sent.

**Import / export** — CSV import of leads, contacts, companies, deals and activities with column matching and skip-or-update for duplicates; CSV export for every module and for tickets.

**Everything else** — custom fields per module including tickets (deal fields optionally per pipeline), multi-currency with AED totals, light and dark themes, mobile layout, installable as a phone app (Add to Home Screen).

## New in this release

### CRM

**Licence register** — every company has a licence register (product, seats, licence key, start and end date, status). Winning a deal with recurring or licence lines adds the licences automatically. Licence keys are stored encrypted; showing one is recorded in the audit log. **90 days** (CRM settings → Licences & handoff) before a licence ends, a renewal deal opens in the Renewals pipeline with the licences on it, once per customer and end date. The *Licences* page lists everything ending soon.

**Outlook email sync** — each rep's Microsoft 365 mailbox is read every ~10 minutes; mail exchanged with a CRM contact is logged against that contact, their company and their latest open deal. Private mail with people who are not in the CRM is ignored. Setup: register an app in Microsoft Entra ID, grant the *application* permission **Mail.ReadBasic.All** (admin consent), create a client secret, then enter tenant ID, client ID and secret in **CRM settings → Email sync** and press *Test*. Each person can switch sync off for their own mailbox under My account. The secret is stored encrypted and never sent to the browser.

**One customer page** — the company page shows deals, licences, support contracts, tickets, emails and satisfaction ratings together, with a **health score** (0–100) made from overdue tickets, recent ratings, licences about to lapse, contract status and recent contact. The score also appears in the companies list.

**Scheduled reports** — CRM settings → Scheduled reports: weekly or monthly *pipeline*, *win/loss*, *activities*, *sales leaderboard* or *helpdesk* summaries emailed to managers. *Send now* previews the report (or shows it on screen when email is not set up).

**Web-to-lead form** — CRM settings → Web form gives a hosted form (`/forms/lead`) and an embed snippet / JSON endpoint (`POST /api/forms/lead`) for raidefend.com. Set the allowed site origins, the owner of new leads, the lead source and the thank-you message. Spam-protected and rate limited.

**Sales leaderboard** — won value, deals won, win rate, activities and target progress per rep, by month, quarter or year.

### Helpdesk

**Support contracts** — Helpdesk → Contracts: tier, included hours, value and dates per customer (optionally per product). A ticket's SLA is taken from its customer's contract tier; customers with an expired contract are flagged on the ticket and tagged `contract-expired`. Owners are warned when 80 % of the hours are used.

**Contract profitability** — the Contracts page compares support hours logged (× cost per support hour, set in Helpdesk settings → More options) with each contract's value and shows the margin.

**Attachments in replies** — files attached to an agent reply are sent with the email and shown under that message in the portal.

**Ticket import** — Tickets → Import takes a CSV export from your current helpdesk or mailbox (subject, requester, status, priority, dates, first message, external ID). Re-importing the same external ID updates instead of duplicating.

**Vendor cases** — record the vendor, their case number and status on a ticket. *Waiting on vendor* moves the ticket to an on-hold status so the SLA pauses; when the vendor responds it goes back to open.

**Escalation ladder** — Helpdesk settings → Escalations: level 1 (agent), level 2 (team lead) and level 3 (manager / helpdesk admins), each after N minutes past the SLA deadline, optionally per department, reassigning or raising priority. Checked every 2 minutes, one level at a time.

**WhatsApp Business** — Helpdesk settings → WhatsApp: enter the Meta phone number ID, access token, app secret and a verify token, and set the webhook URL to `https://<your address>/api/whatsapp`. Incoming messages become tickets (or thread onto the customer's open one), matched to contacts by phone; agent replies go back on WhatsApp within Meta's 24-hour window.

**Skills-based routing** — each agent has products, vendors, languages, a shift (days and hours) and leave dates (Agents & access → *Skills & shifts*). Auto-assignment picks the best-matching agent who is on shift and not on leave.

**Major incidents** — mark a ticket as a major incident, link other tickets to it (bulk action), and one reply goes to every linked ticket. A banner appears in the portal while the incident is open.

**AI help** — *Suggest reply* (grounded in your knowledge base and similar solved tickets), *Summarise* the thread, automatic category, priority and language on new tickets, and an alert to the team lead when a customer sounds frustrated.

**Community forum** — portal customers ask questions and answer each other; agents reply, mark answers, pin, lock or hide posts, and turn a topic into a ticket.

**Status page** — public page at `/status` with your components and current incidents and maintenance (Helpdesk → Status page).

**Agent leaderboard** — points for tickets solved, first-response speed, SLA met and satisfaction ratings.

### Shared

**Ticket-to-sales handoff** — a ticket that mentions renewal, upgrade, quote or more licences (keywords editable) creates a lead for the account owner, once per ticket. A won deal (not a renewal) opens an onboarding ticket with a checklist in the chosen department.

**Custom roles** — CRM settings → Roles: roles that take rights away from a person's base role — export, import, delete, bulk edit, Insights, **see cost and margin**, delete and merge tickets. People without *see cost and margin* never receive cost prices or margins from the server.

### Public addresses

`/status` (status page), `/forms/lead` and `POST /api/forms/lead` (web-to-lead), `/api/whatsapp` (WhatsApp webhook), plus the existing `/support`, `/portal` and `/rate`.

## Development checks

```bash
npm test            # unit tests (phone, TRN, passwords, dates, scoring, reminders, renewals, visibility, brand colours, SLA maths, email threading, helpdesk permissions, TOTP, routing, contracts, health score, triage, handoff, escalation, Outlook, WhatsApp, lead form, reports, leaderboards, roles)
npm run typecheck
npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs type checks, tests, migrations + seed against Postgres, and a production build on every push.

## Project layout

```
src/
  app/(app)/…        CRM pages (home, leads, deals, contacts, companies, activities, insights), desk/* helpdesk pages, settings
  app/portal, support, rate   customer portal, public web form, satisfaction rating
  app/api/…          CSV export, files, notifications, brand assets, cron, health check
  app/login/         sign-in
  components/        UI kit, shell, forms, record views, Insights engine and builder
  db/schema.ts       database schema (Drizzle)
  db/migrate.ts      applies migrations in ./drizzle
  db/seed.ts         first-run structure and sample data
  lib/actions.ts     all server actions (validation, permissions, automations)
  lib/automation.ts  automation engine
  lib/scheduler.ts   hourly jobs (automations, renewals, licence and deal-registration reminders, overdue alerts, recycle bin, auto-close) and 2-minute jobs (SLA sweep, mailbox polling)
  lib/desk*.ts       helpdesk engine, permissions, email in/out, server actions
  lib/sla.ts         business-hours SLA maths
tests/               unit tests (vitest)
drizzle/             SQL migrations
```

Change the schema in `src/db/schema.ts`, then run `npm run db:generate` and `npm run db:migrate`.

## Not included (needs outside services)

Sending email from Outlook (sync is read-only), Gmail sync, open tracking, built-in calling, SMS, live chat and single sign-on. These can be added as integrations (Microsoft Graph Mail.Send, Gmail API, a telephony provider, an OIDC provider).
