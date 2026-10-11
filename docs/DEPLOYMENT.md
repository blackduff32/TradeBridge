# Vercel hosting

Live demo: **https://tradebridge-sigma.vercel.app**.

The Vercel deployment runs the React UI plus `api/index.ts` on Node 22. It is a **synthetic demo**, separate from the local credential-based workspace. Live human approval, agent provider calls and settlement remain disabled.

## Persistence and isolation

Each visitor receives a random Secure/HttpOnly/SameSite cookie. Its SHA-256 hash identifies a private Vercel Blob snapshot. Each API request restores a fresh in-memory SQLite store, executes the existing domain/API logic and conditionally persists successful writes using the blob's ETag. Reads bypass the Blob cache. A conflicting write returns 409; storage failures return 503. No local function filesystem is used for persistence.

Only synthetic evidence, proposals, audit and idempotency rows are snapshotted. Consent, verification, outbox and model-run tables are excluded. The API rejects development credentials and CSV imports, caps requests at 12 KB and caps each sample at 20 proposals. Sessions expire after one hour. Leaving the demo deletes its snapshot. Expired snapshots are removed when their session is next accessed; abandoned snapshots need periodic operator cleanup. Use sample information only.

This is demo persistence, not a production ledger or organizational authentication system. A real deployment requires the remaining trust integrations and an operational database/retention design.

## Project configuration

- Source repository: `blackduff32/TradeBridge`.
- Connect this repository to a Vercel project in your own account and select `main` as the production branch. Hosting credentials and project ownership are not transferred by copying source code.
- The demo URL above belongs to the original deployment. This import does not redeploy it. The original account-specific deployment workflow was removed.
- Build: `npm run build`; static output: `web-dist`.
- API: `/api/*` routes to the Node function in `api/index.ts`.
- Private Blob store: `tradebridge-demo`, region `iad1`.
- Required server environment: `BLOB_READ_WRITE_TOKEN`, connected to production and preview by Vercel. Never expose it through a `VITE_` variable.
- Local `.env`, databases and development credentials are excluded from uploads. No World ID or model secrets are copied to hosting.

To redeploy using the authenticated CLI:

```sh
vercel link
vercel deploy --prod
```

Check `/api/health`, then exercise the browser workflow:

```sh
TRADEBRIDGE_E2E_URL=https://tradebridge-sigma.vercel.app npm run test:e2e
```

The hosted test creates two synthetic workspaces, checks proposal persistence after reload, audit history, isolation, blocked execution and mobile accessibility, then removes its workspaces.
