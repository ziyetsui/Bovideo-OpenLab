# Bovideo OpenLab

Bovideo OpenLab contains three deliberately separate release paths:

- **Preview Beta (PVB)** is a public-readable Cloudflare Pages static preview. It is synthetic/first-party only, permanently `noindex`, and not a production, SEO Beta, production-like soak, or Phase 1 authorization.
- **Phase 1 validation** runs Payload Admin/API as a Node Web Service on Render Free and uses Neon Free PostgreSQL. It is synthetic, bounded, and US$0 for semantic verification only.
- **Production** targets a paid Render Node Web Service plus paid Render PostgreSQL in one region. Cloudflare remains the publication/read plane. The former Worker/D1 path is retained only as historical Phase-0 evidence.

## What is included

- Payload collections for sources, prompts, taxonomy, page records, locale variants, graph edges, and audit events.
- A 16-locale contract: `en`, `zh-CN`, `zh-TW`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `it-IT`, `es-ES`, `es-419`, `pt-BR`, `pt-PT`, `hi-IN`, `th-TH`, `tr-TR`, and `vi-VN`.
- PostgreSQL-backed Payload Admin/API with a bounded connection pool and schema push disabled by default.
- Historical D1 migrations and a local Phase-0 round-trip harness, isolated from the active configuration.
- A remote Preview acceptance test covering login, create, edit, review, approve, publish, withdraw, and 16 locale fixtures.
- Synthetic multilingual example content under `resources/examples/`.

## What is intentionally excluded

- Cloudflare account IDs, D1 IDs, R2 credentials, API tokens, and Payload secrets.
- Real UGC, scraped records, RapidAPI responses, customer data, and copyrighted media.
- Production routes, production Sitemap submission, Google Indexing API submission, and the `ancher.space` root-domain cutover.

## Local development

Requirements: Node.js 24.19.0 and pnpm 11.19.0 (the exact versions pinned for Render validation).

```bash
pnpm install
cp .env.example .env
# Set a random PAYLOAD_SECRET and a local PostgreSQL DATABASE_URL. Never commit them.
pnpm dev
```

For a disposable zero-configuration local database, run `pnpm dev:local`. It starts an isolated embedded PostgreSQL cluster, pushes the Payload schema only into that cluster, and deletes the database on exit. Use it for UI/Admin development; do not expect editorial data to survive a restart.

For a persistent operator-managed PostgreSQL database, set `PAYLOAD_SECRET` and `DATABASE_URL`, then run `pnpm dev`. This path never enables schema push implicitly.

For a persistent zero-configuration localhost database, run `pnpm dev:persistent`. It creates an owner-private, gitignored `.payload-local/` cluster and private raw-evidence store, applies only the reviewed migration ledger, and preserves data across restarts. Do not delete that directory unless you intentionally want to erase the local Payload data.

### Local asset import

The persistent profile imports a validated snapshot directly into `sources`, draft `prompt-artifacts`, private `media-evidence`, and the immutable `workflow-runs` ledger. It does not make third-party X media public or fabricate released page projections.

```bash
# Validate without writing.
pnpm payload:local:import -- --snapshot /absolute/path/to/snapshot --dry-run

# Apply, then safely repeat: unchanged facts are skipped.
pnpm payload:local:import -- --snapshot /absolute/path/to/snapshot
```

To ingest the complete approved assets root in its safe order, use the root
command rather than importing its child folders by hand. It rejects unexpected
root entries before writing, imports the canonical Twitter241 snapshot before
the historical public-search snapshot, archives the deterministic derived
media index only as private evidence, and explicitly ignores `.DS_Store`.

```bash
pnpm payload:local:import:assets -- \
  --assets-root '/absolute/path/to/assets' --dry-run

pnpm payload:local:import:assets -- \
  --assets-root '/absolute/path/to/assets'
```

For a long-lived managed PostgreSQL database, use the managed commands below.
They validate all required credentials, force `PAYLOAD_DB_PUSH` off, apply the
reviewed Payload migration ledger, and only then begin a write. A failed
migration never reaches an importer or collector. This is the intended command
surface for an API-key collector or scheduler:

```bash
DATABASE_URL='postgres://…' PAYLOAD_SECRET='…' \
RAW_EVIDENCE_STORE_DIR='/private/pseo-evidence' \
RAW_EVIDENCE_SIGNER_SECRET='…' \
pnpm payload:managed:import:assets -- \
  --assets-root '/absolute/path/to/assets'
```

Use `pnpm payload:migrate` to apply only the reviewed migration ledger without
ingesting data. The lower-level `payload:import` and `payload:import:assets`
commands remain available for controlled tooling that has already completed
this migration gate; operators should use the `payload:managed:*` commands.

### API-key collection → Payload

The online collection path has the same immutable boundary: Twitter241 first
writes a local, manifest-verified snapshot; only a successful collection is
then passed to the regular Payload importer. Store the RapidAPI key in a
regular credential file whose permissions are `0600` or stricter; never put it
in a command line, source file, or Payload record. The existing collector is
`scripts/fetch_higgsfield_twitter241.py`; set `TWITTER241_COLLECTOR_SCRIPT`
only if an operator deliberately keeps that collector elsewhere.

```bash
chmod 600 /private/twitter241.env
DATABASE_URL='postgres://…' PAYLOAD_SECRET='…' \
RAW_EVIDENCE_STORE_DIR='/private/pseo-evidence' \
RAW_EVIDENCE_SIGNER_SECRET='…' \
TWITTER241_CREDENTIAL_FILE='/private/twitter241.env' \
pnpm payload:managed:collect:twitter241
```

The collection command writes snapshots under the gitignored
`.payload-local/snapshots/` directory by default. It does not start a Payload
import if collection fails, and its output intentionally contains neither the
credential nor HTTP headers.

The Twitter241 snapshot is manifest-hash-verified. The historical public-search snapshot has no published output hashes, so the importer records a computed observed-input fingerprint instead. Both imports retain all regular snapshot files as private content-addressed evidence, so retaining the source folder is no longer required for database evidence (though keeping an offline backup remains sensible). Source ingestion alone does not fill the public pSEO routes: modules, graph review, PageProjection materialization, and active-publication binding remain a separate controlled pipeline stage.

Check process health at `/healthz`, database readiness at `/readyz`, and Payload Admin at `/admin`.

## Phase 1 validation deployment

`render.yaml` declares exactly one free Render Node Web Service with `/readyz` as its database-backed health check. It leaves `DATABASE_URL` for the operator to supply, pins Node/pnpm, disables auto-deploy, and never provisions a database. `P1V_RUNTIME=true` makes the outer request proxy return 404 for every public path except `/healthz` and `/readyz`, including Admin, REST, GraphQL, root and Next static assets. Use a direct (non-`-pooler`) Neon Free connection string with `sslmode=require`; do not connect the Blueprint until the reviewed PostgreSQL migration from P1-T03 exists.

After that migration is applied, run the bounded synthetic transaction gate from the Render service shell:

```bash
P1V_TARGET=render-free-neon-free-synthetic pnpm run test:phase1:access:payload:p1v
```

The command rejects non-Render execution, non-Neon or pooled database URLs, missing TLS mode, and schema push. A local pass does not satisfy this remote gate.

## Verification

```bash
pnpm run lint
pnpm run test:int
pnpm run test:phase1:access
pnpm run test:phase1:access:payload
pnpm run build
pnpm run test:e2e
```

`test:phase1:access:payload` starts an ephemeral real PostgreSQL server and proves that a failed immutable audit insert rolls back its source mutation. The historical D1 round-trip harness remains local-only and refuses remote bindings:

```bash
pnpm exec tsx scripts/p0-real-d1-roundtrip.ts
```

## Preview Beta: public static Pages preview

PVB is generated from committed synthetic/first-party fixtures into an ignored deterministic static tree. The public Pages site has no Payload Admin, API, GraphQL endpoint, Worker, Pages Function, binding, secret, resource ID, route, or custom domain. `robots.txt`, `_headers`, and all 480 HTML pages deny indexing.

