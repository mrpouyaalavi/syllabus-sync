# Production Deployment Runbook

> **Audience:** Engineers performing production releases of Syllabus Sync.
> **Last verified:** 2026-03-21

This runbook covers every step required to ship a release safely, verify it in production, and roll back if something goes wrong. Follow each section in order.

---

## Prerequisites

Before starting a release, confirm the following:

- You have write access to the `main` branch and the Vercel project.
- The Supabase CLI is installed and linked to the production project (`npx supabase link`).
- You have access to the Vercel Dashboard, Sentry Dashboard, and Supabase Dashboard.
- You are working from a clean `main` branch with all changes merged.

---

## 1. Environment Variable Audit

Open the Vercel project settings and confirm that every required variable is present for the **production** environment. Missing or stale values are the most common cause of post-deploy incidents.

| Category          | Variables                                                                                    | Notes                                                                                                                                                                                                                                         |
| :---------------- | :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database          | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`     | Service role key is server-side only.                                                                                                                                                                                                         |
| Auth Cookies      | `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN`                                                             | Set to `.syllabus-sync.app` in production so the Supabase session cookie is shared across subdomains (e.g. `www.syllabus-sync.app` and `sylla.syllabus-sync.app`). Leave unset in preview/local — see `lib/supabase/cookie-options.ts`.       |
| Sylla (ecosystem) | `NEXT_PUBLIC_TRUSTED_ORIGINS`, `NEXT_PUBLIC_SYLLA_URL`                                       | Optional. `NEXT_PUBLIC_TRUSTED_ORIGINS` (comma-separated, no wildcards) allowlists Sylla for CSRF + post-login redirect; `NEXT_PUBLIC_SYLLA_URL` enables the sidebar link. See [Sylla Shared Auth](#8-sylla-shared-authentication-ecosystem). |
| Rate Limiting     | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` | KV variables required by the production env check script.                                                                                                                                                                                     |
| Email             | `RESEND_API_KEY`, `VERIFICATION_EMAIL_FROM`, `VERIFICATION_EMAIL_NAME`                       | Sender must be a verified domain in production.                                                                                                                                                                                               |
| Maps              | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`, `GOOGLE_ROUTES_API_KEY`      | See the [Google Maps Platform Setup](./google-maps-platform-setup.md).                                                                                                                                                                        |
| Security          | `CRON_SECRET` (min 32 chars), `NEXT_PUBLIC_APP_URL`, `CSRF_VALIDATION_ENABLED`               | Generate CRON_SECRET with `openssl rand -hex 32`.                                                                                                                                                                                             |
| WebAuthn          | `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`                                                          | Must match your production domain.                                                                                                                                                                                                            |
| Push              | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                         | Generate once with `npx web-push generate-vapid-keys`.                                                                                                                                                                                        |
| Observability     | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`                | DSN must be active for the production environment.                                                                                                                                                                                            |

You can also validate variable names programmatically:

```bash
VERCEL_ENVIRONMENT=production npm run vercel:env:check
```

Refer to the [Environment Setup Guide](../setup/ENVIRONMENT_SETUP.md) for full variable specifications.

---

## 2. Database Migrations

Database schema changes are managed as timestamped, immutable SQL migration files in `supabase/migrations/`.

**Step 1 -- Review pending migrations:**

```bash
ls -lt supabase/migrations/ | head -20
```

Read through any migration files that have not yet been applied to production. Confirm that they are safe, idempotent, and do not drop data without a backup plan.

**Step 2 -- Apply migrations:**

```bash
npx supabase db push
```

**Step 3 -- Verify in the Supabase Dashboard:**

Open the SQL Editor or Table Editor and confirm that the expected tables, columns, RLS policies, and functions are present.

> **Warning:** The file `docs/database/database-schema.sql` is a reference snapshot only. Never use it to apply schema changes in production. The migration chain in `supabase/migrations/` is the single source of truth.

---

## 3. Quality Gate

Every production release must pass the full local integrity check before deployment. This runs secrets scanning, formatting checks, TypeScript compilation, ESLint, the Vitest test suite, and a production build.

```bash
npm run check
```

**All of the following must be true before proceeding:**

- [ ] Zero ESLint errors or warnings
- [ ] Zero TypeScript compilation errors
- [ ] All Vitest unit and integration tests pass (500+ tests)
- [ ] Next.js production build completes without errors
- [ ] No secrets detected in source files

If any check fails, fix the issue and re-run `npm run check` before continuing.

---

## 4. Deploy to Production

Syllabus Sync uses Vercel's immutable deployment model. Each deployment is an atomic snapshot that can be rolled back to instantly.

**Option A -- Git-triggered deploy (recommended):**

Push to the `main` branch. Vercel will build and deploy automatically.

```bash
git push origin main
```

**Option B -- CLI deploy:**

```bash
npx vercel --prod
```

Monitor the build in the Vercel Dashboard. Watch for:

- Build errors in the Vercel build log
- Source map upload failures in the Sentry release
- Function size warnings

---

## 5. Post-Deployment Smoke Tests

Run these checks against the live production URL immediately after the deployment completes.

