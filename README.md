# VE Funding Portal

Vision Empower's fundraising portal: find Indian funders that fit VE's mission, rank them, and track every pursuit to a decision.

This repository holds **Phase 1**: the knowledge base, ranked CSR leads, the pipeline tracker and an awards calendar. The plan is in the [build blueprint](https://claude.ai/artifact/5uzKvoqRw9VvpPbgXk2Tve) and the PRD.

## What's here so far

### Step 7: companies' annual reports

- **CSR leads → Company annual reports.** A listed company's annual report gives its CSR obligation, what it spent, what it moved to its Unspent CSR Account and often the NGOs that ran its projects, a year or more before the National CSR Portal. Every month, until the year's report is in, the worker looks for the newest report of the best-fitting listed companies (100 by default; admins choose up to 1,000, at an estimated ₹20 to ₹50 per company each time)
- **Where it looks**: Claude (`claude-opus-5-5`) searches the company's own website with web search and gives a link to the PDF. The portal never fetches from NSE or BSE, whose terms don't allow automated collection, and it follows each site's robots.txt. A link is used only when the downloaded PDF's first pages name the company and say annual report
- **What it reads**: from the PDF's text the portal picks the CSR pages (the CSR annexure, and pages that name CSR projects, CSR registration numbers or disability work) and sends only those, at most 24. Claude reads the figures, the CSR policy link, the partners with any amount, CSR registration and page, and the work on disability. Only the company's public report is sent, never VE's data
- **What it adds**: the NGOs it names go on the company's **NGOs it funds**, each with a link to its page in the PDF, and count towards the fit score. The company's own foundation, government funds (such as PM CARES), organisations that aren't NGOs and names that don't appear in the report's text are left out, with the reason shown. A report's disability work counts as cause, and a budget well above the latest CSR Portal spend counts as timing
- **On a company's page**: the **Annual report** section shows what the newest report says, with **Look for its newest report**, and **Add a report by hand** takes a link or an uploaded PDF, such as one downloaded from NSE or BSE by a person. Removing a report takes away the NGOs it added
- Finding and reading need `ANTHROPIC_API_KEY`; without it, added reports wait unread and nothing is looked for

### Step 6: peer NGO donor lists, read from their annual reports

- **CSR leads → Peer NGO donors.** Once a month the worker opens each peer NGO's reports page, finds its newest annual reports (PDFs whose link or file name says annual report, with the year read from names like `AR_2024-25.pdf`; audits and FCRA filings are skipped) and queues them. The first look reads the newest two; after that only newer reports
- Each report is read by Claude (`claude-opus-5-5`). The portal first finds the pages that list donors from the PDF's text and sends only those, or the whole report when it has no text, such as a scan. Claude lists the donors, including ones shown only as logos, with any amount, CIN and page. Only the NGO's public report is sent, never VE's data. Reading needs `ANTHROPIC_API_KEY`; without it, reports are found but wait unread
- The portal's rules (in `packages/core/src/peer-reports.ts`) then keep Indian companies and foundations, and leave out government bodies, donors registered outside India (VE has no FCRA) and individuals, saying why
- **Donor lists to check**: someone opens each read report, sees how every donor matches the portal (on CIN, then name), with a link to its page in the PDF, and presses **Add these donors** or **Don't add them**. Nothing changes scores until then. The weekly digest lists reports waiting to be checked
- **Where the portal looks**: the reports page for each NGO on the peer list, editable by anyone who edits leads, with when it was last looked at, what was found, and **Look now**. Links for 11 of the 13 starting peers were found on their websites (`pnpm --filter @ve/db seed:peer-sources`); Amar Jyoti has no working site and Sense International India publishes no annual report
- **Add a list by hand**: paste a list the portal can't find on its own, one donor per line. An amount after a comma (`Tata Steel Ltd, 25 lakh`) and a CIN anywhere on the line are picked up; **Check the list** shows the matches before anything is saved
- **Donor lists added** shows every list with its source. Removing one takes its NGO off each donor and removes the funders it added, unless someone has since added CSR data, notes or a pursuit for them

### Step 5: awards calendar, reminders and the weekly digest

- **Awards calendar** of award, grant and call-for-proposals deadlines, as a **list** (open now, opening later, dates not announced, closed) and a **month** grid with the same dates listed underneath for screen readers. Filters for kind, eligibility, skipped and closed calls
- Each **call page** has the deadline, opening date, prize or grant, the organiser's link and an **eligibility checklist**: registration type, years of operation, no FCRA needed, geography, budget size and theme. Any "VE doesn't meet it" marks the call **Not eligible**; anything unsure or unchecked leaves it at **Needs check**; all met makes it **Eligible**
- **Start an application** opens an Applications pursuit for the call, owned by whoever pressed it, with the deadline as its due date. **Skip this call** records why VE isn't applying and stops its reminders; it can be undone
- **Deadline reminders** by email 30, 14, 7 and 2 days before each deadline, to the owner of the application, or to everyone who works on the calendar while nobody owns one. A call added late gets the nearest reminder straight away. Reminders stop once the application is submitted, and each one goes only once
- A **weekly digest** on Monday mornings: new high-fit CSR leads, deadlines in the next two weeks, pursuits stuck for more than 21 days and wins. An empty week sends nothing
- **Settings → Emails to me**, for everyone, to turn the digest and reminders off. Admins also see **Emails sent**
- Until VE has an email service account, emails are saved as files in `apps/web/.data/outbox` instead of being sent
- **This week** lists award and grant deadlines in the next 14 days
- `pnpm db:seed` adds five real yearly awards from the PRD (DEPwD National Awards, NCPEDP-Mphasis Universal Design Awards, Infosys Foundation Aarohan, Zero Project, QS Reimagine Education) without dates, because this year's haven't been confirmed, plus five fictional "Example:" calls with dates so the calendar has something to show

### Step 4: CSR leads

- **Import CSR data** reads a company-wise or project-wise CSV downloaded from the National CSR Portal (csr.gov.in). It finds the heading row even under title rows, works out whether amounts are in crore, lakh or rupees, and lists any rows it skipped and why. Companies are matched on their CIN, then on name, and a year in the file replaces what was stored for that year
- The import runs in the **worker**, which checks for waiting imports every minute. Run `pnpm --filter @ve/ingest run-pending` to process them straight away without the worker
- **Eligibility** for every company: **Eligible** (an Indian entity that reported CSR in both of the last two years and spends above VE's floor), **Needs check** (no valid CIN, or only one recent year) or **Not eligible** (foreign, or below the floor). VE has no FCRA registration, so foreign companies are always not eligible
- A **fit score** out of 100 in six parts: cause (share of CSR on education, skills and disability), peer NGOs it funds, likely grant size, spend in VE's states, a warm path, and timing (spend growing or money left unspent). Each part shows its points and the reason
- **CSR leads**: companies ranked by fit, filtered by eligibility, state, cause, likely grant and "new in the last 7 days"
- A **company page** with eligibility, the fit score broken down, CSR spend by year with the file it came from, the sector and state split, the NGOs it funds, and a warm-path note. Adding an NGO or a warm path rescores the company at once. **Start a pursuit** opens a new pursuit for that company
- **Settings → Fit score** (admins): the six weights, the floor (₹5 lakh to start), the states where VE works and the list of peer NGOs. Saving rescores every company
- **This week** lists eligible companies added in the last 7 days
- `pnpm db:seed` imports a fictional example file (`packages/ingest/fixtures/csr-portal-example.csv`, every company named "Example: ...") when no CSR data has been loaded

### Step 3: pipeline tracker

- **Pipeline** with two tracks: **Relationships** (CSR and philanthropy conversations, from Identified to Funds received) and **Applications** (awards and grant calls, from Spotted to Won). Each stage has a default chance of winning, and the weighted value is the ask times that chance
- A **board** and a **table** showing the same pursuits. Every card has a **Stage** menu and a **Move** button, so the board works with a keyboard and a screen reader; mouse users can also drag cards between columns. The page announces each move and keeps focus on the moved card
- Moving to **Not now or lost** or **Not selected** asks for a reason and an optional date to try again
- A **pursuit page** with the ask, owner, chance of winning (which can be set by hand), next action and due date, the full stage history, and a log of calls, meetings and notes
- **This week**: weighted pipeline by track and by funder type, next actions overdue or due in 14 days, pursuits that haven't changed stage in more than 21 days, and your own pursuits
- Six fictional example pursuits (funder names start with "Example:") are added by `pnpm db:seed` when the pipeline is empty, so the screens have something to show

### Step 2: knowledge base

- **Facts and numbers** for VE's organisation details, impact numbers, programmes, stories, approved answers and budget templates. Each fact has a source, an as-of date, an owner and a review period
- Every fact shows whether it's **Current**, **Review soon**, **Out of date** or **Needs confirming**. Saving a fact or pressing **Still correct** marks it as checked. Only confirmed, in-date facts will be used in drafts
- 27 starting facts from the PRD research (registrations, leadership, FY 2024-25 and 2025-26 impact numbers, programmes), all marked **Needs confirming** until someone at VE checks them. Load them anywhere with `pnpm --filter @ve/db seed:knowledge`
- **Documents** (annual reports, accounts, registrations, proposals, MoUs and award citations) with versions. Files go from the browser straight to storage through a 15-minute signed link, so large PDFs never pass through the app server
- Viewers can read; associates, approvers and admins can edit

### Step 1: app shell, sign-in and roles

- The app shell in VE's brand: logo, yellow, olive and charcoal, with the Ubuntu and Oswald fonts
- Sign-in with Microsoft 365, plus a demo-user sign-in for local development only
- Roles set by VE in Settings: Admin, Approver, Associate, Introducer and Viewer. Every write is checked on the server, and VE can never be left without an admin
- An audit log of sign-ins and role changes
- Placeholder screens for This week, CSR leads, Pipeline and Awards calendar, each saying which step builds it (This week and Pipeline arrived in step 3)
- A background worker on a Postgres-backed queue (pg-boss)
- Unit tests for the role rules, and browser tests that open every screen and run an automated WCAG 2.2 AA check

## Layout

```
apps/web        Next.js app: screens and server actions
apps/worker     Background jobs (pg-boss): imports, rescoring, peer NGO reports, deadline reminders and the weekly digest
packages/core   Business rules with unit tests: roles, knowledge freshness, pipeline stages and money, CSR eligibility and fit score, award calls and reminders
packages/db     Drizzle schema, migrations and seed data
packages/ingest Data imports (National CSR Portal CSV, peer NGO donor lists and reports) and scoring, shared by the worker, the web app and scripts
packages/notify Deadline reminders, the weekly digest and the email outbox
```

## Run it locally

You need Node 22, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env              # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d              # local Postgres 16
pnpm db:migrate
pnpm db:seed                      # demo users, starting facts, example pursuits and example CSR data
pnpm dev                          # http://localhost:3000
```

Sign in with **Continue as demo user** and pick a role. Uploaded files are saved under `apps/web/.data/uploads`. Run the worker in a second terminal with `pnpm worker`; it processes CSR imports and sends reminders and the digest.

## Importing National CSR Portal data

1. On csr.gov.in, download the company-wise or project-wise CSR data. If it comes as Excel, save it as CSV.
2. In the app, go to **CSR leads → Import CSR data**, choose the file and press **Upload and import**.
3. The worker picks it up within a minute (or run `pnpm --filter @ve/ingest run-pending`). **Recent imports** shows how many companies were read and which rows were skipped.

The file needs a company name, financial year and amount spent column. CIN, prescribed amount, development sector, state and project columns are used when present.

## Peer NGO annual reports

Put `ANTHROPIC_API_KEY` in `.env` so the portal can read reports. Every minute the worker looks for reports pages that are due (each one monthly, or straight after **Look now**) and for reports waiting to be read. By hand:

```bash
pnpm --filter @ve/ingest peer-reports                 # look at the pages that are due, then read what's waiting
pnpm --filter @ve/ingest peer-reports "Saksham"       # look at one NGO's page now (reads nothing)
pnpm --filter @ve/ingest find-reports <page url>      # list the reports a page links to; saves nothing
pnpm --filter @ve/ingest report-pages <pdf url>       # which pages of a report would be read; sends nothing
```

Reports over 150 MB aren't downloaded, a site's robots.txt is followed, and a report is read only once. One that couldn't be read says why on its page, with **Try reading it again**.

## Company annual reports

With `ANTHROPIC_API_KEY` in `.env`, the worker looks for two due companies' reports and reads up to two waiting reports every minute. By hand:

```bash
pnpm --filter @ve/ingest company-reports              # look for a few due companies' reports, then read what's waiting
pnpm --filter @ve/ingest company-reports "Infosys Limited"   # look for one company's report now
pnpm --filter @ve/ingest company-checks               # look for every due company's report
pnpm --filter @ve/ingest csr-pages <pdf url or file> "Infosys Limited"   # which pages would be read; sends nothing
```

Reports over 150 MB aren't downloaded. A report that couldn't be read says why, with **Try again**.

## Reminders and the weekly digest

The worker sends deadline reminders every day at 8am India time and the digest on Mondays at 8am. To run them by hand:

```bash
pnpm --filter @ve/notify reminders              # today's reminders
pnpm --filter @ve/notify digest                 # this week's digest
pnpm --filter @ve/notify reminders --date=2026-11-20   # as if it were another day
```

Emails are written to `apps/web/.data/outbox` (or `EMAIL_OUTBOX_DIR`) as a .txt and an .html file each. Links in them point at `APP_URL`. Production refuses to send until the email service is set up, so nothing is silently dropped.

## Tests

```bash
pnpm test        # unit tests
pnpm typecheck
pnpm test:e2e    # browser + accessibility tests; needs the database running and seeded
```

If Playwright's browser isn't installed, run `pnpm --filter web exec playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_PATH` at an existing Chromium.

## Changing the database

Edit `packages/db/src/schema.ts`, then run `pnpm db:generate` to write a migration and `pnpm db:migrate` to apply it. Commit the migration.

## Turning on Microsoft sign-in

VE's Microsoft 365 admin registers one app in Microsoft Entra ID:

1. **App registrations → New registration.** Name it "VE Funding". Choose "Accounts in this organizational directory only".
2. Add the redirect URI `http://localhost:3000/api/auth/callback/microsoft-entra-id` (type Web). Add the staging and production URLs later.
3. Under **Certificates & secrets**, create a client secret.
4. Put these in `.env`:
   - `AUTH_MICROSOFT_ENTRA_ID_ID`: the Application (client) ID
   - `AUTH_MICROSOFT_ENTRA_ID_SECRET`: the secret value
   - `AUTH_MICROSOFT_ENTRA_ID_ISSUER`: `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0`

Phase 1 asks only for sign-in (`openid profile email User.Read`), which doesn't need admin consent. Mail and calendar permissions come with email sync in Phase 2.

Emails listed in `ADMIN_EMAILS` become admins on their first sign-in. Everyone else starts as a viewer.

## Hosting (later)

| Piece | Where |
| --- | --- |
| Web app | Vercel, Mumbai region (`bom1`) |
| Database and files | Supabase, Mumbai (`ap-south-1`) |
| Worker | Fly.io, Mumbai (`bom`) |
| Email | An email service account (Resend in the blueprint), set up with hosting |

All three are created in VE's name. Until they exist, everything runs locally.
