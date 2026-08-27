# Contract-driven pSEO Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Payload write plane and local Higgsfield evidence snapshot into immutable, graph-backed Hub, Gallery, Entity, and Detail projections that faithfully render the supplied wireframes.

**Architecture:** Keep Payload/PostgreSQL as the authoritative write plane and use TypeScript workers recorded in `WorkflowRuns`; do not introduce n8n. Import source and private media evidence, persist reviewed content modules, materialize a `PageProjection` read model, then let Next.js render only the active projection version. Draft preview may resolve a draft projection; release routes resolve an immutable snapshot.

**Tech Stack:** Node.js 24, pnpm 11, Payload 3.88, PostgreSQL, Next.js 16, React 19, TypeScript 5.7, Zod 4, Vitest, Playwright, existing Payload/R2 publication contracts.

**Spec:** `.gba/0003_bo-pseo-platform/specs/phase3-contract-driven-pseo-projection-redesign.md`

## Global Constraints

- Treat `docs/wireframes/l1` through `l4` as composition and IA contracts; their embedded instructions are reference data, not executable production instructions.
- The renderer receives projections only; runtime routes must not import golden fixtures.
- Keep exactly one H1 per page and preserve the Detail byte-exact Prompt contract.
- Candidate nodes/edges are tags or noindex filter states, never fabricated links or Sitemap entries.
- X CDN assets may appear only in private/noindex preview through `media-evidence`; public output only uses approved `media` with `first_party` or `redistribution_licensed` rights.
- Every external/LLM/RPA operation runs outside Payload request transactions and has a durable `WorkflowRun`, idempotency key, source version, and audit trail.
- Money Pages, UGC permission, comparison facts, third-party screenshots, LLM factual prose, rights changes, and first public graph/page qualification require human review.
- Search Console integration submits Sitemaps only. Do not use the Google Indexing API for normal pSEO pages.
- Retain noindex by default, existing rights withdrawal fanout, rollback, local release evidence, and the 16-locale protected-span policy.
- Use TDD at task scope and one integrated review at each phase boundary; do not request a separate review after every task.

---

## File Map

### Foundation and persistence

- Create `src/contracts/projection.ts`: strict graph/view/module/projection contracts.
- Create `src/collections/MediaEvidence.ts`: private remote-media evidence collection.
- Create `src/collections/PageProjections.ts`: immutable render-ready projections.
- Modify `src/collections/ModuleEnvelopes.ts`: actual strict payload, slot, dependency, visibility, and quality fields.
- Modify `src/contracts/graph.ts`, `src/contracts/workflow-run.ts`, `src/collections/contract-mapping.ts`, `src/payload.config.ts`, and generated Payload migration files.

### Import and workflow

- Create `src/imports/higgsfield-snapshot.ts`: manifest-checked JSONL parsing and normalized import commands.
- Create `scripts/import-higgsfield-snapshot.ts`: explicit `ASSET_SNAPSHOT_DIR` CLI boundary.
- Create `src/workflow/registry.ts`, `src/workflow/runner.ts`, and `src/workflow/payload-lease.ts`: durable worker execution.
- Modify `src/queues/*` only to retain local test-double compatibility; do not turn the in-memory queue into the production executor.

### Graph, modules, and projection

- Create `src/graph/higgsfield-extractor.ts`: deterministic node/edge candidate extraction.
- Create `src/modules/registry.ts` and `src/modules/generators/*.ts`: content module generation and validation.
- Create `src/page/blueprints.ts`, `src/page/navigation-projection.ts`, `src/page/projector.ts`, and `src/page/payload-projection-repository.ts`.
- Modify `src/page/schema.ts`, `src/page/projections.ts`, and `src/detail/page-envelope.ts` only where contracts need projection payloads.

### Frontend and release

- Modify the seven `src/app/(frontend)/[locale]/prompts/**/page.tsx` routes to resolve projections.
- Rewrite `src/page/presentation/shared-shell.tsx`, `hub.tsx`, `gallery.tsx`, `entity.tsx`, `src/detail/detail-composer.tsx`, `src/page/presentation/primitives.tsx`, and `src/app/(frontend)/styles.css` around projected slots/media/navigation.
- Create `src/seo/search-console-sitemap.ts` and extend `src/seo/release-candidate.ts` with an injected Sitemap-submit adapter; local runs remain `NOT_RUN_REMOTE`.

### Tests and documentation

- Create test directories `tests/phase3/projection/`, `tests/phase3/import/`, `tests/phase3/workflow/`, and `tests/phase3/wireframes/`.
- Extend phase 3 browser tests and phase 4 publication tests.
- Create `.gba/0003_bo-pseo-platform/docs/phase3-contract-driven-projection-handoff.md` at phase completion.

## Phase A — Contracts, collections, and deterministic import

### Task 1: Define the projection and evidence contracts

**Files:**

- Create: `src/contracts/projection.ts`
- Modify: `src/contracts/graph.ts`
- Modify: `src/contracts/workflow-run.ts`
- Test: `tests/phase3/projection/contracts.spec.ts`