### 5.1 Health Check

```bash
curl -s -o /dev/null -w "%{http_code}" https://your-production-domain.vercel.app/api/health
# Expected: 200
```

### 5.2 Security Headers

```bash
curl -sI https://your-production-domain.vercel.app | grep -iE "content-security-policy|strict-transport-security|x-frame-options|x-content-type-options"
```

Confirm that `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, and `X-Content-Type-Options` headers are all present.

### 5.3 Authentication Cycle

1. Open the production URL in an incognito browser window.
2. Sign up with a new test account (or use an existing test account).
3. Complete MFA enrollment if enabled.
4. Log out.
5. Log back in and confirm session is established.

### 5.4 Core Route Verification

Navigate to each of the following routes and confirm they render without client-side errors (check the browser console):

- `/home`
- `/calendar`
- `/map` (both raster and Google modes)
- `/feed`

### 5.5 Cron Endpoint Validation

Confirm that cron-protected endpoints reject unauthenticated requests:

```bash
curl -s -o /dev/null -w "%{http_code}" https://your-production-domain.vercel.app/api/auth/email/cleanup
# Expected: 401 (no Bearer token provided)
```

---

## 6. Monitoring Verification

After deployment, confirm that observability systems are receiving data:

- [ ] **Sentry:** New release appears in the Sentry Releases page. No new unhandled exceptions in the first 15 minutes.
- [ ] **Vercel Analytics:** Function invocations and Web Vitals data are flowing.
- [ ] **Supabase Dashboard:** Database connections are healthy. No unexpected spikes in query latency.

---

## 7. Rollback Procedure

If a critical regression is detected after deployment:

### Immediate Rollback (< 2 minutes)

1. Open the Vercel Dashboard and navigate to the **Deployments** tab.
2. Find the previous known-stable deployment (the one immediately before the current release).
3. Click the three-dot menu and select **Promote to Production**.
4. Vercel shifts traffic instantly -- no rebuild required.

### Database Rollback

If the regression was caused by a database migration:

1. Write and test a compensating migration that reverses the problematic changes.
2. Apply it with `npx supabase db push`.
3. Never manually edit production tables through the Supabase Dashboard without a documented reason.

### Post-Incident

1. Review the `audit_logs` table and Sentry error stream to identify the root cause.
2. Document the incident, root cause, and remediation steps.
3. If the fix is ready, go back to Step 3 (Quality Gate) and re-deploy.

---

## 8. Sylla Shared Authentication (Ecosystem)

Sylla (`https://sylla.syllabus-sync.app`) is a sibling app that shares Syllabus
Sync's Supabase session. Complete these steps only for deployments where Sylla is
live. All are additive and safe to skip in single-app or preview environments.

**Prerequisites**

- Sylla and Syllabus Sync point at the **same Supabase project**.
- Both apps serve from subdomains of the same parent domain (`syllabus-sync.app`).

**Vercel environment variables (production)**

| Variable                         | Value                                                                                     | Purpose                                                                 |
| :------------------------------- | :---------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` | `.syllabus-sync.app`                                                                      | Shares the Supabase session cookie across subdomains (production only). |
| `NEXT_PUBLIC_TRUSTED_ORIGINS`    | `https://sylla.syllabus-sync.app,https://syllabus-sync.app,https://www.syllabus-sync.app` | Explicit CSRF + redirect allowlist. No wildcards.                       |
| `NEXT_PUBLIC_SYLLA_URL`          | `https://sylla.syllabus-sync.app`                                                         | Enables the "Sylla AI Study Assistant" sidebar link.                    |

**Supabase Auth configuration**

In the Supabase dashboard → Authentication → URL Configuration, add both apps'
callback URLs to **Redirect URLs** so OAuth/email links resolve from either origin:

```text
https://www.syllabus-sync.app/auth/callback
https://syllabus-sync.app/auth/callback
https://sylla.syllabus-sync.app/auth/callback   # if Sylla runs its own auth callback
```

**Verification**

1. Sign in on `www.syllabus-sync.app`, then open `sylla.syllabus-sync.app` — the
   session should be recognised without a second login.
2. From a signed-out state, hit `https://www.syllabus-sync.app/login?redirectTo=https://sylla.syllabus-sync.app/`.
   After login you should be returned to Sylla. A `redirectTo` pointing at any
   origin **not** in `NEXT_PUBLIC_TRUSTED_ORIGINS` must fall back to `/home`.
3. Confirm the sidebar shows the Sylla link (only when `NEXT_PUBLIC_SYLLA_URL` is set).

> **Note:** Sylla-side cookie/session configuration is handled in the Sylla repo.
> This checklist only covers the Syllabus Sync side of the integration.

---

## Quick Reference

```text
Pre-deploy:   npm run check              # Must pass cleanly
Deploy:       npx vercel --prod           # Or push to main
Smoke test:   curl /api/health            # Must return 200
Rollback:     Vercel Dashboard > Promote previous deployment
Migrations:   npx supabase db push        # Apply pending SQL
Env check:    VERCEL_ENVIRONMENT=production npm run vercel:env:check
```
