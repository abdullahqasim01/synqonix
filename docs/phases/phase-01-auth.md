# Phase 1 – Auth & Accounts

**Goal:** secure JWT auth for web and the extension; transactional email through Resend.

## Data model
`User`, `RefreshToken` (hashed, rotated), `EmailVerificationToken`, `PasswordResetToken`, `ApiToken` (hashed, scoped, last-used), `Session` metadata (device, IP).

## API
- Register, login, logout, refresh (rotation + reuse detection), me.
- Email verification and resend; forgot/reset password.
- Change password/email; delete account.
- Personal API tokens (create, list, revoke) – used by the VS Code extension.
- Argon2 password hashing, account lockout / rate limiting on auth routes.
- Guards: `JwtAuthGuard`, optional API-token guard, `@CurrentUser()`.
- OAuth sign-in with GitHub (optional, ties into Phase 7).

## Email (Resend)
- Mail module with provider abstraction (Resend in prod, SMTP/Mailpit in dev).
- Templates: verify email, reset password, workspace invite (used in Phase 2).

## Web
- Login, register, verify, forgot/reset pages; auth context; protected routes; refresh handling; profile and security settings (sessions, API tokens).

## Acceptance
- Full register → verify → login → refresh → logout flow covered by e2e tests.
- Refresh token reuse revokes the session family.
- Extension can authenticate with a personal API token.

## Status: done (GitHub OAuth sign-in deferred to phase 7)

Implementation notes:
- **Tokens:** access JWT (15 min) + refresh JWT (30 days) stored hashed per session. Refresh rotates on every use; presenting a used token revokes the whole session.
- **Web storage (decision: localStorage, Firebase-style):** the web app keeps both tokens in `localStorage` (`sx_auth`), so sessions survive reloads and sync across tabs. Trade-off: any XSS can read them, so the web app must avoid unsafe HTML rendering and get a strict CSP (tracked in phase 11). Refresh is serialized across tabs with the Web Locks API and de-duplicated, because rotation + reuse detection would otherwise sign a user out when two tabs refresh at once. Page loads validate the session with `GET /users/me` (refreshing only if the access token expired); transient network/5xx/429 errors keep the session and show a retry screen, only a rejected refresh token signs the user out. The API still sets an optional httpOnly `sx_refresh` cookie, which the web app does not use.
- **Sessions:** every login is a `Session`; the access-token guard checks it is not revoked, so logout, password reset/change and session revocation take effect immediately.
- **API tokens:** `sqx_…` bearer tokens, hashed at rest, shown once, revocable. They authenticate normal routes but cannot manage sessions, tokens, passwords or delete the account (`@RequiresSession()`).
- **Email:** `MailService` sends via Resend when `RESEND_API_KEY` is set, otherwise SMTP (Mailpit in dev). Delivery failures are logged, never fail the request. Verification links last 24 h, reset links 1 h; newest link of each type wins.
- **Hardening:** argon2id, equalised login timing, no email enumeration on forgot-password, per-route rate limits on auth endpoints (429).
- Email verification is not yet enforced for login; later phases can gate actions on `emailVerified`.
- **Tests:** 14 API e2e tests (flows, rotation/reuse, reset, sessions, API tokens, throttling) plus unit tests; web unit tests; verified in a real browser (register → reload → token → sign out → login).
