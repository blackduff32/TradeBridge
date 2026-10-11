# TradeBridge on Sui — Two-Agent Reconciliation PRD

**Version:** 0.3 · 25 September 2026  
**Status:** Sui redesign of the two-agent proposal, not a tested implementation. Supersedes Hedera-specific architecture in earlier PRDs.  
**Primary target:** Curvegrid Best AI Agent Project. **Second partner target:** Sui DeFi & Payments, only if the working demo executes a substantive Sui financial flow.  
**Core promise:** Buyer and broker agents detect a disagreement before settlement; people approve one shared trade version; a Sui Move escrow releases tokenized asset and payment together only after that approval; independent reconciliation checks each party's books against Sui transaction effects.

## 1. Architecture and trust boundaries

- **Buyer-side agent:** reads the buyer's authenticated order and proposes evidence-backed comparisons; cannot approve for the broker or sign payment.
- **Broker-side agent:** reads the broker's confirmation and proposes amendments; cannot approve for the buyer or sign delivery.
- **Deterministic comparator/policy service:** compares typed fields and blocks mismatches, unapproved versions, expired holds and unsupported assets. Agent narratives do not override it.
- **Two authorized human approvers:** separately authenticate approval of the *same* canonical trade ID, version, terms hash, chain ID, asset types, quantity, net payment and expiry. For a material amendment, require fresh approval from both.
- **Sui Move settlement module:** records or verifies appropriate approval authorization and holds the two asset legs; one final call releases both balances or aborts both releases. Off-chain approval alone is not an on-chain guarantee: implement on-chain approval records or verified signatures, or explicitly present the policy gate as off-chain only.
- **Reconciliation service:** verifies finalized Sui effects and token movement, then compares approved terms, buyer book and broker book. It proposes, rather than silently writes, adjustments.

