# TradeBridge on Sui — Narrative judging pitch

**A four-minute, human-readable presentation script**  
**Primary audience:** Curvegrid AI Agent judges; also suitable for Sui DeFi & Payments judges  
**Status:** Script for a proposed demo. Replace any step that is not implemented with an honest explanation of what is working.

## The story in one sentence

Two trading parties can each be certain of *their own* record and still disagree about the trade. TradeBridge's agents expose that disagreement **before** settlement, help people agree on a corrected version, and reconcile the final token movements back to both books.

## Spoken script and demo cues

### 0:00–0:30 — Begin with a familiar mistake

**Say:**

“Imagine an investment firm buying a tokenized bond from a broker. The firm's order says **1,000 units**. The broker's confirmation says **1,100 units**. Both sides have a record that looks perfectly normal in their own system—but they are not describing the same trade.

A settlement contract can move the bond and cash together. What it cannot do by itself is decide whether 1,000 or 1,100 is what the two parties actually agreed. That's the gap we are solving.”

**Show:** Two simple cards: `BUYER ORDER: 1,000 units` and `BROKER CONFIRMATION: 1,100 units`. Avoid architecture diagrams at the start.

### 0:30–1:15 — Let the agents disagree, visibly

**Say:**

“We give each side an agent. The buyer-side agent reads the firm's order; the broker-side agent reads the broker's confirmation. They do not share a magic database or silently rewrite each other's records. Instead, they exchange the relevant trade terms and links back to the evidence.

Our comparison logic finds a **100-unit difference**. The agents can explain what each source says, but a deterministic rule makes the critical decision: **this trade is not ready to settle**.”

**Show:** Agent messages naming each source row and the difference. Click `Attempt settlement` while the mismatch is active. Display `BLOCKED_MISMATCH` and show that the signer or settlement service was not called.

**Transition:** “A warning alone would not be enough. We prevent the transfer.”

### 1:15–2:05 — Fix the record, not just the screen

**Say:**

“Now the broker checks its underlying evidence and proposes a correction: the confirmation should say **1,000 units**. That proposal does not become the truth simply because an AI agent suggested it.

The system creates a **new version** of the full trade: the asset, buyer, broker, quantity, price, cash amount, settlement date and destination. Authorized people for **both parties** review and approve the *same* version. If someone changes the quantity, recipient or payment afterward, the old approvals no longer apply.”

**Show:** Broker's evidence-backed proposed amendment; `v1: disputed → v2: proposed`. Show buyer and broker human approvals next to the identical v2 hash. If approval verification lives only in the application, label it that way; do not imply the contract verifies signatures unless it does.

**Transition:** “We now have something the original two spreadsheets did not give us: one explicitly agreed set of instructions.”

### 2:05–3:05 — Settle on Sui

**Say:**

“For this demonstration, the asset is a **team-created demo bond token**, and the payment is a **team-created demo cash token** on Sui. They illustrate the settlement mechanics; they are not a real issued bond or redeemable dollars.

The buyer authorizes the cash deposit, and the broker authorizes the bond deposit into this trade's escrow. These deposits happen separately. Once both are funded, the approvals and exact amounts are checked. A final Sui transaction either releases the bond to the buyer and cash to the broker together, or it does neither. If one side never funds, the transaction does not magically complete—we need an expiry and refund path.”

**Show:** Approval state, two funding states, then one successful final settlement transaction with digest, success status and the two actual asset movements. If the live network is slow, show a clearly labeled transaction executed earlier in the submitted build, not a simulated success.

**Optional line for Sui judges:** “Sui's programmable transaction block gives us an atomic *final release*. Our Move escrow and approval policy define when that release is permitted.”

### 3:05–3:40 — Complete the work after settlement

**Say:**

“On-chain success is not the end of a trade. The firm's books and the broker's books still have to show what actually happened. We compare **four things**: the buyer's order, the broker's confirmation, the version both approved, and the bond and cash that actually moved on Sui.

