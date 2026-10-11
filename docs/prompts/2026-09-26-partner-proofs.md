# Partner proofs: World ID success path, Sui testnet and hosted demo UX

Given to Claude Code (Claude Opus 5.5) in the Claude desktop app on 26 September 2026 at 03:22 JST. The work is on branch `claude/partner-proofs`. The prompt is verbatim.

## Prompt

> Repo: /Users/chaipinzheng/Dev/tradebridge (TradeBridge, GitHub Ducksss/tradebridge, private for now; hosted demo https://tradebridge-sigma.vercel.app). ETHGlobal Tokyo 2026 submission is due Sun 27 Sep 2026 09:00 JST. Prize targets: Curvegrid (Best AI Agent Project), Sui (DeFi & Payments), World (Best Use of IDKit). Submission docs were written on the local branch `claude/submission-polish` (README judge guide, docs/SUBMISSION.md, docs/STATUS.md, docs/ai-usage.md); merge or rebase onto it if the user has merged it, and fill its TODO(before submit) comments and [TODO] markers only with verified facts.
>
> Gaps, in priority order:
>
> 1. World IDKit success path. src/world-id.ts verifies Proof of Human with require_user_presence via POST https://developer.world.org/api/v4/verify/{rp_id}, but even a valid proof returns 503 PRESENCE_AND_ENROLLMENT_UNCONFIRMED (src/world-id.ts:79) because src/server.ts:19-21 never injects a HumanTrustBoundary or StaffAuthority. World's prize requires one demonstrated successful verification, one alternative path (reject, cancel, or the same person on both sides), server-side verification and an integration debrief. Implement a demo-scoped trust boundary: static staff enrollment of one buyer approver and one broker approver, configured through env, clearly labelled demo-only in the UI, README, STATUS and video; keep production defaults closed. Use World's staging environment and simulator (simulator.worldcoin.org) for proofs if possible. Ask the user to create the Developer Portal app and relying party (rp_id, signing key); secrets go only in the git-ignored .env and are never printed or committed. Record the time from app creation to the first verified proof for the debrief.
> 2. Sui. Publish contracts/tradebridge to testnet with a fresh testnet-only key (ask the user to fund it from the faucet), mint DEMOBOND and DEMOUSD, run propose → attest → approve ×2 → commit → deposit ×2 → settle, and record the package ID, registry ID and each digest with Suiscan links. PRD v0.4 section 8 says to select the Sui prize only if a substantive Sui flow runs.
> 3. Hosted demo UX. After "Create proposal v2", the "Verify with World ID" and "Run buyer agent" buttons and step 4 are disabled with no explanation (web App.tsx:52, 71), the sidebar says "Development workspace" (App.tsx:42), the visitor is silently a buyer agent (src/hosted.ts:37), and index.html has no og:/twitter: tags although docs/assets/social-preview.png exists. Add short explanations on disabled actions in hosted mode, a clearer workspace label and the meta tags.
> 4. Optional: one live buyer and broker agent run with an OpenAI key (src/agents.ts) so the Curvegrid AI Agent claim is backed by a real model call.
>
> Keep `npm run check`, `npm run test:e2e` and `npm run test:move` green. Commit small and often (ETHGlobal penalises large commits). Never describe anything as live unless it ran. Record this work in docs/ai-usage.md and add its prompt under docs/prompts/.

## Follow-up

> Try again

## Notes

- A parallel Claude Code session reported that `claude/submission-polish` had been merged into `origin/main`, so this branch starts from `origin/main` (`8483103`).
- Decisions made while working, with reasons, are in the commit messages on this branch, [docs/INTEGRATIONS.md](../INTEGRATIONS.md) and [docs/STATUS.md](../STATUS.md).
