# ETHGlobal Tokyo 2026 submission copy

Ready-to-paste text for the ETHGlobal submission form, plus partner prize answers. Deadline: Sunday 27 September 2026, 09:00 JST.

Every claim here matches [STATUS.md](STATUS.md) on 26 September 2026. If a live step (World ID verification, Sui testnet publish, live agent run) starts working before submission, update STATUS.md first, then this file and the README. Items the team must fill in are marked `[TODO: ...]`.

## Form fields

### Project name

TradeBridge

### Short description

<!-- 92 characters, counted; the form limit is 100. -->

> Catch trade mismatches before settlement. Agents propose fixes; two verified humans approve.

Alternative (91 characters): "Catch trade mismatches before settlement: exact proposals, two human approvals, Sui escrow."

### Description

<!-- 1,345 characters. -->

> A buy-side desk books 1,000 bond units. Its broker books 1,100. Left alone, a break like this surfaces as a failed settlement. AFME notes that Euroclear Bank's 2023 fail rate of 9.52% falls to 6.27% once a handful of fails from instructing in nominal instead of units are removed.
>
> TradeBridge is a reconciliation workspace for buy-side and broker operations teams. It keeps both parties' original records with file hashes, flags every mismatched field deterministically and turns a fix into an exact, versioned proposal. The proposal's SHA-256 hash binds the economics, parties, recipients, chain and source records, so any edit is a new version. Scoped buyer and broker agents can read evidence and propose, but cannot verify, approve, fund or settle. By design, two distinct World ID-verified humans must approve the same hash before a Sui Move escrow swaps bond and cash in one transaction.
>
> What is real today: the Move escrow is on Sui testnet, and the local app runs the whole settlement there. It commits the approved agreement, funds each leg from its own wallet, shows the contract refusing a half-funded settlement and settles both legs in one transaction, each step linked on Suiscan. Approvals use a production World ID 4.0 app, and an agent's draft only becomes a proposal after its human authorizes it with World ID for Agents. The hosted demo shows the synthetic review flow. [TODO: after the two-phone run, say that both World ID approvals ran live; until then they are configured but not yet run.]

