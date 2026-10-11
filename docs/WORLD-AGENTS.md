# World ID for Agents

Integration for the World "Best Use of World ID for Agents" track. World ID for Agents is World's OpenID
Connect sign-in service for durable human accountability (the "Human Continuity IdP"), reachable in the
sandbox at issuer `https://sandbox.auth.world.org`. TradeBridge uses it to gate one specific action: an
AI agent's proposed trade correction can only become a real candidate once the side's human completes a
fresh World ID proof, verified by TradeBridge's own backend.

Sponsor note honored throughout: proofs in this environment are mocked (fake identities); nothing here
claims a live face-verification result.

## Why a device flow

TradeBridge's agents run headless, server-side, with no browser of their own and no redirect URI to catch
a callback. The OAuth 2.0 Device Authorization Grant (RFC 8628) fits exactly: the server requests a
`device_code`/`user_code` pair, the human completes the check on *their own* device using the
`verification_uri_complete` link, and the server polls the token endpoint until World reports an outcome.
There is no ambient session to reuse — every authorization is a fresh proof, and the human always sees an
explicit Approve/Deny screen at World, never an auto-approval.

## The journey

1. **Dispatch.** A human on side S clicks "Ask {side} agent to propose a fix" (or an agent account starts
   its own run). `POST /trades/:id/agent-runs` resolves that side's agent principal from the configured
   principals list (same tenant, side, kind `agent`, trade in scope) and always resolves the *authorizing
   human* the same way — never from client input.
2. **Draft, not a candidate.** The agent (`src/agents.ts`, `AgentTools.propose_correction`) runs its normal
   bounded tool loop (six turns, one proposal, scoped read/compare/propose tools only — never
   approve/fund/settle) and, if it proposes a fix, stores a **draft**: terms, reason, an evidence envelope,
   and the trade revision it was proposed against. State: `PENDING_HUMAN`. No candidate exists yet.
3. **Server starts the device flow.** Immediately after drafting, the server calls World's
   `device_authorization` endpoint with its own confidential client credentials (`client_secret_basic`).
   The browser is handed only `user_code`, `verification_uri` / `verification_uri_complete`, `expires_in`
   and `interval` — never the `device_code`, the client secret, or any token.
4. **Human completes the check.** The side's human opens the link (or types the code at World), and
   completes World's own proof there. TradeBridge is not involved in that step at all.
5. **Server polls.** The browser calls `POST /trades/:id/agent-authorizations/:id/poll`; the server makes
   exactly one call to World's token endpoint per request, honoring the current `interval` (and extending
   it by 5s on `slow_down`, never contacting World faster than that).
6. **Server verifies the ID token itself.** On a token response, the server — not the browser — verifies,
   using only `node:crypto` (no new dependency): RS256 signature against the JWKS `kid`, `iss`, `aud` ==
   client ID, `exp`, `auth_time` no earlier than 30s before this authorization began, `acr` present, and a
   single-use `jti`. It then requires that `(iss, sub)` is bound to *that side's human account*
   (`store.bindEnrollment`; first use binds, a mismatch is rejected) and re-checks the trade hasn't moved
   on since the draft was made.
7. **Protected action.** Only if every check passes does the server, in one `store.write`, call
   `createCandidate` (the same function every other proposal path uses) and push it onto the trade,
   together with an audit event (`AGENT_PROPOSAL_AUTHORIZED`) recording the IdP issuer, a hash of `sub`,
   `auth_time` and `acr`. This is the one and only place an agent-originated draft becomes a real candidate.
   It still requires the normal two-human World ID approval before it can ever be committed or settled —
   authorizing the *draft* is not approving the *trade*.

## The denied / expired / cancelled path

- World reports `access_denied` (the human declined) → the draft moves to `DENIED`.
- World reports `expired_token`, or the device code's own `expires_in` elapses → `EXPIRED`.
- The human calls `POST .../cancel` before completing the check → `CANCELLED`.
- Any verification failure (bad signature, wrong issuer/audience, stale `auth_time`, replayed `jti`, a
  `sub` that doesn't match this human's prior enrollment, or the trade having changed underneath the
  draft) → `FAILED`.

In every one of these paths, no candidate is ever created, and an audit event is recorded
(`AGENT_PROPOSAL_DENIED` / `_EXPIRED` / `_CANCELLED` / `_FAILED`). State transitions are compare-and-set
(`store.transitionAgentAuthorization`), so only one outcome can ever be written for a given draft, and a
poll on an already-resolved draft never contacts World again.

## Trust boundaries

- **Confidential client only.** `WORLD_IDP_CLIENT_SECRET` lives in server environment variables and is
  used only for `client_secret_basic` calls to World's `device_authorization` and `token` endpoints. It is
  never sent to, or derivable by, the browser.
