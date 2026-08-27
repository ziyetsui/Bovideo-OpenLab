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
