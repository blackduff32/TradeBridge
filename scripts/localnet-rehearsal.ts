// End-to-end settlement rehearsal against a private Sui localnet, with no testnet funds needed.
// Start one first: sui start --with-faucet --force-regenesis
// Then: LOCALNET_RPC=http://127.0.0.1:9000 LOCALNET_FAUCET=http://127.0.0.1:9123 npm run rehearse:localnet
// World ID approvals are stood in for by two consent records here; the World flow has its own tests.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { ChainFlow } from '../src/chain-flow.js';
import { ConsentService, type StaffAuthority } from '../src/consent.js';
import { createCandidate, DomainError, sha256, type Principal } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { Store } from '../src/store.js';
import { SuiLive } from '../src/sui-live.js';
import { buildBytecode, publishTradeBridge } from './sui-publish.js';

const RPC = process.env.LOCALNET_RPC ?? 'http://127.0.0.1:9000';
const FAUCET = process.env.LOCALNET_FAUCET ?? 'http://127.0.0.1:9123';
const client = new SuiGrpcClient({ network: 'localnet', baseUrl: RPC });
const keys = { operator: Ed25519Keypair.generate(), buyer: Ed25519Keypair.generate(), broker: Ed25519Keypair.generate() };
for (const key of Object.values(keys)) await requestSuiFromFaucetV2({ host: FAUCET, recipient: key.toSuiAddress() });
const parties = { buyer: keys.buyer.toSuiAddress(), broker: keys.broker.toSuiAddress() };
const ids = await publishTradeBridge(client, keys.operator, parties, buildBytecode());
const { chainIdentifier } = await client.getChainIdentifier();
const sui = new SuiLive({ grpc_url: RPC, chain_id: chainIdentifier, package_id: ids.package, registry_id: ids.registry, verifier_cap_id: ids.verifier, bond_type: ids.bondType, cash_type: ids.cashType },
  { operator: keys.operator.getSecretKey(), buyer: keys.buyer.getSecretKey(), broker: keys.broker.getSecretKey() }, 'localnet');

const tenant = 'rehearsal';
const principals: Principal[] = (['buyer', 'broker'] as const).flatMap(side => (['agent', 'human'] as const).map(kind => ({ id: `${side}-${kind}`, tenant, organisation: `${side}-demo-org`, side, kind, tradeIds: ['TB-001'], token: randomBytes(32).toString('hex') })));
const person = (id: string) => principals.find(p => p.id === id)!;
const store = new Store();
seedSandbox(store, person('buyer-agent'), new Date(), sui.environment(), parties);
const trade = store.get(tenant, 'TB-001')!;
const { account_ref: _a, external_reference: _e, ...terms } = trade.sources.buyer!.record;
const candidate = createCandidate(trade, terms, 'Align the broker confirmation with the original buyer order.', sui.environment(), new Date());
trade.candidates.push(candidate); trade.revision++; store.save(trade);
for (const side of ['buyer', 'broker'] as const) {
  store.saveConsent({ id: randomUUID(), tenant, trade_id: 'TB-001', version: candidate.version, terms_hash: candidate.terms_hash, side, account: `${side}-human`, organisation: `${side}-demo-org`, challenge_id: randomUUID(), person_binding: sha256(`person-${side}`), identity_scope: 'rehearsal', receipt_hash: randomBytes(32).toString('hex'), decision: 'approve', decided_at: new Date().toISOString(), expires_at: new Date(Date.now() + 900_000).toISOString(), consumed: false });
}
const directory: StaffAuthority = { async assertCurrent() {}, resolve: (t, account) => principals.find(p => p.tenant === t && p.id === account) };
const flow = new ChainFlow(store, sui, new ConsentService(store, directory), () => new Date());
const show = (label: string) => console.log(`${label}: ${store.chainRun<{ steps: { key: string; digest: string; success: boolean; error: string | null }[] }>(tenant, 'TB-001', candidate.version)!.steps.map(s => `${s.key}${s.success ? '' : ` (rejected: ${s.error})`}`).join(' → ')}`);

const committed = await flow.commit(person('buyer-human'), trade);
assert.ok(committed.agreement_id && committed.escrow_id, 'commit must create an agreement and escrow');
show('committed');
await flow.fund(person('buyer-human'), trade);
await assert.rejects(() => flow.settle(person('buyer-human'), trade), (e: unknown) => e instanceof DomainError && e.code === 'ESCROW_NOT_FUNDED');
const probed = await flow.settle(person('buyer-human'), trade, true);
assert.match(probed.steps.at(-1)!.error ?? '', /MoveAbort 6/, 'the contract must reject an underfunded settlement');
show('half-funded probe');
await flow.fund(person('broker-human'), trade);
const settled = await flow.settle(person('buyer-human'), trade);
assert.deepEqual(settled.settlement && { status: settled.settlement.status, verified: settled.settlement.verified }, { status: 'CONFIRMED', verified: true });
show('settled');
const state = await flow.state(trade);
assert.equal(state.escrow?.settled, true);
console.log(`Escrow ${state.escrow_id}: bond ${state.escrow?.bond.funded}/${state.escrow?.bond.required} (paid out), cash ${state.escrow?.cash.funded}/${state.escrow?.cash.required}; settlement ${settled.settlement!.digest} verified.`);