PVB self-hosts the exact `outfit-latin-wght-normal.woff2` variable font from the pinned `@fontsource-variable/outfit@5.3.0` package. The static build copies that file plus `assets/OUTFIT-OFL-1.1.txt` (the package's unmodified SIL Open Font License 1.1 notice) into the generated tree. Its source SHA-256 is `6c18d579fd87c3776be068b762cbc83fde3acb543d49eabd3ade842eb987e887`; the copied license SHA-256 is `0e5fcef5d93bfcae273c11c00f0bb453d3b5491860e1ac8b658767b7577c938f`. The CSS declares local Outfit with a `100 900` weight range, satisfying the 400, 500, 700, and 900 UI weights without any font network request. The asset is supplied under OFL-1.1 and stays accompanied by its attribution/license text in each Pages output tree.

### Live Preview Beta

The stable preview-branch alias is [preview-beta.bovideo-openlab-preview.pages.dev](https://preview-beta.bovideo-openlab-preview.pages.dev). It serves synthetic/first-party demonstration content only, is permanently `noindex`, and is not production or an SEO release. The link can be unavailable until the Pages Direct Upload in Task 5 has completed.

Its flow is one-way: the clean `preview-beta` Git commit versions the generator and input fixtures, produces `static-preview/dist`, and that tree is Direct Uploaded to the Pages project `bovideo-openlab-preview`. Pages never writes back to Payload or Git. Build and verify the baseline tree first, then publish it with:

```bash
pnpm run preview:static:verify
pnpm run deploy:pvb:pages
```

`deploy:pvb:pages` reads the current Git status, branch, and HEAD SHA; reads the Pages config and generated manifest; rejects anything except a clean `preview-beta` worktree whose exact lower-case 40-hex manifest SHA matches HEAD. It also requires the stored `origin` URL to be exactly `https://github.com/ziyetsui/Bovideo-OpenLab.git`, then performs a read-only literal-URL `git ls-remote --heads` proof from a non-repository temporary directory with system, global, XDG, local, and inherited Git configuration rewrites disabled and `GIT_CEILING_DIRECTORIES` pinned to that isolated directory. Exactly one lower-case 40-hex `refs/heads/preview-beta` SHA must equal HEAD. Any existing generated tree is fully verified, then the command immediately rebuilds and fully verifies the only tree that can reach the sole pinned Pages Direct Upload spawn.

The local PVB checks do not publish anything:

```bash
pnpm run preview:static:verify
pnpm run test:pvb:browser
```

The `detail-020` withdrawal drill uses the same full 30-record fixture, changing only that record's `publicationState` to `withdrawn`. It emits and publishes 464 routes; the baseline deployment command then restores the byte-identical 480-route tree:

```bash
pnpm run preview:static:verify:withdrawn
pnpm run deploy:pvb:pages:withdrawn
pnpm run deploy:pvb:pages
```

The browser acceptance runs only against a local static server, checks all manifest pages for `noindex`, verifies internal links and assets, true 404s for non-public endpoints, responsive samples, and serious/critical accessibility violations. Its screenshots stay in ignored local evidence output.

## Historical Paid Workers/R2 Phase 0 deployment

This section records the superseded private Phase-0 engineering path. It is not the active Phase 1 or production deployment target. Every former `deploy` / `deploy:preview:*` command now fails closed with the D11 retirement decision, so it cannot accidentally load the active PostgreSQL config or mutate old D1/R2 resources. Only the explicitly named local historical round-trip command above remains supported for evidence replay.

## Security and publishing boundary

- Never commit `.env`, `.env.*`, `.dev.vars*`, `wrangler.preview.jsonc`, Playwright artifacts, or generated Cloudflare state.
- PVB Direct Upload targets only `bovideo-openlab-preview` on `preview-beta`; generic project names, dirty worktrees, mismatched/short SHAs, Worker configuration, Functions, bindings, secrets, resource IDs, routes, and custom domains are invalid.
- Worker/D1 Phase 0 remains historical and is not an authorized production path; neither a PVB pass nor a local PostgreSQL pass satisfies the Render/Neon validation criteria.
- Production indexing remains disabled until the documented CMS permissions, locale review, publication snapshot, rollback, and withdrawal gates pass.
- Money Pages require human review before any indexable release.

## License

MIT. See [LICENSE](LICENSE).
