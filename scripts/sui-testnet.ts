// Sui testnet rehearsal of the TradeBridge escrow, using the app's own transaction builders
// (src/sui.ts) and settlement-effects verifier. Every command checks the chain before signing.
// Keys are fresh, generated here, and kept in the gitignored .tools/ directory; secrets are never
// printed. The operator key publishes, holds the verifier capability and sponsors all gas, so the
// buyer and broker keys never need SUI.
//
//   npm run sui:testnet -- keys       generate keys (once) and print addresses
//   npm run sui:testnet -- balances   SUI balance of each key
//   npm run sui:testnet -- publish    publish contracts/tradebridge and finalize both demo currencies
//   npm run sui:testnet -- flow       mint, propose, attest, approve x2, commit, deposit x2, settle
//
// SUI_NETWORK=localnet runs the same commands against `sui start --with-faucet` for free rehearsals,
// with separate keys in .tools/sui-localnet; `faucet` funds the operator there.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase58, normalizeStructTag, normalizeSuiAddress, toHex } from '@mysten/sui/utils';
import { createCandidate, parseCsv, sha256, type Candidate, type Environment, type Trade } from '../src/domain.js';
import { approveTransaction, attestationTransaction, commitmentTransaction, depositTransaction, proposeTransaction, settlementTransaction, verifySettlementEffects, type SettlementEffects, type SuiConfig } from '../src/sui.js';
import { exampleCsv, exampleTerms } from './fixtures.js';

const network = process.env.SUI_NETWORK === 'localnet' ? 'localnet' : 'testnet';
const CHAIN_IDENTIFIERS = { testnet: '4c78adac', mainnet: '35834a8a' };
const CHAIN_ID = `sui:${network}`;
const dir = resolve(process.env.SUI_TESTNET_DIR ?? `.tools/sui-${network}`);
const keysPath = resolve(dir, 'keys.json');
const deploymentPath = resolve(dir, 'deployment.json');
const roles = ['operator', 'buyer', 'broker'] as const;
type Role = typeof roles[number];
type Keys = Record<Role, Ed25519Keypair>;
interface Deployment { network: string; package_id: string; registry_id: string; admin_cap: string; verifier_cap: string; upgrade_cap: string; treasury: { bond: string; cash: string }; publish_digest: string; finalize_digest: string | null; published_at: string }
interface Step { label: string; digest: string; status: 'success' | 'failure'; sender: string; abort?: string }
type Executed = Awaited<ReturnType<typeof execute>>;

// Public fullnodes no longer serve JSON-RPC; the gRPC client is the supported path.
const client = new SuiGrpcClient({ network, baseUrl: network === 'testnet' ? 'https://fullnode.testnet.sui.io:443' : 'http://127.0.0.1:9000' });
const txLink = (digest: string) => network === 'testnet' ? `https://suiscan.xyz/testnet/tx/${digest}` : digest;
const objectLink = (id: string) => network === 'testnet' ? `https://suiscan.xyz/testnet/object/${id}` : id;

