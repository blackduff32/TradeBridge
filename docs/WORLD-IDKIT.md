# World IDKit integration — prize write-up

TradeBridge exists to stop a corrected trade from moving until the right two humans have looked
at the exact same version of it and said yes. This document is that trust argument, written for
reviewers of World's "Best Use of IDKit" track: what the trust moment is, why Proof of Human is
the minimum sufficient credential, the paths we can demonstrate today (including the ones where
verification does *not* end in approval), and an honest debrief of integrating IDKit 4.3.0.

## The trust moment

A buyer's book and a broker's book disagree — a quantity, a price, a settlement date. TradeBridge
computes the exact difference and proposes a corrected version. That correction is *inert*: it is
not applied, no agreement is committed, and nothing can settle, until:

1. The buyer's approver and the broker's approver each independently verify with World ID, and
2. Each explicitly approves — not merely "verifies," a separate, logged decision — **the identical
   terms hash and version** of that correction, while their World ID verification is still fresh
   (fifteen minutes, or the trade's own expiry, whichever is sooner).

That is the one moment in the whole system where a human's identity has to be real: everything
before it (reconciliation, proposing terms) is bookkeeping, and everything after it (chain
commitment, funding, settlement) only executes what these two approvals already fixed in place.
If either approval is missing, stale, expired, or given by the wrong person, nothing downstream
can move. The two approvals must also be **two different people**: the same verified identity may
never stand in for both sides of the same version, and within a version the same TradeBridge
account may never be operated by two different verified identities (`src/human-trust.ts`, backed
by `Store.bindEnrollment`'s first-use binding in `src/store.ts`). Each candidate version has its own
World ID action (`approvalAction` in `src/world-id.ts`), because World ID 4.0 uniqueness proofs are
one-time per person per action; that keeps nullifiers unlinkable across versions, so these bindings
hold per version.

## Why Proof of Human is the minimum sufficient credential

TradeBridge does not need to know *who* someone is (a legal name, a document, an address) — it
needs to know that the account approving this version is being operated by one specific, unique,
living person, and that the other side's approver is someone else. World ID's Proof of Human is exactly that claim and
nothing more:

- It proves uniqueness (one Orb-verified human, one nullifier per action scope) without asking for
  a name, a document, or any other personal attribute — a strictly narrower disclosure than
  Passport or MNC, which is why we did not request those credentials.
- Combined with a required **user-presence check** (`require_user_presence`, enabled by default —
  see `require_presence` in `WorldConfig`, `src/world-id.ts`), World App also reports that the
  person completed a presence check for *this specific request*, not merely that they hold a
  previously-issued credential. That flag arrives inside the client-submitted proof and World's
  verify response does not sign it, so `WorldHumanTrust` records it as reported rather than as
  independently proven. Where a deployment cannot yet require presence, `WorldHumanTrust`
  says so honestly (`presence-not-requested:<environment>`) instead of manufacturing a presence
  claim — see `src/human-trust.ts`.
- The nullifier is scoped to our own action and RP id, so it only ever proves "the same unique
  human came back to *this* action" — it cannot be linked to that person's activity elsewhere.

Anything stronger (document identity) would collect data TradeBridge has no use for and a real
counterparty would have no reason to hand over just to approve a bond correction. Anything weaker
(no presence check, or accepting an unauthenticated claim) would let a single person operate both
sides of the same "bilateral" approval, which is the exact failure this product exists to prevent.
Proof of Human plus presence is therefore the credential whose disclosure most closely matches
the claim TradeBridge actually needs to stand behind: *a distinct, present human approved this.*

## Verification and approval: the successful path

1. A signed-in buyer or broker **human** principal (never an agent — `WorldIdService.begin`
   rejects `kind !== 'human'`) opens the candidate correction and starts World ID verification.
2. The server issues a single-use, server-signed challenge (`WorldIdService.begin`) bound to the
   exact terms hash, version, trade, account, and a five-minute RP signature TTL. The signal
   embeds all of it, hashed, so a proof cannot be replayed against a different trade, version, or
   account.
3. IDKit's `IDKitRequestWidget` requests a `ProofOfHuman` credential from World App, with
   `require_user_presence` and `allow_legacy_proofs` read from the server's response rather than
   hard-coded (`web/components/WorldVerification.tsx`), so the client always reflects the active
   server policy.
4. On a completed proof, the server re-validates everything the client could have gotten wrong or
   lied about — action, environment, nonce, signal hash, expiry, single-use challenge claim — then
   forwards the full proof to World's own `/api/v4/verify/{rp_id}`, and only then asks
   `WorldHumanTrust` to confirm presence and enrollment (`WorldIdService.verify`,
   `src/world-id.ts`). A verified HTTP 200 from World is necessary but never sufficient by itself.
5. The verified human then makes an **explicit, separate** approve/reject decision on the exact
   terms hash and version (`ConsentService.record`, `src/consent.ts`), rechecked against a live
   `StaffAuthority` immediately before it is accepted.
6. Once both sides' current, unconsumed approvals exist for the same version, `ConsentService.stage`
   atomically consumes both and stages one canonical correction — the only path by which a
   correction can ever become canonical.

## Alternative paths (what "no" looks like)

A verification flow that only ever demonstrates the happy path proves nothing about the blocking
guarantee. TradeBridge demonstrates three distinct ways the trade stays blocked:

- **Cancellation.** If the approver closes the World App widget before it succeeds, IDKit fires no
  `onSuccess` or `onError` callback for that — only `onOpenChange(false)`. `WorldVerification.tsx`
  tracks whether the current attempt already reached a definite outcome and, if it closed without
  one, shows "Verification cancelled. The trade stays blocked." No partial state is recorded
  server-side, because nothing was ever submitted.
- **The same person on both sides.** Buyer and broker prove the same per-version action, so the same
  person yields the same nullifier. Verifying for the second side is refused at verification
  (`SAME_PERSON_BOTH_SIDES`, or `IDENTITY_ALREADY_ENROLLED` from `WorldHumanTrust`), and any approval
  that got through would still be rejected with `DISTINCT_HUMANS_REQUIRED` — checked twice, independently, once at consent time
  (`ConsentService.record`) and again immediately before staging (`ConsentService.stage`), because
  a two-person guarantee that is only checked once is not a guarantee.
- **A stale version after a new proposal.** If either side's proof or approval targets a terms hash
  or version that a fresh proposal has since superseded, verification and consent both reject it
  (`STALE_CHALLENGE` / `STALE_REVISION`) rather than silently accepting a decision on trade terms
  nobody currently sees on screen.
- Also demonstrable at the World App layer itself: an ineligible user (no Orb verification yet, or
  the wrong World ID protocol) is surfaced as a specific, human-readable message rather than a
  generic failure (`widgetErrorMessage` in `WorldVerification.tsx`), covering
  `credential_unavailable`, `world_id_4_not_available`, and `user_rejected`/`verification_rejected`.

## Staging simulator as a backup path

Staging proofs may also need an open 24-hour staging verification window, whose token goes in `WORLD_STAGING_VERIFICATION_TOKEN`; see [INTEGRATIONS.md](INTEGRATIONS.md#world-id). The production app needs none.

The public World ID simulator (`simulator.worldcoin.org`, reached via the staging
`staging.world.org/verify` link IDKit's widget renders as a QR code) is enough to exercise a
*single* verification end to end, but not the two-distinct-humans requirement this product is
built around: every 4.0 proof it issues comes from one shared test identity. To keep the two-
approver flow rehearsable without a live World App and two phones, `WorldConfig.allow_legacy_simulator`
(staging only — enforced by both a schema refinement and a runtime check in `WorldIdService.verify`)
accepts the simulator's **legacy v3 "Legacy proof"** option instead, which lets an operator pick
two different simulator test identities. World ID 3.0 and 4.0 nullifiers are never compared against
each other — the identity scope embeds the protocol version precisely so a 3.0 approval can never
be paired with, or mistaken for, a 4.0 one.

## Integration debrief

**Time to first successful verification:** TODO — fill in from the live run (first `npm run setup`
+ Developer Portal app creation to first `HUMAN_APPROVED` audit event).

**Time to first deliberately-rejected path (cancel / same-person / stale version):** TODO — fill in
from the live run.

**Friction points encountered:**
- The public simulator issues every World ID 4.0 proof from a single shared test identity, so it
  cannot demonstrate this product's core two-distinct-humans requirement by itself; the only
  staging-side workaround is the legacy (v3) proof option with two separately-chosen test
  identities, which is a materially different code path (different proof shape entirely) from what
  ships to production.
- Liveness (the user-presence check) cannot be exercised at all against the simulator — there is no
  staging equivalent of a live human standing in front of an Orb-linked phone, so `require_user_presence`
  can only be verified for real on live devices.
- Closing the verification widget before it completes calls neither `onSuccess` nor `onError` —
  only `onOpenChange(false)`. Any integration that only wires the two named callbacks will silently
  treat a cancelled verification as "still pending" instead of "blocked."
  `min_protocol_version`/legacy-proof migration behavior is documented mainly in simulator-adjacent
  pages rather than the main IDKit integration guide, and was easy to miss on a first pass.
- "Staging," "sandbox," and "production" are used inconsistently across the SDK types (the
  `environment` field on `IDKitRequestConfig` accepts all three) and the developer docs; it took
  deliberate cross-referencing of the IDKit 4.3.0 `.d.ts` files to confirm which strings a real
  request/response would actually carry, and our own `WorldConfig` deliberately narrows this to the
  two values we can reason about (`production` | `staging`) rather than silently accepting `sandbox`.
- In the Developer Portal, the sidebar's **Verification** entry opens the app-store listing and
  review flow, not actions. Actions live under World ID Configuration's Actions tab
  (`/world-id?tab=actions`), which is easy to miss when looking for where to create one.
- The relying party needs a registered signer before any request verifies. **Generate new key**
  downloads the private key through the browser. We chose **Use Existing Key** instead:
  `npm run world:signer` generates the secp256k1 key straight into the private `.env`, checks that an
  SDK-signed request verifies against it, and prints only the address to paste into the portal. The
  portal then applies the change on-chain, which took under a minute.

**Missing or hard-to-find docs:** a single canonical page listing exactly which `IDKitResult`
fields are guaranteed-present versus optional per protocol version (we derived this from the
`.d.ts` type definitions in `@worldcoin/idkit-core`, not from prose documentation); a documented,
supported way to rehearse two distinct Orb-verified humans against a non-production environment.

**Top improvement we'd ask for:** a staging/sandbox mode where a developer can mint more than one
distinct World ID 4.0 test identity (with presence toggle) without dropping to the legacy v3 proof
format — so the exact production code path can be rehearsed end to end before the first real
Orb-verified user ever touches the app.

## Operator checklist

See the final implementation report for the step-by-step checklist to point this integration at a
production World Developer Portal app and two physical phones running the real World App. In
short: a production app + incognito action in the Developer Portal, `WORLD_ENVIRONMENT=production`,
`WORLD_ALLOW_LEGACY_SIMULATOR` left unset/false, real `humanTrust`/`staffAuthority` adapters wired
into `createApp`, and two distinct Orb-verified accounts signed in as the `buyer-human` and
`broker-human` development principals.
