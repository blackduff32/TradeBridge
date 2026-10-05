# TradeBridge interaction contract

Business sources: `docs/PRD-v0.4.md` owns approval and settlement policy; `docs/API.md` and `src/app.ts` own write semantics. UI behavior cannot expand authority. No sibling UI existed before this milestone; review, audit and connections now share the same shell and primitives.

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | web/components/ui.tsx Field + feature forms | PRD, API | import, proposal, session | browser tests |
| Scrollbar | web/styles.css | DESIGN.md | document, table | mobile/desktop tests |
| Toast | web/components/ui.tsx Notice | this contract | status, error | live-region tests |
| CRUD | web/api.ts and App controller | API | candidate create; sources read-only | API/browser tests |
| Date | web/format.ts | API | UTC read-only; no picker | formatting tests |

No table selection, bulk operations, select/listbox, editable date picker or destructive deletion exists in this release.

The review route opens a scoped trade. Import returns to the same trade and refreshes evidence. Proposal submission stays on the review, updates version/hash only after server confirmation and retains originals. Audit is read-only. No financial write is optimistic. No correction, approval or commitment is implied by proposal creation.

Session cookies are HttpOnly, SameSite Strict and short lived; secrets never enter persistent browser storage. Development token sign-in is explicitly labeled. The sample session is a separately scoped local sandbox, never a way to impersonate a real approver. Browser mutations enforce same-origin checks server-side.

Inputs remain on validation, conflict and network failure. A request intent keeps its idempotency key across uncertain retries. A stale revision requires refreshing evidence and consciously resubmitting. Navigation keeps the proposal form mounted in controller state; no silent lost edits. Session expiry clears confidential trade data and requires signing in again; unsaved edits may need to be re-entered. CSV contents and tokens are never written to browser storage.

UI modes: initial session check, no trades, missing source, mismatch, proposed revision, integration blocked, request failure, conflict. Only server-confirmed results count as saved. API errors persist inline; users can refresh safely. Requests time out and have explicit retry. Competing reads are canceled or generation-checked.

English labels; exact decimal formatting uses BigInt, locale en-US, timestamps UTC. All buttons are keyboard accessible, forms own validation, status is communicated in text, tables use native semantics. At narrow widths the proposal follows the evidence and the table scrolls internally. Reduced motion is respected. Root scrollbars are styled with accessible platform fallback.

Visual update: the unauthenticated entry uses a brand register and anchors for the review method and development access. The authenticated workflow remains the same scoped product surface. Both share the dark token system and brand primitive; entry navigation never implies a trade operation.

Hosted Vercel mode exposes only isolated synthetic samples: hide development-token entry and CSV import; label the workspace Hosted demo and disclose the one-hour session. Proposals persist across refreshes through private conditional snapshot writes. Storage conflict/error states must preserve user input and never claim success.
