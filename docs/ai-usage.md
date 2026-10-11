# AI usage

ETHGlobal asks teams to disclose how they used AI. This is TradeBridge's record. AI coding agents wrote most of this repository under the team's direction; the team owns the product decisions and reviews the output.

## Tools

| Tool | What it did | Evidence |
| --- | --- | --- |
| OpenAI Codex | Implemented the code, tests, Move contracts, CI, assets and most repository docs, in commits `ef91337`, `42d2d54`, `6e15883` and `e36f71a` | Those four commits are the tips of the branches `codex/backend-foundation`, `codex/trade-workspace`, `codex/quantara-polish` and `codex/vercel-hosting` |
| Claude Code (Claude Opus 5.5) | Drafted the submission materials on 26 September 2026: the README summary, judge guide, team and AI usage sections, the status corrections, this file, `docs/SUBMISSION.md` and `docs/planning/README.md` | Commits from branch `claude/submission-polish` carry a `Co-Authored-By: Claude` trailer |
| Claude Code (Claude Opus 5.5), second session | Implemented on 26 September 2026: per-version World ID actions and the same-person refusal, the opt-in, staging-only demo trust boundary and staging after both approvals, the hosted-demo explanations and social meta tags, configurable dev ports, the Sui rehearsal script and the World ID demo helper, with their tests and doc updates | Commits from branch `claude/partner-proofs` carry a `Co-Authored-By: Claude` trailer. Prompt: [docs/prompts/2026-09-26-partner-proofs.md](prompts/2026-09-26-partner-proofs.md) |
| Claude Code (Claude Opus 5.5), third session, with Claude Sonnet subagents | Implemented on 26 September 2026: the Sui testnet deployment and live settlement flow (commit, per-party funding, the on-chain refusal of an underfunded settlement, atomic settlement and the settlement panel), `WorldHumanTrust` and the development staff directory for the production World ID app, World ID for Agents gating of agent drafts, the testnet, World signer and reset scripts, the 12px type scale, and this session's docs. It also drove the user's browser for the Sui faucet and the World Developer Portal setup, and merged the partner-proofs work | Commits from branch `claude/a-5673dc` carry a `Co-Authored-By: Claude` trailer. Prompts: [docs/prompts/2026-09-26-live-integrations.md](prompts/2026-09-26-live-integrations.md) |

<!-- TODO(before submit): confirm the Codex surface and model used, and whether any AI assistant helped draft the PRDs, pitch plan or deck; name it here if so. -->

No commit before the submission-polish branch carries an AI attribution trailer. The Codex commits were made under the maintainer's Git identity, so the branch names are the record of which work Codex did.

Separately, TradeBridge itself can call the OpenAI Responses API for its optional buyer and broker agents (`src/agents.ts`). That is a product feature, not build assistance. The buyer's agent first ran live on `gpt-6-luna` on 26 September.

The World ID for Agents and World ID integrations are also product features: they gate what the app's own agents and approvers may do, not how it was built.

## What the team did

- Wrote the product requirements: PRD v0.2, which targeted Hedera, and [PRD v0.4](PRD-v0.4.md), the Sui redesign with mandatory World ID approval. Both are in the repository ([planning artifacts](planning/)).
- Chose to redesign settlement for Sui.
- Set the design direction, including the Quantara template as the visual reference ([design notes](DESIGN-REFERENCE.md)).
- Chose the partner prize targets: Curvegrid, Sui and World.
- Directed the build task by task, and reviews the output. Review status per area is in the table below.

## Areas

| Area | Files | How it was made | Team review |
| --- | --- | --- | --- |
| Requirements and plans | `docs/PRD-v0.4.md`, `docs/planning/` | Written by the team. PRD v0.4 was the first commit (`549f93d`) | pending |
| API, storage and domain logic | `src/app.ts`, `src/domain.ts`, `src/store.ts`, `src/server.ts`, `src/config.ts`, `src/browser-session.ts`, `src/seed.ts` | Codex, from PRD v0.4 (`ef91337`, `42d2d54`) | pending |
| Integration engines | `src/world-id.ts`, `src/consent.ts`, `src/outbox.ts`, `src/sui.ts`, `src/agents.ts`, `src/reconciliation.ts` | Codex (`42d2d54`); per-version World ID actions and the same-person refusal by Claude Code (`claude/partner-proofs`); World ID config, presence and legacy-simulator options, and agent drafts by Claude Code (`claude/a-5673dc`) | pending |
| Live integrations | `src/sui-live.ts`, `src/chain-flow.ts`, `src/human-trust.ts`, `src/staff-directory.ts`, `src/world-agents.ts`, `web/components/ChainSettlement.tsx`, `web/components/AgentReview.tsx` | Claude Code (`claude/a-5673dc`); the World ID approval path and World ID for Agents were built by Claude Sonnet subagents and reviewed by the main session | pending |
| Demo trust boundary | `src/demo-trust.ts`, `test/demo-trust.test.ts` | Claude Code (`claude/partner-proofs`) | pending |
| Hosted demo | `src/hosted.ts`, `api/index.ts`, `vercel.json`, `.vercelignore` | Codex (`e36f71a`) | pending |
| Web workspace | `web/` | Codex (`42d2d54`), restyled by Codex to the team's design direction (`6e15883`); disabled-step explanations, identity label and meta tags by Claude Code (`claude/partner-proofs`) | pending |
| Move contracts | `contracts/tradebridge/` | Codex (`42d2d54`) | pending |
| Tests | `test/`, `e2e/`, `contracts/tradebridge/tests/` | Codex, alongside each feature | pending |
| Scripts, CI and config | `scripts/`, `.github/workflows/ci.yml`, `package.json`, `tsconfig*.json`, `vite.config.ts`, `playwright.config.ts` | Codex | pending |
| Teammate deploy workflow | `.github/workflows/vercel-deploy.yml` | Claude Code ([prompt](prompts/2026-09-26-teammate-vercel-deploys.md)) | pending |
| Rehearsal scripts | `scripts/sui-testnet.ts`, `scripts/world-demo.ts` | Claude Code (`claude/partner-proofs`) | pending |
| Deployment scripts | `scripts/testnet-deploy.ts`, `scripts/sui-publish.ts`, `scripts/world-signer.ts`, `scripts/live-reset.ts`, `scripts/localnet-rehearsal.ts` | Claude Code (`claude/a-5673dc`) | pending |
| Brand assets and screenshots | `docs/assets/`, `web/public/brand/`, `docs/screenshots/` | Codex (`6e15883`): original SVG artwork, and screenshots of the running app with synthetic data | pending |
| Repository docs | `DESIGN.md`, `UX-CONTRACT.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/DEPLOYMENT.md`, `docs/DESIGN-REFERENCE.md`, `docs/STATUS.md`, and the README before the submission-polish branch | Codex | pending |
| Submission docs | README summary, judge, team and AI usage sections; `docs/STATUS.md` level split; `docs/ai-usage.md`; `docs/SUBMISSION.md`; `docs/planning/README.md` | Claude Code | pending |

## Prompts

Claude Code prompts are in [docs/prompts/](prompts/). The prompts and task descriptions given to Codex are not yet committed.

<!-- TODO(before submit): export the Codex task prompts into docs/prompts/, one file per task (backend foundation, trade workspace, Quantara polish, Vercel hosting), and link them from this section. -->
