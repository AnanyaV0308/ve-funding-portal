# Notes for Claude

- pnpm monorepo: `apps/web` (Next.js 16 App Router), `apps/worker` (pg-boss), `packages/core` (pure business rules, unit-tested with Vitest), `packages/db` (Drizzle + postgres-js).
- Next.js 16 differs from older versions; read `apps/web/AGENTS.md` and the docs in `node_modules/next/dist/docs/` before using unfamiliar APIs.
- One `.env` at the repo root serves every package (`next.config.ts` loads it).
- Every write goes through a server action that calls `requirePermission()` from `apps/web/src/lib/authz.ts`. Never rely on hiding UI for access control.
- Business rules (roles, eligibility, fit score) live in `packages/core` as pure functions with tests, not in components or AI prompts.
- Accessibility is a requirement: VE has blind team members using screen readers. Keep landmarks, labels and `aria-current`, offer non-drag alternatives, and keep `pnpm test:e2e` (axe, WCAG 2.2 AA) passing.
- Brand: VE yellow is a fill behind dark text only, never text on white. Tokens are in `apps/web/src/app/globals.css`.
- Data stays in India (Supabase Mumbai, Vercel bom1, Fly bom). No LinkedIn scraping.
