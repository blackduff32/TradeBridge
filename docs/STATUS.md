# Implementation status

Built from PRD v0.4 at ETHGlobal Tokyo 2026. Settlement runs live on Sui testnet, and World ID approvals use a production Developer Portal app. Each item below sits at one level: live, awaiting its first live run, implemented and verified, or implemented and tested only with stubs or injected adapters. Remaining work comes last.

## Live

- **Sui testnet.** Package [`0x7bc4129e…f9dd499a`](https://suiscan.xyz/testnet/object/0x7bc4129e33ba9954efd5f4484c60ec6f2773a92a552e7559bb144a20f9dd499a) and registry `0xc78aff0d…bc3f7b1a` were published on 2026-09-26, with demo cash and bond coins minted to the two party wallets.
- **Full settlement flow on testnet.** A browser rehearsal on 2026-09-26 ran all nine transactions in about 20 seconds: intent, attestation, buyer approval, broker approval, commitment, cash funding, the contract refusing an underfunded settlement, bond delivery, and atomic settlement. That rehearsal's two approvals were local test consents, not World ID proofs.
- **World ID 4.0 app.** Production app `app_05dd091906db19227afe394e354c5d93` with relying party `rp_cf37062be91a081b` and a registered signer, whose key is held only in the private `.env`. The server signs each request against it, and the IDKit widget opens with the production QR code.
- **World ID for Agents, end to end in the app.** On 2026-09-26 the buyer's agent (`gpt-6-luna`) drafted a correction in 10 seconds. The buyer's human authorized it through World ID for Agents' sandbox, and the server verified World's ID token and saved it as proposal v2 in the same transaction as its `AGENT_PROPOSAL_AUTHORIZED` audit event. `npm run agents:check` separately verified the device flow and token in 145 seconds.

## Implemented and tested, awaiting a live run

- **Two real World App approvals.** Two Orb-verified people each verify on their own phone, then approve the same version, followed by settlement on testnet. Everything is configured; only the live session remains.

## Implemented and verified

- TypeScript/SQLite API: original source retention, exact comparison, candidates, revisions, idempotency, audit and access scope.
- React workspace: sample/credential sessions, source CSV import, side-by-side evidence, proposal form, agreement inspection, bilateral approval status, live settlement panel with per-step transaction links, audit and connections.
- Local HttpOnly/SameSite sessions, origin enforcement, isolated synthetic tenant and removable demo working data.
- World ID 4.0 widget, signed RP challenge, exact signal binding, server proof forwarding/validation, one-use challenge claiming and stale/replay rejection.
- Each candidate version signs and verifies its own World ID action, because World ID 4.0 uniqueness proofs are one-time per person per action. One World ID verifying for both sides of a version is refused at verification.
- Trust adapters. `WorldHumanTrust` serves a configured World ID app: it binds each account to one verified person per version and records presence as World App reports it in the proof. The opt-in demo roster (`TRADEBRIDGE_DEMO_APPROVERS`) refuses any World environment but staging and is labelled in `/health`, `/integrations` and the UI. Without a World ID app, approval stays blocked, and no browser flag waives it.
- Explicit consent records: separate proof/decision, shared-scope distinct humans, role rechecks, rejection/expiry, one-use consumption and atomic canonical correction staging, which the approvals route triggers after the second approval.
- Move package: frozen immutable agreements, separate mutable escrow, restricted/rotatable verifier capability, two party approvals, exact/partial funding, atomic payout, cancellations/refunds, receipt replay protection and supersession. Verified by 17 Move scenario tests and published to testnet.
- Modern coin-registry demo asset definitions and pinned compiler/framework.
- Live Sui driver and chain flow: commitment through the durable outbox (signed bytes and digest persisted before broadcast), per-party funding, an on-chain proof that underfunded settlement is refused, and atomic settlement verified against finalized effects.
- Buyer/broker scoped agent tools, real OpenAI Responses adapter, six-turn/one-proposal budget, evidence envelopes and durable run deduplication. Agents can only store drafts; a candidate needs the side's human to authorize it with World ID for Agents.
- CI for backend, browser/accessibility and Move tests.
- Quantara-inspired dark visual system, original TradeBridge mark and wireframe artwork, responsive entry flow, real product screenshots and branded repository assets. The design distillation is recorded in `DESIGN-REFERENCE.md`.
- Vercel-hosted synthetic demo with private Blob snapshots, isolated secure cookies, compare-and-swap proposal persistence and public credential/import restrictions. See `DEPLOYMENT.md`.
- Every disabled next step says why (World ID, agent runs, commit and settle), the sidebar shows the signed-in role, and the hosted notice says the visitor acts as the buyer's scoped agent. Links unfurl with Open Graph and Twitter tags. Verified locally by the browser flows; the hosted copy updates on the next deploy.
- Sui rehearsal script (`npm run sui:testnet`): on 26 September 2026, on a local Sui network (`sui start`, 1.80.1), it published the package, finalized both demo currencies, minted exact DEMOBOND and DEMOUSD, and ran propose, attest, approve ×2, commit, deposit ×2 and settle with the app's own builders. Settling with one leg funded and settling a second time both aborted on chain, and `verifySettlementEffects` confirmed the settlement from checkpointed data. The script's attestation receipts are synthetic, not World ID consents. The testnet run above used the app itself instead.

## Implemented and tested with stubs or injected adapters

- World ID proof verification against World. Tests use a stubbed World API response, including the full two-approver path through the API with the demo roster (`test/demo-trust.test.ts`). The production app exists, but no live verification has run yet. `npm run world:demo` completes staging proofs through World's simulator MCP.
- World ID for Agents' denied, expired and cancelled paths, against a fake IdP with a real RSA key and JWKS. The approved path's token verification also ran live (see above).
- The broker's agent. It uses the same adapter and tools as the buyer's agent, which ran live, but has itself only run against test doubles.
- Four-way reconciliation engine requiring approved terms, verified effects and both book postings; mismatches propose adjustments without changing books. Not yet exposed in the API or UI.

## Verification

- 114 backend/domain/integration-boundary tests pass, including the World ID for Agents and demo-roster suites.
- 17 Move scenario tests pass with warnings treated as errors.
- Four browser flows pass, including desktop/mobile accessibility, actual proposal persistence, preserved source evidence, keyboard entry, validation, conflict recovery, retained drafts across navigation and network-error recovery.
- The hosted browser flow passes on Vercel, including save/reload persistence, isolated visitors, blocked execution and mobile accessibility.
- TypeScript, production build, strict UI contract audit and design-document lint pass (lint reports informational orphan-token warnings because runtime CSS owns tokens).
- Sample assets carry no real-world value.

## Trust assumptions and remaining work

1. **The verifier service is trusted.** Move does not verify World ID proofs natively; the verifier capability attests opaque receipt commitments that the server derived from verified proofs.
2. **Presence is reported, not signed.** `user_presence_completed` arrives inside the client-submitted proof, and World's verify response carries no signed presence result. Both trust adapters record presence as reported.
3. **Person binding is per version.** Per-version actions keep nullifiers unlinkable across versions, so an account's binding to one person holds within a version. World ID session proofs could bind a staff account across versions.
4. **Development accounts.** Approvers sign in with development tokens, and a development staff directory answers whether they are current. An organizational identity and role provider would replace both.
5. **Custodied demo wallets.** The server holds the buyer and broker testnet keys and signs their transactions. In production, each party would sign from its own wallet.
6. **Book postings.** The four-way engine still needs authenticated book-posting adapters, with its results shown in the UI.

Local tests are not a security audit. See `INTEGRATIONS.md` for setup and trust boundaries.
