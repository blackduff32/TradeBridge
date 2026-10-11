# Demo script

For the 4-minute live demo and the 2–4 minute submission video. ETHGlobal's rules apply to the video: at least 720p, no speed-up, and your own voice (no AI voiceover).

## Before you start

1. `npm run live:reset`, then `npm run dev`. The API log should say `World ID production` and `Sui testnet package 0x7bc4…`.
2. Open two browser windows side by side, for example one normal and one private. Sign in as **buyer-human** in one and **broker-human** in the other, using the development tokens in `.env` under **Workspace access**.
3. Have two phones ready, each with World App and a different Orb-verified World ID.
4. Open a Suiscan tab on the [package](https://suiscan.xyz/testnet/object/0x7bc4129e33ba9954efd5f4484c60ec6f2773a92a552e7559bb144a20f9dd499a).
5. For the agent beat, set `OPENAI_API_KEY`, `TRADEBRIDGE_MODEL`, `WORLD_IDP_CLIENT_ID` and `WORLD_IDP_CLIENT_SECRET` in `.env` first. Without them, skip that beat.

## Script (about 3.5 minutes)

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | Trade review, both windows | "A buyer booked 1,000 bond units. The broker booked 1,100. In back offices this gets caught days after settlement, if at all. TradeBridge catches it before anything moves." |
| 0:20 | Compare source records | "Both original records stay intact, with source hashes. The difference is exact: 100 units and 1,000 DEMOUSD." |
| 0:35 | Buyer window: **Ask buyer agent to propose a fix** | "Each side has a scoped AI agent. It can read evidence and draft a fix, but it can never approve, fund or settle." |
| 0:50 | The draft card with the user code, then **Open World ID authorization** | "The agent's draft isn't a proposal yet. The buyer authorizes it through World ID for Agents. The server verifies the token itself, and only then saves version 2." |
| 1:15 | Buyer window: **Verify with World ID**, scan with phone 1, then **Approve** | "Approving is the trust moment, because it changes what money moves. I prove I'm a unique human with World ID, then explicitly approve this exact version." |
| 1:40 | Broker window, phone 2 | "The broker does the same on their own phone. The same person can't approve for both sides, and a different person can't take over an account." |
| 2:00 | **Commit agreement on Sui** | "Now it goes on-chain. Both approvals are attested, each party approves from its own wallet, and the agreement is frozen as an immutable object with a separate escrow." |
| 2:25 | **Fund cash leg**, then **Prove the contract refuses** | "The buyer funds only their cash leg. Can anyone settle half-funded? The contract rejects it on-chain, and here is the failed transaction." |
| 2:50 | Broker window: **Deliver bond leg**, then **Settle both legs atomically**, then open the Suiscan link | "The broker delivers the bond, and one transaction pays out both legs, verified from finalized effects. Either both legs move or neither does." |
| 3:15 | Audit trail | "Every step is in an append-only audit trail and on Suiscan. World ID for the humans, World ID for Agents for the AI, and Sui for atomic settlement." |

Beat without the agent: at 0:35, have the buyer use **Create proposal v2** with quantity 1,000 and say that humans can also propose directly.

## Likely questions

- **Why World ID and not just wallets?** A wallet proves key control, not that two different people agreed. World ID makes the two approvals come from two distinct, unique humans, without collecting identity documents.
- **What does the chain trust?** Move does not verify World ID proofs. A registry-bound verifier capability attests opaque receipt commitments that the server derived from proofs it verified with World, and it can be rotated. That service is the stated trust assumption.
- **What stops an agent from settling?** Its tool list has no approve, fund or settle tools, and the server checks authority on every route. Its draft needs its human's World ID for Agents authorization before it becomes a candidate.
- **Why Sui?** Typed `Coin<T>` legs, a frozen agreement object plus a shared escrow object, and atomic multi-transfer settlement in one transaction with fast finality. The nine-step flow takes about 20 seconds on testnet.
- **Who holds the keys?** For the demo, the server holds the buyer and broker testnet keys. In production, each party signs from its own wallet; the escrow logic doesn't change.
- **What is real and what is synthetic?** The chain transactions and World ID verifications are real. The trade, the parties and the coins are synthetic and have no value.
