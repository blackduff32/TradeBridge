# Integration setup and remaining gates

## World ID

Implemented: pinned `@worldcoin/idkit` 4.3.0, official server RP signing, server-owned five-minute challenges, exact version/context signal binding, Proof of Human without legacy fallback, required fresh presence request, complete proof forwarding, strict verification-result checks, durable challenge claiming and replay/stale-version rejection. The widget is lazy loaded and only available to the matching development human principal when configured.

**One action per candidate version.** World ID 4.0 uniqueness proofs are one-time per person per action, and World's migration guide calls repeated verification under one action an anti-pattern. With a single fixed action, each approver could approve once, ever. `WORLD_ACTION` is therefore a prefix: each candidate signs and verifies its own action, `<prefix>-<first 32 hex of sha256(tenant, trade, version, terms hash)>`, and World creates it on first verification. Buyer and broker prove the same action for a version, so their nullifiers are comparable. The first account a nullifier verifies for keeps it: the same person verifying for the other side gets `403 SAME_PERSON_BOTH_SIDES`, and the consent engine's distinct-person check stays in place behind it.

Create a World ID Developer Portal app (not a Mini App) with a World ID 4.0 relying party. No action needs to be created in the portal. Add these private local environment variables:

```text
WORLD_APP_ID=app_...
WORLD_RP_ID=rp_...
WORLD_ACTION=tradebridge-approval
WORLD_ENVIRONMENT=staging
WORLD_SIGNING_KEY=<server-only relying-party signing key>
```

Restart the API. Sign in with the appropriate buyer/broker **human** development token, create a candidate, and launch the World ID request. Staging verifies only against World's simulator and cannot substantiate a live face-verification claim.

**Without a trust adapter, approval remains blocked even after a successful proof.** The official API response is not, by itself, sufficient evidence that TradeBridge has authenticated fresh presence or the user's organizational authority. `WorldIdService` requires a `HumanTrustBoundary` implementation for presence and staff enrollment/current authority, and no browser flag can waive it.

**Configured app (`WorldHumanTrust`).** With a World ID app configured and no demo roster, the server injects `WorldHumanTrust` (`src/human-trust.ts`) and a development staff directory (`src/staff-directory.ts`). `WorldHumanTrust` binds each account to one verified person per version on first use, so one person can never back both sides, and it records presence as World App reports it in the proof. The directory only answers whether an approver is still a configured human account. For the production app, set `WORLD_ENVIRONMENT=production`, create the signer with `npm run world:signer` and register the printed address in the Developer Portal under **Use Existing Key**. `WORLD_REQUIRE_PRESENCE` defaults to `true`.

**Demo trust boundary (staging only).** To demonstrate the approval path, `src/demo-trust.ts` provides a labelled stand-in for both adapters. It is off unless you name exactly one buyer and one broker human principal:

```text
TRADEBRIDGE_DEMO_APPROVERS=buyer-human,broker-human
```

The server refuses to start with it unless a World ID app is configured with `WORLD_ENVIRONMENT=staging`. Staff enrollment is that static roster. Presence is the `user_presence_completed` flag IDKit reports in the proof, because World's verify response carries no signed presence result. Each approval's person binding is a hash of the per-version scope and nullifier. `/health` reports `configured_demo_trust_boundary`, `/integrations` reports `trust: demo_static_roster`, and the approval cards and Connections say "Demo trust boundary". This is not production staff authentication.

**Staging verification window.** Another team project found that World's verify API accepts staging proofs only while the team has a 24-hour staging verification window open, and otherwise answers `403 environment_not_allowed`. World's public docs do not mention this yet. The window is opened with the Developer Portal MCP tool `set_world_id_staging_verification` (`app_id`, `enabled: true`), which needs a team API key that a team member creates in the portal. It returns a token once: set it as `WORLD_STAGING_VERIFICATION_TOKEN` and the server sends it as the `x-staging-verification-token` header. With the window closed, verification fails as `WORLD_STAGING_WINDOW_CLOSED` instead of a generic rejection. Production proofs from a real World App need no window, and the token is refused outside staging.

To run the path without a phone, start the app with those settings, then:

```sh
npm run world:demo -- prepare          # import both synthetic records and propose v2
npm run world:demo -- approve buyer    # the simulator MCP proves; TradeBridge verifies and approves
npm run world:demo -- approve broker --manual   # paste the printed URL into simulator.worldcoin.org
npm run world:demo -- status
```

`approve` opens the same IDKit request as the widget and asks World's simulator to complete it through its MCP endpoint (`https://simulator.worldcoin.org/api/mcp`, tool `complete_test_request`) with a real staging Proof of Human. The TradeBridge server then verifies the proof with World. The MCP always proves as one default simulator identity, so approving the broker the same way demonstrates the same-person refusal. `--manual` prints the connector URL instead; paste it into the browser simulator and choose a different identity to act as a second person. Add `reject` to record a rejection. Each verification is appended to `.tools/world-demo.log` with its duration. In the browser, the same flow works with two windows signed in as the two approvers and the simulator open beside them.

The consent engine and UI implement an explicit approve/reject step after server verification. Consent is bound to the verified challenge, actor, role, exact hash/version, common identity scope and fifteen-minute/trade expiry. Two distinct people are mandatory. An injected StaffAuthority rechecks current roles before consent and correction staging. When the second side approves, the approvals route stages the correction: both consents are consumed atomically with one durable instruction and a versioned canonical correction. Without `TRADEBRIDGE_DEMO_APPROVERS`, the server supplies neither trust adapter nor staff authority, so this path stays closed. No live verifier-service attestation has been issued. The UI keeps proof, consent, commitment and settlement separate.

