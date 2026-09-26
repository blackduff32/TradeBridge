import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../src/store.js';
import { AgentTools, OpenAIResponsesDriver, agentTools, runAgent, type ModelDriver } from '../src/agents.js';
import { demoEnvironment } from '../src/domain.js';
import { seedSandbox } from '../src/seed.js';
import { examplePrincipals, exampleTerms } from '../scripts/fixtures.js';

function fixture() {
  const store = new Store(); const principals = examplePrincipals(); const buyer = principals.find(p => p.id === 'buyer-agent')!; const broker = principals.find(p => p.id === 'broker-agent')!;
  seedSandbox(store, buyer, new Date());
  return { store, principals, buyer, broker, tools: new AgentTools(store, buyer, 'TB-001', demoEnvironment, 'buyer-human') };
}
const call = (name: string, args: unknown = {}) => ({ type: 'function_call', name, call_id: name, arguments: JSON.stringify(args) });
test('buyer and broker tools are separate scopes; sources never expose the other account', () => {
  const f = fixture(); try {
    const buyer = f.tools.execute('read_own_source', {}, 'read', null);
    const broker = new AgentTools(f.store, f.broker, 'TB-001', demoEnvironment).execute('read_own_source', {}, 'read', null);
    assert.ok(JSON.stringify(buyer).includes('buyer-demo-account')); assert.ok(!JSON.stringify(buyer).includes('broker-demo-account'));
    assert.ok(JSON.stringify(broker).includes('broker-demo-account')); assert.ok(!JSON.stringify(broker).includes('buyer-demo-account'));
    assert.throws(() => new AgentTools(f.store, { ...f.buyer, tradeIds: [] }, 'TB-001', demoEnvironment), /scope/);
    assert.throws(() => f.tools.execute('approve', {}, 'attack', null), /cannot approve/);
    assert.throws(() => f.tools.execute('read_own_source', { side: 'broker' }, 'attack', null));
  } finally { f.store.close(); }
});
test('provider loop acts through typed tools, persists an evidence envelope, and leaves canonical unchanged', async () => {
  const f = fixture(); try {
    const revision = f.store.get(f.buyer.tenant, 'TB-001')!.revision;
    const outputs = [[call('read_own_source')], [call('compare_records')], [call('propose_correction', { expected_revision: revision, terms: exampleTerms('buyer'), reason: 'Buyer order supports exactly 1000 units.' })], [{ type: 'message', content: [{ type: 'output_text', text: 'Proposal saved. Both humans must approve.' }] }]];
    let turns = 0;
    const driver: ModelDriver = { async respond(input, instructions) { assert.ok(instructions.includes('buyer')); assert.equal(JSON.stringify(input).includes('broker-demo-account'), false); return { output: outputs[turns++]! }; } };
    const result = await runAgent(f.tools, driver);
    assert.equal(result.status, 'COMPLETE'); assert.equal(result.trace.length, 3);
    // An agent can never write a candidate directly: it drafts, and only a human's World ID
    // authorization (src/world-agents.ts) ever creates one.
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.canonical, null);
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.candidates.length, 0);
    const drafts = f.store.agentAuthorizations(f.buyer.tenant, 'TB-001');
    assert.equal(drafts.length, 1); assert.equal(drafts[0]!.state, 'PENDING_HUMAN');
    assert.ok(JSON.stringify(drafts[0]).includes('buyer-human'));
    const event = f.store.history(f.buyer.tenant, 'TB-001').at(-1)!;
    assert.equal(event.action, 'AGENT_PROPOSAL_DRAFTED'); assert.ok(JSON.stringify(event.detail).includes('prior_message_id'));
  } finally { f.store.close(); }
});
test('bounded agent cannot execute a privileged model tool or create a second candidate', async () => {
  const f = fixture(); try {
    await assert.rejects(() => runAgent(f.tools, { async respond() { return { output: [call('settle')] }; } }), /cannot approve/);
    let count = 0;
    const result = await runAgent(f.tools, { async respond() { count++; return { output: [call('compare_records')] }; } });
    assert.equal(result.status, 'TURN_LIMIT'); assert.equal(count, 6);
    const terms = exampleTerms('buyer');
    await assert.rejects(() => runAgent(f.tools, { async respond() { return { output: [call('propose_correction', { expected_revision: f.store.get(f.buyer.tenant, 'TB-001')!.revision, terms, reason: 'Evidence supports this candidate.' })] }; } }), /at most one/);
    // The first propose_correction call in that run completed (drafting), before the second attempt was denied.
    assert.equal(f.store.get(f.buyer.tenant, 'TB-001')!.candidates.length, 0);
    assert.equal(f.store.agentAuthorizations(f.buyer.tenant, 'TB-001').length, 1);
  } finally { f.store.close(); }
});
// HTTP-level dispatch (idempotent retries, human-dispatches-agent resolution, device authorization kickoff)
// is covered in test/world-agents.test.ts against the routes in src/world-agents.ts.
test('OpenAI adapter uses a fixed Responses endpoint, strict tools, no storage, and no keys in model input', async () => {
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init!.body)); assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.tools.length, 3); assert.equal(body.model, 'configured-model'); assert.ok(!String(init!.body).includes('private-key'));
    assert.ok(agentTools.every(t => t.strict && t.parameters.additionalProperties === false));
    return new Response(JSON.stringify({ output: [] }));
  }) as typeof fetch;
  await new OpenAIResponsesDriver('private-key', 'configured-model', request).respond([], 'instructions');
});
test('OpenAI adapter asks for encrypted reasoning so stateless turns can be replayed, unless reasoning is off', async () => {
  const bodies: Record<string, unknown>[] = [];
  const request = (async (_url: string | URL | Request, init?: RequestInit) => { bodies.push(JSON.parse(String(init!.body))); return new Response(JSON.stringify({ output: [] })); }) as typeof fetch;
  await new OpenAIResponsesDriver('k', 'gpt-6-luna', request).respond([], 'i');
  await new OpenAIResponsesDriver('k', 'gpt-6-luna', request, 'medium').respond([], 'i');
  await new OpenAIResponsesDriver('k', 'older-model', request, 'off').respond([], 'i');
  assert.deepEqual(bodies[0]!.reasoning, { effort: 'low' }); assert.deepEqual(bodies[0]!.include, ['reasoning.encrypted_content']);
  assert.deepEqual(bodies[1]!.reasoning, { effort: 'medium' });
  assert.equal('reasoning' in bodies[2]!, false); assert.equal('include' in bodies[2]!, false);
  assert.ok(bodies.every(body => body.store === false));
});
