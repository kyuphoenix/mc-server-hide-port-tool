# Production Hardening Plan

Date: 2026-07-16

1. Establish the baseline with tests, TypeScript, build, migration validation, and Wrangler dry-run.
2. Harden authentication configuration, OAuth account linking, session-sensitive operations, and random token generation.
3. Replace process-local throttling with atomic D1 rate limits and add global verification-failure buckets.
4. Validate OAuth discovery and runtime endpoints, then enforce HTTPS, host allowlists, timeouts, response limits, and redirect policy.
5. Make Cloudflare DNS mutations and user deletion recoverable when a Worker request is interrupted.
6. Add CSRF protection, strict browser security headers, a self-hosted stylesheet, output escaping, and secret redaction.
7. Add backward-compatible production migrations and validate deployment inputs and pinned GitHub Actions.
8. Run the complete production gate and document deployment, rollback, recovery, monitoring, and key rotation.
