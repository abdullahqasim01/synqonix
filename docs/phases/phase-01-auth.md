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
