# TradeBridge on Sui — Narrative judging pitch

**Revision:** v0.4 · 26 September 2026  
**Format:** Four-minute presentation with five slides and demo cues  
**Audience:** Curvegrid AI Agent judges, with Sui DeFi & Payments relevance if implemented  
**Status:** Proposed workflow aligned with PRD v0.4. Describe functionality as working only when the submitted build demonstrates it.

## The story in one sentence

Two agents investigate a trade mismatch. An authorised human on each side completes fresh World ID face verification and approves the same correction before the system applies it, commits the agreement immutably to Sui and settles the funded trade.

## Spoken script and demo cues

### Slide 1: 0:00–0:20 — TradeBridge

**Say:**

An investment firm and its broker can each trust their own records and still disagree about a trade. TradeBridge uses two agents to investigate that disagreement. Our proposed workflow requires authorised people on both sides to verify with World ID and approve the correction before we commit the agreement to Sui.

**Show / presenter note:** Show the title. Describe this as the proposed workflow unless the submitted build demonstrates all required gates.

### Slide 2: 0:20–1:00 — A 100-unit disagreement

**Say:**

The in-house order says 1,000 demo bond units. The broker confirmation says 1,100. Each agent reads its own party's source and exchanges evidence. The comparator finds the 100-unit difference and blocks settlement. The broker agent proposes 1,000 units at the agreed price of 10 demo cash units. That makes a proposed payment of 10,000, with zero fees or interest in this example. The proposal cannot change the trade yet. A price mismatch triggers the same intervention.

**Show / presenter note:** Show source rows, the exact mismatch and a rejected settlement attempt. Show no signer invocation. The tokens are team-created DEMOBOND and DEMOUSD with no real-world-value claim.

### Slide 3: 1:00–2:10 — World ID verification on both sides

**Say:**

An authorised person from the investment firm and a different authorised person from the broker review the same proposed version. Each completes a fresh World ID face check, then explicitly approves the corrected price, volume and full terms. We verify human participation separately from the firm's permission to approve. One person's approval cannot stand in for the other. If either check fails or either person rejects, the correction stays blocked. Any change to the terms requires fresh verification and approval from both. The agents can prepare the proposal, but they cannot provide human consent.

**Show / presenter note:** Allow about 25 seconds within this segment for two prepared approvers to demonstrate the checks. Show each side's verification and explicit consent separately against the same v2 hash. If live timing is unreliable, use a clearly labelled recording from the submitted build. Never present a mock as verification. Technical requirement: Proof of Human plus require_user_presence. Face Auth itself is local authentication, not a proof returned to TradeBridge. Verify the supported evidence path before claiming completion. World ID alone does not establish staff authority. No biometric images go into TradeBridge's on-chain agreement.

### Slide 4: 2:10–3:20 — An immutable agreement before settlement

**Say:**

Only after both approvals does the service apply the exact correction and commit an immutable agreement to Sui. We preserve the original records. The agreement fixes what both parties approved. A later amendment needs a new linked version and fresh consent. Once commitment is confirmed, the buyer deposits demo cash and the broker deposits demo bonds separately. The Move escrow checks the agreement and exact funding. One final transaction releases both assets together or releases neither. Our design relies on a verification service for World ID evidence, with Move enforcing its attestations. These are demo tokens. If one party never funds, the other needs the defined expiry and refund path.

**Show / presenter note:** Show the agreement object and confirmed transaction digest before funding. Then show both funding states and the final transaction's actual token movements. The commitment, separate deposits and final release are distinct steps. Do not claim end-to-end atomicity or native World ID proof verification in Move. Missing on-chain attestation enforcement or a mutable agreement means the PRD's P0 flow is incomplete.

### Slide 5: 3:20–4:00 — Agreement and settlement meet the books

**Say:**

We then compare the buyer's record, the broker's record, the approved agreement and the transfers that actually occurred. If a book still shows 1,100, or has no posting, we keep that exception visible with its evidence. A successful transaction does not resolve it automatically. TradeBridge gives post-trade teams a traceable path from disagreement to a human-approved correction and verifiable settlement. The agents speed up investigation. Both firms retain authority over the trade.

**Show / presenter note:** Show four-way reconciliation and one SETTLED_BOOK_MISSING exception. Explain that book adjustments require their own authorised process. For network timeouts, resolve the existing instruction and digest before retrying. Close on the value for institutional post-trade operations, without invented savings metrics.