- **The browser never sees a token.** Not the `device_code`, not the `id_token`, not the client secret.
  The browser only ever receives the fields `POST /trades/:id/agent-authorizations` and its `poll`/`cancel`
  siblings choose to expose (see `safeView` in `src/world-agents.ts`).
- **The client never gets to assert an outcome.** There is no endpoint where the browser can submit "it
  was approved" — the server is the only thing that ever talks to World's token endpoint, and the only
  thing that ever decides whether a draft is authorized.
- **Agent vs. human authority stays separated.** An agent account can draft a proposal but the
  `poll`/`cancel` routes require the caller to be the specific human account bound to that draft
  (`principal.kind === 'human' && principal.id === record.human_account`) — an agent can never authorize
  (or cancel) its own draft, and this is enforced independently of, and before, any World ID check.
- **One proof, one draft, forever.** `jti` is tracked as single-use across the whole tenant (not just per
  draft), so a captured/replayed token cannot be presented again for a *different* draft even though every
  other check on it would otherwise pass.
- **A human is bound to one identity, once.** The first successful authorization binds `(iss, sub)` to that
  human's account; a later authorization presenting a different `sub` for the same account is rejected,
  the same durable-enrollment pattern TradeBridge already uses for its World ID (Orb) human-verification
  feature (`store.bindEnrollment`), applied here to a separate, namespaced scope so the two features never
  collide.
- **Server-side revision re-check.** The trade's revision is re-checked at authorization time, not just at
  drafting time — if the trade changed in between (a new source import, another candidate, etc.), the
  authorization fails closed rather than creating a candidate against stale evidence.

## Environment variables

```text
WORLD_IDP_ISSUER=https://sandbox.auth.world.org   # optional; this is already the default
WORLD_IDP_CLIENT_ID=<confidential client id from https://sandbox.auth.world.org/portal>
WORLD_IDP_CLIENT_SECRET=<confidential client secret>
```

Registration happens at the World sandbox developer portal (a human operator's task, not this
integration's). Scope requested is exactly `openid`, PKCE (`S256`) is used for the authorization-code
flow (not needed for the device flow itself, which authenticates the client directly), and the discovery
document at `/.well-known/openid-configuration` confirms `RS256`, `client_secret_basic`, and both
`authorization_code` and `urn:ietf:params:oauth:grant-type:device_code` grants are supported.

## Integration debrief

On 26 September 2026, `npm run agents:check` ran the device flow against the sandbox IdP with the registered TradeBridge client and verified the resulting ID token with the same code the app uses (`verifyIdToken` in `src/world-agents.ts`). No model was involved. Later that day the whole flow ran in the app: the buyer's agent (`gpt-6-luna`) drafted a correction at 17:24:36 JST, the device authorization started two seconds later, and after the buyer's human approved in World ID for Agents the server saved proposal v2 at 17:31:55 JST (`AGENT_PROPOSAL_DRAFTED`, then `AGENT_PROPOSAL_AUTHORIZED`).

- **Time to first success:** 145 seconds from starting the device authorization to a verified ID token, including a person approving it in the browser. Registering the client took one form once portal access was granted. In the app, the agent drafted in 10 seconds, and the first `AGENT_PROPOSAL_AUTHORIZED` event followed about seven minutes later, most of it the time taken to open the approval page and approve.
- **What the live run confirmed:** `client_secret_basic` works. The device response carries `user_code`, `verification_uri`, `verification_uri_complete` (an `/authorize?transaction_id=…` page that shows the code to check), `expires_in` (1,200 seconds) and `interval` (5). A pending poll returns HTTP 400 `{"error":"authorization_pending"}`. The ID token verified against the published JWKS with issuer `https://sandbox.auth.world.org`, our client as audience, a fresh `auth_time`, `acr` `https://world.org/oidc/acr/orb-v3`, `amr` `["pop"]` and a `jti`.
- **Friction encountered:** The client portal (`sandbox.auth.world.org/portal`) only admits Google accounts permitted for the portal, so registration waited on that access. The portal requires a redirect URI even for a client that only uses the device flow; we registered an unused callback on our own domain.
- **Missing capability:** a way to exercise `slow_down`, `access_denied` and `expired_token` on demand in the sandbox, so the denied and expired paths can be checked live rather than only against a fake IdP.
- **Top improvement suggestion for World:** document the device flow's error bodies and the `acr`/`amr` values per credential alongside the discovery document, so relying parties can pin them without a live run.

## Open questions after the live check

1. The token endpoint's bodies for `slow_down`, `access_denied` and `expired_token` are assumed to follow RFC 8628 (`{"error": "..."}` over HTTP 400), as `authorization_pending` did live. They are covered only by the fake IdP in the tests.
2. Whether `amr` always includes `"pop"`. It did on the live token; the server requires `acr` but does not require `amr`.