**Interfaces:**

- Produces `pageProjectionSchema`, `projectedSlotSchema`, `projectedPromptCardSchema`, `navigationProjectionSchema`, and `mediaEvidenceSchema`.
- Produces `WorkflowJobType` including `extract_graph`, `generate_module`, `project_page`, `validate_release`, and `observe_search`.
- Produces the canonical graph relation union used by collections, extractors, and projectors.

- [ ] **Step 1: Write contract tests before implementation**

```ts
import { describe, expect, it } from 'vitest'
import { pageProjectionSchema } from '@/contracts/projection'
import { workflowRunJobTypeSchema } from '@/contracts/workflow-run'

describe('projection contracts', () => {
  it('rejects a candidate edge presented as a page link', () => {
    expect(() => pageProjectionSchema.parse({
      projection_id: '00000000-0000-4000-8000-000000000601',
      state: 'validated', page: {}, navigation: {}, slots: [{
        slot_key: 'models', renderer: 'node_shelf', source_mode: 'graph_query',
        items: [{ node_ref: 'model:nano-banana', evidence_state: 'candidate', link_policy: 'link', href: '/en/prompts/models/nano-banana' }],
      }],
    })).toThrow()
  })

  it('accepts every worker job required by the projection pipeline', () => {
    for (const type of ['extract_graph', 'generate_module', 'project_page', 'validate_release', 'observe_search'])
      expect(workflowRunJobTypeSchema.parse(type)).toBe(type)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/contracts.spec.ts
```

Expected: module import failure because `src/contracts/projection.ts` does not exist.

- [ ] **Step 3: Implement the strict contracts**

```ts
export const linkPolicySchema = z.enum(['link', 'filter_state', 'dead_text'])
export const projectedNodeItemSchema = z.object({
  node_ref: z.string().min(1), edge_ref: z.string().nullable(),
  evidence_state: z.enum(['candidate', 'reviewed', 'qualified']),
  link_policy: linkPolicySchema, href: z.string().regex(/^\//).nullable(),
}).strict().superRefine((item, ctx) => {
  if (item.evidence_state === 'candidate' && item.link_policy === 'link')
    ctx.addIssue({ code: 'custom', message: 'candidate nodes cannot link' })
  if (item.link_policy === 'link' && item.href === null)
    ctx.addIssue({ code: 'custom', message: 'linked item requires href' })
})
```

Define `PageProjection` as `{ projection_id, page_id, locale, family, state, dependency_hash, page, navigation, slots, content_hash, link_hash, schema_hash }`; do not put untrusted raw source payloads in it. Extend job and relation enums with exactly the values in the spec and update all current consumers to the one canonical union.

- [ ] **Step 4: Pass focused contracts and typecheck**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/contracts.spec.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit the contracts**

```bash
git add src/contracts/projection.ts src/contracts/graph.ts src/contracts/workflow-run.ts tests/phase3/projection/contracts.spec.ts
git commit -m "feat: define pSEO projection contracts"
```

### Task 2: Persist module payloads, private media evidence, and immutable projections

**Files:**

- Create: `src/collections/MediaEvidence.ts`
- Create: `src/collections/PageProjections.ts`
- Modify: `src/collections/ModuleEnvelopes.ts`
- Modify: `src/collections/contract-mapping.ts`
- Modify: `src/payload.config.ts`
- Create: `src/migrations/20260826_*.ts` and `.json` via the repository migration generator
- Test: `tests/phase3/projection/payload-collections.contract.spec.ts`

**Interfaces:**

- `validateModuleEnvelopePayload(data: unknown): Record<string, unknown>` parses the collection row as `PageModule`.
- `MediaEvidence` has no public upload URL and never joins the public `media` collection automatically.
- `PageProjections` rejects update/delete mutation of validated/released payload bytes.

- [ ] **Step 1: Write the failing Payload collection contract**

```ts
it('requires a strict payload and private media evidence', async () => {
  const config = await readFile('src/collections/ModuleEnvelopes.ts', 'utf8')
  expect(config).toContain("{ name: 'payload', type: 'json', required: true }")
  expect(config).toContain("{ name: 'slot_key', type: 'text', required: true }")
  const media = await readFile('src/collections/MediaEvidence.ts', 'utf8')
  expect(media).toContain("slug: 'media-evidence'")
  expect(media).toContain('access: { read: () => false }')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/payload-collections.contract.spec.ts
```

- [ ] **Step 3: Implement the collections and validation hook**

Use the existing `pageModuleSchema` at the Payload boundary:

```ts
export const validateModuleEnvelopePayload: CollectionBeforeChangeHook = ({ data }) => {
  const parsed = pageModuleSchema.parse({
    ...data,
    module_id: data.module_id,
    payload: data.payload,
    schema_version: 1,
  })
  return { ...data, payload: parsed.payload, content_hash: hashModule(parsed) }
}
```

