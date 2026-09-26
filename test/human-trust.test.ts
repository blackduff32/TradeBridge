import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/store.js';
import type { Principal } from '../src/domain.js';
import type { Challenge, WorldConfig } from '../src/world-id.js';
import { WorldHumanTrust } from '../src/human-trust.js';
import { DevelopmentStaffDirectory } from '../src/staff-directory.js';

const stagingConfig: WorldConfig = { app_id: 'app_test', rp_id: 'rp_test', action: 'tradebridge-approval', signing_key: '1'.repeat(64), environment: 'staging', require_presence: true, allow_legacy_simulator: false };
function principal(overrides: Partial<Principal> = {}): Principal {
  return { id: 'buyer-human', tenant: 'demo-workspace', organisation: 'buyer-demo-org', side: 'buyer', kind: 'human', tradeIds: ['TB-001'], token: 'x'.repeat(32), ...overrides };
}
function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return { id: 'c1', tenant: 'demo-workspace', account: 'buyer-human', organisation: 'buyer-demo-org', side: 'buyer', action: 'tradebridge-approval-test', trade_id: 'TB-001', version: 1, terms_hash: 'a'.repeat(64), signal: 'signal-value', signal_hash: '0x1', nonce: 'n', created_at: 0, expires_at: 9_999_999_999, rp_expires_at: 9_999_999_999, signature: 'sig', state: 'ISSUED', ...overrides };
}

test('validatePresence returns an honest world-app reference only when the proof confirms presence', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, stagingConfig);
    const reference = await trust.validatePresence({ user_presence_completed: true }, { some: 'receipt' }, challenge());
    assert.ok(reference.startsWith('world-app:user-presence:'));
    const again = await trust.validatePresence({ user_presence_completed: true }, { some: 'receipt' }, challenge());
    assert.equal(reference, again, 'same receipt/signal must hash to the same reference');
    const differentReceipt = await trust.validatePresence({ user_presence_completed: true }, { some: 'other-receipt' }, challenge());
    assert.notEqual(reference, differentReceipt);
  } finally { store.close(); }
});
test('validatePresence never claims presence that did not happen', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, stagingConfig);
    await assert.rejects(() => trust.validatePresence({ user_presence_completed: false }, {}, challenge()), /presence/);
    await assert.rejects(() => trust.validatePresence({}, {}, challenge()), /presence/);
  } finally { store.close(); }
});
test('validatePresence is honest about an unrequested presence check instead of guessing', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, { ...stagingConfig, require_presence: false });
    assert.equal(await trust.validatePresence({ user_presence_completed: false }, {}, challenge()), 'presence-not-requested:staging');
    // Even a proof that happens to say "true" gets the same honest label: this deployment did not require it.
    assert.equal(await trust.validatePresence({ user_presence_completed: true }, {}, challenge()), 'presence-not-requested:staging');
  } finally { store.close(); }
});
test('validateEnrollment binds an account to a person on first use and is idempotent after that', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, stagingConfig);
    const first = await trust.validateEnrollment(principal(), 'scope-a', '111');
    const second = await trust.validateEnrollment(principal(), 'scope-a', '111');
    assert.equal(first, second);
  } finally { store.close(); }
});
test('a different verified person cannot take over an already-enrolled account', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, stagingConfig);
    await trust.validateEnrollment(principal(), 'scope-a', '111');
    await assert.rejects(() => trust.validateEnrollment(principal(), 'scope-a', '222'), /different verified identity/);
  } finally { store.close(); }
});
test('the same verified person cannot enroll a second account (distinct-humans guarantee)', async () => {
  const store = new Store(); try {
    const trust = new WorldHumanTrust(store, stagingConfig);
    await trust.validateEnrollment(principal({ id: 'buyer-human' }), 'scope-a', '111');
    await assert.rejects(() => trust.validateEnrollment(principal({ id: 'broker-human', side: 'broker' }), 'scope-a', '111'), /already enrolled/);
  } finally { store.close(); }
});
test('development staff directory resolves configured human principals and revokes everyone else', async () => {
  const buyer = principal();
  const broker = principal({ id: 'broker-human', side: 'broker', organisation: 'broker-demo-org' });
  const directory = new DevelopmentStaffDirectory([buyer, broker]);
  assert.equal(directory.resolve('demo-workspace', 'buyer-human')?.id, 'buyer-human');
  assert.equal(directory.resolve('demo-workspace', 'nobody'), undefined);
  await directory.assertCurrent(buyer); // does not throw
  const revoked = new DevelopmentStaffDirectory([broker]);
  await assert.rejects(() => revoked.assertCurrent(buyer), /STAFF_AUTHORITY_REVOKED|current staff authority/);
  const agent = principal({ id: 'buyer-agent', kind: 'agent' });
  await assert.rejects(() => new DevelopmentStaffDirectory([agent]).assertCurrent(agent), /current staff authority/);
});
