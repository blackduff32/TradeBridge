import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const executable = process.env.SUI_BIN || (existsSync('.tools/sui') ? resolve('.tools/sui') : 'sui');
const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
if (version.error || !version.stdout.includes('1.80.1')) {
  console.error('TradeBridge requires Sui 1.80.1. Install the official CLI or set SUI_BIN to its path. See docs/INTEGRATIONS.md.');
  process.exit(1);
}
// Build/test never needs a wallet. Explicit empty config prevents Sui's first-run
// wallet generation and keeps all development state away from personal wallets.
const configDir = resolve('.tools/sui-config');
mkdirSync(configDir, { recursive: true, mode: 0o700 });
const keystore = resolve(configDir, 'empty.keystore');
if (!existsSync(keystore)) writeFileSync(keystore, '[]', { mode: 0o600, flag: 'wx' });
const config = resolve(configDir, 'client.yaml');
if (!existsSync(config)) writeFileSync(config, `keystore:\n  File: ${JSON.stringify(keystore)}\nenvs:\n  - alias: testnet\n    rpc: https://fullnode.testnet.sui.io:443\nactive_env: testnet\nactive_address: null\n`, { mode: 0o600, flag: 'wx' });
const result = spawnSync(executable, ['move', 'test', '--path', 'contracts/tradebridge', '--warnings-are-errors'], { stdio: 'inherit', env: { ...process.env, SUI_CONFIG_DIR: configDir } });
process.exit(result.status ?? 1);
