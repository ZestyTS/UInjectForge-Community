# Public report intake

This is the framework-independent request handler and its schema/migration/tests
for the UIF public intake service. It is NOT hosted by GitHub Pages. The deployed
Sites project wraps `handle(request, env)` in a dynamic API route, and separately
hosts owner-only review and receipt-status pages. Its Vinext starter source is
kept in the same Site's source repository.

Required runtime bindings, configured outside source:

- `DB`: provisioned Cloudflare D1 database, migrations applied before deployment.
- `INTAKE_SECRET`: random server-side signing/rate-limit secret.
- `MODERATOR_EMAIL`: explicitly allowed reviewer account. Hosting supplies and
  protects `oai-authenticated-user-*` identity headers. Never deploy this handler
  behind a proxy that lets visitors forge those headers.

`GET /api/challenge`, `POST /api/submissions` (consent, report, honeypot, signed
challenge, proof), `GET /api/reports?after=receipt` (100 approved reports/page),
`GET /api/receipts/receipt` (status only), and owner-only `GET/POST /api/moderation`.
All writes require the expected Origin. Anonymous receipt IDs are unpredictable;
pending report contents and identities are never exposed by receipt endpoints.
Network rate identifiers are keyed hashes, never stored raw addresses. Global
limits still apply when no trusted network address is provided.

Only compatibility JSON is accepted. No binary uploads, GitHub token, or app
support bundles. Moderation is a metadata/privacy review, not reproduction.

Run with Node 22.13+:

```
node --test service/tests/intake.test.mjs
```

The tests use an isolated in-memory SQLite database and authored fixtures only.
Keep `service/registry.mjs` byte-identical to `site/registry.mjs`. Do not alter
applied migrations; append a generated migration for future schema changes.