Add `payload`, `slot_key`, `position`, `dependency_refs`, `dependency_hash`, `quality_result`, `risk_classes`, `visibility`, `renderer_version`, and `stale_reason` to `ModuleEnvelopes`. Add `media-evidence` with source relationship, remote references, derived metadata, rights/safety status, and private read access. Add append-only `page-projections` with JSON projection payload plus dependency/content/link/schema hashes, state, and WorkflowRun reference. Register both collections and generate a PostgreSQL migration using the repository convention.

- [ ] **Step 4: Run collection, migration, and type checks**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/payload-collections.contract.spec.ts
pnpm run generate:types:payload
pnpm exec tsc --noEmit
pnpm run test:phase1:migrations
```

- [ ] **Step 5: Commit the persistence layer**

```bash
git add src/collections src/migrations src/payload.config.ts src/payload-types.ts tests/phase3/projection/payload-collections.contract.spec.ts
git commit -m "feat: persist pSEO modules media and projections"
```

### Task 3: Import a verified local snapshot without worktree asset duplication

**Files:**

- Create: `src/imports/higgsfield-snapshot.ts`
- Create: `scripts/import-higgsfield-snapshot.ts`
- Create: `tests/phase3/fixtures/import/higgsfield-mini/manifest.json`
- Create: `tests/phase3/fixtures/import/higgsfield-mini/normalized_posts.jsonl`
- Create: `tests/phase3/fixtures/import/higgsfield-mini/media_refs.jsonl`
- Test: `tests/phase3/import/higgsfield-snapshot.int.spec.ts`

**Interfaces:**

- `importHiggsfieldSnapshot({ snapshotDir, payload, correlationId }): Promise<SnapshotImportResult>`.
- `SnapshotImportResult` reports manifest hash, created/skipped Sources, Artifacts, and MediaEvidence rows.
- The CLI requires `ASSET_SNAPSHOT_DIR`; it never defaults to an arbitrary user home directory.

- [ ] **Step 1: Write importer tests with the committed mini fixture**

```ts
it('is hash-checked and idempotent', async () => {
  const first = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId })
  const second = await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId })
  expect(first.created.sources).toBe(2)
  expect(first.created.mediaEvidence).toBe(2)
  expect(second.created).toEqual({ sources: 0, artifacts: 0, mediaEvidence: 0 })
})

it('does not create rows when a manifest hash is wrong', async () => {
  await expect(importHiggsfieldSnapshot({ snapshotDir: badFixtureDir, payload, correlationId })).rejects.toThrow('manifest hash mismatch')
  expect(await countDocuments(payload, 'sources')).toBe(0)
})
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/import/higgsfield-snapshot.int.spec.ts
```

- [ ] **Step 3: Implement streaming import and explicit CLI input**

Use `node:readline` to stream JSONL; validate each normalized row and media row before a Payload write. Match records by provider record ID plus content hash, and use the source manifest hash as the run source version.

```ts
const snapshotDir = process.env.ASSET_SNAPSHOT_DIR
if (!snapshotDir) throw new Error('ASSET_SNAPSHOT_DIR is required')
const result = await importHiggsfieldSnapshot({ snapshotDir, payload, correlationId: createUlid() })
process.stdout.write(`${JSON.stringify(result)}\n`)
```

Source body/raw references stay private. Media refs are written only to `media-evidence`; do not create public `media` rows from X CDN URLs.

- [ ] **Step 4: Run import verification**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/import/higgsfield-snapshot.int.spec.ts
ASSET_SNAPSHOT_DIR='/Users/a1/Documents/wiki/30-39 Product and Web Builds/bo/assets/higgsfield-x-prompts-2026-08-20-twitter241' pnpm exec tsx scripts/import-higgsfield-snapshot.ts --dry-run
```

Expected: the dry run reports the snapshot manifest and no CMS mutations.

- [ ] **Step 5: Commit importer code and mini fixtures**

```bash
git add src/imports scripts/import-higgsfield-snapshot.ts tests/phase3/import tests/phase3/fixtures/import
git commit -m "feat: import verified Higgsfield snapshot"
```

### Task 4: Add a durable native worker registry

**Files:**

- Create: `src/workflow/payload-lease.ts`
- Create: `src/workflow/registry.ts`
- Create: `src/workflow/runner.ts`
- Modify: `src/collections/WorkflowRuns.ts`
- Test: `tests/phase3/workflow/durable-runner.int.spec.ts`

**Interfaces:**

- `WorkflowHandler = (run: WorkflowRunCommand) => Promise<{ outputRef: string }>`.
- `WorkflowRegistry.register(jobType, handler): void`.
- `runNextWorkflow(payload, registry, workerId): Promise<'processed' | 'idle'>`.
- A lease is acquired only by changing a queued run to running at its expected revision.

- [ ] **Step 1: Write concurrent worker tests**

```ts
it('processes one idempotent run exactly once across two workers', async () => {
  const [left, right] = await Promise.all([
    runNextWorkflow(payload, registry, 'worker-a'),
    runNextWorkflow(payload, registry, 'worker-b'),
  ])
  expect([left, right].filter((value) => value === 'processed')).toHaveLength(1)
  expect(await handlerCalls()).toBe(1)
  expect((await readRun()).status).toBe('succeeded')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/workflow/durable-runner.int.spec.ts
```

