# P2-L local publication runbook

The P2-L publication plane is a local, loopback-only emulator. It writes only to
the in-memory publication store and an explicitly supplied cache root; it does
not create a public listener, call a remote service, or mutate a remote
publication.

## Activation and rollback

Build a deterministic manifest with `src/publication/manifest.ts`, then call
`activatePublication` with the store's current pointer revision. The pointer
revision is a compare-and-swap token. A stale token, a validation failure, or
an injected fault before/after commit restores pointer, lifecycle records and
audit events together. `rollbackPublication` uses the previous verified
version and increments (rather than restores) the pointer revision.

## Withdrawal and cache convergence

`emergencyWithdraw` records an idempotent tombstone for the requested locale
(the P2-L B3 drill withdraws fixed `zh-TW`) and makes that local read route
return HTTP 410 with `noindex` headers. Other locale routes and their hashes
remain unchanged. `convergeLocalCache` projects active records as 200 and
withdrawn records as 410; an old cache entry is never allowed to serve a
withdrawn route.

Run the focused verification with `pnpm run test:phase2:t06`. It uses three
independent logical local emulator contexts: `local-region-a` on 4311 with
`output/p2-local-cache/a`, `local-region-b` on 4312 with `.../b`, and
`local-region-c` on 4313 with `.../c`. These are not geographic or production
regions. All configured ports must be unique, unoccupied and loopback-only;
the smoke report proves `network_calls=0`, `remote_mutations=0` and
`public_listeners=0`, with an injected 60-second logical convergence window.