function loadKeys(): Keys {
  if (!existsSync(keysPath)) throw new Error(`No keys at ${keysPath}. Run: npm run sui:testnet -- keys`);
  const raw = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<Role, string>;
  return Object.fromEntries(roles.map(role => [role, Ed25519Keypair.fromSecretKey(raw[role])])) as Keys;
}
function loadDeployment(): Deployment {
  if (!existsSync(deploymentPath)) throw new Error('No deployment yet. Run: npm run sui:testnet -- publish');
  return JSON.parse(readFileSync(deploymentPath, 'utf8')) as Deployment;
}
function save(path: string, value: unknown) { mkdirSync(dir, { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
async function assertNetwork() {
  // gRPC returns the base58 genesis checkpoint digest; its first four bytes are the CLI chain ID.
  const { chainIdentifier } = await client.getChainIdentifier();
  const chain = toHex(fromBase58(chainIdentifier)).slice(0, 8);
  if (network === 'testnet' ? chain !== CHAIN_IDENTIFIERS.testnet : Object.values(CHAIN_IDENTIFIERS).includes(chain)) throw new Error(`Refusing to run: RPC chain ${chain} is not Sui ${network}.`);
}

/** Signs with every signer (sender first, then any gas sponsor) and waits for finality. */
async function execute(label: string, transaction: Transaction, signers: Ed25519Keypair[], steps: Step[], expect: 'success' | 'failure' = 'success') {
  const bytes = await transaction.build({ client });
  const signatures = await Promise.all(signers.map(async signer => (await signer.signTransaction(bytes)).signature));
  const result = await client.executeTransaction({ transaction: bytes, signatures, include: { effects: true, objectTypes: true } });
  const done = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
  await client.waitForTransaction({ digest: done.digest });
  const ok = done.status.success;
  const abort = ok ? undefined : JSON.stringify(done.status.error);
  steps.push({ label, digest: done.digest, status: ok ? 'success' : 'failure', sender: signers[0]!.toSuiAddress(), ...(abort ? { abort } : {}) });
  console.log(`${label.padEnd(32)} ${ok ? 'success' : 'aborted'}  ${done.digest}`);
  if ((expect === 'success') !== ok) throw new Error(`${label} ${ok ? 'unexpectedly succeeded' : `failed: ${abort}`}`);
  return done;
}
function created(done: Executed, type: RegExp) {
  const ids = done.effects!.changedObjects.filter(c => c.idOperation === 'Created' && type.test(done.objectTypes![c.objectId] ?? '')).map(c => c.objectId);
  if (ids.length !== 1) throw new Error(`Expected one created object matching ${type}, found ${ids.length}.`);
  return ids[0]!;
}
/** The party signs as sender; the operator pays the gas. */
function sponsored(transaction: Transaction, operator: Ed25519Keypair) { transaction.setGasOwner(operator.toSuiAddress()); return transaction; }
function asOperator(transaction: Transaction, operator: Ed25519Keypair) { transaction.setSender(operator.toSuiAddress()); return transaction; }
/** Denied paths have to reach the chain, but the gRPC resolver simulates every full build and throws
 * on an abort. Resolve the inputs in a kind-only build, then fix gas so that no simulation runs. */
async function unsimulated(transaction: Transaction, sender: Ed25519Keypair) {
  const full = Transaction.fromKind(await transaction.build({ client, onlyTransactionKind: true }));
  const [{ referenceGasPrice }, { objects }] = await Promise.all([client.getReferenceGasPrice(), client.listCoins({ owner: sender.toSuiAddress(), coinType: '0x2::sui::SUI' })]);
  const coin = [...objects].sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))[0];
  if (!coin) throw new Error('The sender needs a SUI coin object to pay for a denied-path transaction.');
  full.setSender(sender.toSuiAddress()); full.setGasPrice(BigInt(referenceGasPrice)); full.setGasBudget(20_000_000);
  full.setGasPayment([{ objectId: coin.objectId, version: coin.version, digest: coin.digest }]);
  return full;
}

async function keys() {
  if (existsSync(keysPath)) console.log(`Keys already exist at ${keysPath}; reusing them.`);
  else {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fresh = Object.fromEntries(roles.map(role => [role, Ed25519Keypair.generate().getSecretKey()]));
    writeFileSync(keysPath, JSON.stringify(fresh, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    chmodSync(keysPath, 0o600);
    console.log(`Generated fresh testnet-only keys in ${keysPath} (mode 600, gitignored).`);
  }
  for (const [role, pair] of Object.entries(loadKeys())) console.log(`${role.padEnd(8)} ${pair.toSuiAddress()}`);
}
async function balances() {
  await assertNetwork();
  for (const [role, pair] of Object.entries(loadKeys())) {
    const { balance } = await client.getBalance({ owner: pair.toSuiAddress() });
    console.log(`${role.padEnd(8)} ${pair.toSuiAddress()} ${(Number(balance.balance) / 1e9).toFixed(4)} SUI`);
  }
}

async function faucet() {
  if (network !== 'localnet') throw new Error('Fund testnet keys at https://faucet.sui.io; this command only serves localnet.');
  await assertNetwork();
  await requestSuiFromFaucetV2({ host: getFaucetHost('localnet'), recipient: loadKeys().operator.toSuiAddress() });
  await balances();
}
async function publish() {
  await assertNetwork();
  if (existsSync(deploymentPath)) throw new Error(`${deploymentPath} already records a deployment. Move it aside to publish again.`);
  const { operator } = loadKeys();
  const sui = process.env.SUI_BIN || (existsSync('.tools/sui') ? resolve('.tools/sui') : 'sui');
  // Same isolated, wallet-free config as npm run test:move; building needs no keys.
  const build = spawnSync(sui, ['move', 'build', '--dump-bytecode-as-base64', '--path', 'contracts/tradebridge'], { encoding: 'utf8', env: { ...process.env, SUI_CONFIG_DIR: resolve('.tools/sui-config') } });
  if (build.status !== 0) throw new Error(`sui move build failed:\n${build.stderr}`);
  const { modules, dependencies } = JSON.parse(build.stdout) as { modules: string[]; dependencies: string[] };
  const steps: Step[] = [];
  const publishTx = asOperator(new Transaction(), operator);
  const [upgradeCap] = publishTx.publish({ modules, dependencies });
  publishTx.transferObjects([upgradeCap!], operator.toSuiAddress());
  const published = await execute('publish', publishTx, [operator], steps);
  const packageId = normalizeSuiAddress(published.effects!.changedObjects.find(c => c.outputState === 'PackageWrite')!.objectId);
  const deployment: Deployment = {
    network: CHAIN_ID, package_id: packageId,
    registry_id: created(published, /::settlement::Registry$/), admin_cap: created(published, /::settlement::AdminCap$/), verifier_cap: created(published, /::settlement::VerifierCap$/),
    upgrade_cap: created(published, /::package::UpgradeCap$/),
    treasury: { bond: created(published, /::coin::TreasuryCap<.*::demo_bond::DEMO_BOND>$/), cash: created(published, /::coin::TreasuryCap<.*::demo_usd::DEMO_USD>$/) },
    publish_digest: published.digest, finalize_digest: null, published_at: new Date().toISOString(),
  };
  save(deploymentPath, deployment);
  // Each init sends a Currency to the coin registry; finalizing shares it with its metadata.
  try {
    const finalize = asOperator(new Transaction(), operator);
    for (const name of ['demo_bond::DEMO_BOND', 'demo_usd::DEMO_USD']) {
      finalize.moveCall({ target: '0x2::coin_registry::finalize_registration', typeArguments: [`${packageId}::${name}`], arguments: [finalize.object('0xc'), finalize.object(created(published, new RegExp(`::coin_registry::Currency<.*::${name}>$`)))] });
    }
    save(deploymentPath, { ...deployment, finalize_digest: (await execute('finalize demo currencies', finalize, [operator], steps)).digest });
  } catch (error) { console.warn(`Currency finalization did not complete; the package is still usable. ${error instanceof Error ? error.message : error}`); }
  console.log(`\nPackage   ${deployment.package_id}\n          ${objectLink(deployment.package_id)}\nRegistry  ${deployment.registry_id}\n          ${objectLink(deployment.registry_id)}\nPublish   ${txLink(deployment.publish_digest)}`);
}

/** A candidate built by the app's own domain code, bound to this testnet deployment and these keys. */
function rehearsalCandidate(deployment: Deployment, keys: Keys, now: Date): Candidate {
  const environment: Environment = { chain_id: CHAIN_ID, package_id: deployment.package_id, registry_id: deployment.registry_id, bond_type: normalizeStructTag(`${deployment.package_id}::demo_bond::DEMO_BOND`), cash_type: normalizeStructTag(`${deployment.package_id}::demo_usd::DEMO_USD`) };
  const parties = { buyer_address: keys.buyer.toSuiAddress(), broker_address: keys.broker.toSuiAddress(), buyer_recipient: keys.buyer.toSuiAddress(), broker_recipient: keys.broker.toSuiAddress(), bond_type: environment.bond_type, cash_type: environment.cash_type };
  // A fresh tenant per run gives a fresh registry trade key, because each key commits once.
  const tenant = `testnet-rehearsal-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const trade: Trade = { id: 'TB-001', tenant, revision: 2, sources: {}, candidates: [], canonical: null };
  for (const side of ['buyer', 'broker'] as const) {
    const csv = exampleCsv(side, now, parties);
    trade.sources[side] = { ...parseCsv(csv)[0]!, id: randomUUID(), side, file_hash: sha256(csv), imported_at: now.toISOString(), actor: `${side}-rehearsal`, organisation: `${side}-demo-org` };
  }
  return createCandidate(trade, { ...exampleTerms('buyer', now), ...parties }, 'Align the broker confirmation with the original buyer order.', environment, now);
}

async function flow() {
  await assertNetwork();
  const keys = loadKeys(); const deployment = loadDeployment(); const { operator, buyer, broker } = keys;
  const now = new Date(); const steps: Step[] = [];
  const candidate = rehearsalCandidate(deployment, keys, now);
  const config: SuiConfig = { chain_id: CHAIN_ID, package_id: deployment.package_id, registry_id: deployment.registry_id, bond_type: candidate.terms.bond_type, cash_type: candidate.terms.cash_type };
  console.log(`Candidate v${candidate.version} ${candidate.terms_hash}\n  ${candidate.terms.quantity} DEMOBOND for ${candidate.terms.net_cash_base} DEMOUSD base units, tenant ${candidate.terms.tenant}\n`);

  // Synthetic assets for this run, minted in exact amounts by the operator's treasury caps.
  const mint = asOperator(new Transaction(), operator);
  mint.moveCall({ target: '0x2::coin::mint_and_transfer', typeArguments: [config.bond_type], arguments: [mint.object(deployment.treasury.bond), mint.pure.u64(candidate.terms.quantity), mint.pure.address(broker.toSuiAddress())] });
  mint.moveCall({ target: '0x2::coin::mint_and_transfer', typeArguments: [config.cash_type], arguments: [mint.object(deployment.treasury.cash), mint.pure.u64(candidate.terms.net_cash_base), mint.pure.address(buyer.toSuiAddress())] });
  const minted = await execute('mint DEMOBOND and DEMOUSD', mint, [operator], steps);
  const bondCoin = created(minted, /::coin::Coin<.*::demo_bond::DEMO_BOND>$/); const cashCoin = created(minted, /::coin::Coin<.*::demo_usd::DEMO_USD>$/);

  const proposed = await execute('propose (buyer)', sponsored(proposeTransaction(config, candidate, buyer.toSuiAddress()), operator), [buyer, operator], steps);
  const intentId = created(proposed, /::settlement::Intent<.*>$/);
  // Opaque 32-byte receipt commitments. This rehearsal uses synthetic ones, not World ID consents.
  const receipts = { buyer: sha256(`tradebridge:testnet-rehearsal:buyer:${randomUUID()}`), broker: sha256(`tradebridge:testnet-rehearsal:broker:${randomUUID()}`), expires_at: new Date(now.getTime() + 15 * 60_000).toISOString() };
  await execute('attest (verifier capability)', asOperator(attestationTransaction(config, candidate, intentId, deployment.verifier_cap, receipts), operator), [operator], steps);
  await execute('approve (buyer)', sponsored(approveTransaction(config, candidate, intentId, 'buyer'), operator), [buyer, operator], steps);
  await execute('approve (broker)', sponsored(approveTransaction(config, candidate, intentId, 'broker'), operator), [broker, operator], steps);
  const committed = await execute('commit agreement', asOperator(commitmentTransaction(config, candidate, intentId), operator), [operator], steps);
  const agreementId = created(committed, /::settlement::Agreement<.*>$/); const escrowId = created(committed, /::settlement::Escrow<.*>$/);
  await execute('deposit bond (broker)', sponsored(depositTransaction(config, candidate, agreementId, escrowId, BigInt(candidate.terms.quantity), 'broker'), operator), [broker, operator], steps);
  // Denied path: with only the bond funded, settle must abort on chain, where it is recorded.
  await execute('settle, one leg funded (denied)', await unsimulated(settlementTransaction(config, candidate, agreementId, escrowId), operator), [operator], steps, 'failure');
  await execute('deposit cash (buyer)', sponsored(depositTransaction(config, candidate, agreementId, escrowId, BigInt(candidate.terms.net_cash_base), 'buyer'), operator), [buyer, operator], steps);
  const settled = await execute('settle', asOperator(settlementTransaction(config, candidate, agreementId, escrowId), operator), [operator], steps);
  await execute('settle again (denied)', await unsimulated(settlementTransaction(config, candidate, agreementId, escrowId), operator), [operator], steps, 'failure');

  const verdict = verifySettlementEffects(config, candidate, { digest: settled.digest, agreement_id: agreementId, escrow_id: escrowId }, await finalizedEffects(settled.digest));
  console.log(`\nverifySettlementEffects: ${verdict.status}${verdict.verified ? ` at checkpoint ${verdict.checkpoint}` : ''}`);
  const run = { network: CHAIN_ID, package_id: deployment.package_id, registry_id: deployment.registry_id, run_at: now.toISOString(), tenant: candidate.terms.tenant, trade_id: candidate.terms.trade_id, version: candidate.version, terms_hash: candidate.terms_hash, receipts: 'synthetic', parties: { buyer: buyer.toSuiAddress(), broker: broker.toSuiAddress(), operator: operator.toSuiAddress() }, objects: { intent: intentId, agreement: agreementId, escrow: escrowId, bond_coin: bondCoin, cash_coin: cashCoin }, steps, verification: verdict };
  const path = resolve(dir, `run-${now.toISOString().replace(/[:.]/g, '-')}.json`); save(path, run);
  console.log(`\nRecorded ${path}\n\n| Step | Result | Transaction |\n| --- | --- | --- |\n${steps.map(s => `| ${s.label} | ${s.status === 'success' ? 'Success' : 'Aborted'} | [${s.digest}](${txLink(s.digest)}) |`).join('\n')}\n\nAgreement ${objectLink(agreementId)}\nEscrow    ${objectLink(escrowId)}`);
  if (!verdict.verified) throw new Error('The settlement effects did not verify.');
}

/** Decodes checkpointed transaction data into the normalized shape verifySettlementEffects checks. */
async function finalizedEffects(digest: string): Promise<SettlementEffects> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await client.getTransaction({ digest, include: { balanceChanges: true, transaction: true } });
    const done = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
    if (done.checkpoint) {
      const data = done.transaction as unknown as { inputs: Record<string, unknown>[]; commands: { MoveCall?: { package: string; module: string; function: string; arguments: { Input?: number }[] } }[] };
      const objectId = (value: unknown): string | null => {
        if (!value || typeof value !== 'object') return null;
        if ('objectId' in value && typeof value.objectId === 'string') return normalizeSuiAddress(value.objectId);
        for (const inner of Object.values(value)) { const found = objectId(inner); if (found) return found; }
        return null;
      };
      return {
        digest: done.digest, chain_id: CHAIN_ID, checkpoint: done.checkpoint, status: done.status.success ? 'success' : 'failure',
        calls: data.commands.flatMap(c => c.MoveCall ? [{ package_id: normalizeSuiAddress(c.MoveCall.package), module: c.MoveCall.module, function: c.MoveCall.function, object_ids: c.MoveCall.arguments.map(arg => arg.Input === undefined ? null : objectId(data.inputs[arg.Input])).filter((id): id is string => Boolean(id)) }] : []),
        balance_changes: done.balanceChanges!.map(change => ({ owner: normalizeSuiAddress(change.address), coin_type: normalizeStructTag(change.coinType), amount: change.amount })),
      };
    }
    await new Promise(wake => setTimeout(wake, 2000));
  }
  throw new Error(`Transaction ${digest} was not checkpointed within a minute.`);
}

const commands: Record<string, () => Promise<void>> = { keys, balances, faucet, publish, flow };
const command = commands[process.argv[2] ?? ''];
if (!command) { console.error(`Usage: npm run sui:testnet -- <${Object.keys(commands).join('|')}>`); process.exit(1); }
await command();
