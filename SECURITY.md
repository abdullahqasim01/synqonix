# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub's *Security → Report a vulnerability* on this repository (private vulnerability reporting). Include what you found, how to reproduce it, and the impact you expect.

We aim to acknowledge reports within a few days and to fix confirmed issues promptly. Please give us reasonable time to release a fix before disclosing details.

## Supported versions

Synqonix has no stable releases yet; fixes land on `main`.

## What is in place

Authorization checks on every route (covered by an automated route matrix), nonce-based Content-Security-Policy on the web app, rate limiting, HMAC-signed webhooks with SSRF protection for outbound ones, private S3 buckets accessed only through short-lived presigned links, production secret checks at boot, and dependency audit and secret scanning in CI.

## Known limitations

- **GitHub App installation:** the install redirect trusts a signed state plus an installation id from the query string and does not yet verify the user with GitHub OAuth. On a shared instance, someone who knows a not-yet-connected installation id could attach it to their own workspace. Until this is fixed, do not rely on the integration for sensitive repositories on instances with untrusted users.
- Access tokens are stored in the browser's `localStorage` (the strict CSP is the mitigation); the refresh token is also returned to non-browser clients.
- Running more than one API instance is not supported (realtime and schedulers assume one process).
