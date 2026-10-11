# TradeBridge — Hackathon judging pitch plan

**Primary target:** Curvegrid Best AI Agent Project  
**Secondary angle:** Curvegrid Best Digital Asset Dashboard, if the working UI shows exception and settlement evidence  
**Format:** 4-minute presentation/demo + 3-minute Q&A, per the event brief supplied by the team  
**Core line:** “Two agents can spot a disagreement before money moves; neither can settle until both parties approve the same trade.”

> This plan describes the intended demo, not verified implemented functionality. Rehearse only the steps that actually work in the submission build. The supplied review of commit `a45e83f` is not a security audit.

## 1. What judges must remember

A buyer books **1,000 tokenized bond units**. A broker confirms **1,100**. TradeBridge's two independently scoped agents compare their records and explain the mismatch. The settlement service **refuses to sign** while they disagree. The broker proposes corrected terms; authorized humans for both parties approve the same immutable version; then the system settles the bond and cash together on the demonstrated same-chain Hedera path and reconciles the receipt and token movements back to both books.

**Distinctive claim:** This is not “AI trades for you.” AI proposes and explains. Deterministic comparison and policy enforce the stop; humans authorize material changes; the contract executes its encoded DvP rules; an independent checker verifies what moved. Do not imply that the DvP contract validates all off-chain trade terms unless the submitted contract actually does.

## 2. Audience and track framing

| Audience | What to emphasize | What not to claim |
|---|---|---|
| Curvegrid AI Agent judges | Two role-separated agents read different financial records, exchange evidence-backed proposals, and request human action; an attempted unsafe settlement is rejected by backend policy | A chat transcript alone equals a working agent; an LLM approves a trade |
| Curvegrid Dashboard judges | One screen exposes both records, field-level diff, approval states, settlement evidence, and unresolved book exceptions | A static table is operational reconciliation |
| General finalists | Specific failure, visible blocked transaction, approved resolution, real settlement evidence, clear buyer for product | Atomic settlement prevents every bookkeeping error |

**Potential adopter:** a tokenized-asset broker, trading desk or post-trade operations team with separate trade capture and broker confirmations. Frame as an integration layer for exception resolution and verifiable settlement, not a replacement for every clearing or custody system.

## 3. Live demonstration: four minutes

| Time | Screen/action | Spoken line | Proof judges should see |
|---|---|---|---|
| 0:00–0:20 | Two source records side by side | “Atomic settlement can move bond and cash together—but it cannot tell us whether the two firms agreed on the same trade.” | Buyer order 1,000 units; broker confirmation 1,100 units |
| 0:20–0:55 | Start two agents; open evidence exchange | “Each agent reads only its party's authenticated record. They compare the same instrument, quantity, price and settlement fields.” | Separate source IDs, message origin and 100-unit diff |
| 0:55–1:25 | Click ‘Attempt settlement’ on mismatched v1 | “The agents flag the difference. This is a real policy block before signing, not a warning banner.” | `BLOCKED_MISMATCH`; no signer invocation and no chain submission |
| 1:25–2:05 | Broker agent proposes correction to 1,000; show buyer agent's comparison | “The broker proposes—not unilaterally changes—the terms. A material amendment needs both parties' authorized humans.” | Proposal, evidence citation, version v2, buyer and broker approval states |
| 2:05–2:35 | Both authorized humans approve identical v2 hash | “These approvals bind to the exact same version and economic terms. Changing any term would invalidate them.” | Matching version/hash, role-attributed approvals, enabled settlement only after checks |
| 2:35–3:10 | Submit instruction; show receipt and transfers | “Now the approved instruction can settle. We check the receipt and the bond and cash movements—not just an event that says ‘settled.’” | Stable instruction ID, successful receipt, both token transfer records |
| 3:10–3:40 | Show four-way reconciliation | “We compare buyer book, broker confirmation, approved terms, and observed settlement. If either book is still pending, it becomes an exception.” | Both-book status or a clearly identified missing-book update; export/history |
| 3:40–4:00 | Close with product value and boundary | “TradeBridge connects agreement, execution and bookkeeping. Agents accelerate investigation; policies and people retain control.” | Architecture/impact slide; no unsupported metrics |

**If a real transaction takes too long:** use a pre-generated *real* transaction from the submitted build with transaction ID, network, time and linked evidence; distinguish it from the live mismatch/approval demo. Never pass a simulated receipt or hard-coded success off as live chain execution.

## 4. Slide plan

Use no more than five lightweight slides around the live product; avoid repeating screenshots the judges can already see.