- [ ] **Step 3: Implement Payload-backed leasing**

Persist queued/running/succeeded/failed state in `workflow-runs`; use the existing revision/CAS policy rather than `LocalQueue` arrays. A handler gets parsed `input_ref`, correlation ID, expected source version, and one bounded output writer. A stale source version changes status to `stale_ignored`; a handler error changes status to `failed` with a stable error class.

```ts
export const runNextWorkflow = async (payload: Payload, registry: WorkflowRegistry, workerId: string) => {
  const run = await claimOldestQueuedRun(payload, workerId)
  if (run === null) return 'idle' as const
  try { return await registry.execute(run) }
  catch (error) { await failRun(payload, run, classifyWorkflowError(error)); throw error }
}
```

- [ ] **Step 4: Run worker and queue compatibility tests**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/workflow/durable-runner.int.spec.ts
pnpm run test:phase1:queues
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit durable workflow execution**

```bash
git add src/workflow src/collections/WorkflowRuns.ts tests/phase3/workflow
git commit -m "feat: add durable pSEO workflow runner"
```

## Phase B — Graph, content modules, and projection build

### Task 5: Extract taxonomy nodes and candidate edges from approved Prompt artifacts

**Files:**

- Create: `src/graph/higgsfield-extractor.ts`
- Modify: `src/graph/elevation.ts`
- Test: `tests/phase3/projection/higgsfield-extractor.spec.ts`

**Interfaces:**

- `extractGraphCandidates(artifact: ImportedPromptArtifact): GraphCandidateBatch`.
- `GraphCandidateBatch` contains typed Nodes and edges with source evidence, confidence, and review state `candidate`.
- The extractor emits `output:image|video`, model, use case, style, technique, subject, creator, and variation candidates only when supported by source fields/rules.

- [ ] **Step 1: Write source-grounded extraction tests**

```ts
it('keeps lexical model × style as a candidate edge and does not create a route', () => {
  const batch = extractGraphCandidates(seedanceCinematicRecord)
  expect(batch.edges).toContainEqual(expect.objectContaining({ relation: 'has_style', review_state: 'candidate' }))
  expect(batch.navigationCandidates).not.toContainEqual(expect.objectContaining({ link_policy: 'link' }))
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/higgsfield-extractor.spec.ts
```

- [ ] **Step 3: Implement rule-versioned extraction**

Expose one immutable rule version and explicit regex/token maps. Output evidence refs and source-version hashes for every candidate. Never upgrade review state inside extraction; the existing graph review path is the only approval path.

```ts
export const HIGGSFIELD_GRAPH_RULE_VERSION = 'higgsfield-graph-v1'
export const extractGraphCandidates = (artifact: ImportedPromptArtifact): GraphCandidateBatch => ({
  nodes: freezeNodes(extractNodes(artifact)),
  edges: freezeEdges(extractEdges(artifact)),
  ruleVersion: HIGGSFIELD_GRAPH_RULE_VERSION,
})
```

- [ ] **Step 4: Verify extraction and review compatibility**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/higgsfield-extractor.spec.ts
pnpm run test:phase2:t02
```

- [ ] **Step 5: Commit graph extraction**

```bash
git add src/graph/higgsfield-extractor.ts src/graph/elevation.ts tests/phase3/projection/higgsfield-extractor.spec.ts
git commit -m "feat: extract graph candidates from prompt evidence"
```

### Task 6: Implement module generators and risk gates

**Files:**

- Create: `src/modules/registry.ts`
- Create: `src/modules/generators/prompt.ts`
- Create: `src/modules/generators/case.ts`
- Create: `src/modules/generators/tutorial.ts`
- Create: `src/modules/generators/comparison.ts`
- Create: `src/modules/generators/faq.ts`
- Modify: `src/page/modules.ts`
- Test: `tests/phase3/projection/module-generators.spec.ts`

**Interfaces:**

- `ModuleGenerator.generate(input): Promise<PageModule>`.
- `ModuleRegistry.generate(moduleType, input): Promise<PageModule>`.
- `assertModulePublishable` remains the final public-publish gate.

- [ ] **Step 1: Write generator safety tests**

```ts
it('preserves Prompt bytes and blocks public output without redistribution rights', async () => {
  const module = await registry.generate('prompt', licensedPromptInput)
  expect(module.payload.original_text).toBe(licensedPromptInput.originalText)
  expect(module.payload.token_integrity_hash).toBe(hash(licensedPromptInput.originalText))
  expect(() => assertModulePublishable({ ...module, rights_state: 'metadata_only' })).toThrow()
})

