# Production Hardening Design

Date: 2026-07-16

## Scope

The review covers the Cloudflare Worker runtime, Better Auth, generic OAuth, Cloudflare DNS, D1 persistence, browser assets, migrations, and the GitHub Actions deployment path.

## Security Model

- Authentication configuration fails closed when the secret or public origin is unsafe.
- Sensitive provider and mail credentials are encrypted with a dedicated data-encryption key and support bounded key rotation.
- Every app-owned state-changing endpoint requires same-origin and CSRF validation.
- OAuth endpoints require HTTPS and an explicit host allowlist; discovery and runtime requests have redirect, timeout, retry, and body-size boundaries.
- Verification throttles use atomic D1 updates and hashed subjects so raw email addresses and IPs are not stored in bucket keys.

## Consistency Model

Cloudflare DNS and D1 cannot participate in one distributed transaction. DNS records therefore persist explicit creating, updating, active, or error state so interrupted work can be retried. User deletion uses a leased, bounded D1 job and only removes the user after all remote DNS records are reconciled.

## Browser Boundary

The Worker emits a strict self-only Content Security Policy, anti-framing and MIME-sniffing headers, HTTPS HSTS, and no-store headers for APIs. Static scripts avoid inline event handlers and escape untrusted data before HTML insertion.

## Deployment Model

Migrations applied in the deployment path must be backward-compatible. CI pins third-party actions, validates production secrets and OAuth host patterns, then runs build, tests, TypeScript, migration validation, and Wrangler dry-run before applying migrations and deploying the Worker.

## Residual Risk

DNS/D1 convergence and deletion jobs still require operational monitoring. Production also depends on least-privilege Cloudflare tokens, correct host allowlists, D1 recovery readiness, post-deploy smoke tests, and the key-rotation procedure in `docs/production-runbook.md`.
