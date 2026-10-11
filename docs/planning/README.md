# Planning artifacts

These are the team's planning documents for TradeBridge. They are committed for ETHGlobal's rule that specs and plans be included in the repository. Each file is copied verbatim from the team's working copy; only the file names changed.

| File | What it is | Status |
| --- | --- | --- |
| [PRD-v0.2-hedera.md](PRD-v0.2-hedera.md) | Two-agent trade reconciliation PRD, v0.2, 25 September 2026. Settlement on Hedera. | Superseded |
| [pitch-plan-v0.2-hedera.md](pitch-plan-v0.2-hedera.md) | Judging pitch plan for the v0.2 design, aimed at the Curvegrid AI Agent track. | Superseded |
| [PRD-v0.3-sui.md](PRD-v0.3-sui.md) | First Sui redesign of the two-agent PRD, v0.3, 25 September 2026, before World ID approval was added. | Superseded by PRD v0.4 |
| [pitch-v0.3-sui.md](pitch-v0.3-sui.md) | Four-minute narrative pitch for the v0.3 Sui design. | Superseded |
| [pitch-v0.4-sui.md](pitch-v0.4-sui.md) | Four-minute narrative pitch for the v0.4 design, v0.4, 26 September 2026: two agents, fresh World ID verification on both sides, an immutable Sui agreement and four-way reconciliation. | Current pitch script. It describes the target workflow; present only the steps the build demonstrates |
| [pitch-deck-v0.4.pptx](pitch-deck-v0.4.pptx) | Five-slide deck with speaker notes for the same v0.4 pitch. | Describes the target workflow; its slides are labelled "Proposed workflow", not the current build |

## Which document is current

[docs/PRD-v0.4.md](../PRD-v0.4.md), dated 26 September 2026, is the current spec. It is the Sui redesign: it moves settlement to a Sui Move escrow, adds mandatory World ID approval by both parties, and supersedes the Hedera-specific architecture of the v0.2 documents and the v0.3 Sui draft. [pitch-v0.4-sui.md](pitch-v0.4-sui.md) is the matching pitch script; [docs/SUBMISSION.md](../SUBMISSION.md) adapts it to what the build shows today.

No Hedera code is in this repository. Its first commit (`549f93d`) added PRD v0.4. The v0.2 documents mention an earlier codebase, for example a review of commit `a45e83f`; that commit and its code are not part of this repository.

For what is built and tested today, see [STATUS.md](../STATUS.md).
