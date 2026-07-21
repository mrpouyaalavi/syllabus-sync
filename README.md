<div align="center">

<!-- Typing animation -->

[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=700&size=20&duration=2800&pause=700&color=6366F1&center=true&vCenter=true&width=860&lines=Full-Stack+Student+Planning+Platform;Academic+Planning+%C2%B7+Deadlines+%C2%B7+Campus+Support;Next.js+16+%C2%B7+React+19+%C2%B7+TypeScript+%C2%B7+Supabase;Security-Focused+%C2%B7+35+Languages)](https://readme-typing-svg.demolab.com)

<!-- Badges -->

![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=for-the-badge)
![Next.js](https://img.shields.io/badge/Next.js_16-000?style=for-the-badge&logo=nextdotjs)
![React](https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![Tests](https://img.shields.io/badge/Vitest-878_passing-6E9F18?style=for-the-badge)
![CI/CD](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)

</div>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

# Syllabus Sync — Student Planning Platform

> **A full-stack student planning platform that brings unit management, assessment deadlines, study organisation, and basic campus support into one interface.**

Syllabus Sync helps university students track enrolled units, class times, and assessment deadlines, and gives them a lightweight campus map for finding buildings. It started as a project built around Macquarie University's unit and building data, and is architected so that data layer can be swapped for another institution.

It is an independent project, **not officially affiliated with Macquarie University**. Built on Next.js 16, React 19, and Supabase with TypeScript throughout, it's primarily a portfolio piece demonstrating full-stack engineering, applied security practices, and CI/CD discipline.

**[🔗 Live Demo](https://www.syllabus-sync.app)** &nbsp;·&nbsp; **[📖 Docs](./docs/README.md)** &nbsp;·&nbsp; **[🔐 Security](./SECURITY.md)** &nbsp;·&nbsp; **[🤝 Contributing](./CONTRIBUTING.md)**

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## 🎯 Problem & Value Proposition

University tools are often fragmented — timetables, deadlines, campus maps, and support resources scattered across separate portals with clunky UX. Syllabus Sync brings the pieces students actually check daily into one place:

- **Unified Academic Management:** Enrolled units, class times, and assessment deadlines in a single dashboard and calendar.
- **Basic Campus Support:** A Leaflet-based campus map with building search and an embedded Google Maps view — location context, not turn-by-turn wayfinding.
- **Security-Focused Architecture:** Defence-in-depth with WebAuthn (passkeys), TOTP-based MFA, edge middleware auth gating, rate limiting, and PostgreSQL Row-Level Security.
- **Engagement Mechanics:** XP and streak tracking to nudge consistent use, backed by anti-abuse rate limiting.
- **Portfolio-Grade Process:** Every change runs through a CI pipeline that checks secrets, formatting, types, lint, tests, and build before merge.

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Screenshots

<div align="center">

|                              Dashboard                               |                              Calendar                              |
| :------------------------------------------------------------------: | :----------------------------------------------------------------: |
| <img width="400" alt="Dashboard" src="./docs/images/Dashboard.png"/> | <img width="400" alt="Calendar" src="./docs/images/Calendar.png"/> |

|                          Campus Map (Leaflet)                          |                        Campus Map (Google Maps)                        |
| :--------------------------------------------------------------------: | :--------------------------------------------------------------------: |
| <img width="400" alt="Campus map" src="./docs/images/Campus map.png"/> | <img width="400" alt="Google map" src="./docs/images/Google map.png"/> |

</div>

> TODO: add current screenshots for Settings, Auth/Security flows, and a mobile viewport — not yet captured.

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Key Features

```text
╔══════════════════════════════════════════════════════════════════════╗
║  🗓  Unit tracking, class schedule, and assessment deadline manager  ║
║  ☀️  Weather-aware planning via Open-Meteo / Google Weather          ║
║  🗺  Basic campus map: Leaflet + Google Maps Embed, building search  ║
║  🔐  WebAuthn passkeys, TOTP MFA, RLS, CSRF, edge rate limiting      ║
║  🌍  35 locale dictionaries · RTL layout support                     ║
║  🎮  XP and streak tracking (leaderboard/achievements: backend only) ║
║  🔔  Push + in-app notifications (email reminders: not yet wired)    ║
║  ⚡  GitHub Actions CI · 878 Vitest tests · Vercel deployment        ║
╚══════════════════════════════════════════════════════════════════════╝
```

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## 🏗️ Technical Architecture Overview

### Runtime Stack

| Layer               | Technology                                                           |
| ------------------- | -------------------------------------------------------------------- |
| **Framework**       | Next.js 16 (App Router), `proxy.ts` edge middleware                  |
| **UI**              | React 19, Tailwind CSS 4, Radix UI primitives, Framer Motion         |
| **State**           | Zustand (persisted stores), TanStack Query                           |
| **Database & Auth** | Supabase PostgreSQL with Row-Level Security, Supabase Auth           |
| **Infrastructure**  | Vercel (Edge Middleware, Serverless Functions)                       |
| **Rate Limiting**   | Upstash Redis, fail-closed on security-critical routes in production |
| **Error Tracking**  | Sentry (client, server, edge configs)                                |
| **Testing**         | Vitest + Testing Library, 94 test files / 878 tests                  |

### Key Architectural Decisions

- **Edge-First Security Middleware:** All routing passes through `proxy.ts` (Next.js 16's replacement for `middleware.ts`). Auth state, email verification gates, CSRF checks, and rate limiting are enforced here.
- **Fail-Closed Rate Limiting:** `lib/services/rateLimitService.ts` denies requests to security-critical endpoints (login, signup, password reset) if the Upstash store is unavailable in production, rather than silently allowing traffic through.
- **Proxy Auth Gate:** `/api/*` routes require authentication by default — new endpoints are secure unless explicitly opted out.
- **Single-Provider-Per-Account:** A user who signs up with email/password can't sign in with Google on the same account, even if Supabase auto-links identities — enforced via `lib/auth/providerGuard.ts`.

> **Deep Dive:** [Technical Explanation](./TECHNICAL_EXPLANATION.md) | [Architecture Reference](./docs/architecture/ARCHITECTURE.md)

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## 🔒 Security-Focused Architecture

- **Authentication:** WebAuthn passkeys (`@simplewebauthn`), TOTP-based MFA with backup codes, audited session termination.
- **Authorisation:** PostgreSQL Row-Level Security enforced across Supabase tables.
- **Transport & Policy:** Strict Content Security Policy, CSRF token verification (`lib/security/csrf.ts`), HTTPS-enforced deployment.
- **Rate Limiting:** Upstash Redis-backed, fail-closed on auth-critical routes.
- **Audit Logging:** Structured logging for sensitive auth/session operations (`lib/security/audit.ts`).
- **Secret Scanning:** Custom `check:secrets` script runs in CI before every merge.

Accessibility is treated as a linting concern, not a certified standard: the codebase uses `eslint-plugin-jsx-a11y` and supports RTL layouts across 35 locales, but there is no formal WCAG audit in this repo — don't take that as a compliance claim.

> **For Security Reviewers:** [Security Posture Report](./docs/security/SECURITY_POSTURE.md) | [Security Evidence Index](./docs/security/SECURITY_EVIDENCE_INDEX.md)

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## 🎯 Project Governance

### License

Released under the **MIT License**.

### Roadmap (not yet built)

- **Syllabus extraction pipeline:** Parsing syllabus PDFs into structured deadlines (OCR/LLM) — planned, no code exists yet.
- **Email reminder delivery:** Settings toggles exist and persist, but no cron job dispatches reminder emails yet (push and in-app notifications are fully wired).
- **Gamification UI:** A `mv_xp_leaderboard` materialized view exists in the database, but there is no leaderboard or achievements UI surfaced to users yet.
- **MQ Navigation integration:** [MQ Navigation](https://github.com/mrpouyaalavi/MQ_Navigation) is a separate, unpublished mobile wayfinding prototype. Syllabus Sync links out to its repo — there's no in-app deep link or advanced routing integration.
- Reference dataset support for additional universities (USYD, UNSW).
- Federated identity via institution SSO (SAML/OIDC) — aspirational, not scheduled.

### Maintainers

| Name               | Role                                           |
| ------------------ | ---------------------------------------------- |
| Pouya Alavi Naeini | Lead maintainer — architecture, infrastructure |
| Raouf Abedini      | Co-maintainer — security, backend              |

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Repository Layout

```text
app/                Next.js routes, layouts, 65 API route handlers
components/         Shared UI and layout components
config/             ESLint, Next, Prettier, Sentry, Tailwind, TS, Vitest, Lighthouse
data/               Static academic data (unit catalogue, building maps)
docs/               Architecture, operations, API, policy, security, reference docs
features/           Feature-first client modules (home, calendar, map, settings, auth, gamification)
infra/              Docker assets
lib/                Stores, hooks, services, security, utilities, Supabase clients
locales/            35 locale dictionaries
public/             Static assets, icons, map tiles, overlays, service worker
supabase/           Migration history and configuration
tests/              Vitest test suites (94 files, 878 tests)
tools/              Repo utilities (i18n checks, secret scanning, exports)
```

> **Full Inventory:** [Repository Inventory](./docs/reference/REPOSITORY_INVENTORY.md)

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Quick Start

### Prerequisites

- Node.js `>=22 <23`
- npm `>=10`
- A Supabase project (required for auth and data — the app doesn't run meaningfully without one)
- An Upstash Redis instance (optional locally — rate limiting falls back to in-memory outside production)

### Setup

```bash
# Clone and install
git clone https://github.com/mrpouyaalavi/syllabus-sync.git
cd syllabus-sync
npm install

# Configure environment
cp .env.example .env.local
# Fill in Supabase URL/keys at minimum — see Environment Variables below

# Start development
npm run dev
```

If you want your local database schema to match the app, link and push Supabase migrations:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Quality Assurance

```bash
npm run check
# Runs: secrets scan → format check → typecheck → lint → tests → build
```

Individual steps are also available: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Environment Variables

See [`.env.example`](./.env.example) for the full list. Key groups:

| Variable                                                     | Required                  | Purpose                                                                                                       |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes                       | Supabase client config                                                                                        |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | Yes (server)              | Server-side Supabase access                                                                                   |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN`                         | Yes                       | Passkey registration/auth — must match your domain                                                            |
| `VERIFICATION_EMAIL_FROM` / Resend key                       | Yes                       | Auth/verification emails via Resend                                                                           |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`        | Recommended in production | Distributed rate limiting; falls back to in-memory (fail-closed on critical routes) if unset                  |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`                            | Optional                  | Enables the Google Maps embed view on `/map`                                                                  |
| `SENTRY_*`                                                   | Optional                  | Error tracking                                                                                                |
| `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`                             | Prod only                 | Shares the Supabase session across `*.syllabus-sync.app` subdomains (applied only when `NODE_ENV=production`) |
| `NEXT_PUBLIC_TRUSTED_ORIGINS` / `NEXT_PUBLIC_SYLLA_URL`      | Optional                  | Sylla companion app: explicit CSRF + redirect allowlist, and the sidebar entry point                          |

Full setup notes: [Environment Setup](./docs/operations/ENVIRONMENT_SETUP.md).

> **Ecosystem note:** Syllabus Sync can share its Supabase login with the sibling
> [Sylla](https://sylla.syllabus-sync.app) study-assistant app via a parent-domain
> auth cookie and an explicit trusted-origin allowlist (no open redirects). See the
> [Sylla Shared Authentication](./docs/operations/deployment-checklist.md#8-sylla-shared-authentication-ecosystem)
> section of the deployment checklist. Sylla itself is a separate application.

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Documentation Map

| Document              | Path                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| Architecture          | [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)             |
| Technical Explanation | [TECHNICAL_EXPLANATION.md](./TECHNICAL_EXPLANATION.md)                               |
| API Reference         | [docs/api/API_REFERENCE.md](./docs/api/API_REFERENCE.md)                             |
| Environment Setup     | [docs/operations/ENVIRONMENT_SETUP.md](./docs/operations/ENVIRONMENT_SETUP.md)       |
| Deployment Checklist  | [docs/operations/deployment-checklist.md](./docs/operations/deployment-checklist.md) |
| Docs Index            | [docs/README.md](./docs/README.md)                                                   |
| Security Policy       | [SECURITY.md](./SECURITY.md)                                                         |
| Contributing          | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                 |

<br/>

<img src="https://capsule-render.vercel.app/api?type=rect&color=0:0f172a,30:6366f1,60:22c55e,100:0f172a&height=2" width="100%"/>

<br/>

## Acknowledgements

- [Supabase](https://supabase.com/) — Open-source backend with RLS.
- [Vercel](https://vercel.com/) — Deployment infrastructure.

<br/>

<div align="center">

### `> ping --authors`

```text
> Authors    : Pouya Alavi Naeini — Software Engineer | Mohammad Raouf Abedini — Back-End Developer
> University : Macquarie University, Sydney, NSW
> Status     : [●] ONLINE — open to grad & junior opportunities
```

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-6366f1?style=for-the-badge&logo=linkedin&logoColor=ffffff&labelColor=0f172a)](https://www.linkedin.com/in/pouya-alavi/)
[![GitHub](https://img.shields.io/badge/GitHub-Follow-22c55e?style=for-the-badge&logo=github&logoColor=ffffff&labelColor=0f172a)](https://github.com/mrpouyaalavi)
[![Email](https://img.shields.io/badge/Email-Contact-f59e0b?style=for-the-badge&logo=gmail&logoColor=09090b&labelColor=0f172a)](mailto:pouya@pouyaalavi.dev)

<br/>

_Syllabus Sync is an independent open-source project and is not officially affiliated with Macquarie University._

</div>
