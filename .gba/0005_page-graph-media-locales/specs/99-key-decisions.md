# Page graph, media, and locales key decisions

Status: Accepted · Date: 2026-08-27

| ID | Decision | Why |
| --- | --- | --- |
| D1 | Link policy and indexability are independent. | A useful noindex preview page still needs normal navigation. |
| D2 | Media is carried inside PromptCard projection bytes. | Fixed layouts should consume one renderer contract, not perform request-time joins. |
| D3 | Private evidence needs explicit promotion before noindex preview delivery. | Prevents the renderer from silently bypassing Payload visibility policy. |
| D4 | Original prompt text remains byte-preserved across locales. | Matches generation behavior and avoids fabricating translated prompts. |
| D5 | Missing locale metadata uses a disclosed deterministic overlay of bound English bytes. | Makes all 16 controls functional without materializing ~16,000 unreviewed duplicates. |
| D6 | Exact published LocaleVariant projections always win over fallback. | Preserves the existing review and publication workflow as the authority. |
| D7 | Publisher concurrency uses fresh request carriers. | Payload mutates request transaction state; sharing it caused transaction and FK races. |
| D8 | Partial writes stay append-only and unbound. | They are audit evidence and cannot affect the active pointer. |
| D9 | Entity taxonomy enters Payload only through an explicit reviewed manifest with source-version scope and exact expected count. | The live corpus had zero taxonomy relationships; deriving an Entity from prompt prose would hide that data-plane gap and weaken review provenance. |
| D10 | Reviewed taxonomy uses candidate staging and one final all-node promotion/audit transaction. | Batch scalability is retained while a failed or interrupted ingress remains invisible to the projector. |
| D11 | PromptArtifact relationship Local/API changes atomically claim and increment `WHERE id AND revision`; taxonomy ingress additionally locks parent followed by relationship rows in the same Payload adapter transaction before re-read/merge/ID update. | Payload 3.88 bulk `where` is not a real SQL CAS and can otherwise skip parent writes. A stale waiter now fails instead of overwriting ingress, while one Payload-compatible lock order prevents cross-order deadlocks without bypassing hooks; exact retries still produce zero writes. |
