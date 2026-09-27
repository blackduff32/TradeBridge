// World ID relying-party signer for the live demo. Run with `npm run world:signer`.
// Creates the server-only signing key in the private .env (once) and prints only its public
// Ethereum address, which the Developer Portal registers under "Use Existing Key".
// Secrets are never printed.
import { appendFileSync, existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { computeRpSignatureMessage, signRequest } from '@worldcoin/idkit-server';

if (!existsSync('.env')) throw new Error('Run npm run setup first; .env is missing.');
loadEnvFile('.env');

const strip = (hex: string) => hex.replace(/^0x/, '');
const checksum = (address: string) => {
  const hash = bytesToHex(keccak_256(utf8ToBytes(address)));
  return '0x' + [...address].map((c, i) => (parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c)).join('');
};

let key = process.env.WORLD_SIGNING_KEY;
if (!key) {
  key = '0x' + bytesToHex(secp256k1.utils.randomSecretKey());
  appendFileSync('.env', `WORLD_SIGNING_KEY=${key}\n`, { mode: 0o600 });
  console.log('Created WORLD_SIGNING_KEY in .env.');
}
const publicKey = secp256k1.getPublicKey(hexToBytes(strip(key)), false);
const address = checksum(bytesToHex(keccak_256(publicKey.slice(1)).slice(-20)));

// Self-check: a request signed by the SDK must verify against this address's public key, the same
// EIP-191 payload World checks against the registered signer.
const action = process.env.WORLD_ACTION ?? 'tradebridge-approval';
const signed = signRequest({ signingKeyHex: key, action, ttl: 300 });
const message = computeRpSignatureMessage(hexToBytes(strip(signed.nonce)), signed.createdAt, signed.expiresAt, action);
const digest = keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${message.length}`), message));
if (!secp256k1.verify(hexToBytes(strip(signed.sig)).slice(0, 64), digest, publicKey, { prehash: false })) {
  throw new Error('The SDK signature does not verify against the derived signer address.');
}
console.log(`Signer address (register in the Developer Portal): ${address}`);
