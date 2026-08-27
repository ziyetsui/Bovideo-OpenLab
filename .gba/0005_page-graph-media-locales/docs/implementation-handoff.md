# Page graph, media, and locales implementation handoff

Status: Live release v12 verified · Date: 2026-08-28

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
- Reviewed promotion is media-type aware: an image needs its reviewed X CDN source
  URL and may omit a redundant thumbnail; a video still requires both its reviewed
  video and poster URLs.
- The canonical projection locale enum has an additive migration aligned with all 16
  application locales.
- The shared locale bundle provides 44 translated chrome labels per locale across
  Hub, Gallery, Entity and Detail without mutating source prompt text.

## Verification evidence

Run from the feature worktree with the bundled Node runtime on 2026-08-28:

- Phase 3 unit/integration suite: 38 files, 255 tests passed.
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

The ordered deployment gates completed as follows:

1. Reader, schema, migration and publisher changes were pushed through commit
   `b314a7f` and deployed live on Render.
2. The persistent Supabase migration entrypoint completed with no pending migration.
3. The English publisher ran with the reviewed local media manifest and reviewed
   Higgsfield taxonomy manifest, then exited successfully.
4. Supabase reconciliation confirmed artifacts, media, workflows, projections,
   bindings, snapshot and the active pointer for v12.
5. The production browser completed Hub → Image Gallery → Higgsfield Entity → image
   Detail, and the Detail language control switched to `zh-CN` through its real anchor.

All five gates are complete.

## Live release result

- Active publication: v12; previous verified version: v11; pointer revision: 6.
- Corpus: 1,043 artifacts; 1,043 exact reviewed model relationships; one reviewed
  Higgsfield model node.
- Release: 1,054 succeeded workflows, 1,054 bindings, 1,054 unique routes, one
  snapshot and zero failed workflows.
- Families: 1 Hub, 9 Gallery routes, 1 Entity and 1,043 Detail routes. The Gallery
  routes include four Image pages and five Video pages.
- Media: 642 image and 493 video evidence rows are eligible internal previews. Of the
  Detail pages, 873 are media-backed, 404 include image evidence, 489 include video
  evidence, 20 include both, and 170 keep the explicit unavailable state.
- Production Image Gallery reports 399 image prompt cards; its first page rendered
  150 real `<img>` elements. The clicked Detail retained the same X CDN image.
- All 16 Hub, Image Gallery, Entity and selected Detail locale identities returned
  HTTP 200. The browser-rendered Chinese Detail showed localized chrome and the
  source-language fallback disclosure while preserving prompt bytes.
- `https://bovideo-openlab.onrender.com/readyz` returned
  `{"database":"postgres","status":"ready"}` after the Render Free cold start.
