# Phase 3 UI and local runtime remediation handoff

**Status:** complete and phase-reviewed
**Date:** 2026-08-26
**Branch:** `phase2-local`
**Authority:** `../specs/phase3-ui-runtime-remediation-design.md`

## Delivered outcome

The four pSEO page families now render through a shared Bauhaus presentation system while preserving the existing typed envelopes, noindex policy, provenance states, locale routes and server-rendered discovery paths.

- Hub: poster hero, truthful inventory, disabled unsupported search, output axes, evidence, discovery shelves, full qualified inventory, method, related links and CTA.
- Gallery: medium hero, disabled unsupported search, axes, featured and residual inventory, explicit unavailable taxonomy, method, related links and crawlable pagination.
- Entity: qualification hero, disabled generation control, recent snapshot, complete qualified inventory, unavailable variable/creator states, evidence, self-audit, related links and CTA.
- Detail: exact ten-module order with byte-exact original prompt, distinct evidence states, source signals and disabled unsupported product action.
- Shared UI: normative color/type/geometry tokens, local Outfit font, hard borders and shadows, compact no-JS locale control, keyboard focus, reduced motion and responsive 1/2/3-column composition.

The local backend now starts Next, Payload and an isolated PostgreSQL instance with one command:

```bash
pnpm dev:local
```

The command binds Next explicitly to `127.0.0.1`, creates a random fallback Payload secret, supplies a temporary `DATABASE_URL`, enables Payload development push behavior, forwards termination signals and removes the temporary database directory on exit. Editorial data is intentionally not retained between runs.

## Verification evidence

The final phase gate covered the advertised Phase 3 entrypoints, the local runtime, static analysis and production compilation.

| Gate | Result |
|---|---|
| `pnpm run test:phase3` | Passed: 56 Vitest tests plus 6 Playwright scenarios. Includes token/family contracts, 12 screenshots, Axe, real Tab traversal, no-JS SSR, locales, variants, pagination, soak and shutdown. |
| `pnpm run test:local-runtime` | Passed: loopback listener, `/healthz`, PostgreSQL `/readyz`, unauthenticated `/admin` authentication flow and local-only browser requests. |
| `pnpm exec tsc --noEmit` | Passed. |
| `pnpm run lint` | Passed. |
| `NODE_OPTIONS='--no-deprecation --max-old-space-size=8000' PAYLOAD_SECRET='<ephemeral verification value>' pnpm exec tsx scripts/run-with-postgres.ts node_modules/next/dist/bin/next build --webpack` | Passed: 487 static pages generated; Payload API/Admin and health routes collected successfully. |
| `git diff --check` and `git diff --check 641b786..HEAD` | Passed. |

Production builds remain fail-closed when `PAYLOAD_SECRET` or `DATABASE_URL` is absent. The verification build used the local PostgreSQL wrapper and a disposable secret; deployment must provide managed production values.

## Visual acceptance

The approved baselines live under `tests/phase3/page/runtime.e2e.spec.tsx-snapshots/`:

| Family | 375 × 812 | 768 × 1024 | 1440 × 900 |
|---|---:|---:|---:|
| Hub | `hub-mobile-darwin.png` | `hub-tablet-darwin.png` | `hub-desktop-darwin.png` |
| Gallery | `gallery-mobile-darwin.png` | `gallery-tablet-darwin.png` | `gallery-desktop-darwin.png` |
| Entity | `entity-mobile-darwin.png` | `entity-tablet-darwin.png` | `entity-desktop-darwin.png` |
| Detail | `detail-mobile-darwin.png` | `detail-tablet-darwin.png` | `detail-desktop-darwin.png` |

The screenshots exclude Next development chrome. Runtime assertions additionally require the module order, normative canvas/font, expected grid columns, no horizontal overflow and zero serious/critical Axe violations.

## Independent phase review

The first review found no Critical issues and identified runtime exposure, incomplete Entity inventory, unsupported enabled search, weak keyboard/no-JS coverage, missing `/admin` acceptance, omitted tests from the phase gate, unsafe source URL schemes and handoff/diagnostic gaps.

All findings were resolved:

- `dev:local` now binds to IPv4 loopback and the test inspects the actual listener.
- The fallback Payload secret is random for each disposable run.
- Entity's all-inventory section contains every qualified link.
- Hub and Gallery search controls are visibly disabled with the missing-contract reason.
- Keyboard acceptance uses real Tab presses; no-JS acceptance covers all four families and item links.
- `/admin` accepts the correct fresh-database `create-first-user` flow or an existing-database login flow.
- UI contracts and shutdown integration are part of `test:phase3`.
- Detail source links accept only `http:` and `https:`.
- Shutdown timeout errors include bounded child-process diagnostics.
- Playwright base URLs match the literal `127.0.0.1` listener.

The re-review reported zero unresolved Critical or Important findings. Its single base-URL Minor was fixed and both browser suites were rerun successfully.

## Commit ledger

- `94ca1b5` — remediation design
- `bbbf9f0` — implementation plans
- `7f81cfd` — Bauhaus tokens
- `ed82bd3` — shared shell
- `634dc9e`, `2ae1e47` — disposable Payload/PostgreSQL runtime and readiness tests
- `6dcf4e4`, `26bbaed`, `c9ce9f0`, `2c4f0e7` — Hub, Gallery, Entity and Detail compositions
- `375c491`, `b5ff97f` — responsive baselines and deterministic screenshot isolation
- `a6bf6ea` — first phase-review remediation
- `72eb4da` — loopback URL alignment

## Operational notes

- Use `pnpm dev:local` for disposable local development.
- Use `pnpm dev` only with an externally managed `DATABASE_URL` and explicit `PAYLOAD_SECRET`.
- A fresh ephemeral database routes `/admin` to Payload's create-first-user screen; after an admin exists it uses the login screen.
- Search, generation and product-run controls remain unavailable until their own server-side product contracts are approved.

No implementation issue remains open in this remediation scope.
