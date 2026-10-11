# TradeBridge on Sui — Two-Agent Reconciliation PRD

**Version:** 0.4 · 26 September 2026  
**Status:** Sui redesign of the two-agent proposal, not a tested implementation. Supersedes Hedera-specific architecture in earlier PRDs.  
**Primary target:** Curvegrid Best AI Agent Project. **Second partner target:** Sui DeFi & Payments, only if the working demo executes a substantive Sui financial flow.  
**Core promise:** Buyer (in-house) and broker agents detect a disagreement before settlement; an authorised human on each side completes fresh World ID face verification and explicitly approves the same corrected price, volume and full trade version; only then does the system apply the correction and commit an immutable agreement to Sui; a Sui Move escrow releases tokenized asset and payment together only after that approval; independent reconciliation checks each party's books against Sui transaction effects.

**v0.4 change:** Adds mandatory World ID face verification to bilateral mismatch resolution, including version-bound human consent, correction gating, immutable agreement commitment, failure handling and acceptance tests. The supporting pitch documents provide context; this revision changes the Sui PRD only.

## 1. Architecture and trust boundaries

- **Buyer-side (in-house) agent:** reads the buyer's authenticated order and proposes evidence-backed comparisons; cannot approve for either human, complete their face verification, apply disputed corrections or sign payment.
- **Broker-side agent:** reads the broker's confirmation and proposes amendments; cannot approve for either human, complete their face verification, apply disputed corrections or sign delivery.
- **Deterministic comparator/policy service:** compares typed fields and blocks mismatches, unapproved versions, expired holds and unsupported assets. Agent narratives do not override it.
- **Two authorised human approvers:** one designated buyer/in-house approver and one distinct broker approver. Each uses their organisational account, completes a fresh World ID face verification for the proposed correction, and explicitly approves the *same* canonical trade ID, version, terms hash, chain ID, asset types, unit price, quantity, net payment and expiry. Any change to the approval-bound record requires fresh verification and consent from both.
- **World ID verification and approval service:** verifies proof and required presence evidence server-side, checks the approver's current organisational role, binds the result to the exact amendment, and issues a single-use approval record. Agents have no access to its attestation key or human approval credentials. A World ID proof alone does not establish employment, trading authority or agreement with the terms.
- **Sui Move agreement and settlement module:** requires both role-scoped approvals and their verification attestations before committing the corrected agreement; it then holds the two asset legs and releases both balances or aborts both releases. The MVP trusts a restricted verification service for the World ID check and enforces its attestation in Move; this is not native World ID proof verification on Sui. An application-only gate is an incomplete implementation of this PRD.
- **Reconciliation service:** verifies finalized Sui effects and token movement, then compares approved terms, buyer book and broker book. It proposes, rather than silently writes, adjustments.

