# P1-T01 required-local evidence

This tracked fixture is the clean-checkout evidence reference for the P1-T01
acceptance manifest. The full execution ledger remains historical context only;
the acceptance ref must resolve without `.superpowers/` or any ignored file.

```yaml
task: P1-T01
scope: canonical typed contracts
status: PASS_REQUIRED_LOCAL
review: approved after two fix rounds
remote_mutations: 0
p1v_status: NOT_RUN_REQUIRED_REMOTE
```

Required-local checks recorded by the task:

- `pnpm run test:phase1:contracts` — PASS (224 tests on the final bootstrap rerun)
- `pnpm exec tsc --noEmit` — PASS
- `pnpm run lint` — PASS
- `pnpm run test:int` — PASS (38 tests, process-only local bindings)
- `pnpm run test:preview:all` — PASS (89 tests)
- `git diff --check` — PASS

The companion contract fixture is
`tests/phase1/contracts/common.contract.spec.ts`. T01 proves canonical local
schemas and pure decisions only; Payload persistence, queues, storage,
localization runtime, and remote P1-V evidence belong to successor tasks.
