import { DatabaseSync } from 'node:sqlite';
import { DomainError, type Principal, type Trade } from './domain.js';
import type { Consent, Instruction } from './consent.js';

const demoTables = { trades: ['tenant', 'id', 'data'], source_files: ['tenant', 'hash', 'csv'], audit: ['sequence', 'tenant', 'trade_id', 'actor', 'action', 'at', 'detail'], requests: ['tenant', 'actor', 'key', 'digest', 'result'] } as const;
export type DemoSnapshot = Record<keyof typeof demoTables, Record<string, string | number | null>[]>;

export class Store {
  private db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS trades (tenant TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tenant,id));
      CREATE TABLE IF NOT EXISTS source_files (tenant TEXT NOT NULL, hash TEXT NOT NULL, csv TEXT NOT NULL, PRIMARY KEY (tenant,hash));
      CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY, tenant TEXT NOT NULL, trade_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (tenant TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (tenant,actor,key));
      CREATE TABLE IF NOT EXISTS challenges (id TEXT NOT NULL, tenant TEXT NOT NULL, data TEXT NOT NULL, state TEXT NOT NULL, verification TEXT, PRIMARY KEY (id,tenant));
      CREATE TABLE IF NOT EXISTS consents (tenant TEXT NOT NULL, trade_id TEXT NOT NULL, version INTEGER NOT NULL, side TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tenant,trade_id,version,side));
      CREATE TABLE IF NOT EXISTS outbox (tenant TEXT NOT NULL, trade_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tenant,trade_id,version));
      CREATE TABLE IF NOT EXISTS agent_runs (tenant TEXT NOT NULL, actor TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL, result TEXT, PRIMARY KEY (tenant,actor,key));
      CREATE TABLE IF NOT EXISTS enrollments (tenant TEXT NOT NULL, account TEXT NOT NULL, scope TEXT NOT NULL, binding TEXT NOT NULL, bound_at TEXT NOT NULL, PRIMARY KEY (tenant,account,scope), UNIQUE (tenant,scope,binding));
      CREATE TABLE IF NOT EXISTS agent_authorizations (id TEXT NOT NULL, tenant TEXT NOT NULL, trade_id TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (id,tenant));
      CREATE TABLE IF NOT EXISTS chain_runs (tenant TEXT NOT NULL, trade_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (tenant,trade_id,version));
      CREATE TABLE IF NOT EXISTS world_nullifiers (tenant TEXT NOT NULL, action TEXT NOT NULL, nullifier TEXT NOT NULL, account TEXT NOT NULL, side TEXT NOT NULL, PRIMARY KEY (tenant,action,nullifier));
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;`);
  }
  close() { this.db.close(); }
  // Hosted demos use a fresh in-memory store per request. Only these four
  // evidence/proposal tables cross the durable snapshot boundary; never consent.
  demoSnapshot(): DemoSnapshot {
    return Object.fromEntries(Object.keys(demoTables).map(table => [table, this.db.prepare(`SELECT * FROM ${table}`).all()])) as DemoSnapshot;
  }
  restoreDemo(snapshot: DemoSnapshot) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [table, columns] of Object.entries(demoTables)) {
        const insert = this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        for (const row of snapshot[table as keyof DemoSnapshot]) {
          if (!String(row.tenant).startsWith('sandbox-')) throw new Error('Only synthetic demo workspaces can be restored.');
          insert.run(...columns.map(column => row[column] ?? null));
        }
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  beginAgentRun(principal: Principal, key: string, digest: string): { claimed: boolean; state: string; result: unknown } {
    const inserted = this.db.prepare("INSERT OR IGNORE INTO agent_runs VALUES (?,?,?,?,'RUNNING',NULL)").run(principal.tenant, principal.id, key, digest).changes === 1;
    const row = this.db.prepare('SELECT digest,state,result FROM agent_runs WHERE tenant=? AND actor=? AND key=?').get(principal.tenant, principal.id, key)!;
    if (row.digest !== digest) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Agent request key was already used with different input.', 409);
    return { claimed: inserted, state: String(row.state), result: row.result ? JSON.parse(String(row.result)) : null };
  }
  finishAgentRun(principal: Principal, key: string, state: 'COMPLETE' | 'FAILED', result: unknown) {
    this.db.prepare('UPDATE agent_runs SET state=?,result=? WHERE tenant=? AND actor=? AND key=?').run(state, JSON.stringify(result), principal.tenant, principal.id, key);
  }
  verification<T>(id: string, tenant: string): T | undefined {
    const row = this.db.prepare('SELECT verification FROM challenges WHERE id=? AND tenant=?').get(id, tenant);
    return row?.verification ? JSON.parse(row.verification as string) as T : undefined;
  }
  consents(tenant: string, tradeId: string, version: number): Consent[] {
    return this.db.prepare('SELECT data FROM consents WHERE tenant=? AND trade_id=? AND version=?').all(tenant, tradeId, version).map(row => JSON.parse(row.data as string) as Consent);
  }
  saveConsent(consent: Consent) {
    this.db.prepare('INSERT INTO consents VALUES (?,?,?,?,?) ON CONFLICT (tenant,trade_id,version,side) DO UPDATE SET data=excluded.data').run(consent.tenant, consent.trade_id, consent.version, consent.side, JSON.stringify(consent));
  }
  instruction(tenant: string, tradeId: string, version: number): Instruction | undefined {
    const row = this.db.prepare('SELECT data FROM outbox WHERE tenant=? AND trade_id=? AND version=?').get(tenant, tradeId, version);
    return row ? JSON.parse(row.data as string) as Instruction : undefined;
  }
  saveInstruction(instruction: Instruction) {
    this.db.prepare('INSERT INTO outbox VALUES (?,?,?,?) ON CONFLICT (tenant,trade_id,version) DO UPDATE SET data=excluded.data').run(instruction.tenant, instruction.trade_id, instruction.version, JSON.stringify(instruction));
  }
  replaceInstruction(before: Instruction, after: Instruction): boolean {
    return this.db.prepare('UPDATE outbox SET data=? WHERE tenant=? AND trade_id=? AND version=? AND data=?')
      .run(JSON.stringify(after), before.tenant, before.trade_id, before.version, JSON.stringify(before)).changes === 1;
  }
  /** First use binds an account to one identity per scope; the same identity can never back two accounts. */
  bindEnrollment(tenant: string, account: string, scope: string, binding: string, at: Date): 'BOUND' | 'MATCHED' {
    const existing = this.db.prepare('SELECT binding FROM enrollments WHERE tenant=? AND account=? AND scope=?').get(tenant, account, scope);
    if (existing) {
      if (existing.binding !== binding) throw new DomainError('ENROLLMENT_MISMATCH', 'This account is enrolled to a different verified identity.', 403);
      return 'MATCHED';
    }
    const holder = this.db.prepare('SELECT account FROM enrollments WHERE tenant=? AND scope=? AND binding=?').get(tenant, scope, binding);
    if (holder) throw new DomainError('IDENTITY_ALREADY_ENROLLED', 'This verified identity is already enrolled to another account.', 403);
    this.db.prepare('INSERT INTO enrollments VALUES (?,?,?,?,?)').run(tenant, account, scope, binding, at.toISOString());
    return 'BOUND';
  }
  enrollment(tenant: string, account: string, scope: string) {
    const row = this.db.prepare('SELECT binding,bound_at FROM enrollments WHERE tenant=? AND account=? AND scope=?').get(tenant, account, scope);
    return row ? { binding: String(row.binding), bound_at: String(row.bound_at) } : undefined;
  }
  saveAgentAuthorization(tenant: string, id: string, tradeId: string, state: string, data: unknown) {
    this.db.prepare('INSERT INTO agent_authorizations VALUES (?,?,?,?,?)').run(id, tenant, tradeId, state, JSON.stringify(data));
  }
  agentAuthorization<T>(tenant: string, id: string): (T & { state: string }) | undefined {
    const row = this.db.prepare('SELECT state,data FROM agent_authorizations WHERE id=? AND tenant=?').get(id, tenant);
    return row ? { ...JSON.parse(row.data as string), state: String(row.state) } : undefined;
  }
  agentAuthorizations<T>(tenant: string, tradeId: string): (T & { state: string })[] {
    return this.db.prepare('SELECT state,data FROM agent_authorizations WHERE tenant=? AND trade_id=? ORDER BY rowid').all(tenant, tradeId).map(row => ({ ...JSON.parse(row.data as string), state: String(row.state) }));
  }
  /** Compare-and-set so only one poller can resolve an authorization. */
  transitionAgentAuthorization(tenant: string, id: string, from: string, to: string, data: unknown): boolean {
    return this.db.prepare('UPDATE agent_authorizations SET state=?,data=? WHERE id=? AND tenant=? AND state=?').run(to, JSON.stringify(data), id, tenant, from).changes === 1;
  }
  chainRun<T>(tenant: string, tradeId: string, version: number): T | undefined {
    const row = this.db.prepare('SELECT data FROM chain_runs WHERE tenant=? AND trade_id=? AND version=?').get(tenant, tradeId, version);
    return row ? JSON.parse(row.data as string) as T : undefined;
  }
  saveChainRun(tenant: string, tradeId: string, version: number, data: unknown) {
    this.db.prepare('INSERT INTO chain_runs VALUES (?,?,?,?) ON CONFLICT (tenant,trade_id,version) DO UPDATE SET data=excluded.data').run(tenant, tradeId, version, JSON.stringify(data));
  }
  /** First claim wins. Nullifiers are stored as decimal strings, never as hex text. */
  claimNullifier(tenant: string, action: string, nullifier: string, account: string, side: string): { account: string; side: string } {
    this.db.prepare('INSERT OR IGNORE INTO world_nullifiers VALUES (?,?,?,?,?)').run(tenant, action, nullifier, account, side);
    const row = this.db.prepare('SELECT account,side FROM world_nullifiers WHERE tenant=? AND action=? AND nullifier=?').get(tenant, action, nullifier)!;
    return { account: String(row.account), side: String(row.side) };
  }
  saveChallenge(id: string, tenant: string, challenge: unknown) {
    this.db.prepare('INSERT INTO challenges (id,tenant,data,state) VALUES (?,?,?,?)').run(id, tenant, JSON.stringify(challenge), 'ISSUED');
  }
  getChallenge<T>(id: string, tenant: string): T | undefined {
    const row = this.db.prepare('SELECT data,state FROM challenges WHERE id=? AND tenant=?').get(id, tenant);
    return row ? { ...JSON.parse(row.data as string), state: row.state } as T : undefined;
  }
  claimChallenge(id: string, tenant: string) {
    return this.db.prepare("UPDATE challenges SET state='VERIFYING' WHERE id=? AND tenant=? AND state='ISSUED'").run(id, tenant).changes === 1;
  }
  finishChallenge(id: string, tenant: string, state: string, verification: unknown) {
    this.db.prepare('UPDATE challenges SET state=?,verification=? WHERE id=? AND tenant=?').run(state, JSON.stringify(verification), id, tenant);
  }
  list(tenant: string, ids: string[]) {
    return ids.map(id => this.get(tenant, id)).filter((trade): trade is Trade => Boolean(trade));
  }
  removeSandbox(tenant: string) {
    if (!tenant.startsWith('sandbox-')) throw new Error('Only disposable sandbox data may be removed.');
    // Audit is retained intentionally; only synthetic working data is removable.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['trades', 'source_files', 'requests', 'agent_runs', 'challenges', 'consents', 'outbox', 'enrollments', 'agent_authorizations', 'chain_runs', 'world_nullifiers']) this.db.prepare(`DELETE FROM ${table} WHERE tenant=?`).run(tenant);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  saveSourceFile(tenant: string, hash: string, csv: string) {
    this.db.prepare('INSERT OR IGNORE INTO source_files VALUES (?,?,?)').run(tenant, hash, csv);
  }
  sourceFile(tenant: string, hash: string) {
    return this.db.prepare('SELECT csv FROM source_files WHERE tenant=? AND hash=?').get(tenant, hash)?.csv;
  }
  get(tenant: string, id: string): Trade | undefined {
    const row = this.db.prepare('SELECT data FROM trades WHERE tenant=? AND id=?').get(tenant, id);
    return row ? JSON.parse(row.data as string) as Trade : undefined;
  }
  save(trade: Trade) {
    this.db.prepare('INSERT INTO trades VALUES (?,?,?) ON CONFLICT (tenant,id) DO UPDATE SET data=excluded.data').run(trade.tenant, trade.id, JSON.stringify(trade));
  }
  audit(principal: Principal, id: string, action: string, at: Date, detail: unknown) {
    this.db.prepare('INSERT INTO audit (tenant,trade_id,actor,action,at,detail) VALUES (?,?,?,?,?,?)').run(principal.tenant, id, principal.id, action, at.toISOString(), JSON.stringify(detail));
  }
  history(tenant: string, id: string) {
    return this.db.prepare('SELECT sequence,actor,action,at,detail FROM audit WHERE tenant=? AND trade_id=? ORDER BY sequence').all(tenant, id)
      .map(row => ({ sequence: Number(row.sequence), actor: String(row.actor), action: String(row.action), at: String(row.at), detail: JSON.parse(row.detail as string) as unknown }));
  }
  write<T>(principal: Principal, key: string, digest: string, operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT digest,result FROM requests WHERE tenant=? AND actor=? AND key=?').get(principal.tenant, principal.id, key);
      if (prior) {
        if (prior.digest !== digest) throw new DomainError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used with a different request.', 409);
        this.db.exec('COMMIT');
        return JSON.parse(prior.result as string) as T;
      }
      const result = operation();
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?)').run(principal.tenant, principal.id, key, digest, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