Source for the AFME figures: [AFME, "Is Settlement Efficiency Improving? The Answer is 'Yes'!", 3 May 2024](https://www.afme.eu/news-insights/views-from-afme/is-settlement-efficiency-improving-the-answer-is-yes/).

### How it's made

<!-- 1,799 characters. -->

> TypeScript end to end. A Fastify API on Node 22 with strict Zod schemas keeps trades, raw CSV rows, proposals and an append-only audit log in Node's built-in SQLite. Each write checks its idempotency key and expected revision and logs its audit entry in one BEGIN IMMEDIATE transaction. The React/Vite workspace talks only to that API. The hosted demo runs the same handlers on Vercel: each request restores a per-visitor SQLite snapshot from private Vercel Blob and saves it back with an ETag compare-and-swap.
>
> Amounts are u64-bounded integer strings. Net cash (quantity × price + interest + fees) is computed in BigInt and checked again in Move, where overflow aborts. Proposals are hashed as sorted-key canonical JSON behind a domain-separation prefix.
>
> Sui: a Move 2024 package with typed Coin legs, a frozen Agreement separate from the shared mutable Escrow, a rotatable verifier capability, single-use attestation receipts, exact funding caps, one-transaction settlement and funder-only refunds, covered by 17 scenario tests. @mysten/sui builders cover each step of the trade flow. Our effects verifier ignores events and checks the digest, checkpoint, executed settle call and exact recipient balance changes.
>
> World: IDKit 4.3.0 requests Proof of Human with fresh presence. The server signs the RP request under a per-version action, binds the signal to trade, version and hash, verifies with the v4 API and compares nullifiers in that action so one person cannot approve both sides. World ID for Agents gates the AI: an agent's draft becomes a candidate only after the server verifies its human's OIDC ID token itself (RS256 via JWKS, single-use jti) and writes the candidate in the same transaction.
>
> The live chain driver uses the gRPC client, serializes transactions per signer so owned objects never lock, funds each leg with coinWithBalance for its exact amount, and verifies every step from finalized effects.
>
> Agents get three strict tools, one tool call per turn, one proposal per run and a 403 on every privileged route, so they structurally cannot approve. OpenAI Codex wrote the original code under the team's direction; Claude Code built the live Sui and World integrations and drafted the submission docs (docs/ai-usage.md).

### Links

| Field | Value |
| --- | --- |
| Source code | https://github.com/blackduff32/TradeBridge [TODO: verify judge access before submission] |
| Live demo | https://tradebridge-sigma.vercel.app (synthetic data; health check at `/api/health`) |
| Demo video | [TODO: video URL] |
| Sui testnet package | `0x7bc4129e33ba9954efd5f4484c60ec6f2773a92a552e7559bb144a20f9dd499a` ([Suiscan](https://suiscan.xyz/testnet/object/0x7bc4129e33ba9954efd5f4484c60ec6f2773a92a552e7559bb144a20f9dd499a)) |

### Tech tags

| Form group | Tags |
| --- | --- |
| Blockchain networks | Sui (testnet) |
| Programming languages | TypeScript, Move |
| Web frameworks | React, Vite, Fastify |
| Databases | SQLite (Node built-in), Vercel Blob |
| Other | World ID, IDKit, World ID for Agents (OIDC), @mysten/sui, Zod, Node.js, OpenAI Responses API (gpt-6-luna agents), Vercel, Playwright, axe-core, GitHub Actions |

## Partner prize answers

### Curvegrid: Best AI Agent Project

Secondary fit under the same partner: RWA tokenization (bond-versus-cash settlement with approval workflows). The bond is a synthetic demo coin with no real-world rights.

**How we use it.** TradeBridge's buyer and broker agents are policy-aware transaction agents. Each reads only its own side's source record and the deterministic comparison, and may propose one correction per run (`src/agents.ts:8-12`, `src/agents.ts:66-89`). The rules live in server code, not in the prompt: three strict tools and `AGENT_TOOL_DENIED` for anything else (`src/agents.ts:32`), a 403 on every verification, approval, commitment, funding and settlement route (`src/app.ts:131-134`), exact u64 economics (`src/domain.ts:23-24`, `src/domain.ts:45-49`), and two distinct human approvals of the exact version hash before anything is committed (`src/consent.ts:33`, `src/consent.ts:43`, `src/consent.ts:72`). A proposal never changes the canonical record (`src/app.ts:116-130`).

**MultiBaas.** Not used. Settlement is designed for Sui Move, so this build has no EVM contract for MultiBaas to manage.

**What's live vs pending.**

- Live in the hosted demo and local app: deterministic comparison, hash-bound proposals, and 403s for agents on privileged routes (`test/api.test.ts:109`).
- Live on 26 September: the buyer's agent ran on `gpt-6-luna` through the OpenAI Responses adapter. In 10 seconds it read its own record, compared both books and drafted the correction its booking supports, citing both source IDs. The tool loop is also tested with test doubles (`test/agents.test.ts`).
- Tested with injected adapters only: two-person consent (`test/consent.test.ts`). Approval is closed in the running app unless the opt-in, staging-only demo roster is enabled (`test/demo-trust.test.ts`).
- Tested against a fake IdP: an agent's proposal is stored as a draft and becomes a candidate only after that side's human authorizes it with World ID for Agents (`src/world-agents.ts`, `test/world-agents.test.ts`).
- Pending: a live run of the broker's agent. [TODO: if run before submission, add what it proposed.]

**Feedback.** We did not use MultiBaas, so we have no product feedback. [TODO: add feedback if the team used Curvegrid docs or mentor sessions.]

### Sui: DeFi & Payments

**How we use it.** `contracts/tradebridge/sources/settlement.move` is a bond-versus-cash escrow for one approved trade version:

- Typed legs: the escrow holds `Balance<B>` bond and `Balance<C>` cash, and the two coin types must differ (`settlement.move:40-42`, `:72`). Demo coins use the coin registry (`demo_bond.move:6`).
- A frozen `Agreement` fixes the approved economics, separate from the shared mutable `Escrow` (`settlement.move:33-42`, `:135-136`).
- A verifier capability is bound to one registry and can be rotated, which voids outstanding attestations (`:18-19`, `:56-61`, `:89`). Attestation receipts are single-use (`:93`, `:126-127`).
- Each party approves from its own address, only after attestation (`:97-108`), and funds only its own leg, capped at the exact amount (`:147-158`).
- `settle` requires both exact balances and pays both legs in one transaction, or aborts (`:159-166`). Refunds go only to the original funder (`:172-183`). Amendments supersede the old agreement (`:113-121`).
- `src/sui.ts:26-88` builds each transaction with `@mysten/sui` 2.33.1. `src/sui.ts:95-110` verifies finalized effects without trusting events: digest, checkpoint, the executed `settle` call, exact recipient balance changes and no extra payouts.

The two deposits are separate transactions, because one party's transaction cannot spend the other party's owned coins. Only the final release is atomic (`docs/PRD-v0.4.md`, section 1).

**What's live vs pending.**

- Tested: 17 Move scenario tests pass in CI with warnings treated as errors (`contracts/tradebridge/tests/settlement_tests.move`). They cover atomic delivery and payment, exact partial funding, one-sided funding, wrong-sender deposits and approvals, overfunding, duplicate settlement, commits with one approval, unattested approvals, expired approvals, verifier rotation, receipt reuse, refunds to the original funder, operator redirection and supersession.
- Tested: transaction builders and the effects verifier (`test/sui.test.ts`).
- Rehearsed on a local Sui network (`sui start` 1.80.1) on 26 September: `npm run sui:testnet` published the package, finalized both demo currencies, minted exact DEMOBOND and DEMOUSD, and ran propose, attest, approve ×2, commit, deposit ×2 and settle with the app's own builders (`scripts/sui-testnet.ts`). Settling with one leg funded and settling twice both aborted on chain, and `verifySettlementEffects` confirmed the settlement from checkpointed data. The attestation receipts were synthetic, not World ID consents.
- Live on testnet since 26 September: package `0x7bc4129e33ba9954efd5f4484c60ec6f2773a92a552e7559bb144a20f9dd499a` ([publish](https://suiscan.xyz/testnet/tx/3o2p2zAEZ6BdThB5sjbhjG3FKNxQNu5R2DeAnyUuLsDv)), registry `0xc78aff0d0c9db6873c10bbc33d23fe30b8af52b0618f72129bfeec81bc3f7b1a`, and both demo coins registered and minted to the parties ([transaction](https://suiscan.xyz/testnet/tx/2nVHdWDLcwLEcsNS7meuiZ17bfu5WRxHmcPMzmRxAKmT)).
- Live in the local app: commit (propose, attest, buyer and broker approvals, commit), per-party funding, the contract refusing an underfunded settlement, and atomic settlement verified from finalized effects (`src/chain-flow.ts`, `src/sui-live.ts`). A 26 September rehearsal ran all nine transactions in about 20 seconds, for example [settle](https://suiscan.xyz/testnet/tx/GenYio6VT4bFFN23FA5bWJuuhk8kv7sEHhVeUyigRkPs) and the [refused settlement](https://suiscan.xyz/testnet/tx/3VVEEeh1gzMxCZTjcuo2ffBxJSTVu2buze43APxVr7Sq). Its two approvals were synthetic test consents. [TODO: add the digests from the recorded World ID run.]
- Demo simplification: the server holds the buyer and broker testnet keys and signs their transactions. In production each party signs from its own wallet.
- PRD v0.4 section 8 says to select this prize only if the build runs a substantive Sui flow. It now does.

**Feedback.**

- Walletless tests: on a clean machine, the Sui CLI's first run wants to create a client config and wallet. To keep tests and CI walletless we write an empty keystore and `client.yaml` into an isolated `SUI_CONFIG_DIR` (`scripts/move.mjs:11-19`). A documented walletless mode for `sui move build` and `sui move test` would remove this step.
- Version pinning: we pin the framework to the git tag `mainnet-v1.80.1` (`contracts/tradebridge/Move.toml:6`) and require the matching CLI (`scripts/move.mjs:7`). The word "mainnet" in the tag reads like a network choice, so we had to document that it is only a compiler and framework pin (`docs/INTEGRATIONS.md`, Sui section).
- Two-party settlement: a transaction cannot spend the counterparty's owned coins, so bilateral delivery-versus-payment needs each side to prefund a shared escrow in its own transaction. A reference pattern for two-party atomic swaps without prefunding would help.
- Hash interoperability: our terms hash is SHA-256 over canonical JSON, while Move works naturally with BCS bytes. We still need matching byte-level test vectors before committing hashes on chain (`docs/ARCHITECTURE.md`). A reference for hashing the same structured terms off chain and in Move would help.
- Public fullnodes no longer serve JSON-RPC ("JSON-RPC on public fullnodes has been deprecated"), so the rehearsal uses the SDK's gRPC client.
- The gRPC resolver simulates every full transaction build and throws on an abort. Recording a deliberately failing settle on chain needed a kind-only build plus explicit gas price, budget and payment (`scripts/sui-testnet.ts`, `unsimulated`).
- gRPC `getChainIdentifier` returns the base58 genesis checkpoint digest, while the CLI shows its first four bytes in hex (`4c78adac` for testnet), so the network check converts between them.
- Coin-registry finalization worked in one programmable transaction after publish, calling `finalize_registration` for both currencies (on localnet).
- Sponsored transactions let the operator pay all gas, so the buyer and broker keys never held SUI.
- The testnet faucet API refused our machine with "Too many requests from this client", after other projects on the same network had used it.
- The gRPC client reports framework types in normalized long form (`0x0000…0002::coin::Coin`), so comparing object types needed `normalizeStructTag` on both sides.
- Two concurrent transactions from one signer can lock its owned gas coins until the epoch ends, so the app runs one transaction at a time per signer.
- `coinWithBalance` made each deposit exact even when a minted coin holds more than one leg's amount.
- Ease of use (1-10): [TODO: team to rate]

### World: Best Use of IDKit

**How we use it.** The trust moment is approval: a proposal turns into money only when both firms approve it. Each approver must be a present human, not a stale session or an agent, and the buyer and broker approvers must be two different people.

- Credential: Proof of Human with `require_user_presence: true` and legacy proofs off (`web/components/WorldVerification.tsx:61`). It is the minimum that gives both liveness at approval time and a one-person-one-account guarantee. Nullifiers from one shared scope let the server refuse one person approving both sides (`src/consent.ts:43`, `src/consent.ts:72`).
- Not chosen: a passport (NFC) credential would be excessive, because it attests document attributes the organisation already knows, and the PRD rules out identity mappings on chain (`docs/PRD-v0.4.md`, section 4.1). Selfie Check has lower friction but no strict one-person-one-account guarantee.
- Personhood is not authority: staff enrollment stays a separate check (`docs/INTEGRATIONS.md`, World ID section).
- Per-version actions: each candidate version signs and verifies its own action (`src/world-id.ts:41-46`), because World ID 4.0 uniqueness proofs are one-time per person per action. Both sides of a version prove the same action, so one person verifying for both sides is refused at verification with `SAME_PERSON_BOTH_SIDES` (`src/world-id.ts:146-149`).
- Flow: the server signs the RP request with `@worldcoin/idkit-server` (`src/world-id.ts:99`) and binds the signal to account, side, trade, version, terms hash, chain, package, registry, nonce and expiry (`src/world-id.ts:103`). It accepts only protocol 4.0, `proof_of_human`, issuer schema 1 and `user_presence_completed: true` (`src/world-id.ts:64-84`), checks context and claims the challenge once (`src/world-id.ts:129-133`), then verifies with `POST https://developer.world.org/api/v4/verify/{rp_id}` and checks each result and the nullifier (`src/world-id.ts:135-138`).
- Alternative paths: an explicit Reject button (`WorldVerification.tsx:54`) records the decision and forces a new version with fresh verification from both sides (`src/consent.ts:40`). A cancelled or failed verification leaves the trade blocked (`WorldVerification.tsx:61-63`). Stale versions, replayed challenges and same-person approvals are refused (`src/world-id.ts:116`, `src/world-id.ts:133`, `src/world-id.ts:149`, `src/consent.ts:43`).

**What's live vs pending.**

- Implemented and tested against a stubbed World API (`test/world-id.test.ts:23-27`): everything in the flow above, including the reject and distinct-person paths (`test/consent.test.ts`), and the whole two-approver path through the API with the demo roster, ending in one staged correction (`test/demo-trust.test.ts`).
- Configured: a production Developer Portal app (`app_05dd091906db19227afe394e354c5d93`, relying party `rp_cf37062be91a081b`) with a registered signer. The server signs each request against it, and the IDKit widget opens with the production QR code. The first verification from two real phones is next. The hosted demo shows the button disabled and says why. `npm run world:demo` completes staging proofs through World's simulator MCP (`scripts/world-demo.ts`).
- Without a trust adapter, even a verified proof returns `503 PRESENCE_AND_ENROLLMENT_UNCONFIRMED` (`src/world-id.ts:139`). Two adapters ship: `WorldHumanTrust` for the configured app, which binds each account to one verified person per version and records presence as World App reports it (`src/human-trust.ts`), and a demo roster of one buyer and one broker approver: opt-in (`TRADEBRIDGE_DEMO_APPROVERS`), staging-only and labelled "Demo trust boundary" in the UI and `/health` (`src/demo-trust.ts`).
- [TODO: after the first live verification, add the date, the environment (staging or production), and the video timestamp for the success and reject paths.]

**Feedback (integration debrief).**

- Time to first successful verification: [TODO: minutes from creating the Developer Portal app to the first verified proof, and to verified proofs on both approvers' devices.]
- Our first design reused one action for every approval. World ID 4.0 uniqueness proofs are one-time per person per action, and World's migration guide calls repeated verification under one action an anti-pattern, so each approver could have approved only once, ever. Each candidate version now gets its own action (`src/world-id.ts:41-46`).
- `user_presence_completed` arrives inside the client-submitted proof (`src/world-id.ts:125-127`). We did not find how a relying party confirms on the server that the presence check happened, so `WorldHumanTrust` records presence as World App reports it, and says so (`src/human-trust.ts`).
- Developer Portal: actions live under World ID Configuration's Actions tab, while the sidebar's Verification entry is the app-store review flow. We registered the signer with **Use Existing Key**, generating the key locally into `.env` (`scripts/world-signer.ts`), so the private key never passed through the browser. World applied it on-chain in under a minute.
- An HTTP success from v4 verify means at least one proof verified, so we check each required result and the nullifier ourselves (`src/world-id.ts:136-138`, `test/world-id.test.ts:72`).
- The Proof of Human preset can include a legacy fallback, so we set `allow_legacy_proofs: false` explicitly (`docs/ARCHITECTURE.md`).
- The widget, core and server packages are versioned separately (4.3.0, 4.3.0 and 1.1.1), so we pin all three exactly (`package.json:36-38`). A compatibility table would help.
- For recurring checks World points to session proofs, which would suit binding a staff account to one person. The simulator's MCP endpoint completes only uniqueness requests, so the demo uses per-version uniqueness actions.
- Missing capability or docs: a presence result the server can verify.
- The one improvement with the greatest impact: a signed presence result in the v4 verify response. This is based on our reading of the docs. [TODO: confirm or revise after the first live verification.]
- Ease of use (1-10): [TODO: team to rate]

### World: Best Use of World ID for Agents

**How we use it.** The protected action is saving an AI agent's proposed correction as a candidate version. The buyer and broker agents can read evidence and draft terms, but never approve, fund or settle.

- The agent's proposal tool stores a draft, never a candidate (`src/agents.ts`).
- The server starts a device authorization with World ID for Agents using confidential client credentials. The browser only sees the user code and verification link, never the device code, secret or tokens (`src/world-agents.ts`).
- The side's human completes World ID. The server verifies the ID token itself with `node:crypto`: RS256 against the published JWKS, issuer, audience, expiry, fresh `auth_time` and `acr`. Each `jti` is accepted once, and each human account binds to one World subject.
- Only then is the candidate written, together with its audit event and the draft's AUTHORIZED state, in one transaction. Denied, expired and cancelled drafts are audited and never create a candidate.

**What's live vs pending.**

- Tested: 18 tests against a fake IdP with a real RSA key, JWKS, device and token endpoints (`test/world-agents.test.ts`), covering the approved path, denial, expiry, cancellation, a tampered signature, the wrong audience or issuer, a stale `auth_time`, a replayed `jti`, a different subject for the same human and a concurrent resolution.
- Live against World's sandbox on 26 September: `npm run agents:check` ran the device flow with the registered TradeBridge client, and the server verified the ID token with the app's own checks (`verifyIdToken`): issuer, audience, fresh `auth_time`, `acr` `https://world.org/oidc/acr/orb-v3`, `amr` `["pop"]` and `jti`. It took 145 seconds including a person approving it.
- Live in the app on 26 September: the buyer's agent drafted the correction, the buyer's human authorized it through World ID for Agents, and the server saved proposal v2 with an `AGENT_PROPOSAL_AUTHORIZED` audit event recording the issuer, a hash of the subject, `auth_time` and `acr`. [TODO: add the video timestamp.]

**Feedback (integration debrief).**

- The sandbox discovery document matched every assumption: issuer, authorize, token, device and JWKS endpoints, the `openid` scope, RS256, S256 PKCE and `client_secret_basic`.
- The client portal only admits Google accounts permitted for it, so registration waited on that access. It also requires a redirect URI even for a device-flow-only client.
- Time to first success: 145 seconds from the device authorization to a verified ID token, including the approval.
- Full debrief: `docs/WORLD-AGENTS.md`.

## Demo video script

Target 3:30 to 3:50. ETHGlobal rules: 2 to 4 minutes, a human voice (no text-to-speech or AI voice), no sped-up footage, and at least 720p (record at 1080p). Say "synthetic data" out loud, and label anything recorded earlier or not live. Never show `.env`, tokens or the World signing key.

Rows marked **If live** apply only once that step really works. Otherwise use the **Until then** version; never stage a success.

| Time | Screen | Narration | Proof on screen |
| --- | --- | --- | --- |
| 0:00-0:15 | Hosted demo entry screen, "Bring both sides to the same record" | "A buy-side desk booked 1,000 bond units. Its broker booked 1,100. At 10 per unit, that's 1,000 in cash that doesn't match. This is TradeBridge, and everything here is synthetic data." | "Synthetic demo" label |
| 0:15-0:30 | AFME article, then back to the app | "This isn't hypothetical. AFME notes that Euroclear Bank's 2023 fail rate drops from 9.52% to 6.27% once a handful of units-versus-nominal instruction errors are removed." | Article title and date |
| 0:30-1:00 | **Explore the 100-unit mismatch**, the amber banner, the table, then **Buyer evidence** | "Both original records stay exactly as imported. The comparison is deterministic code, not a model's opinion. Here's the raw CSV row and the SHA-256 of the file it came from." | "100-unit quantity difference", raw row, file hash |
| 1:00-1:25 | **Create proposal v2**, the saved hash, then **Agreement** | "A fix is a proposal, not an edit. Version 2 is 1,000 at 10, so 10,000. Its hash binds the amounts, both parties, the recipients, the chain and the source records. Change anything and it becomes version 3, and approval starts over." | "Version 2 saved for review", terms hash, "Original economics remain unchanged" |
| 1:25-1:50 | `src/agents.ts` tool list, `src/app.ts:131-134`, then a terminal running `npm test` | "Each side gets a scoped agent with three tools: read its own record, compare, propose. Anything else is refused, and every approval, funding and settlement route returns 403 to an agent. Two agents can't agree a trade into existence." | Tool list; passing test "all privileged paths reject agents and remain closed even to configured humans" |
| 1:50-2:35 | **If live:** buyer approver taps **Verify with World ID**, completes it in World App, taps **Approve this corrected trade**; the broker approver does the same on a second device; then the same person tries both sides and is refused. **Until then:** `WorldVerification.tsx:61`, `src/world-id.ts:64-84` and `:129-133`, and the World ID and consent tests passing | **If live:** "Approval is the trust moment. Each approver proves they're a present, unique human with World ID, then explicitly approves this exact hash. One person can't approve both sides." **Until then:** "Approval is the trust moment. We request Proof of Human with fresh presence, sign the request on our server, bind it to this exact version and hash, and verify with World's v4 API. This is tested against a stubbed World API. We haven't run it against a live World ID app yet, so approval stays locked." | **If live:** two verified approvals and the distinct-human refusal. **Until then:** passing test names and the disabled button in the hosted demo |
| 2:35-3:15 | **If live:** Sui explorer showing the package, the frozen Agreement, both deposit digests and the settle digest with both balance changes. **Until then:** `settle` and the refund functions in `settlement.move`, then `npm run test:move` | **If live:** "On Sui testnet, the approved terms are frozen in an Agreement object. Each side funds its own leg, and one settle transaction pays both. Our verifier reads the effects, not the events." **Until then:** "The Move escrow holds typed bond and cash coins, freezes the approved agreement, caps each deposit at the exact amount and settles both legs in one transaction, or aborts. Seventeen scenario tests cover the failure paths. It isn't deployed yet." | **If live:** digests on the explorer. **Until then:** "Total tests: 17; passed: 17" |
| 3:15-3:35 | **Audit trail**, then **Connections** | "Every saved change is in an append-only audit trail. And Connections says plainly what isn't connected yet." | Audit events; connection statuses |
| 3:35-3:50 | README top | "TradeBridge: evidence before execution. Agents propose, two people approve, and the escrow moves both legs or neither." | Repository URL |

## Live judging outline (four minutes)

| Time | Beat | Show |
| --- | --- | --- |
| 0:00-0:20 | The break: 1,000 against 1,100 units, and the AFME figure | README top |
| 0:20-1:10 | Evidence and the exact proposal | Hosted demo: banner, table, evidence, **Create proposal v2**, hash |
| 1:10-1:50 | Agents propose and cannot approve | `src/agents.ts` tools, `src/app.ts:131-134`, the passing 403 test |
| 1:50-2:40 | World ID at the approval moment: why Proof of Human with fresh presence, and the distinct-person check | Live verification if configured; otherwise the code path and tests, stated as tested with a stubbed API |
| 2:40-3:30 | Sui escrow: frozen agreement, exact funding, one-transaction settlement, effects verifier | Testnet digests if published; otherwise `settlement.move` and the 17 passing tests |
| 3:30-4:00 | What is live, what is next, and who uses it: buy-side and broker operations teams | **Connections** tab, then the README status table |

## Q&A bank

**Why Sui?**
Sui lets one shared escrow object hold typed bond and cash coins and release both legs in a single transaction that either completes or aborts (`settlement.move:159-166`). Frozen objects give us an immutable Agreement separate from the mutable Escrow, which matches the split between what was agreed and what moved (`settlement.move:33-42`, `:135-136`).

**Why World ID instead of a passkey?**
The buyer and the broker are different companies with no shared identity provider, so a passkey only proves that someone holds a device enrolled on one side. World ID gives a privacy-preserving proof that each approval came from a distinct, present human, not an agent or a second account (`src/consent.ts:43`, `:72`).

**What stops the agents agreeing on a wrong trade?**
Agent agreement counts for nothing: agents can only create unapproved proposals, and every verification, approval, commitment, funding and settlement route returns 403 to them (`src/app.ts:131-134`). A proposal moves forward only when two distinct humans approve the same version hash, and any edit creates a new version that needs both again (`src/consent.ts:33`, `:40`).

**What's not built yet?**
The two real World App approvals are configured against the production app but have not run yet, so the testnet settlement has only run with synthetic test approvals. Staff enrollment and the parties' wallets are development stand-ins, and the four-way reconciliation engine passes its tests but is not in the UI. Only the buyer's agent has run live.

**Why use AI at all instead of a CSV diff?**
The diff is deterministic and stays authoritative; the model never decides whether there is a mismatch (`src/domain.ts:115-127`). The agents read the evidence and draft the correction with a cited reason, the part an operations analyst otherwise does by hand, and they can do nothing else.

**What does the Move contract actually guarantee?**
Only what it encodes: two party approvals after a verifier attestation, single-use receipts, each leg funded only by its owner up to the exact amount, and settlement of both legs or neither (`settlement.move:88-166`). It trusts an off-chain verifier service for the World ID check; Move does not verify World ID proofs itself.

**What happens if a chain call times out?**
The commitment outbox stores the signed bytes and their digest before broadcasting, so after a timeout it looks up that digest first (`src/outbox.ts:40-57`). If the transaction is not found, it rebroadcasts the identical bytes and never builds a second transaction.

**How do you know the two approvers are different people?**
Both approvers of a version verify under that version's World ID action, so the same person produces the same nullifier. The server refuses it at verification with `SAME_PERSON_BOTH_SIDES` (`src/world-id.ts:146-149`) and again at consent with `DISTINCT_HUMANS_REQUIRED` (`src/world-id.ts:141-149`, `src/consent.ts:43`, `:72`). Separate accounts alone are never enough.

**Do you store biometrics or put identities on chain?**
No. World ID proofs carry no face data, and the Move package stores only opaque 32-byte receipt commitments, never nullifiers or staff identities (`settlement.move:86-91`).

**Why does a verified World ID proof still return 503?**
A proof shows personhood, not employment or trading authority, and we have not yet confirmed a presence signal the server can verify (`src/world-id.ts:139`). Until a trust adapter checks presence and staff enrollment, approvals stay blocked instead of being faked. For the demo, an opt-in roster of two approvers stands in on staging only, and the UI labels it "Demo trust boundary" (`src/demo-trust.ts`).

## Pre-submission checklist

- [ ] Make the GitHub repository public, then remove "The repository is private, so cloning requires access." from the README's Getting started section.
- [x] Choose and add a license, and update the README's License section.
- [ ] Record and upload the demo video (2 to 4 minutes, own voice, no text-to-speech, no speed-up, 720p or better). Add the link to the README header, the judge section and the form.
- [ ] World: create the Developer Portal app and relying party, put the `WORLD_*` values in the local `.env` only, run a first verification on both approvers' devices, and fill in the debrief timings in the README and above.
- [x] Decide how approval is shown: an opt-in, staging-only demo trust boundary (`TRADEBRIDGE_DEMO_APPROVERS`), labelled in the UI, README and STATUS.md. Say "demo trust boundary" in the video too.
- [ ] Sui: publish the Move package to testnet with a fresh testnet-only key. Record the package ID, registry ID, and commit, deposit and settle digests with explorer links in the README and above. Select the Sui prize only if this works.
- [ ] Fill every TODO: `grep -rn "TODO(before submit)" README.md docs/` and `grep -n "\[TODO" docs/SUBMISSION.md`.
- [ ] Team: names, roles, GitHub, X and LinkedIn handles for everyone (Curvegrid asks for them).
- [ ] AI usage: replace each "pending" in `docs/ai-usage.md` with the reviewer, confirm the Codex surface and model, and export the Codex prompts into `docs/prompts/`.
- [ ] Select partner prizes in the form: Curvegrid (Best AI Agent Project), World (Best Use of IDKit), and Sui (DeFi & Payments) only with a working testnet flow.
- [ ] Push, confirm CI is green, and check the hosted demo (HTTP 200) and `/api/health` just before submitting.
- [ ] Optional: upload `docs/assets/social-preview.png` under repository Settings, Social preview.
- [ ] Keep commits small until the end; avoid one large final commit.
- [ ] Submit before Sunday 27 September 2026, 09:00 JST, with a buffer.