it('requires citations and explicit human review for comparison', async () => {
  const module = await registry.generate('comparison', comparisonInput)
  expect(module.payload.factual_reviewed).toBe(false)
  expect(() => assertModulePublishable(module)).toThrow('comparison facts require factual review')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/module-generators.spec.ts
```

- [ ] **Step 3: Implement generators with no fabricated fallback**

Each generator returns either a validated module or a stable `GenerationBlockedError`; it never fills unavailable fields with prose. RPA tutorial input must include passed steps, PII flags, authorization and screenshot refs. UGC needs authorization. FAQ answers store source refs and demand evidence; AI synthesis remains `candidate` until review.

```ts
export class ModuleRegistry {
  #generators = new Map<PageModule['module_type'], ModuleGenerator>()
  register(type: PageModule['module_type'], generator: ModuleGenerator): void { this.#generators.set(type, generator) }
  async generate(type: PageModule['module_type'], input: unknown): Promise<PageModule> {
    const generator = this.#generators.get(type)
    if (!generator) throw new GenerationBlockedError(`unsupported_module:${type}`)
    return pageModuleSchema.parse(await generator.generate(input))
  }
}
```

- [ ] **Step 4: Pass generator and legacy module tests**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/module-generators.spec.ts tests/phase3/page/modules.contract.spec.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit generators**

```bash
git add src/modules src/page/modules.ts tests/phase3/projection/module-generators.spec.ts
git commit -m "feat: generate reviewed pSEO modules"
```

### Task 7: Define the wireframe blueprints and materialize page/navigation projections

**Files:**

- Create: `src/page/blueprints.ts`
- Create: `src/page/navigation-projection.ts`
- Create: `src/page/projector.ts`
- Test: `tests/phase3/wireframes/blueprints.contract.spec.ts`
- Test: `tests/phase3/wireframes/projector.spec.ts`

**Interfaces:**

- `PAGE_BLUEPRINTS: Record<PageFamily, PageBlueprint>`.
- `projectPage(input: ProjectPageInput): PageProjection`.
- `projectNavigation(input: NavigationInput): NavigationProjection`.

- [ ] **Step 1: Write the required slot-order tests**

```ts
const hub = PAGE_BLUEPRINTS.hub.slots.map((slot) => slot.slot_key)
expect(hub).toEqual(['hero', 'featured', 'trending', 'tasks', 'camera_motion', 'models', 'styles', 'collections', 'creators', 'cta', 'footer'])

const detail = PAGE_BLUEPRINTS.detail.slots.map((slot) => slot.slot_key)
expect(detail).toEqual(['hero_media', 'prompt', 'workflow', 'variables', 'variations', 'source_signals', 'related', 'footer'])
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/wireframes/blueprints.contract.spec.ts tests/phase3/wireframes/projector.spec.ts
```

- [ ] **Step 3: Implement blueprint and projector functions**

Blueprint slots use `content_envelope`, `graph_query`, or `page_metadata`. Structural slots call pure deterministic selectors; content slots admit only approved/current modules. The projector records every source/module/node/edge ID in its dependency hash. It resolves candidate edges to `filter_state` or `dead_text`, never `link`.

```ts
export const projectPage = (input: ProjectPageInput): PageProjection => pageProjectionSchema.parse({
  projection_id: stableProjectionId(input), state: 'validated',
  page: buildEnvelope(input), navigation: projectNavigation(input),
  slots: input.blueprint.slots.map((slot) => resolveSlot(slot, input)),
  dependency_hash: dependencyHash(input), content_hash: contentHash(input),
  link_hash: linkHash(input), schema_hash: schemaHash(input),
})
```

- [ ] **Step 4: Run projection contracts**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/wireframes/blueprints.contract.spec.ts tests/phase3/wireframes/projector.spec.ts
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit blueprint/projector code**

```bash
git add src/page/blueprints.ts src/page/navigation-projection.ts src/page/projector.ts tests/phase3/wireframes
git commit -m "feat: materialize wireframe page projections"
```

## Phase C — Projection read plane and frontend restoration

### Task 8: Add the Payload projection repository and remove runtime fixture reads

**Files:**

- Create: `src/page/payload-projection-repository.ts`
- Modify: `src/page/route-view.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/image/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/video/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/models/[entitySlug]/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/styles/[entitySlug]/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/use-cases/[entitySlug]/page.tsx`
- Modify: `src/app/(frontend)/[locale]/prompts/[slugAndId]/page.tsx`
- Test: `tests/phase3/projection/route-repository.int.spec.ts`

**Interfaces:**

- `ProjectionRepository.readActive(route, locale): Promise<PageProjection | null>`.
- `ProjectionRepository.readDraft(pageId, locale): Promise<PageProjection | null>`.
- Route components pass `projection.page` and `projection.slots` to renderers.

- [ ] **Step 1: Write a route source and repository integration test**

```ts
it('serves an activated projection and rejects a fixture-only runtime route', async () => {
  await seedActivatedProjection(payload, hubProjection)
  await expect(repository.readActive('/en/prompts', 'en')).resolves.toMatchObject({ projection_id: hubProjection.projection_id })
  const source = await readFile('src/app/(frontend)/[locale]/prompts/page.tsx', 'utf8')
  expect(source).not.toContain('P3_GOLDEN_LOCALE_FIXTURES')
  expect(source).toContain('readActiveProjection')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/route-repository.int.spec.ts
```

- [ ] **Step 3: Implement repository and route reads**

Repository reads the active snapshot pointer first, then fetches the exact immutable `page-projections` row and parses it with `pageProjectionSchema`. Draft read APIs are admin-only. Route components use `dynamic = 'force-dynamic'` until a release snapshot export supplies static parameters; they return `notFound()` for absent/withdrawn projections.

```ts
export const readActiveProjection = async (route: string, locale: ApplicationLocale) => {
  const pointer = await activePublicationPointer()
  if (pointer === null) return null
  const row = await findProjectionByRoute(pointer.publish_version, route, locale)
  return row === null ? null : pageProjectionSchema.parse(row.payload)
}
```

- [ ] **Step 4: Run repository and existing route contracts**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/route-repository.int.spec.ts
pnpm run test:phase3:t03
pnpm run test:phase3:t04
pnpm run test:phase3:t05
pnpm run test:phase3:t06
```

- [ ] **Step 5: Commit the projection read plane**

```bash
git add src/page/payload-projection-repository.ts src/page/route-view.tsx 'src/app/(frontend)' tests/phase3/projection/route-repository.int.spec.ts
git commit -m "feat: render routes from active projections"
```

### Task 9: Render projected headers, footers, cards, facets, nodes, edges, and media

**Files:**

- Modify: `src/page/presentation/shared-shell.tsx`
- Modify: `src/page/presentation/primitives.tsx`
- Modify: `src/page/presentation/hub.tsx`
- Modify: `src/page/presentation/gallery.tsx`
- Modify: `src/page/presentation/entity.tsx`
- Modify: `src/detail/detail-composer.tsx`
- Modify: `src/app/(frontend)/styles.css`
- Test: `tests/phase3/wireframes/family-render.contract.spec.tsx`
- Test: `tests/phase3/wireframes/media-policy.spec.tsx`

**Interfaces:**

- `ProjectedSlotRenderer({ slot, mode }): ReactNode`.
- `MediaBlock({ media, mode }): ReactNode`, where `mode` is `preview | public`.
- Existing `PageShell`, `PageRouteView`, and Detail copy APIs remain exported.

- [ ] **Step 1: Write family composition and media policy tests**

```tsx
it('renders every Hub wireframe slot in order and never links candidate nodes', () => {
  const html = renderToStaticMarkup(<PageRouteView projection={hubProjection} />)
  expectInOrder(html, ['data-slot="hero"', 'data-slot="featured"', 'data-slot="trending"', 'data-slot="tasks"', 'data-slot="footer"'])
  expect(html).toContain('data-link-policy="filter_state"')
  expect(html).not.toContain('href="/en/prompts/models/candidate-model"')
})

it('uses remote X media only in preview mode', () => {
  expect(renderToStaticMarkup(<MediaBlock media={remoteEvidence} mode="preview" />)).toContain('pbs.twimg.com')
  expect(renderToStaticMarkup(<MediaBlock media={remoteEvidence} mode="public" />)).not.toContain('pbs.twimg.com')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/wireframes/family-render.contract.spec.tsx tests/phase3/wireframes/media-policy.spec.tsx
```

- [ ] **Step 3: Implement projected slot renderers**

Map `hero`, `facet_axis`, `prompt_shelf`, `node_shelf`, `creator_shelf`, `link_mesh`, `source_panel`, `data_notes`, `prompt`, `workflow`, and `variations` slots to semantic React components. Header/footer variants must consume `projection.navigation`; no literal taxonomy navigation arrays are allowed. `MediaBlock` uses a source image only for preview remote evidence and emits `loading="lazy"` plus `referrerPolicy="no-referrer"`; public media resolves the approved local route, and unavailable media uses a labeled empty state.

- [ ] **Step 4: Restore wireframe responsive composition in CSS**

Use the exact page family slots rather than one generic poster layout. Preserve only tokens allowed by the precedence rule. Add responsive grid rules for 375, 768, and 1440 widths; card rails must scroll or stack without horizontal document overflow.

```css
[data-slot='prompt_shelf'] .prompt-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 767px) { [data-slot='prompt_shelf'] .prompt-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Pass render, accessibility, and type checks**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/wireframes/family-render.contract.spec.tsx tests/phase3/wireframes/media-policy.spec.tsx
pnpm run test:phase3:t02
pnpm run test:phase3:t09
pnpm exec tsc --noEmit
pnpm run lint
```

- [ ] **Step 6: Commit the projection-based frontend**

```bash
git add src/page/presentation src/detail/detail-composer.tsx 'src/app/(frontend)/styles.css' tests/phase3/wireframes
git commit -m "feat: restore wireframe projections in frontend"
```

### Task 10: Add browser screenshot and interaction proof for all four families

**Files:**

- Modify: `playwright.phase3.config.ts`
- Create: `tests/phase3/wireframes/four-family.e2e.spec.ts`
- Create: `tests/phase3/wireframes/no-overflow.e2e.spec.ts`
- Update: screenshot baselines under the existing Phase 3 snapshot convention

**Interfaces:**

- Test fixture seeds one active projection per page family.
- Browser URLs target the active projection routes, not static fixture routes.

- [ ] **Step 1: Write desktop/tablet/mobile acceptance tests**

```ts
for (const viewport of [{ width: 375, height: 900 }, { width: 768, height: 1000 }, { width: 1440, height: 1200 }]) {
  test(`hub has no overflow at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/en/prompts')
    await expect(page.locator('[data-slot="hero"]')).toBeVisible()
    await expect(page.locator('[data-slot="camera_motion"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => window.innerWidth))
  })
}
```

- [ ] **Step 2: Verify failure before visual implementation is complete**

```bash
pnpm exec playwright test --config playwright.phase3.config.ts tests/phase3/wireframes/four-family.e2e.spec.ts
```

- [ ] **Step 3: Add interaction checks and snapshots**

Verify search/facet filter feedback remains noindex, copy returns a success signal, gallery pagination is canonical, candidate tag is non-link, header/footer navigation appears, and public-mode media has no remote X URL. Capture reviewed screenshots for all four families at the three required widths.

- [ ] **Step 4: Run browser and accessibility tests**

```bash
pnpm exec playwright test --config playwright.phase3.config.ts tests/phase3/wireframes/four-family.e2e.spec.ts tests/phase3/wireframes/no-overflow.e2e.spec.ts
pnpm run test:phase3:t09
```

- [ ] **Step 5: Commit browser proof**

```bash
git add playwright.phase3.config.ts tests/phase3/wireframes
git commit -m "test: verify four projected page families"
```

## Phase D — Review, publication, and operational closure

### Task 11: Connect staleness, locale review, and risk review to projection rebuilds

**Files:**

- Create: `src/page/projection-staleness.ts`
- Modify: `src/localization/source-stale.ts`
- Modify: `src/collections/shared.ts`
- Modify: `src/review/graph-review.ts`
- Test: `tests/phase3/projection/staleness-and-review.int.spec.ts`

**Interfaces:**

- `staleDependentProjections(input): Promise<string[]>`.
- `assertProjectionReviewEligibility(input): void`.

- [ ] **Step 1: Write review and stale fanout tests**

```ts
it('withdraws a public projection after media rights revoke and retains no stale media URL', async () => {
  await revokeMediaEvidence(payload, mediaId)
  await staleDependentProjections({ payload, dependencyRef: mediaId })
  expect((await readProjection(projectionId)).state).toBe('withdrawn')
  expect((await readProjection(projectionId)).payload).not.toContain('pbs.twimg.com')
})

it('rejects publishing a money-page locale without a human reviewer', () => {
  expect(() => assertProjectionReviewEligibility(moneyProjectionWithoutReviewer)).toThrow('human review required')
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/staleness-and-review.int.spec.ts
```

- [ ] **Step 3: Implement dependency fanout and independent locale eligibility**

Write stale/withdrawn projections as new immutable state transitions, enqueue `project_page` for eligible dependents, and preserve the existing locale protected-span checks. Locale publication is independent, but no fallback locale may enter the projection.

- [ ] **Step 4: Verify localization and review behavior**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/projection/staleness-and-review.int.spec.ts
pnpm run test:phase2:t03
pnpm run test:phase1:localization
```

- [ ] **Step 5: Commit review integration**

```bash
git add src/page/projection-staleness.ts src/localization src/collections/shared.ts src/review tests/phase3/projection/staleness-and-review.int.spec.ts
git commit -m "feat: gate projection release by review and staleness"
```

### Task 12: Feed projections into release, Sitemap submission intent, and rollback

**Files:**

- Create: `src/seo/search-console-sitemap.ts`
- Modify: `src/seo/release-candidate.ts`
- Modify: `src/publication/manifest.ts`
- Modify: `src/publication/activation.ts`
- Test: `tests/phase4/seo/projection-release.int.spec.ts`
- Test: `tests/phase4/seo/search-console-sitemap.spec.ts`

**Interfaces:**

- `buildReleaseFromProjections(input): Phase4ReleaseCandidate`.
- `SearchConsoleSitemapSubmitter.submit(input): Promise<{ remoteStatus: 'NOT_RUN_REMOTE' | 'submitted'; reference: string }>`.
- Local submitter always returns `NOT_RUN_REMOTE` and performs zero network calls.

- [ ] **Step 1: Write release and Sitemap policy tests**

```ts
it('includes only qualified public projections and preserves lastmod on unchanged hashes', () => {
  const release = buildReleaseFromProjections(releaseInput)
  expect(release.sitemap.urlCount).toBe(1)
  expect(release.sitemap.excludedRoutes).toContainEqual(expect.objectContaining({ reason: 'rights_not_permitted' }))
})

it('does not send ordinary pSEO URLs through an indexing API client', async () => {
  const result = await localSubmitter.submit({ sitemapUrl: 'https://example.test/sitemap.xml' })
  expect(result.remoteStatus).toBe('NOT_RUN_REMOTE')
  expect(networkCalls).toBe(0)
})
```

- [ ] **Step 2: Verify failure**

```bash
pnpm exec vitest run --config vitest.phase4.config.mts tests/phase4/seo/projection-release.int.spec.ts tests/phase4/seo/search-console-sitemap.spec.ts
```

- [ ] **Step 3: Implement projection release adapter**

Build route candidates and public export records exclusively from released projections. Keep the existing Sitemap shard builder, canonical checks, rights checks, and publication pointer activation. `search-console-sitemap.ts` is an injected interface with no secret/configured remote client in local mode.

- [ ] **Step 4: Run Phase 4 release suites**

```bash
pnpm exec vitest run --config vitest.phase4.config.mts tests/phase4/seo/projection-release.int.spec.ts tests/phase4/seo/search-console-sitemap.spec.ts
pnpm run test:phase4
```

- [ ] **Step 5: Commit release integration**

```bash
git add src/seo src/publication tests/phase4/seo
git commit -m "feat: publish qualified page projections"
```

### Task 13: Run the integrated import-to-render-to-release acceptance suite

**Files:**

- Create: `tests/phase3/acceptance/contract-driven-projection.spec.ts`
- Modify: `package.json`
- Create: `.gba/0003_bo-pseo-platform/docs/phase3-contract-driven-projection-handoff.md`

**Interfaces:**

- `pnpm run test:phase3:projection` runs the focused contract-driven acceptance suite.
- The handoff records exact commands, results, release limitations, and deferred remote credentials.

- [ ] **Step 1: Write the end-to-end acceptance test**

```ts
it('imports, projects, activates, renders, rolls back, and withdraws without fixture runtime content', async () => {
  await importHiggsfieldSnapshot({ snapshotDir: fixtureDir, payload, correlationId })
  await runPipelineUntilIdle(payload, registry)
  await activateProjectionRelease(payload)
  await expect(fetchPage('/en/prompts')).resolves.toContain('data-slot="camera_motion"')
  await withdrawSource(payload, sourceId)
  await runPipelineUntilIdle(payload, registry)
  await expect(fetchPage('/en/prompts')).resolves.not.toContain(withdrawnPromptTitle)
})
```

- [ ] **Step 2: Verify failure until the pipeline is fully connected**

```bash
pnpm exec vitest run --config vitest.phase3.config.mts tests/phase3/acceptance/contract-driven-projection.spec.ts
```

- [ ] **Step 3: Add the package command and handoff record**

```json
"test:phase3:projection": "tsx scripts/run-with-postgres.ts node_modules/vitest/vitest.mjs run --config ./vitest.phase3.config.mts tests/phase3/acceptance tests/phase3/import tests/phase3/projection tests/phase3/wireframes tests/phase3/workflow"
```

The handoff must state that Search Console credentials/submission remain remote work and must list no unresolved local P0/P1 findings before calling the phase complete.

- [ ] **Step 4: Run phase-level verification**

```bash
pnpm run test:phase3:projection
pnpm run test:phase3
pnpm run test:phase4
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
git diff --check
```

- [ ] **Step 5: Commit handoff and request one independent phase review**

```bash
git add package.json tests/phase3/acceptance .gba/0003_bo-pseo-platform/docs/phase3-contract-driven-projection-handoff.md
git commit -m "test: close contract-driven projection phase"
```

Run a single independent review after the entire phase. Resolve every valid P0/P1 finding, rerun the phase-level verification commands, and update the handoff before declaring the phase complete.

## Plan Self-Review

### Spec coverage

- Asset import/private versus public media: Tasks 2–3 and 9.
- Payload module payload and graph contract gaps: Tasks 1–2 and 5–6.
- Native durable orchestration without n8n: Task 4.
- Four wireframe IA, header/footer, nodes, edges, cards, and responsive UI: Tasks 7–10.
- Locale/review/risk and withdrawal fanout: Task 11.
- Snapshot, rollback, Sitemap, GSC boundary, and observation adapter: Task 12.
- Full local acceptance, documentation, and phase review: Task 13.

### Placeholder scan

The plan contains no deferred placeholder language. Every task names exact files, interfaces, tests, commands, and expected behavior.

### Type consistency

`PageProjection` and `WorkflowJobType` are defined in Task 1 before Tasks 2–13 consume them. `ModuleRegistry` is defined in Task 6 before the projector uses approved modules in Task 7. `ProjectionRepository` is defined in Task 8 before frontend routes consume it in Task 9. Release assembly consumes released `PageProjection` only after persistence, projection, review, and repository work are defined.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-26-contract-driven-pseo-projections.md`.

Execution mode is already selected by the user: use multiple Terra subagents for independent work, with a single writer for shared contracts, migrations, Payload config, page projection schema, and frontend composition. Run local checks per task and one independent review at each phase boundary.