1. **Title + one-sentence promise:** “Two agents, one agreed trade, verifiable settlement.”
2. **Problem:** internal order 1,000 versus broker confirmation 1,100; DvP does not cure differing instructions or missing book updates.
3. **Solution workflow:** `Two records → Two agents → Evidence + mismatch → Human-approved v2 → Policy gate → Hedera DvP → Four-way reconciliation`.
4. **Technical trust boundary:** agents suggest; deterministic comparator and backend block; humans approve the same hash; contract handles encoded DvP; verifier inspects bond/cash movement; book updates are reconciled separately.
5. **Who uses it + next step:** institutional operations teams; start with tokenized-bond trade exceptions; extend broker formats and production book integration after the prototype.

**Design cue:** Make `1,000 ≠ 1,100` the visual anchor. Use a visible red blocked state followed by a distinct approved v2 state. Never use green “safe” merely because a transaction executed.

## 5. Proof checklist before rehearsing

- Two agent processes or role-separated sessions use different credentials and source records; roles are not only labels on one unrestricted service.
- Deterministic comparator produces the 100-unit mismatch; agent text contains source-row references and no invented explanation.
- Mismatch and unapproved-version tests show zero signer calls. A disabled button alone is not enough.
- Approvals are authenticated, actor-attributed, version-bound and invalidated on amendment.
- Settlement preflight checks reciprocal roles, asset IDs, amounts, hold ownership/expiry and existing instruction status.
- Instruction ID is durable; timeout yields `UNKNOWN` and safe lookup rather than a second random trade.
- Receipt status and expected bond/cash token movements are checked independently.
- Hedera same-chain DvP is described accurately; separate Arc referenced payment is not presented as cross-chain atomicity.
- Audit screen preserves imported records, negotiation, approval, attempts, movements and book-update proposals.
- Clearly mark synthetic demo trades and any prerecorded transaction evidence; cite actual network/transaction identifiers during the presentation where safe.
- README points to agent tools, policy gate, agreement versioning, contract integration and verifier, with runnable setup and tests.

## 6. Seven-minute-session Q&A preparation

**Q: Why do you need AI rather than a CSV diff?**  
A deterministic diff detects mismatches and remains authoritative. The two agents interpret their own source records, exchange evidence, propose corrections, and prepare the next action without giving a model authority to approve or settle. If agent behavior is only a scripted description of a diff, say so; do not oversell autonomy.

**Q: What stops agents from agreeing on a wrong trade?**  
Their agreement is not sufficient. Authorized humans approve the same exact version, and preflight enforces constraints. Even then, approval does not guarantee the original business instruction was correct; the product preserves provenance so it can be investigated.

**Q: What does the smart contract actually guarantee?**  
Only the encoded same-chain settlement conditions and token transfers it enforces. Application-level agreement and post-settlement bookkeeping require separate checks. State exactly which checks are on-chain in the submitted build.

**Q: What if the transaction succeeds but your server times out?**  
The durable instruction becomes `UNKNOWN`. The system looks up the existing transaction and verifies receipt and transfers before marking it confirmed or permitting recovery; it does not create a new trade ID blindly.

**Q: Why does each side need its own agent?**  
The buyer and broker have different books, source evidence and authority. Separate agents can propose and challenge terms without silently giving either side the power to rewrite the other's record.

**Q: What is the customer benefit?**  
Operations teams get a traceable path from conflicting confirmations to approved settlement and book reconciliation. Frame faster investigation and fewer unresolved breaks as hypotheses until measured; do not invent time savings.

**Q: Why Curvegrid's AI Agent track?**  
The central workflow is two constrained agents understanding financial and on-chain evidence, negotiating a resolution, and attempting a policy-governed on-chain action with human approval. MultiBaas use is optional under the supplied prize brief.

**Q: What is not built yet?**  
Be explicit about missing production broker connections, compliance integration, more instruments, full source-schema coverage, and any on-chain hash binding not implemented in the submitted contract.

## 7. Optional demo video and submission

Keep the optional video between **2 and 4 minutes**, at least **720p**, with clear human narration under the event brief supplied by the team. Start with the mismatch, then the blocked signer, correction, dual approval, settlement evidence and both-book reconciliation. Reserve a fallback recording of the working flow, but distinguish recordings and fixtures honestly.

The supplied brief sets the deadline at **Sunday 27 September 2026, 09:00 JST**. Leave a submission buffer; select the relevant Curvegrid partner prize in the form and explain the actual agent behavior in your materials. If code at commit `a45e83f` predates the event, verify Classic versus Continuity eligibility and identify new work, reused code, prompts/specs and AI-assisted files in the repository.

**Final rehearsal test:** a teammate unfamiliar with the project should be able to answer, after one viewing: *What differed? Who approved the correction? What prevented premature settlement? What evidence proves what moved?* If any answer is unclear, simplify the presentation before adding features.