## Timing and evidence

The script leaves time for prepared approvers and short transitions. Rehearse the actual devices and network. If either face-verification flow exceeds the slot, use a clearly labelled recording from the submitted build and keep the narrative intact. Do not bypass verification to save time. Show completed transaction evidence as recorded when it is not live.

Keep these states separate in the demo: proposed terms, each human verified, each human approved, correction applied, agreement committed, funded legs, settled trade and reconciled books. Never display invented hashes, transaction digests or successful proof results.

## Track framing

For the Curvegrid AI Agent category, lead with two independently scoped agents that investigate a real exception and encounter enforced limits. Under the supplied event brief, MultiBaas is optional. For Sui DeFi & Payments, show the immutable agreement and substantive asset/payment flow only if implemented. Confirm eligibility in the event dashboard. This revision makes no World-specific prize claim.

## Questions to be ready for

**Why World ID as well as staff login?** The organisation decides who may approve. World ID Proof of Human with a fresh requested presence check supplies the human-verification layer. Explicit consent establishes approval of the exact trade. All three controls are required.

**Does Face Auth itself send proof to TradeBridge?** No. World distinguishes local Face Auth from application proofs. The intended integration uses Proof of Human with `require_user_presence: true`. The team must validate the face-check and verifiable evidence path in its chosen SDK before claiming completion. [World credential configuration](https://docs.world.org/world-id/idkit/credentials), [Face Auth explanation](https://support.world.org/hc/en-us/articles/31589092274195-What-is-Face-Authentication-and-how-does-it-work).

**Does World ID know someone works for the broker?** No. TradeBridge checks organisational identity and permissions separately and securely binds each approved account to its verified World ID context. Two accounts alone do not establish two different people.

**Can an agent reuse an earlier approval?** Each challenge and approval binds to the exact trade version, terms hash, role, environment and expiry. The service consumes authorisations once. Changed terms require both humans to repeat verification and approval.

**What if only one person approves or the face check fails?** The system leaves the correction and commitment blocked. Agents cannot override the gate. Verification success without explicit consent also remains insufficient.

**Does Sui verify World ID directly?** The proposed MVP verifies World ID off-chain through a restricted service. Move must enforce the service's attestations and both role-scoped approvals. This introduces trust in the service and its keys. An application-only gate does not satisfy the revised PRD.

**What becomes immutable?** A separate agreement object commits to the approved trade version and settlement parameters. Escrow funding and execution status remain mutable. Later changes create a linked agreement after fresh bilateral verification and approval. Completed settlement history cannot be rewritten.

**Do you publish faces on-chain?** No. TradeBridge must not collect or publish biometric images or templates. Public agreement evidence excludes private World ID identifiers and staff identity mappings.

**What exactly is atomic?** The final release of both funded token legs in one successful Sui transaction. Human approvals, database correction, agreement commitment, separate deposits and external book updates do not form one atomic operation.

**What if funding or a network request fails?** One-sided funding cannot settle and needs the defined expiry/refund path. A timeout means an unknown outcome. Resolve the existing instruction and transaction digest before retrying, including agreement commitment.

**Why two agents, and why AI?** Each agent represents a different principal and reads its own source records. Agents interpret formats, exchange evidence and draft corrections. A deterministic comparator establishes the numerical mismatch. Neither model may approve or silently rewrite the trade.

**Can this trade real bonds?** The demo uses team-created DEMOBOND and DEMOUSD. Real instruments need issuer-backed rights and appropriate transfer/custody permissions. No real-value or redemption claim applies to these demo tokens.

**What is working today?** Answer from the submitted build and its test evidence. The supplied documents specify intended functionality. Demonstrate each completed gate and identify anything incomplete, mocked or recorded.

## Final rehearsal rule

A judge should be able to explain that the agents found the disagreement, two authorised humans verified and approved the same correction, the system committed an immutable agreement before settlement, and reconciliation checked both books against the actual transfers.

## Sources

- TradeBridge on Sui PRD v0.4, supplied in this task.
- [World ID credential configuration](https://docs.world.org/world-id/idkit/credentials)
- [World verification API](https://docs.world.org/api-reference/developer-portal/verify)
- [World Face Authentication](https://support.world.org/hc/en-us/articles/31589092274195-What-is-Face-Authentication-and-how-does-it-work)
- [Sui programmable transaction blocks](https://docs.sui.io/develop/transactions/ptbs/)
