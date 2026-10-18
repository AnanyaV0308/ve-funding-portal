# VE Funding Portal

Vision Empower's fundraising portal: find Indian funders that fit VE's mission, rank them, and track every pursuit to a decision.

This repository holds **Phase 1**: the knowledge base, ranked CSR leads, the pipeline tracker and an awards calendar. The plan is in the [build blueprint](https://claude.ai/artifact/5uzKvoqRw9VvpPbgXk2Tve) and the PRD.

## What's here so far

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
- A background worker on a Postgres-backed queue (pg-boss), currently running a heartbeat job only
- Unit tests for the role rules, and browser tests that open every screen and run an automated WCAG 2.2 AA check

## Layout

```
apps/web        Next.js app: screens and server actions
apps/worker     Background jobs (pg-boss): crawls, scoring, reminders
packages/core   Business rules with unit tests: roles, knowledge freshness, pipeline stages and money (eligibility and fit score next)
packages/db     Drizzle schema, migrations and seed data
```

## Run it locally

You need Node 22, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env              # then set AUTH_SECRET: openssl rand -base64 32
docker compose up -d              # local Postgres 16
pnpm db:migrate
pnpm db:seed                      # five demo users, starting facts and example pursuits
pnpm dev                          # http://localhost:3000
```

Sign in with **Continue as demo user** and pick a role. Uploaded files are saved under `apps/web/.data/uploads`. Run the worker in a second terminal with `pnpm worker`.

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

All three are created in VE's name. Until they exist, everything runs locally.