**Sui object-model warning:** Sui PTBs execute multiple commands atomically, but that fact does *not* automatically permit one party's transaction to consume another party's address-owned coin objects. For the weekend MVP, each party deposits its own asset into a shared escrow in **separate authorized transactions**; a final settlement transaction conditionally distributes both assets in one atomic operation. Prefunding has custody, withdrawal, expiry and liveness risks that need explicit controls. An alternative all-in-one multi-signature/authorization design requires separate feasibility work; do not assume a standard multisig substitutes for two separately owned coin inputs. [Sui PTBs](https://docs.sui.io/develop/transactions/ptbs/), [multisig](https://docs.sui.io/develop/transactions/transaction-auth/multisig)

## 2. Four-minute demo workflow

1. Buyer agent imports an authenticated order to buy **1,000 DEMOBOND** units at an illustrative agreed unit price of **10 DEMOUSD**; broker agent imports a confirmation for **1,100 DEMOBOND**. These are team-created test assets and synthetic economics, not a real bond or redeemable dollar.
2. Agents exchange field-level evidence with source row, timestamp and signer/role. Comparator yields `QUANTITY_MISMATCH = 100 units`. The settlement API refuses the request and the Move escrow is not settled.
3. Broker agent proposes correcting the confirmation to 1,000; buyer agent checks the proposal against its order. Candidate `v2` displays the before/after quantity, agreed unit price of 10 DEMOUSD and resulting net payment of 10,000 DEMOUSD with zero demo fees/interest. It remains a proposal, not an applied correction. The designated human on each side independently reviews v2, completes fresh World ID face verification, and explicitly approves its identical terms hash. One side's verification or approval is insufficient.
   - Once both approvals pass, the correction service applies exactly v2 to the versioned canonical record and submits its immutable agreement commitment to Sui. The UI remains `COMMIT_PENDING` until confirmed effects establish `AGREEMENT_COMMITTED`. Original source records remain preserved. Funding and settlement remain blocked before commitment.
4. The buyer deposits precisely the approved demo-cash amount into the Sui trade escrow; the broker deposits precisely the approved demo-bond amount. The UI shows which leg is funded and whether both deposits match v2. Require funding **after confirmed agreement commitment** to minimize exposure; a rejected or expired trade must offer independently authorized refunds.
5. An authorized service submits the final `settle(v2)` call. The Move module checks the committed agreement for approved v2, both funded legs, exact amounts, asset types, recipients, expiry, consumed flag and applicable access rules. On success, it transfers the bond to the buyer and cash to the broker in one Sui transaction; on abort, neither payout occurs.
6. Verifier inspects the transaction digest, effects status and balance/object changes, ties it to the approved hash and updates each book's reconciliation state. Show `SETTLED_BOOK_MISSING` if one book has not posted the trade.

**Required blocked counterexample:** After v2 approval, attempt to settle an unapproved 1,100-unit v3 or a partially funded escrow. The backend must refuse before signing; the Move module must also reject direct unauthorized calls where applicable. Show the failing Move test, not only a disabled UI button.

## 3. What can be traded on Sui?

Tradeability has four independent gates: **technical token representation, holder/transfer permissions, actual commercial/legal rights, and available counterparty/liquidity**. A token type existing on Sui does not mean it is a real security or that your app may freely trade it.

| Asset leg | Sui representation/use | Fit for this MVP | Caveat |
|---|---|---|---|
| Team-created demo bond units | A new Sui fungible `Coin<DEMO_BOND>` or regulated demo currency; define 0 or agreed decimal places and test issuer controls | **Best delivery leg**; simple quantity matching and cash-versus-asset demo | Call it a *simulated tokenized bond unit*, not a legally issued bond. Team-issued tokens do not confer real issuer claims by default. |
| Team-created demo cash token | `Coin<DEMO_USD>` with explicit decimals and mint authority | **Best initial payment leg** on Sui testnet/localnet; avoids testnet USDC availability assumptions | Not actual dollars or USDC; no promise of redemption. |
| Native USDC on Sui | Circle-issued USDC type on Sui mainnet | **Good real-world payment example** for future piloting | Verify the exact coin type, network, balances and permissions. Do not treat bridged USDC as native USDC or assume mainnet USDC is freely available on testnet. |
| SUI | Native Sui asset, usable as a traded asset or to pay gas | Optional payment/benchmark leg | Volatility makes it a weaker stand-in for a cash-denominated bond settlement. |
| Other Sui fungible tokens such as DEEP | Typed coins where owner permissions and on-chain liquidity permit | Optional future spot reconciliation | A token's existence does not guarantee a DeepBook pool or compliant institutional settlement. |
| Authorized tokenized funds or debt claims | Issuer-specific Sui Move objects or currencies, potentially with eligibility restrictions | Future institutional integration | Need issuer cooperation, transfer/custody rights, eligible counterparties and legal/compliance review; do not substitute an unrelated fund token for a bond. |
| Unique instruments or lots | Sui objects with issuer and transfer policy, potentially paired with payment in a custom escrow | Later | Different accounting and settlement logic from interchangeable `Coin<T>`; not P0. |
| Off-chain shares, bonds, fiat bank balances or Hedera assets | No native Sui transfer unless legally/technically represented there | Out of scope for same-chain atomic demo | Bridging or separate bank/chain payment introduces a distinct coordination problem; a trade reference is not atomic cross-chain settlement. |

**Recommended demonstration pair:** testnet `DEMO_BOND` / `DEMO_USD`, both newly issued by the team with no real-world-value claim. If the team can obtain verified testnet USDC or a supported equivalent, add it *only after* the demo works; use Sui mainnet native USDC as a sourced production *possibility*, not a testnet integration promise. Sui's currency standards create interoperable fungible `Coin<T>` objects; regulated currencies additionally support deny-list/pausing features, but a regulatory-feature API alone does not make a token legally compliant. [Sui fungible tokens](https://docs.sui.io/onchain-finance/fungible-tokens/), [regulated currencies](https://docs.sui.io/onchain-finance/fungible-tokens/regulated-tokens), [Circle native USDC](https://www.circle.com/blog/now-available-native-usdc-on-sui)

**Spot markets versus bilateral settlement:** DeepBook provides a Sui liquidity/order-book integration path for *supported pools*, but it is optional and does not replace bilateral approval and four-way trade reconciliation. Before claiming any pool supports a bond token, verify its registered type and liquidity. [DeepBook overview](https://docs.sui.io/onchain-finance/deepbook/), [pool information](https://docs.sui.io/onchain-finance/deepbook/deepbookv3/contract-information)

## 4. Canonical trade and agent negotiation

**Required typed record:** `trade_id`, `schema_version`, `version`, `chain_id`, buyer/broker public addresses, internal account references (off-chain), `bond_type`, `cash_type`, issuer/instrument identifier, quantity in base units, unit-price convention, gross amount, accrued interest, fees, exact net cash in base units, buyer/broker settlement recipients, intended settlement date/expiry, external references and fill IDs. Preserve original CSV rows and source-file hashes outside the publicly visible chain state.

**Exact approval:** deterministic serialization and `terms_hash = H(canonical record)`. Human approvals bind the hash plus trade ID, version, Sui network, contract package/object identity and expiration to avoid replay across environments. Roles must be distinct. A revision invalidates old approvals for the unexecuted instruction. A hash proves consistency of bytes, not accuracy or issuer rights.

**Negotiation envelope:** `message_id`, sending principal/agent, trade/version, changed fields, source IDs, evidence IDs, proposed fix, timestamp, prior message ID. Authentication, deduplication and tenant separation are required. Model-generated text cannot mutate canonical economics. Comparator computes the 100-unit delta; each agent explains what its own evidence says and may request correction.

**Mismatch-resolution state machine:** `IMPORTED → MISMATCH → INTERVENTION_REQUIRED → PROPOSED_V2 → DUAL_HUMAN_APPROVED → CORRECTION_APPLIED → COMMIT_PENDING → AGREEMENT_COMMITTED → BUYER_FUNDED + BROKER_FUNDED → SETTLEMENT_SUBMITTED → CONFIRMED / ABORTED / UNKNOWN → BOOK_RECONCILED`.

Each side independently progresses through `AWAITING_WORLD_ID → WORLD_ID_VERIFIED → HUMAN_APPROVED`; `DUAL_HUMAN_APPROVED` requires both complete paths for the same version/hash. A rejected proposal stays blocked; an amended proposal resets both paths. A timeout during commitment or settlement means `UNKNOWN`, not failure: resolve the existing instruction before resubmitting. `MATCHED` imports retain dual authorised approval before commitment; any subsequent amendment uses the full World ID intervention flow. No agent consensus bypass is permitted.

### 4.1 Mandatory World ID face verification and human consent (P0)

**Product rule:** When either agent or the comparator finds a price, volume or other material trade discrepancy, neither side may apply corrected economics until two distinct authorised humans have completed fresh World ID face verification and approved the exact same amendment. Agents may draft proposals; only the deterministic correction service can apply a fully approved version. Human-entered edits also create proposals and cannot overwrite an approved version.

**World ID integration:** Use IDKit Proof of Human with `require_user_presence: true` to request a fresh face/liveness check associated with the Orb-backed credential. Pin the supported SDK/protocol and credential policy; do not silently fall back to a device-only, document-only or lower-assurance proof. Bind the proof's action/signal to the amendment challenge. The official documentation describes this request-level presence check and context binding. [World ID credential configuration](https://docs.world.org/world-id/idkit/credentials)

**Terminology and implementation gate:** World calls the local face match protecting access to an Orb-verified World ID “Face Auth”; it is not itself a proof supplied to TradeBridge. This PRD implements the requested face authentication using verified Proof of Human plus fresh requested user presence. Before declaring the feature complete, demonstrate that the selected flow performs the required face match and supplies trustworthy evidence of completion. An ordinary successful proof or a client-supplied `face_verified=true` flag is insufficient. If this cannot be enforced, leave the correction blocked and record the integration as incomplete. [World Face Authentication](https://support.world.org/hc/en-us/articles/31589092274195-What-is-Face-Authentication-and-how-does-it-work)

**Per-side approval sequence:**

1. Authenticate the staff member through the organisation's existing account controls. Check tenant, buyer/broker role, trade scope and amendment authority. Maintain an access-controlled enrollment binding between that account and its verified World ID context; linking or replacing that binding cannot be performed by an agent.
2. Display source evidence and the full proposed record, with explicit before/after price, volume and net cash. Generate a server-owned challenge binding trade ID, proposal version, terms hash, tenant, approver account, role, Sui network, package/registry identity, nonce and expiration. MVP default: challenge expires after five minutes; approval expires after fifteen minutes or trade expiry, whichever comes first.
3. Launch the World ID flow. Verify the complete returned result on the server using the configured relying party, expected action/context, required credential, nonce and fixed environment. Validate the required presence evidence through the supported verifier/attestation path, not by trusting a browser callback. The current verification API accepts `user_presence_completed` in the proof submission; the integration spike must establish how its integrity is checked. HTTP success alone is not sufficient: all required results and policy checks must pass. [World verification API](https://docs.world.org/api-reference/developer-portal/verify)
4. Ask the authenticated human to explicitly **Approve this corrected trade** or **Reject**. Face verification alone does not count as consent. Bind the approval signature or authenticated consent record to the challenge, proof receipt and exact terms; record time and authorisation decision. Re-check role validity when accepting approval and before commitment.
5. Repeat independently for the other party. Enforce distinct people as well as separate accounts/roles. Verify the World ID uniqueness design: compare nullifiers only within the same supported scope, or use a verified enrollment binding. Different role-scoped nullifiers alone do not prove different people. Prove this separation in the integration spike.
6. Once both records are valid, consume their authorisations atomically with a durable correction instruction and expected-version check. Apply only the approved values, then submit the same stable commitment instruction. A durable outbox/retry process handles the database-to-chain boundary; it is not one atomic transaction across both systems. A failed commitment leaves the correction staged and unavailable for funding/settlement until resolved.

**Failure policy:** Missing, rejected, expired, replayed or invalid proofs; unavailable verification; missing presence evidence; lost staff authority; same-person approvals; or any terms mismatch leave the trade blocked. A retry issues a new challenge for the same candidate. Any changed approval-bound field creates a new candidate and invalidates both previous proofs and approvals. No agent, administrator shortcut or timeout may waive the two-human requirement. Once an agreement is committed, later amendments require a new linked agreement, not reuse of consumed approvals.

**Evidence record (off-chain):** retain `approval_id`, trade/version/hash, organisation/role, authorised account reference, verified World ID binding reference, challenge digest/nonce, policy and SDK/protocol versions, proof-verification receipt, presence-evidence reference, explicit decision, timestamps/expiry, consent signature/reference, and consumption/revocation state. Store proof material only as needed under access controls and a defined retention policy. Never collect or publish face images, biometric templates or raw biometric data; do not put World ID nullifiers, session identifiers or staff identity mappings on Sui.

**UI:** show separate buyer and broker cards with verification status, approval status, version/hash and expiry. Show the immutable agreement transaction/object only after confirmation. Keep “human verified,” “trade approved,” “agreement committed” and “settled” as separate states. This establishes recorded human participation and consent; it does not guarantee the commercial correctness of the trade.

The optional World human-in-the-loop SDK can orchestrate the pause, but enforcement remains in the backend and Move module. Its returned tool input is not sufficient authorisation on its own. [World human-in-the-loop integration](https://docs.world.org/agents/human-in-the-loop/integrate)

## 5. Sui Move settlement design

**Illustrative module responsibility, not copy-ready Move syntax:**

- `commit_agreement(...)` verifies both role authorisations and verification-service attestations, expected prior version, exact terms binding, expiration and unused approval IDs. In one Sui transaction, record consumed authorisations and create a frozen immutable agreement object containing trade ID/version, prior agreement reference if any, terms hash, required settlement parameters and minimal approval commitments. Never include biometrics or private World ID identifiers. Validate the chosen freeze/immutability primitive in the Move spike; a mutable shared escrow alone is not an immutable trade record.
- `create_trade<BOND, CASH>(agreement, ...)` creates a shared escrow uniquely tied to that committed agreement; only supported coin types and the committed settlement parameters are allowed. Recompute/check the canonical hash binding or store all required settlement fields in the agreement so unrelated terms cannot be attached to a valid hash.
- `approve_buyer` / `approve_broker` or verified signature payloads enforce role-scoped consent to that exact hash. Each requires an attestation from the restricted World ID verification service bound to the same party, approval ID and challenge. Direct wallet approval without that attestation must fail. Select and test supported Sui signature/capability primitives; no unverified native World ID verifier on Sui is assumed. Service compromise remains an explicit trust risk.
- `deposit_bond(trade, Coin<BOND>)` requires the broker's authorized sender; `deposit_cash(trade, Coin<CASH>)` requires the buyer. Exact funded totals, partial funding and refund behavior must be defined; cap per-leg balance and reject irrelevant types.
- `settle(trade)` checks the immutable agreement reference, both recorded approvals, current non-superseded execution status, version/hash, exact balances, not expired, valid recipients, no prior completion, and supported compliance/capability rule; marks the trade consumed and transfers both legs. Failure aborts the whole transaction.
- `refund_bond` / `refund_cash` allow return to original funder under an explicit cancellation or expiration policy, never to an arbitrary operator address. Prevent one party from reclaiming its funds after a successful settlement.
- Events report the trade ID/version/hash and actual outputs; post-settlement verifier independently reads transaction effects/coin changes rather than trusting an emitted event alone.

**Design choice to resolve in first spike:** whether approvals are recorded by transactions from each party's address, or by verified signature payloads. Do not invent a Move verification API in the implementation plan; validate available Sui primitives and implement/test the simplest safe path. Distinguish the Sui PTB's atomic *final transfer* from the non-atomic process of separately funding the two escrow legs. Sui PTBs can combine multiple commands atomically, but asset access still depends on ownership/capabilities. [Sui PTBs](https://docs.sui.io/develop/transactions/ptbs/)

**Immutability versus execution state:** The committed agreement's economics cannot be edited by either agent, an approver or an operator. Keep funding, cancellation and settlement status in a separate mutable execution object. A later correction creates a linked agreement after fresh bilateral face verification and consent; an atomic registry transition marks the old unexecuted agreement superseded so it cannot settle. Resolve/refund any existing funded escrow before replacement. A completed settlement is never rewritten; any reversal or corrective trade is a separately authorised transaction. Commitment proves what was agreed; settlement effects separately prove what moved.

**Object/concurrency specifics:** persist object ID and version for trade escrow, coin type strings and transaction digest. Sui objects have versioned inputs, so retries using stale owned-object references may fail; re-query state and distinguish a conflict from a failed settlement. Ensure each trade ID/version is unique and consumed once; legitimate partial fills use separate fill IDs and remaining amounts. [Sui common transaction errors](https://docs.sui.io/develop/testing-debugging/common-errors)

## 6. Reconciliation and backend APIs

**Four-way compare:** buyer CSV, broker CSV, approved canonical terms and confirmed Sui effects/balance movement. Different statuses: `MISSING_INTERNAL`, `MISSING_BROKER`, `QUANTITY_MISMATCH`, `CASH_MISMATCH`, `PRICE_MISMATCH`, `HUMAN_VERIFICATION_REQUIRED`, `WORLD_ID_FAILED`, `APPROVAL_EXPIRED`, `APPROVAL_REJECTED`, `COMMIT_PENDING`, `COMMIT_UNKNOWN`, `UNAPPROVED_VERSION`, `PARTIALLY_FUNDED`, `SETTLEMENT_PENDING`, `UNKNOWN_OUTCOME`, `SETTLEMENT_ABORTED`, `TRANSFER_MISMATCH`, `SETTLED_BOOK_MISSING`. Never infer the contractually right fee from what moved.

**Proposed API surface:** `POST /imports`, `POST /trades/{id}/compare`, `POST /trades/{id}/proposals`, `POST /trades/{id}/versions`, `POST /trades/{id}/verification-challenges`, `POST /trades/{id}/world-id-verifications`, `POST /trades/{id}/approvals`, `POST /trades/{id}/agreement-commitments`, `POST /trades/{id}/funding-intents`, `POST /trades/{id}/settlement-instructions`, `GET /trades/{id}/sui-evidence`, `GET /trades/{id}/reconciliation`, `GET /trades/{id}/audit`. Exact IDs and JSON schema are team decisions; all writes need actor authorization, idempotency and expected-version checks.

**Write permissions:** Proposal/version endpoints create candidates only. Agents may import, compare and propose; they cannot submit human consent, issue verification attestations, apply corrections or commit agreements using their own approval authority. The approval endpoint accepts only an authenticated authorised human session and a server-verified, unused challenge. The commitment endpoint accepts only the deterministic correction service's validated bilateral instruction. Concurrent retries return the existing outcome; they cannot create a second correction or agreement. External buyer/broker book adjustments remain separately authorised and reconciled; preserve the originals.

**Verification:** read transaction digest/effects status, executed Move calls and relevant balance changes/object ownership for both token types and recipients; store checkpoint/timestamp, chain ID, package ID, escrow object ID, source references and decision. Check finality/status for the specific Sui transaction. Do not compare only events from your own module. An uncertain network response keeps the original stable instruction and queries its existing digest before another attempt.

**Privacy:** retain private allocations and detailed economics in access-controlled storage; store only necessary hashes/participants/amounts publicly for the prototype. A public hash can still reveal relationships when context is known; consider which values must be on-chain and which are only evidence for the parties.

## 7. Acceptance criteria

| Test | Result |
|---|---|
| Buyer 1,000 versus broker 1,100 | Both agents show source-backed mismatch; backend and Move-side controls prevent unauthorized settlement |
| Broker proposes 1,000 but buyer has not completed verification and approved v2 | Correction, commitment, funding and settlement blocked; original economics unchanged |
| Both approve different hashes or different networks | Settlement blocked |
| Both approve v2; only broker deposits bond | `PARTIALLY_FUNDED`, no payout; authorized refund path available |
| Exact v2 approvals and both deposits | One successful final Sui transaction sends exact bond/cash amounts to intended recipients |
| Attempt to settle again or replay v1 | Aborts; no second payment |
| Direct call bypassing backend with mismatched sender/asset/amount | Move module rejects it |
| Expiry/cancellation after one-sided funding | Original funder can recover under defined policy; no operator diversion |
| Network timeout after submission | `UNKNOWN`; lookup existing digest/state, no duplicate trade |
| Correct chain settlement but buyer ledger still pending | Distinct book exception with safe proposed replay |
| Agent claims a 100-unit change is immaterial | Deterministic policy blocks and requests human approval |

**Additional World ID and immutable-agreement acceptance criteria:**

| Test | Result |
|---|---|
| Price mismatch with matching volume | Intervention required; review shows corrected price and recomputed exact net cash |
| Agent or script calls correction/approval endpoint directly | Rejected; no canonical correction, attestation or chain commitment |
| Both complete World ID but only one explicitly approves | Correction and commitment blocked |
| Authorised person lacks valid World ID/presence evidence, or verified person lacks staff authority | Blocked; both requirements are mandatory |
| Same person attempts to approve both sides using separate accounts | Blocked using validated identity-binding/uniqueness controls |
| Replayed challenge/proof, wrong role/tenant/environment/network, stale version or expired approval | Blocked; no new mutation |
| Face check fails, user cancels, or verifier is unavailable | Remains pending/blocked; retry cannot waive verification |
| Change price, volume, recipient or another bound field after either approval | New candidate; fresh verification and approval required from both |
| Both verified authorised humans approve identical v2 | Exactly v2 applied once; immutable agreement committed once before funding |
| Direct Move commitment with missing/forged verifier attestation or one approval | Aborts; no agreement created |
| Commitment times out after possible chain success | `COMMIT_UNKNOWN`; resolve existing instruction/object before retry; no duplicate agreement |
| Concurrent attempts consume the same approvals | At most one correction/commitment; retries return original result |
| Attempt to edit committed economics or settle a superseded agreement | Edit unavailable/rejected; superseded execution rejected |
| Later amendment to committed, unexecuted trade | New linked agreement after fresh bilateral verification/consent; prior evidence retained |
| Inspect on-chain agreement and application logs | No face images, biometric templates or public World ID identity mappings |

**Gate for demo claims:** Show both live face-verification flows, explicit approvals and the immutable agreement object/digest. Label mocks or recorded flows. An application-only gate, missing fresh presence evidence, or a mutable agreement fails this revision's P0 requirements. Describe any such build as partial. Tests on testnet/localnet support a prototype claim, not a security audit.

## 8. Prize plan and timeboxed execution

**Curvegrid AI Agent:** two independently scoped agents read financial and Sui evidence, exchange proposals and encounter enforceable approval and policy gates. A scripted UI plus an LLM explanation is weaker than typed agent tools acting on live state. Under the supplied prize text, MultiBaas is optional.

**Sui DeFi & Payments:** select if the implementation genuinely moves/manages/transforms tokenized financial assets on Sui through a functioning financial interface or automation workflow; the substantive proof is the funded escrow, denied path and atomic final release. The user-supplied brief lists payment flows, vaults, capital allocators and automation under this track. Confirm exact eligibility on the Hacker Dashboard before selecting.

**Curvegrid Dashboard/RWA categories:** secondary under the same partner if dashboard and tokenized-asset lifecycle are actually working. **1inch Aqua:** do not select for a Sui-only architecture; its sponsor challenge requires Aqua-specific integration.

**Weekend critical path:** (1) verify World ID Proof of Human + fresh face/presence flow, server validation and distinct approver binding, alongside Sui network/client, gas and asset deployment; (2) build Move escrow and failure/refund tests; (3) create typed buyer/broker demo assets and CSV mismatch; (4) add bilateral World ID verification, explicit consent, immutable agreement commitment and scoped agent tools; (5) verify digest, effects and book statuses; (6) capture a short live demo and known limitations. Cut DeepBook integration, real fund tokens, cross-chain settlement and production KYC before cutting bilateral face verification, dual approvals, immutable agreement commitment and refund safety.

**Four-minute pitch:** 20s pain; 40s two different source records; 35s agents flag 100-unit mismatch and a settlement is blocked; 40s corrected v2 with both World ID face checks and explicit human approvals; 75s immutable Sui agreement + funding + atomic final settlement proof; 30s four-way reconciliation and refund/timeout boundary. If final settlement waits on testnet, use a previously completed real transaction digest with transparent labeling.

## 9. Open feasibility checks

1. Which exact Sui network and Move framework version will the team deploy against?
2. Can the team create/mint demo asset types and fund both parties, including SUI gas, early enough for a live rehearsal?
3. Are the bond and cash representations fungible coins, or does the real asset require a restricted object/capability model?
4. How are approval identity and authenticity enforced *in Move*, not only by the API?
5. What contract prevents a participant from bypassing backend policy or depositing mismatched coins?
6. What are the unilateral cancellation and refund conditions, especially if only one side funds?
7. Can settlement effects and asset changes be queried reliably by digest in the chosen client/indexer?
8. Is the submission Classic or Continuity given any pre-event Hedera repository work? Treat this Sui rewrite as new only if event rules actually permit it.

9. Which pinned IDKit/protocol configuration supplies verified fresh face/presence evidence with Proof of Human, and does it work on both approvers' devices without a weaker fallback?
10. How is each organisational approver securely bound to their World ID, and how is the same person prevented from filling both roles across scoped identifiers?
11. Which supported Sui primitives enforce verification-service attestations and immutable agreement creation, and how are attestation keys restricted, rotated and revoked?
12. Can the team demonstrate replay protection, approval freshness, durable correction/commit recovery, immutable economics and supersession rejection before presenting the full flow?

## Sources consulted

- Sui PTBs: https://docs.sui.io/develop/transactions/ptbs/
- Sui fungible tokens and currencies: https://docs.sui.io/onchain-finance/fungible-tokens/
- Sui regulated currencies: https://docs.sui.io/onchain-finance/fungible-tokens/regulated-tokens
- Sui multisig: https://docs.sui.io/develop/transactions/transaction-auth/multisig
- Sui transaction troubleshooting: https://docs.sui.io/develop/testing-debugging/common-errors
- Circle native USDC on Sui: https://www.circle.com/blog/now-available-native-usdc-on-sui
- Sui DeepBook overview and pool information: https://docs.sui.io/onchain-finance/deepbook/ and https://docs.sui.io/onchain-finance/deepbook/deepbookv3/contract-information
- User-supplied event and prior two-agent PRD context. Specific code and contract semantics remain proposed until tested.

### World ID sources added for v0.4 (checked 26 September 2026)

- [World ID credential configuration and required user presence](https://docs.world.org/world-id/idkit/credentials)
- [World verification API](https://docs.world.org/api-reference/developer-portal/verify)
- [World Face Authentication terminology and privacy](https://support.world.org/hc/en-us/articles/31589092274195-What-is-Face-Authentication-and-how-does-it-work)
- [World human-in-the-loop integration](https://docs.world.org/agents/human-in-the-loop/integrate)

The approval time limits, role-binding policy, Sui attestation bridge and immutable-agreement lifecycle above are TradeBridge design requirements, not claims that World ID supplies these application controls automatically.
