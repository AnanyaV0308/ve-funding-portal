# Notes for Claude

- pnpm monorepo: `apps/web` (Next.js 16 App Router), `apps/worker` (pg-boss), `packages/core` (pure business rules, unit-tested with Vitest), `packages/db` (Drizzle + postgres-js), `packages/ingest` (data imports and rescoring, used by the worker, web and scripts), `packages/notify` (reminders, weekly digest, email outbox).
- Next.js 16 differs from older versions; read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before using unfamiliar APIs.
- One `.env` at the repo root serves every package (`next.config.ts` loads it).
- Every write goes through a server action that calls `requirePermission()` from `apps/web/src/lib/authz.ts`. Never rely on hiding UI for access control.
- Business rules (roles, eligibility, fit score) live in `packages/core` as pure functions with tests, not in components or AI prompts.
- Accessibility is a requirement: VE has blind team members using screen readers. Keep landmarks, labels and `aria-current`, offer non-drag alternatives, and keep `pnpm test:e2e` (axe, WCAG 2.2 AA) passing.
- Brand: VE yellow is a fill behind dark text only, never text on white. Tokens are in `apps/web/src/app/globals.css`.
- File uploads use signed upload URLs (`apps/web/src/lib/storage.ts`): the browser PUTs the file, then a server action records it. Never send file bodies through server actions (Vercel caps bodies at 4.5 MB). Only the local-disk driver exists; Supabase Storage comes with hosting.
- Knowledge facts carry `confirmed_at` + `refresh_months`; status rules live in `packages/core/src/knowledge.ts`. Drafts must only use facts where `usableInDrafts()` is true.
- Pipeline stages, probabilities, weighted value, stuck and due rules live in `packages/core/src/pipeline.ts`. Amounts are whole rupees in a `bigint`; parse input with `parseInr` and show it with `formatInrShort`/`formatInr`. Every stage change writes a `pursuit_stage_changes` row; lost stages need a reason.
- Drag-and-drop always has a non-drag alternative (the board's Stage menu). Scroll containers are `relative` so `sr-only` text can't make the page scroll sideways.
- CSR rules (CSV reading, eligibility, ticket estimate, fit score) live in `packages/core/src/csr.ts`; fit settings are stored in `app_settings` via `packages/db/src/settings.ts`. Funders are matched on CIN, then name. Foreign companies are never eligible (VE has no FCRA).
- Imports: the web app stores the CSV and queues a `data_imports` row; the worker's `pending-work` job (every minute) runs it through `@ve/ingest`. Anything that changes a company's facts calls `rescoreFunders([id])`. Locally `pnpm --filter @ve/ingest run-pending` runs the queue without the worker. Upload keys start with `uploads/`, so files sit at `apps/web/.data/uploads/uploads/...`.
- Peer NGO donor lists (`donor_lists`) add `funder_grantees` rows with `donor_list_id`; reading and matching pasted names is in `packages/core/src/donors.ts` (`companyNameKey`, `matchDonors`), saving and removing in `packages/ingest/src/donors.ts`.
- Award calls live in `opportunities`; checklist verdicts, call status and the 30/14/7/2 reminder rule are in `packages/core/src/awards.ts`. Real recurring awards are seeded without dates (`pnpm --filter @ve/db seed:awards`); never invent a deadline.
- Emails (reminders, digest) go through `@ve/notify`: queue a row in `outbound_emails` with a unique `dedupe_key`, then `deliverQueued()`. Until an email service exists, delivery writes files to `apps/web/.data/outbox` and refuses in production. Each person's choices are `users.digest_emails` / `users.reminder_emails`, set in Settings → Emails to me.
- e2e tests share one database and run with one worker; give records they create unique names.
- Data stays in India (Supabase Mumbai, Vercel bom1, Fly bom). No LinkedIn scraping.
