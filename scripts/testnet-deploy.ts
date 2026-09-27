// Sui testnet deployment for the live demo. Run with `npm run testnet:deploy`.
// Pass 1 creates operator/buyer/broker keys in the private .env and prints the faucet link.
// Pass 2 (operator funded) publishes the package, registers and mints the demo assets,
// gives both parties gas and appends the deployment IDs to .env. Secrets are never printed.
import { appendFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildBytecode, publishTradeBridge } from './sui-publish.js';

const GRPC_URL = process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443';
if (!existsSync('.env')) throw new Error('Run npm run setup first; .env is missing.');
loadEnvFile('.env');
const append = (lines: Record<string, string>) => appendFileSync('.env', Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

if (!process.env.SUI_OPERATOR_KEY) {
  const keys = { operator: Ed25519Keypair.generate(), buyer: Ed25519Keypair.generate(), broker: Ed25519Keypair.generate() };
  append({ SUI_NETWORK: 'testnet', SUI_GRPC_URL: GRPC_URL, SUI_OPERATOR_KEY: keys.operator.getSecretKey(), SUI_BUYER_KEY: keys.buyer.getSecretKey(), SUI_BROKER_KEY: keys.broker.getSecretKey() });
  const operator = keys.operator.toSuiAddress();
  console.log(`Created testnet keys in .env.\n  operator ${operator}\n  buyer    ${keys.buyer.toSuiAddress()}\n  broker   ${keys.broker.toSuiAddress()}`);
  console.log(`\nFund the operator (about 1 SUI), then run this again:\n  https://faucet.sui.io/?address=${operator}`);
  process.exit(0);
}
if (process.env.SUI_PACKAGE_ID) {
  console.log(`Already deployed: ${process.env.SUI_PACKAGE_ID}. Remove the SUI_* deployment lines from .env to redeploy.`);
  process.exit(0);
}

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL });
const operator = Ed25519Keypair.fromSecretKey(process.env.SUI_OPERATOR_KEY);
const parties = { buyer: Ed25519Keypair.fromSecretKey(process.env.SUI_BUYER_KEY!).toSuiAddress(), broker: Ed25519Keypair.fromSecretKey(process.env.SUI_BROKER_KEY!).toSuiAddress() };
const { balance } = await client.getBalance({ owner: operator.toSuiAddress() });
if (BigInt(balance.balance) < 500_000_000n) {
  console.log(`Operator has ${balance.balance} MIST. Fund it first:\n  https://faucet.sui.io/?address=${operator.toSuiAddress()}`);
  process.exit(1);
}
const ids = await publishTradeBridge(client, operator, parties, buildBytecode(), line => {
  const [label, digest] = line.split(': ');
  console.log(`${label}: https://suiscan.xyz/testnet/tx/${digest}`);
});
const { chainIdentifier } = await client.getChainIdentifier();
append({
  SUI_CHAIN_ID: chainIdentifier, SUI_PACKAGE_ID: ids.package, SUI_REGISTRY_ID: ids.registry,
  SUI_ADMIN_CAP_ID: ids.admin, SUI_VERIFIER_CAP_ID: ids.verifier,
  SUI_BOND_TREASURY_CAP_ID: ids.bondCap, SUI_CASH_TREASURY_CAP_ID: ids.cashCap,
  SUI_BOND_TYPE: ids.bondType, SUI_CASH_TYPE: ids.cashType,
});
console.log(`\nDeployed package ${ids.package}\n  https://suiscan.xyz/testnet/object/${ids.package}\nDeployment IDs appended to .env. Restart the API to use them.`);