**Sui object-model warning:** Sui PTBs execute multiple commands atomically, but that fact does *not* automatically permit one party's transaction to consume another party's address-owned coin objects. For the weekend MVP, each party deposits its own asset into a shared escrow in **separate authorized transactions**; a final settlement transaction conditionally distributes both assets in one atomic operation. Prefunding has custody, withdrawal, expiry and liveness risks that need explicit controls. An alternative all-in-one multi-signature/authorization design requires separate feasibility work; do not assume a standard multisig substitutes for two separately owned coin inputs. [Sui PTBs](https://docs.sui.io/develop/transactions/ptbs/), [multisig](https://docs.sui.io/develop/transactions/transaction-auth/multisig)

## 2. Four-minute demo workflow

1. Buyer agent imports an authenticated order to buy **1,000 DEMOBOND** units at an illustrative agreed unit price of **10 DEMOUSD**; broker agent imports a confirmation for **1,100 DEMOBOND**. These are team-created test assets and synthetic economics, not a real bond or redeemable dollar.
2. Agents exchange field-level evidence with source row, timestamp and signer/role. Comparator yields `QUANTITY_MISMATCH = 100 units`. The settlement API refuses the request and the Move escrow is not settled.
3. Broker agent proposes correcting the confirmation to 1,000; buyer agent checks the proposal against its order. New canonical trade version `v2` records the full economic terms; the broker and buyer authorized humans approve its hash independently.
4. The buyer deposits precisely the approved demo-cash amount into the Sui trade escrow; the broker deposits precisely the approved demo-bond amount. The UI shows which leg is funded and whether both deposits match v2. Prefer funding **after** approval to minimize exposure; a rejected or expired trade must offer independently authorized refunds.
5. An authorized service submits the final `settle(v2)` call. The Move module checks approved v2, both funded legs, exact amounts, asset types, recipients, expiry, consumed flag and applicable access rules. On success, it transfers the bond to the buyer and cash to the broker in one Sui transaction; on abort, neither payout occurs.
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

**State machine:** `IMPORTED → MISMATCH / MATCHED → PROPOSED_V2 → BUYER_APPROVED + BROKER_APPROVED → AGREED → BUYER_FUNDED + BROKER_FUNDED → SETTLEMENT_SUBMITTED → CONFIRMED / ABORTED / UNKNOWN → BOOK_RECONCILED`. A timeout means unknown, not failed. Funding and approval order is configurable only after tests prove safe recovery.

## 5. Sui Move settlement design

**Illustrative module responsibility, not copy-ready Move syntax:**

- `create_trade<BOND, CASH>(terms_hash, buyers, sellers, amounts, expiry)` creates a shared trade escrow/position uniquely tied to trade ID and version; only supported coin types allowed.
- `approve_buyer` / `approve_broker` or cryptographically verified approval payloads enforce role-scoped approval of that exact hash. If approvals live only in an application DB, do not claim Move-level dual consent.
- `deposit_bond(trade, Coin<BOND>)` requires the broker's authorized sender; `deposit_cash(trade, Coin<CASH>)` requires the buyer. Exact funded totals, partial funding and refund behavior must be defined; cap per-leg balance and reject irrelevant types.
- `settle(trade)` checks both approvals, version/hash, exact balances, not expired, valid recipients, no prior completion, and supported compliance/capability rule; marks the trade consumed and transfers both legs. Failure aborts the whole transaction.
- `refund_bond` / `refund_cash` allow return to original funder under an explicit cancellation or expiration policy, never to an arbitrary operator address. Prevent one party from reclaiming its funds after a successful settlement.
- Events report the trade ID/version/hash and actual outputs; post-settlement verifier independently reads transaction effects/coin changes rather than trusting an emitted event alone.

**Design choice to resolve in first spike:** whether approvals are recorded by transactions from each party's address, or by verified signature payloads. Do not invent a Move verification API in the implementation plan; validate available Sui primitives and implement/test the simplest safe path. Distinguish the Sui PTB's atomic *final transfer* from the non-atomic process of separately funding the two escrow legs. Sui PTBs can combine multiple commands atomically, but asset access still depends on ownership/capabilities. [Sui PTBs](https://docs.sui.io/develop/transactions/ptbs/)

**Object/concurrency specifics:** persist object ID and version for trade escrow, coin type strings and transaction digest. Sui objects have versioned inputs, so retries using stale owned-object references may fail; re-query state and distinguish a conflict from a failed settlement. Ensure each trade ID/version is unique and consumed once; legitimate partial fills use separate fill IDs and remaining amounts. [Sui common transaction errors](https://docs.sui.io/develop/testing-debugging/common-errors)

## 6. Reconciliation and backend APIs

**Four-way compare:** buyer CSV, broker CSV, approved canonical terms and confirmed Sui effects/balance movement. Different statuses: `MISSING_INTERNAL`, `MISSING_BROKER`, `QUANTITY_MISMATCH`, `CASH_MISMATCH`, `UNAPPROVED_VERSION`, `PARTIALLY_FUNDED`, `SETTLEMENT_PENDING`, `UNKNOWN_OUTCOME`, `SETTLEMENT_ABORTED`, `TRANSFER_MISMATCH`, `SETTLED_BOOK_MISSING`. Never infer the contractually right fee from what moved.

**Proposed API surface:** `POST /imports`, `POST /trades/{id}/compare`, `POST /trades/{id}/proposals`, `POST /trades/{id}/versions`, `POST /trades/{id}/approvals`, `POST /trades/{id}/funding-intents`, `POST /trades/{id}/settlement-instructions`, `GET /trades/{id}/sui-evidence`, `GET /trades/{id}/reconciliation`, `GET /trades/{id}/audit`. Exact IDs and JSON schema are team decisions; all writes need actor authorization, idempotency and expected-version checks.

**Verification:** read transaction digest/effects status, executed Move calls and relevant balance changes/object ownership for both token types and recipients; store checkpoint/timestamp, chain ID, package ID, escrow object ID, source references and decision. Check finality/status for the specific Sui transaction. Do not compare only events from your own module. An uncertain network response keeps the original stable instruction and queries its existing digest before another attempt.

**Privacy:** retain private allocations and detailed economics in access-controlled storage; store only necessary hashes/participants/amounts publicly for the prototype. A public hash can still reveal relationships when context is known; consider which values must be on-chain and which are only evidence for the parties.

## 7. Acceptance criteria

| Test | Result |
|---|---|
| Buyer 1,000 versus broker 1,100 | Both agents show source-backed mismatch; backend and Move-side controls prevent unauthorized settlement |
| Broker proposes 1,000 but buyer has not approved v2 | Settlement blocked |
| Both approve different hashes or different networks | Settlement blocked |
| Both approve v2; only broker deposits bond | `PARTIALLY_FUNDED`, no payout; authorized refund path available |
| Exact v2 approvals and both deposits | One successful final Sui transaction sends exact bond/cash amounts to intended recipients |
| Attempt to settle again or replay v1 | Aborts; no second payment |
| Direct call bypassing backend with mismatched sender/asset/amount | Move module rejects it |
| Expiry/cancellation after one-sided funding | Original funder can recover under defined policy; no operator diversion |
| Network timeout after submission | `UNKNOWN`; lookup existing digest/state, no duplicate trade |
| Correct chain settlement but buyer ledger still pending | Distinct book exception with safe proposed replay |
| Agent claims a 100-unit change is immaterial | Deterministic policy blocks and requests human approval |

**Gate for demo claims:** if both humans sign only off-chain and Move does not verify them, describe the contract's DvP guarantee narrowly and demonstrate the application gate separately. Tests on testnet/localnet support a prototype claim, not a security audit.

## 8. Prize plan and timeboxed execution

**Curvegrid AI Agent:** two independently scoped agents read financial and Sui evidence, exchange proposals and encounter enforceable approval and policy gates. A scripted UI plus an LLM explanation is weaker than typed agent tools acting on live state. Under the supplied prize text, MultiBaas is optional.

**Sui DeFi & Payments:** select if the implementation genuinely moves/manages/transforms tokenized financial assets on Sui through a functioning financial interface or automation workflow; the substantive proof is the funded escrow, denied path and atomic final release. The user-supplied brief lists payment flows, vaults, capital allocators and automation under this track. Confirm exact eligibility on the Hacker Dashboard before selecting.

**Curvegrid Dashboard/RWA categories:** secondary under the same partner if dashboard and tokenized-asset lifecycle are actually working. **1inch Aqua:** do not select for a Sui-only architecture; its sponsor challenge requires Aqua-specific integration.

**Weekend critical path:** (1) verify Sui network/client, gas and asset deployment; (2) build Move escrow and failure/refund tests; (3) create typed buyer/broker demo assets and CSV mismatch; (4) add human approval and agent tools; (5) verify digest, effects and book statuses; (6) capture a short live demo and known limitations. Cut DeepBook integration, real fund tokens, cross-chain settlement and production KYC before cutting dual approvals and refund safety.

**Four-minute pitch:** 20s pain; 40s two different source records; 35s agents flag 100-unit mismatch and a settlement is blocked; 40s corrected v2 with both human approvals; 75s Sui funding + atomic final settlement proof; 30s four-way reconciliation and refund/timeout boundary. If final settlement waits on testnet, use a previously completed real transaction digest with transparent labeling.

## 9. Open feasibility checks

1. Which exact Sui network and Move framework version will the team deploy against?
2. Can the team create/mint demo asset types and fund both parties, including SUI gas, early enough for a live rehearsal?
3. Are the bond and cash representations fungible coins, or does the real asset require a restricted object/capability model?
4. How are approval identity and authenticity enforced *in Move*, not only by the API?
5. What contract prevents a participant from bypassing backend policy or depositing mismatched coins?
6. What are the unilateral cancellation and refund conditions, especially if only one side funds?
7. Can settlement effects and asset changes be queried reliably by digest in the chosen client/indexer?
8. Is the submission Classic or Continuity given any pre-event Hedera repository work? Treat this Sui rewrite as new only if event rules actually permit it.

## Sources consulted

- Sui PTBs: https://docs.sui.io/develop/transactions/ptbs/
- Sui fungible tokens and currencies: https://docs.sui.io/onchain-finance/fungible-tokens/
- Sui regulated currencies: https://docs.sui.io/onchain-finance/fungible-tokens/regulated-tokens
- Sui multisig: https://docs.sui.io/develop/transactions/transaction-auth/multisig
- Sui transaction troubleshooting: https://docs.sui.io/develop/testing-debugging/common-errors
- Circle native USDC on Sui: https://www.circle.com/blog/now-available-native-usdc-on-sui
- Sui DeepBook overview and pool information: https://docs.sui.io/onchain-finance/deepbook/ and https://docs.sui.io/onchain-finance/deepbook/deepbookv3/contract-information
- User-supplied event and prior two-agent PRD context. Specific code and contract semantics remain proposed until tested.
