// Shared by the testnet deploy and the localnet rehearsal: compile with the pinned CLI,
// publish through the SDK, then register the demo coins, mint them and fund party gas.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';

const BOND_MINT = 10_000n; // zero-decimal bond units, enough for repeated rehearsals
const CASH_MINT = 100_000_000n; // 1,000,000.00 DEMOUSD in base units
const PARTY_GAS = 200_000_000n; // 0.2 SUI each

/** Always builds for the testnet environment; framework packages are identical on every network. */
export function buildBytecode() {
  // Same empty config as scripts/move.mjs, which stops the CLI generating a wallet on first run.
  const sui = process.env.SUI_BIN || (existsSync('.tools/sui') ? resolve('.tools/sui') : 'sui');
  const configDir = resolve('.tools/sui-config');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  if (!existsSync(resolve(configDir, 'empty.keystore'))) writeFileSync(resolve(configDir, 'empty.keystore'), '[]', { mode: 0o600 });
  if (!existsSync(resolve(configDir, 'client.yaml'))) writeFileSync(resolve(configDir, 'client.yaml'), `keystore:\n  File: ${JSON.stringify(resolve(configDir, 'empty.keystore'))}\nenvs:\n  - alias: testnet\n    rpc: https://fullnode.testnet.sui.io:443\nactive_env: testnet\nactive_address: null\n`, { mode: 0o600 });
  const build = spawnSync(sui, ['move', 'build', '--dump-bytecode-as-base64', '-e', 'testnet', '--path', 'contracts/tradebridge'], { encoding: 'utf8', env: { ...process.env, SUI_CONFIG_DIR: configDir }, maxBuffer: 32 * 1024 * 1024 });
  if (build.status !== 0) throw new Error(`Move build failed:\n${build.stderr || build.stdout}`);
  return JSON.parse(build.stdout.slice(build.stdout.indexOf('{'))) as { modules: string[]; dependencies: string[] };
}

export async function publishTradeBridge(client: SuiGrpcClient, operator: Ed25519Keypair, parties: { buyer: string; broker: string }, bytecode: { modules: string[]; dependencies: string[] }, log: (line: string) => void = console.log) {
  async function execute(label: string, tx: Transaction) {
    const result = await client.signAndExecuteTransaction({ signer: operator, transaction: tx, include: { effects: true, objectTypes: true } });
    const executed = result.Transaction ?? result.FailedTransaction;
    if (result.$kind !== 'Transaction' || !executed.status.success) throw new Error(`${label} failed: ${JSON.stringify(executed.status)}`);
    await client.waitForTransaction({ digest: executed.digest });
    log(`${label}: ${executed.digest}`);
    return executed;
  }
  const publish = new Transaction();
  publish.transferObjects([publish.publish(bytecode)], operator.toSuiAddress());
  const published = await execute('publish', publish);
  const created = published.effects.changedObjects.filter(o => o.idOperation === 'Created');
  const packageId = created.find(o => o.outputState === 'PackageWrite')!.objectId;
  const find = (type: string) => {
    const match = created.find(o => (published.objectTypes[o.objectId] ?? '').includes('::') && normalizeStructTag(published.objectTypes[o.objectId]!) === normalizeStructTag(type));
    if (!match) throw new Error(`Publish did not create ${type}`);
    return match.objectId;
  };
  const bondType = `${packageId}::demo_bond::DEMO_BOND`;
  const cashType = `${packageId}::demo_usd::DEMO_USD`;
  const ids = {
    package: packageId, bondType, cashType,
    registry: find(`${packageId}::settlement::Registry`),
    admin: find(`${packageId}::settlement::AdminCap`),
    verifier: find(`${packageId}::settlement::VerifierCap`),
    bondCap: find(`0x2::coin::TreasuryCap<${bondType}>`),
    cashCap: find(`0x2::coin::TreasuryCap<${cashType}>`),
    bondCurrency: find(`0x2::coin_registry::Currency<${bondType}>`),
    cashCurrency: find(`0x2::coin_registry::Currency<${cashType}>`),
  };
  const setup = new Transaction();
  for (const [type, currency] of [[bondType, ids.bondCurrency], [cashType, ids.cashCurrency]] as const) {
    setup.moveCall({ target: '0x2::coin_registry::finalize_registration', typeArguments: [type], arguments: [setup.object('0xc'), setup.object(currency)] });
  }
  setup.moveCall({ target: '0x2::coin::mint_and_transfer', typeArguments: [bondType], arguments: [setup.object(ids.bondCap), setup.pure.u64(BOND_MINT), setup.pure.address(parties.broker)] });
  setup.moveCall({ target: '0x2::coin::mint_and_transfer', typeArguments: [cashType], arguments: [setup.object(ids.cashCap), setup.pure.u64(CASH_MINT), setup.pure.address(parties.buyer)] });
  const [buyerGas, brokerGas] = setup.splitCoins(setup.gas, [PARTY_GAS, PARTY_GAS]);
  setup.transferObjects([buyerGas], parties.buyer);
  setup.transferObjects([brokerGas], parties.broker);
  await execute('register, mint and fund parties', setup);
  return ids;
}
