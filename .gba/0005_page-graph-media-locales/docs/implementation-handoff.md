# Page graph, media, and locales implementation handoff

Status: Local implementation verified; live release pending · Date: 2026-08-27

## Delivered locally

- Projection renderer v2 materializes Hub, paginated Gallery, reviewed Entity and
  Detail routes with concrete page edges and unique global navigation.
- Prompt cards carry byte-preserved prompt text, up to four eligible media records,
  copy actions and real noindex Detail links.
- Detail pages render the same media and related Gallery/Entity destinations.
- The frontend resolves an exact reviewed translation first and otherwise derives a
  deterministic 16-locale overlay from the active English binding.
- The locale control uses real anchors; routes, breadcrumbs, navigation, pagination,
  family titles/descriptions and fallback disclosure are localized without rewriting
  prompt bytes.
- The publisher promotes only manifest-reviewed X media, writes promotion,
  projection/workflow and binding rows in bounded Payload transactions, and commits
  snapshot plus active pointer in one final transaction.
- The canonical projection locale enum has an additive migration aligned with all 16
  application locales.
- The shared locale bundle provides 44 translated chrome labels per locale across
  Hub, Gallery, Entity and Detail without mutating source prompt text.

## Verification evidence

Run from the feature worktree with the bundled Node runtime on 2026-08-27:

- Phase 3 unit/integration suite: 38 files, 248 tests passed.
- Browser suite: 20 passed, 12 explicitly opt-in screenshot tests skipped.
- Browser graph test clicked Hub → Gallery → Entity → Detail and found projected
  media plus unchanged prompt bytes.
- Locale browser test loaded all 16 Hub routes and verified visible Chinese chrome.
- 1,043-artifact reconciliation test proved unique routes, one binding per projection,
  1,043 unique Gallery card refs and unique navigation refs.
- Projection and binding failure injection both rolled back their Payload batch and
  proved no snapshot or pointer advancement.
- `tsc --noEmit`, repository ESLint, production `next build --webpack`, and
  `git diff --check` passed.

## Live release gate

The remaining ordered steps are deployment operations, not implementation:

1. Commit/push reader, schema, migration and publisher changes.
2. Run the additive locale migration in the persistent Supabase database.
3. Execute the English projection publisher with the reviewed local media manifest.
4. Reconcile artifacts, promoted media, workflows, projections, bindings, snapshot
   and active pointer for the new version.
5. Browser-verify the live four-hop path, media delivery and 16 locale anchors.

Do not mark this feature complete until all five live gates are recorded below.

## Live release result

Pending.