Sources: [IDKit integration](https://docs.world.org/world-id/idkit/integrate), [credential/presence configuration](https://docs.world.org/world-id/idkit/credentials), [verification API](https://docs.world.org/api-reference/developer-portal/verify). Reviewed during implementation; provider HTTP success means at least one proof verified, so required results and context are checked individually.

## Sui

The Move package pins the official `mainnet-v1.80.1` framework source and has been compiled/tested with `sui 1.80.1`. The release tag pins the compiler/framework version; **it does not mean the app connects to mainnet**. The app itself holds no keys and submits nothing to any network.

### Testnet rehearsal

`scripts/sui-testnet.ts` runs the escrow end to end with the same builders and effects verifier the app uses (`src/sui.ts`):

```sh
npm run sui:testnet -- keys       # fresh testnet-only keys in .tools/sui-testnet (mode 600); prints addresses only
npm run sui:testnet -- balances
npm run sui:testnet -- publish    # publish contracts/tradebridge, finalize both demo currencies
npm run sui:testnet -- flow       # mint, propose, attest, approve x2, commit, deposit x2, settle
```

Fund the printed operator address from the [testnet faucet](https://faucet.sui.io) first; it publishes, holds the verifier capability and sponsors every transaction's gas, so the buyer and broker keys never hold SUI. `flow` mints exact DEMOBOND and DEMOUSD, builds a v2 candidate with the app's domain code bound to this deployment and these addresses, and runs every step. It also executes two denied paths on chain: settling with only the bond deposited, and settling again after settlement. Both must abort. Finally it decodes the checkpointed settle transaction and checks it with `verifySettlementEffects`. The attestation's receipt commitments are synthetic in this rehearsal, not World ID consents. Each run is recorded in `.tools/sui-testnet/run-*.json`.

`SUI_NETWORK=localnet` runs the same commands against `sui start --with-faucet`, with separate keys in `.tools/sui-localnet` and a `faucet` command. Every command checks the chain identifier before it signs.

Install the [official Sui CLI](https://docs.sui.io/getting-started/onboarding/sui-install), or point `SUI_BIN` at the pinned executable:

```sh
SUI_BIN=/absolute/path/to/sui npm run test:move
```

The test runner also recognizes a gitignored `.tools/sui` executable. It creates an isolated empty keystore/config in `.tools/sui-config`; contract tests never need a wallet, signing key or faucet. GitHub Actions downloads/caches the pinned official Linux binary and runs the same tests.

Contract design:

- A shared intent binds exact economics, asset type parameters, recipients, expiry, trade/version/hash and registry identity.
- A registry-bound verifier capability attaches two unique opaque receipt commitments. Its service must establish human verification and consent off-chain; Move does not verify native World ID proofs.
- Buyer and broker each send a separate role-authorized approval transaction after attestation. One approval or an unattested wallet approval fails.
- Commitment consumes both receipt IDs, freezes the agreement and creates a separate shared escrow. Actual execution fields are stored in the immutable agreement, not inferred from the hash.
- Each party funds only its own typed leg. Partial deposits are allowed up to the exact cap; settlement requires both exact balances and transfers both legs in one transaction.
- Either party may cancel an uncompleted escrow, after which each original funder can refund their own leg. Expiry independently enables refunds. Operators cannot redirect refunds.
- Amendments require a new attested/approved intent, a higher version, the same participants, and a fully unfunded/refunded prior escrow. The registry transition makes the old agreement unexecutable.
- Verifier capability rotation invalidates outstanding uncommitted attestations. It does not rewrite committed economics.
- Demo currencies use the current coin-registry initializer, with 0 bond decimals and 2 cash decimals. Final registration and issuance remain deployment tasks.

`src/sui.ts` builds proposal, attestation, party-approval, commitment/amendment, funding, cancellation, refund and settlement PTBs and validates normalized finalized effects. It checks exact recipients/amounts, the executed package/module/function, agreement/escrow/registry references, checkpoint, digest and network. It does not trust an event alone. The commitment outbox persists signed bytes and their digest before broadcasting. Leased workers query existing digests after timeouts/restarts; not-found retries reuse exactly the same bytes, while unknown observations stay unresolved. The live driver (`src/sui-live.ts`) and chain flow (`src/chain-flow.ts`) implement CommitDriver against testnet with testnet-only keys held in the private `.env`, including authority/expiry preflight; they check the chain ID at boot. Funding and settlement execute directly and are verified from finalized effects; only commitment goes through the durable outbox. The four-way engine is implemented but authenticated book adapters and UI integration remain pending.

The verification service remains a trust assumption. Capability custody, party-account binding, role revocation policy, formal hash/BCS interoperability and a security review are required before a full PRD claim. The testnet deployment is described in [STATUS.md](STATUS.md). Unit tests do not constitute an audit.

## Scoped model agents

Optional server configuration (never exposed to the browser):

```text
OPENAI_API_KEY=<private provider key>
TRADEBRIDGE_MODEL=<model available to your account>
```

Restart the API, sign in as a buyer or broker agent, and choose **Run buyer/broker agent**. Each explicit run sends that role's source plus exchangeable comparator evidence to OpenAI. The fixed Responses API adapter uses strict function schemas, no provider response storage, at most six turns and one proposal. It preserves reasoning/output items required by the provider protocol. Each role has an independent context; neither can read the counterparty's private account/source row, change canonical economics, invoke arbitrary tools, or verify/approve/fund/settle. Server tools enforce these limits regardless of model instructions.

The source import/comparison and manual proposal path works without a model. No fake agent output is substituted. Model calls have been tested with injected responses; no live paid call was made. Failed/ambiguous runs are not automatically rerun, because a tool may already have saved a proposal. Inspect audit/proposals before explicitly beginning another run.

Reference: [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling).