If the chain settled 1,000 units but one party's internal record still says 1,100—or was never updated—we show that as an exception with an owner and evidence. We propose a correction for review; we don't quietly overwrite anyone's books.”

**Show:** Four-column reconciliation view and, if available, one `SETTLED_BOOK_MISSING` exception with a proposed action and audit trail.

### 3:40–4:00 — Close with the boundary and value

**Say:**

“TradeBridge connects three moments that are often separated: **agreement, settlement and bookkeeping**. The agents make disagreement easier to discover and resolve. People approve material changes. Policy prevents premature settlement. Sui provides evidence of what moved, and reconciliation checks that both parties recorded it.

That's our goal: don't just settle a trade—make sure both sides agreed on what settled, and can explain it afterward.”

**Show:** One simple flow: `Two records → Mismatch blocked → Corrected v2 approved → Sui settlement → Both books reconciled`.

## Why the tracks fit

**Curvegrid Best AI Agent Project — lead with this:** Each agent represents a different principal and reads a different source. They exchange evidence-backed proposals and attempt to advance a real financial workflow. A deterministic policy rejects an unsafe action; authorized humans approve the corrected terms. The agent is more than a conversational overlay, but it cannot silently change the trade or spend funds. Under the supplied prize brief, MultiBaas is optional.

**Sui DeFi & Payments — only if implemented:** The application manages a tokenized-asset-versus-payment flow on Sui, with explicit funding and an atomic final release. Point judges to the deployed Move module, transaction digest, both token movements, and tests for mismatch, insufficient funding and duplicate settlement. Do not claim the separately funded escrow deposits were atomic with each other.

## Five simple visuals

1. **The conflict:** `1,000 ≠ 1,100`.
2. **The pause:** agents show evidence; settlement is blocked *before* signing.
3. **The agreement:** corrected `v2`, identical terms hash, buyer and broker approvals.
4. **The transfer:** cash and demo bond funded separately; final Sui release happens together.
5. **The proof:** approved terms versus actual transfers versus two book records.

Build the visuals around the live interface. Avoid a wall of smart-contract names or AI-model details. Show source references and real state changes in the product.

## Questions to be ready for

**“Why two agents instead of one?”** Each party owns different records and has different authority. The agents can compare and challenge terms without allowing one organization to impersonate the other.

**“Why AI instead of a simple diff?”** The numerical mismatch and payment gate are deterministic. The agents interpret differently formatted source records, exchange evidence, draft a possible correction and route it for approval. Do not claim AI discovered a cause that the source evidence does not support.

**“What exactly is atomic?”** The *final on-chain release* of both funded legs, if implemented in one successful Sui transaction. Separate deposits, off-chain approvals, external bookkeeping and eventual settlement are not all atomic.

**“What if the broker never deposits?”** No settlement. The escrow must expose funding state, expiry and a tested authorized refund route for the party that did deposit.

**“Can this trade real bonds?”** The hackathon example uses demo coins. Trading a real tokenized bond or fund requires an issuer-backed asset, rights for the holder, permitted counterparties and appropriate controls; the demo does not create those rights.

**“What happens if the server times out?”** Mark the result unknown, look up the original instruction and transaction digest, and verify effects before retrying. Never create a fresh trade ID merely because the HTTP call timed out.

**“Does the smart contract know the approved economic terms?”** Answer according to the submitted code. If the Move module checks on-chain approvals and the hash, show the lines and tests. If only the backend does, distinguish the backend policy from the contract's narrower token-transfer conditions.

## Final rehearsal rule

After one viewing, a judge should be able to retell the story without knowing Sui: **“The two sides disagreed, their agents found it, the system stopped payment, people agreed on one corrected trade, both assets moved together, and the system checked that both firms recorded the result.”** If that story gets lost, remove detail rather than adding another slide.
