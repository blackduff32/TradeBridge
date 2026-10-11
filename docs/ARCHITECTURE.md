# Architecture and trust boundaries

## Current executable path

```text
Development principal -> strict CSV import -> preserved source file + trade row
                                               |
                                     deterministic comparator
                                               |
                              versioned, hash-bound candidate
                                               |
                     World ID request/verification -> STOP unless a trust adapter is injected
                                               |          (only the opt-in, staging-only demo roster exists)
                              two explicit decisions -> staged correction + one PENDING instruction
                                               |
                                       Sui commitment -> not run by the app
```

Fastify owns transport and principal checks. Zod validates strict input objects. CSV Parse preserves row text and source line information. Domain code compares typed fields and uses BigInt for all financial arithmetic. SQLite owns transactions, expected-revision enforcement, durable request receipts and append-only audit. Successful writes, their audit records and idempotency receipts commit in a single local transaction. This is not a database-to-chain transaction.

SQLite's single writer and `BEGIN IMMEDIATE` serialize read/check/write operations. No asynchronous work occurs inside those transactions. Failed batches roll back every row, source-file write, audit record and request receipt. Retained request receipts are not automatically expired in this prototype.

Canonical format v1 is UTF-8 JSON with recursively sorted keys and integer amounts represented as decimal strings. Hash input is `tradebridge:terms:v1\n` followed by canonical JSON. Schema, tenant, trade/version, complete economics, identities/recipients, source references, chain, package, registry and expiry are bound. This is an off-chain candidate hash, not a claim of a deployed Move-compatible encoding. The Move spike must add matching byte-level vectors before using it for commitments. Private account references remain off-chain.

Only the API's import path establishes source provenance in this milestone. That provenance means an authenticated **development principal submitted it**, not that an external broker signed it or that it is commercially correct. Source files are private database records, and trade reads expose only their own row. Separate source-book posting states and external signatures are not yet modeled.

## Missing security boundaries

- Development bearer identities are static local credentials. Replace them with organisational authentication, current role checks, trading scope, revocation and verified World ID enrollment bindings.
- World ID requests and proof verification are implemented when configured. With a World ID app, `WorldHumanTrust` (`src/human-trust.ts`) binds each account to one verified person per version and records presence as World App reports it; a development staff directory answers whether an approver is current. On staging, the opt-in demo roster (`src/demo-trust.ts`) can stand in instead: a static list of one buyer and one broker approver, with presence as IDKit reports it. World's verify response carries no signed presence result, so presence is reported, not independently proven.
- With `SUI_PACKAGE_ID` set, the app holds testnet-only operator, buyer and broker keys in the private `.env` and runs the settlement itself (`src/sui-live.ts`, `src/chain-flow.ts`): it verifies the chain ID at boot and checks every step against finalized effects. Holding the parties' keys is a demo simplification; in production each party signs from its own wallet. Without Sui configured, `local-demo:not-connected` and `undeployed` deliberately cannot stand in for real network/package identity. The separate rehearsal script (`npm run sui:testnet`) runs the escrow outside the app.
- The Move package enforces attestations, dual wallet approvals, immutable agreement creation and escrow rules, in local tests and on testnet (package `0x7bc4129e…f9dd499a`). Backend checks alone never stand in for those contract checks: the app shows the contract itself refusing an underfunded settlement.
- Audit is append-only through the service and SQLite triggers; a database administrator can still alter storage. This is not tamper-proof evidence, encrypted storage or a production retention system.
- Health reports operational availability, not deployment readiness. The app is loopback-only, with bounded request bodies and no public CORS configuration. Production rate limits, SSO, TLS, observability, migrations and data lifecycle controls remain work.

## Integration evidence to establish next

World's current credential documentation describes Proof of Human, a request-level `require_user_presence` check and signal binding. The default Proof of Human preset can include legacy fallback; TradeBridge must explicitly pin and test an acceptable policy. These documented request options are not sufficient evidence of this application's implementation. [World credential configuration](https://docs.world.org/world-id/idkit/credentials)

The verifier spike must use the server verification API and establish how required presence, challenge integrity and all relevant proof results are authenticated; HTTP 200 alone must not become an approval. Also prove same-person rejection across buyer and broker accounts using an appropriate shared scope or verified enrollment design. [World verification API](https://docs.world.org/api-reference/developer-portal/verify)

Sui programmable transactions supply atomic execution for the final release, while the two parties' prior deposits remain separate transactions. Design the Move escrow around actual ownership, authorization, immutable agreement fields, exact balances, expiration and original-funder refunds. [Sui PTBs](https://docs.sui.io/develop/transactions/ptbs/)

The source PRD is retained as product requirements. Its operational examples, event suggestions and external actions are not blanket authorization to publish contracts, submit hackathon entries or move assets.

## Browser and integration modules

`web/` implements the responsive React workspace. `src/browser-session.ts` supplies one-hour HttpOnly sessions and isolated synthetic demo tenants. `src/world-id.ts` holds signed, durable, version-bound challenges; raw biometric data is never requested or retained. `src/sui.ts` contains unsigned PTB builders and effect checks. `contracts/tradebridge` is a compiled Move package tested separately from the API. See `INTEGRATIONS.md` for what is implemented versus still disconnected.
