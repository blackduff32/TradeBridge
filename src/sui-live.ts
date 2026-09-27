import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Inputs, Transaction } from '@mysten/sui/transactions';
import { fromBase64, isValidSuiObjectId, normalizeStructTag, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
import { z } from 'zod';
import { DomainError, type Environment } from './domain.js';
import type { SettlementEffects } from './sui.js';

export type Signer = 'operator' | 'buyer' | 'broker';
const objectId = z.string().refine(isValidSuiObjectId, 'Expected a full Sui object ID.');
const configSchema = z.strictObject({
  grpc_url: z.url(), chain_id: z.string().min(1), package_id: objectId, registry_id: objectId, verifier_cap_id: objectId,
  bond_type: z.string().min(1), cash_type: z.string().min(1),
});
export type SuiLiveConfig = z.infer<typeof configSchema>;
export interface Execution {
  digest: string; success: boolean; error: string | null; checkpoint: string | null; signer: string;
  created: { id: string; type: string }[]; balance_changes: { owner: string; coin_type: string; amount: string }[];
}

/** Testnet demo custody: the server holds one key per party. Move still checks every sender. */
export function suiLiveFromEnv(env: NodeJS.ProcessEnv = process.env): SuiLive | undefined {
  if (!env.SUI_PACKAGE_ID) return undefined;
  const config = configSchema.parse({
    grpc_url: env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443', chain_id: env.SUI_CHAIN_ID, package_id: env.SUI_PACKAGE_ID,
    registry_id: env.SUI_REGISTRY_ID, verifier_cap_id: env.SUI_VERIFIER_CAP_ID, bond_type: env.SUI_BOND_TYPE, cash_type: env.SUI_CASH_TYPE,
  });
  const keys = z.object({ operator: z.string().startsWith('suiprivkey'), buyer: z.string().startsWith('suiprivkey'), broker: z.string().startsWith('suiprivkey') })
    .parse({ operator: env.SUI_OPERATOR_KEY, buyer: env.SUI_BUYER_KEY, broker: env.SUI_BROKER_KEY });
  return new SuiLive(config, keys);
}

export class SuiLive {
  readonly client: SuiGrpcClient;
  private keys: Record<Signer, Ed25519Keypair>;
  private queues: Partial<Record<Signer, Promise<unknown>>> = {};
  constructor(readonly config: SuiLiveConfig, keys: Record<Signer, string>, network: 'testnet' | 'localnet' = 'testnet') {
    this.client = new SuiGrpcClient({ network, baseUrl: config.grpc_url });
    this.keys = { operator: Ed25519Keypair.fromSecretKey(keys.operator), buyer: Ed25519Keypair.fromSecretKey(keys.buyer), broker: Ed25519Keypair.fromSecretKey(keys.broker) };
  }
  address(signer: Signer) { return this.keys[signer].toSuiAddress(); }
  environment(): Environment {
    const { chain_id, package_id, registry_id, bond_type, cash_type } = this.config;
    return { chain_id, package_id, registry_id, bond_type, cash_type };
  }
  explorer(kind: 'tx' | 'object' | 'account', id: string) { return `https://suiscan.xyz/testnet/${kind}/${id}`; }
  async assertChain() {
    const { chainIdentifier } = await this.client.getChainIdentifier();
    if (chainIdentifier !== this.config.chain_id) throw new Error(`Sui RPC is on chain ${chainIdentifier}, expected ${this.config.chain_id}.`);
  }
  /** One transaction at a time per signer: concurrent use of the same owned objects can lock them until epoch end. */
  private serial<T>(signer: Signer, work: () => Promise<T>): Promise<T> {
    const next = (this.queues[signer] ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues[signer] = next;
    return next;
  }
  execute(signer: Signer, tx: Transaction): Promise<Execution> {
    return this.serial(signer, () => this.submit(signer, tx));
  }
  /** Pre-resolves every input, gas coin, price and budget so the SDK submits without dry-running:
   * shows on-chain that the contract itself rejects a call the backend would refuse to sign. */
  probe(signer: Signer, call: { target: string; typeArguments: string[]; objects: { id: string; mutable: boolean }[] }): Promise<Execution> {
    return this.serial(signer, async () => {
      const sender = this.address(signer);
      const [{ referenceGasPrice }, { objects: coins }] = await Promise.all([this.client.getReferenceGasPrice(), this.client.listCoins({ owner: sender, coinType: '0x2::sui::SUI' })]);
      const gas = coins.find(c => BigInt(c.balance) >= 20_000_000n);
      if (!gas) throw new DomainError('GAS_UNAVAILABLE', 'The signer has no SUI coin large enough for the probe.', 503);
      const tx = new Transaction();
      tx.setSender(sender); tx.setGasPrice(BigInt(referenceGasPrice)); tx.setGasBudget(20_000_000n);
      tx.setGasPayment([{ objectId: gas.objectId, version: gas.version, digest: gas.digest }]);
      const args = await Promise.all(call.objects.map(async ({ id, mutable }) => {
        const { object } = await this.client.getObject({ objectId: id });
        return tx.object(object.owner.$kind === 'Shared' ? Inputs.SharedObjectRef({ objectId: id, initialSharedVersion: object.owner.Shared.initialSharedVersion, mutable }) : Inputs.ObjectRef({ objectId: id, version: object.version, digest: object.digest }));
      }));
      tx.moveCall({ target: call.target, typeArguments: call.typeArguments, arguments: args });
      return this.submit(signer, tx);
    });
  }
  private async submit(signer: Signer, tx: Transaction): Promise<Execution> {
      tx.setSenderIfNotSet(this.address(signer));
      const result = await this.client.signAndExecuteTransaction({ signer: this.keys[signer], transaction: tx, include: { effects: true, objectTypes: true, balanceChanges: true } });
      const executed = result.Transaction ?? result.FailedTransaction;
      const settled = await this.client.waitForTransaction({ digest: executed.digest });
      const final = settled.Transaction ?? settled.FailedTransaction;
      return {
        digest: executed.digest, success: result.$kind === 'Transaction' && executed.status.success,
        error: executed.status.success ? null : describeError(executed.status.error), checkpoint: final.checkpoint, signer: this.address(signer),
        created: executed.effects.changedObjects.filter(o => o.idOperation === 'Created').map(o => ({ id: o.objectId, type: executed.objectTypes[o.objectId] ?? '' })),
        balance_changes: executed.balanceChanges.map(c => ({ owner: normalizeSuiAddress(c.address), coin_type: normalizeStructTag(c.coinType), amount: c.amount })),
      };
  }
  /** Signs without broadcasting so the commitment outbox can persist bytes and digest first. */
  prepare(signer: Signer, tx: Transaction): Promise<{ digest: string; bytes: string }> {
    return this.serial(signer, async () => {
      tx.setSenderIfNotSet(this.address(signer));
      const built = await tx.build({ client: this.client });
      const { signature } = await this.keys[signer].signTransaction(built);
      return { digest: await tx.getDigest({ client: this.client }), bytes: JSON.stringify({ tx: toBase64(built), signature }) };
    });
  }
  async broadcast(prepared: string): Promise<{ digest: string; success: boolean }> {
    const { tx, signature } = z.object({ tx: z.string(), signature: z.string() }).parse(JSON.parse(prepared));
    const result = await this.client.executeTransaction({ transaction: fromBase64(tx), signatures: [signature] });
    const executed = result.Transaction ?? result.FailedTransaction;
    await this.client.waitForTransaction({ digest: executed.digest });
    return { digest: executed.digest, success: result.$kind === 'Transaction' && executed.status.success };
  }
  /** undefined means the network has no record of the digest yet. */
  async transaction(digest: string) {
    try {
      const result = await this.client.getTransaction({ digest, include: { effects: true, objectTypes: true, balanceChanges: true, transaction: true } });
      return result.Transaction ?? result.FailedTransaction;
    } catch (error) {
      if (/not.?found/i.test(String((error as Error)?.message ?? error))) return undefined;
      throw error;
    }
  }
  async fields(id: string): Promise<Record<string, unknown>> {
    const { object } = await this.client.getObject({ objectId: id, include: { json: true } });
    if (!object.json) throw new DomainError('CHAIN_OBJECT_UNREADABLE', 'The on-chain object has no readable fields.', 502);
    return object.json;
  }
  /** Decoded from the finalized transaction the RPC returns, never from a client body or event alone. */
  async settlementEffects(digest: string): Promise<SettlementEffects> {
    const executed = await this.transaction(digest);
    if (!executed) return { digest, chain_id: this.config.chain_id, checkpoint: null, status: 'failure', calls: [], balance_changes: [] };
    const data = executed.transaction as unknown as { inputs: Record<string, any>[]; commands: Record<string, any>[] };
    const inputId = (input: Record<string, any> | undefined): string | undefined => {
      const object = input?.Object ?? {};
      return object.SharedObject?.objectId ?? object.ImmOrOwnedObject?.objectId ?? object.Receiving?.objectId ?? input?.UnresolvedObject?.objectId;
    };
    const calls = data.commands.filter(c => c.MoveCall).map(c => ({
      package_id: normalizeSuiAddress(c.MoveCall.package), module: String(c.MoveCall.module), function: String(c.MoveCall.function),
      object_ids: (c.MoveCall.arguments as Record<string, any>[]).map(a => typeof a.Input === 'number' ? inputId(data.inputs[a.Input]) : undefined).filter((id): id is string => Boolean(id)).map(id => normalizeSuiAddress(id)),
    }));
    return {
      digest: executed.digest, chain_id: this.config.chain_id, checkpoint: executed.checkpoint, status: executed.status.success ? 'success' : 'failure', calls,
      balance_changes: executed.balanceChanges.map(c => ({ owner: normalizeSuiAddress(c.address), coin_type: normalizeStructTag(c.coinType), amount: c.amount })),
    };
  }
}

const moveAbortCodes: Record<number, string> = { 0: 'EAuthority', 1: 'ETerms', 2: 'EExpired', 3: 'EApproval', 4: 'EReplay', 5: 'EState', 6: 'EAmount' };
function describeError(error: unknown) {
  const text = JSON.stringify(error);
  const code = /"abortCode":"?(\d+)"?/.exec(text)?.[1];
  return code !== undefined ? `MoveAbort ${code} (${moveAbortCodes[Number(code)] ?? 'unknown'})` : text.slice(0, 200);
}
