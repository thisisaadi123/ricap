# RICap: technical spec

How the RICap portal (Retail Innovation Capital) is built. The product source of truth is **RICap PRD v1.1** and its answered Open Questions; section numbers below (e.g. "PRD 6.6") refer to that PRD.

## 1. Stack

Same stack as the RISE portal, so anyone who has worked on RISE can work here.

| Layer | Choice | Same as RISE? |
|---|---|---|
| Backend | Node 18+, Express 4, `pg`, `jsonwebtoken`, `bcryptjs`, CommonJS | Yes |
| Database | Postgres on a dedicated Supabase project | Yes |
| Files (KYC, signed documents, proofs) | Supabase Storage, private bucket, via its S3 API | Yes |
| Email | Resend HTTP API (no SDK) | Yes |
| Frontend | Vite + React 18, `lucide-react` icons, inline styles, Poppins, RIV `BRAND` tokens | Yes |
| Charts (dashboards) | `recharts` | From RIOS |
| Hosting | One Netlify site: static frontend + Express wrapped as a Netlify function | Yes |
| Domain | `ricap.retailinnovation.ai` | – |

### Deliberate differences from RISE

1. **Schema changes are numbered migration files** (`backend/migrations/NNN_name.sql`), applied once each and recorded in a `schema_migrations` table on boot. RISE edits `CREATE TABLE IF NOT EXISTS` in place, which silently skips CHECK-constraint changes on existing databases (see the long comments in RISE's `db.js`). RICap holds money and legal records, so every schema change must apply exactly once, in order.
2. **The frontend is split into files** (`components/`, `views/admin`, `views/partner`, `views/investor`) instead of one large `App.jsx`. RIOS already splits its modules this way.
3. **Login has a second step**: an emailed 6-digit code (PRD 9.2 requires MFA for every user).
4. **Users are invited, never self-registered** (PRD 6.14, INV-8). An invite link lets the user set their own password.
5. **An audit log from day one** (PRD 8.13). Every sign-in, invite and status change is recorded.

## 2. Repo layout

```
backend/
  app.js                 Express app (routes, static frontend, error handler)
  server.js              local entry point
  netlify/functions/api.js  Netlify entry point (serverless-http)
  db.js                  pool + migration runner
  migrations/            001_foundation.sql, 002_..., applied in order
  middleware/auth.js     JWT check, role guards
  lib/                   email, audit, tokens, rate limits
  routes/                auth.js, admin.js, then one file per area
  seed.js                demo accounts for local development
frontend/
  src/brand.js           RIV brand tokens (same as RISE / RIOS)
  src/api.js             fetch wrapper + API surface
  src/components/        shared UI (buttons, cards, modal, badges, nav)
  src/views/             auth screens, then admin / partner / investor views
docs/
  TECH-SPEC.md           this file
netlify.toml
```

## 3. Conventions

- **Money:** `NUMERIC(14,2)`, USD only (MON-3). Shown as `$1,234.00`.
- **Statuses:** each lifecycle is one exported list in the backend and enforced with a CHECK constraint. Transitions are validated server-side.
- **Permissions:** enforced in Express middleware and queries, never only by hiding UI.
- **Records with legal or money meaning are never deleted**, only voided with a reason (PRD 7).
- **Configurable numbers** (minimum tickets, fee %, payout %, credit window) live in database rows with the agreed defaults, not in code.
- **Secrets** live in `backend/.env` locally and in Netlify environment variables in production. Never in the repo.

## 4. Authentication (M0)

| Step | Endpoint | Notes |
|---|---|---|
| Admin invites a user | `POST /api/admin/users` | Creates the user as `invited` and emails a one-time link (valid 72 h). In local dev without Resend, the link is returned to the admin screen and logged. |
| User accepts invite | `POST /api/auth/accept-invite` | Sets a password (min 10 characters); user becomes `active`. |
| Sign in, step 1 | `POST /api/auth/login` | Checks email + password, emails a 6-digit code (valid 10 min, 5 attempts), returns a short-lived challenge token. |
| Sign in, step 2 | `POST /api/auth/verify-code` | Checks the code, returns the session token (8 h). |
| Forgot / reset password | `POST /api/auth/forgot`, `POST /api/auth/reset` | Same pattern as RIOS: one-hour link, same reply whether or not the email exists. |

Roles: `admin`, `partner` (venture partner), `investor`. Startups have no login in v1 (IB-2). Suspended users can't sign in.

## 5. Data model by milestone

Tables follow PRD Section 8. Each milestone adds its own migration file.

| Milestone | Tables |
|---|---|
| M0 Foundation | `users`, `user_invites`, `password_resets`, `login_codes`, `audit_log` |
| M1 People | `venture_partners`, `investors` (partner credit window lives on the investor: `partner_id`, `credit_expires_at`), `investor_contacts`, `bigin_imports`; `users.restricted_access` |
| M2 KYC & documents | `kyc_checklist_templates`, `kyc_files`, `kyc_items`, `kyc_ubos`, `documents`, `document_templates` |
| M3 HoldCo + Fund soft commitments | `vehicles` (minimum tickets per investor kind live on the vehicle), `bank_account_changes`, `vehicle_visibility`, `commitments`, `commitment_events`, `commitment_notes`, `payment_instructions`, `money_movements`, `stage_requirements` |
| M4 IB deals | `ib_deals`, `deal_access_log`, `fee_invoices` |
| M5 Money & payouts | `partner_payouts`, `outbound_investments`, `app_settings`; `money_movements` gains payout and outbound links and reconciliation |
| M6 Investor updates & alerts | `investor_updates`, `update_deliveries`, `notifications` |
| M8 Retail intelligence | `retail_tags`, `entity_tags`, `retail_insights`, `enrichment_runs` |

### M1–M2 notes

- **Restricted access.** KYC files and documents, and investor net worth / inclination, are visible only to admins with `restricted_access` (PRD 8.2, 9.1). An admin who has it can grant it to other admins on the Users page.
- **Partner privacy.** Partners see only investors they registered. Duplicate matches are shown to admins only; a partner whose submission is a duplicate sees "Not accepted".
- **Bigin import.** CSV upload with a preview step. Column names are matched against the aliases in `backend/routes/imports.js`; add the real export's headers there if any aren't recognised.
- **File storage.** `backend/lib/storage.js` has two drivers: a local folder (`backend/storage`, development only) and Supabase Storage via its S3 API (same approach as RISE), chosen automatically when the `SUPABASE_S3_*` variables are set. Downloads always go through a 60-second link, and every open of a KYC or restricted document is written to the audit log.
- **Still manual in v1.** Signature status is tracked by hand on each document until Zoho Sign is connected (needs RIV's Zoho Sign API credentials). Sanctions / PEP screening results are entered by hand (PRD 3). Emails go through Resend once configured; until then they're printed in the backend terminal.

### M3–M4 notes

- **One engine for every flow** (`backend/lib/commitments.js`): the stages of HoldCo, Fund and IB, the eligibility check, and moving one stage at a time. A move is refused with a plain list of what's missing. Stages can't be skipped.
- **Eligibility** (PRD 6.5): approved investor, KYC cleared and not expired, amount at least the vehicle's minimum for the investor kind (an admin can override the minimum with a logged reason), and an allowed KYC classification. Clearing KYC automatically re-checks that investor's waiting commitments.
- **Stage evidence** (PRD 7): the documents each stage needs are rows in `stage_requirements`, editable under Settings > Stage evidence. A document counts as evidence when it's tagged with that stage. Investors' uploaded signed copies are tagged by RIV before they count.
- **Money** (PRD 7, 8.8): payment instructions copy the vehicle's approved bank account at issue time. Only admins record receipts, always with bank proof; partial receipts are allowed, and the full amount moves the commitment to Funds received. Changing a vehicle's receiving account needs a second admin. Receipts and instructions are voided, never deleted.
- **Fund in v1** (LEG-3, MON-5): soft commitments only. The investor confirms in the portal, or RIV uploads their emailed confirmation.
- **IB deals** (BIZ-3, MON-1, MON-7, LEG-11): rounds under USD 2M need sweat equity; under USD 500K also need a recorded reason. Sweat equity is valued at pre-money. Investors pay the startup directly; RIV records the startup's confirmation. Fee invoices bill the cash fee on confirmed placements plus VAT, from Retail X HoldCo, each placement once. Closing a deal withdraws investors who hadn't transferred funds; funded investors stay active until allotment.
- **Visibility**: partners and investors see Open vehicles and Live deals flagged visible to them; an admin can hide a vehicle from individual investors. Teasers are documents of type "Teaser" on the vehicle.

### M5–M6 notes

- **Partner payouts (`lib/payouts.js`).** One row per credited commitment, kept in sync by `refreshPayout` after anything that changes the commitment. HoldCo and Fund: % of capital. HoldCo is earned at Funds received; Fund only accrues in v1. IB: % of RIV's consideration (cash fee + sweat share, capped at 100% of the sweat value), earned when the invoice is paid. Earned amounts are frozen; going un-earned returns the row to Accruing and clears approvals. Paid and manually cancelled rows never change.
- **Approvals.** One admin, or two different admins above `payout_second_admin_above` (Settings → Payout rules; total including VAT). An IB payout above the cash fee received needs a logged reason. Payments go out of the Retail X HoldCo account with proof.
- **Money view.** Every movement with proof, totals, filters, reconcile, and void with a reason. A void puts its record back one step; a fee receipt can't be voided once a payout on it is paid.
- **Alerts (`lib/notify.js`).** Routes insert `notifications` rows in their own transaction. `flushEmailsAfterWrites` sends pending emails before each write request answers (the hosted backend stops once it has responded), claiming rows with `SKIP LOCKED`, within an 8-second budget, up to 3 attempts. Leftovers go with a later request. Emails never carry bank details or update text.
- **Who gets an update.** Investors with a live commitment past Eligible in that vehicle or deal, or a selected subset of them. Partners see that it went out; contents only if marked shareable. Withdrawn updates stay on record and leave the portals.
- **Statement (`lib/statements.js`).** Worked out from commitments and money records as of a date. It shows current stage and committed figures, with payments up to the date. Indicative HoldCo figures are left out until committed.
- **Profile.** Contact details change straight away. Legal name or country reopens a Submitted or Cleared KYC file and alerts admins.

## 6. Pages by role

| Role | Pages |
|---|---|
| Admin | Overview, Partners, Investors, KYC queue, Vehicles (HoldCo, Fund), IB deals, Commitments, Money, Payouts, Outbound investments, Updates, Intelligence, Users, Audit log |
| Venture partner | Dashboard, My investors, Add investor, Vehicles and live deals, My payouts |
| Investor | Home (holdings and actions), KYC, My commitments, Documents, Open opportunities, Updates and statements, Profile |

## 7. Who can do what (summary of PRD 9.1)

| | Admin | Partner | Investor |
|---|---|---|---|
| Invite users, set rates, approve payouts | ✓ | – | – |
| See all investors and partners | ✓ | Own investors only | Self only |
| See KYC documents | ✓ (permitted admins) | – | Own checklist and uploads |
| Mark funds received | ✓ | – | – |
| See vehicles and live IB deals | ✓ | Approved summaries and teasers | All open (with per-investor hide switch) |
| Change a receiving bank account | Two admins | – | – |

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Foundation | Admin can invite users; invited users set a password and sign in with an emailed code; each role lands on its own home; audit log records it all |
| M1 | People | Partners onboard in RICap; investors registered with duplicate check, approval and credit window; Bigin CSV import |
| M2 | KYC & documents | Configurable checklists, investor uploads, admin review, document vault, Zoho Sign |
| M3 | HoldCo flow | Commitment engine, eligibility, HoldCo stages with evidence gates; Fund soft commitments |
| M4 | IB deals | Deal setup, mandate, teaser, investor stages, sweat equity, 5% fee + VAT invoice |
| M5 | Money & payouts | Money movements, partner payouts (4% / 15%), outbound investments, two-admin bank changes |
| M6 | Investor updates & alerts | Monthly letters and other updates, delivery log, account statements, profile, email + in-app alerts |
| M7 | Dashboards | Admin, partner and investor dashboards; Intelligence headline view |
| M8 | Retail intelligence | Retail lens, tags, insight notes, Claude enrichment and summaries |
| M9 | Launch | Security pass, full Bigin import, testing with Saravana, go-live |
