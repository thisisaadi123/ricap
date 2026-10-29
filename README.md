# RICap Portal

Retail Innovation Capital: the investor, venture partner and capital-flow portal for Retail Innovation Ventures (RIV), Dubai. Sister app to RISE and RIOS, with its own repo, backend and database.

Home: `ricap.retailinnovation.ai`

- Product spec: RICap PRD v1.1 and its answered Open Questions
- Technical spec: [docs/TECH-SPEC.md](docs/TECH-SPEC.md)

## Structure

```
backend/     Express + PostgreSQL API (Supabase in production)
  db.js            connection pool + migration runner
  migrations/      numbered SQL files, applied once each on boot
  routes/          auth.js (sign-in, invites, resets), admin.js
  seed.js          demo accounts for local development
frontend/    Vite + React
  src/App.jsx      signed-out screens + signed-in shell per role
  src/views/       auth, admin, partner and investor screens
  src/components/  shared UI (same look as RISE / RIOS)
```

## Local development

You need Node 18+ and a Postgres database. Use the dedicated RICap Supabase project (Project Settings → Database → Connection string → URI).

```bash
# backend
cd backend
npm install
cp .env.example .env      # then set DATABASE_URL and JWT_SECRET
npm run seed              # applies migrations + creates demo accounts
npm run dev               # http://localhost:4200

# frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5190, proxies /api to :4200
```

Demo accounts (local only; `seed.js` refuses to run in production):

| Role | Email | Password |
|---|---|---|
| Admin | `admin@ricap.demo` | `admin-demo-123` |
| Venture Partner | `partner@ricap.demo` | `partner-demo-123` |
| Investor | `investor@ricap.demo` | `investor-demo-123` |

Sign-in has two steps: password, then a 6-digit code sent by email. Until `RESEND_API_KEY` and `EMAIL_FROM` are set, the code (and any invite or reset link) is printed in the **backend terminal** instead of emailed.

## Schema changes

Add a new numbered file in `backend/migrations/` (e.g. `002_people.sql`). It's applied once, in order, the next time the backend starts. Never edit a migration that has already run anywhere.

## Deployment (Netlify + Supabase)

One Netlify site, built from `netlify.toml`: the frontend is served as static files and the backend runs as a Netlify function. Environment variables to set in Netlify:

- `DATABASE_URL`: RICap Supabase connection string
- `JWT_SECRET`: long random string
- `APP_URL`: `https://ricap.retailinnovation.ai`
- `RESEND_API_KEY`, `EMAIL_FROM`: required, or nobody can receive sign-in codes
- `NODE_ENV`: `production`
