// Tests for the Bedrock (AWS Converse API) tool-use-loop planner (issue #122). Like
// conversation.integration.test.js, every tool call in here reaches a REAL, separately
// spawned server process over real HTTP — the only thing ever mocked is `bedrockClient`,
// a fake object with a `send(command)` method returning scripted Converse-shaped
// responses. No AWS credentials, no network call to AWS, ever.
//
// The point of most of these tests is adversarial: a "mock model" that tries to smuggle
// its own confirmation_id, redirect execution to a different device, replay a token, or
// race two proposals against each other. bedrock-planner.js's confirmedProposals Map
// (keyed by proposal_id, local to each runBedrockConversation call) is what has to make
// every one of those attempts structurally impossible — these tests prove it holds
// against the real server, not just against a mocked one.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpHttpClient } from '../src/mcp-client.js';
import { runBedrockConversation, DEFAULT_MODEL_ID } from '../src/bedrock-planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'server', 'src', 'server.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

async function waitForServer(url, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
      });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms: ${lastErr}`);
}

let serverProcess;
let serverUrl;

// A fresh server per test (rather than one shared across the whole file, like
// conversation.integration.test.js does) so audit-log-count and device-state
// assertions never depend on what an earlier test in this file happened to do.
beforeEach(async () => {
  const port = await getFreePort();
  serverUrl = `http://127.0.0.1:${port}/mcp`;
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(serverUrl);
});

afterEach(() => {
  serverProcess?.kill();
});

// --- Converse-shaped response builders, matching the real documented shape:
// { output: { message: { role: 'assistant', content: [...] } }, stopReason }.

function textResponse(text) {
  return {
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
  };
}

function toolUseResponse(toolUseId, name, input, text) {
  const content = [];
  if (text) content.push({ text });
  content.push({ toolUse: { toolUseId, name, input } });
  return {
    output: { message: { role: 'assistant', content } },
    stopReason: 'tool_use',
  };
}

/** Finds the toolResult content fed back for one specific toolUseId, anywhere in history. */
function findToolResultJson(messages, toolUseId) {
  for (const msg of messages) {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.toolResult?.toolUseId === toolUseId) {
        return block.toolResult.content[0].json;
      }
    }
  }
  return undefined;
}

/** A scripted mock bedrockClient: each step is either a fixed response or a function of the message history so far. */
function mockBedrockClient(steps) {
  let i = 0;
  return {
    async send(command) {
      if (i >= steps.length) {
        throw new Error(`mockBedrockClient: ran out of scripted steps after ${i} call(s)`);
      }
      const step = steps[i++];
      return typeof step === 'function' ? step(command.input.messages) : step;
    },
  };
}

function spyOnCallTool(client) {
  const calls = [];
  const original = client.callTool.bind(client);
  client.callTool = async (name, args) => {
    calls.push({ name, args });
    return original(name, args);
  };
  return calls;
}

test('listTools() on the real server returns all 8 registered tools', async () => {
  const client = new McpHttpClient(serverUrl);
  await client.initialize();
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      'check_automation_policy',
      'compose_scene',
      'execute_action',
      'execute_scene',
      'get_device_state',
      'list_devices',
      'propose_action',
      'read_audit_log',
    ]
  );
  await client.close();
});

test('confirm -> execute: an adversarial model trying to supply its own confirmation_id/device_id is ignored', async () => {
  const client = new McpHttpClient(serverUrl);
  const calls = spyOnCallTool(client);

  let realConfirmationId;
  const originalApprove = client.approveProposal.bind(client);
  client.approveProposal = async (proposalId) => {
    const result = await originalApprove(proposalId);
    realConfirmationId = result.confirmation_id;
    return result;
  };

  const steps = [
    () =>
      toolUseResponse('t-propose', 'propose_action', {
        device_id: 'dev_living_room_light_1',
        action: 'set_brightness',
        params: { brightness: 50 },
      }),
    (messages) => {
      const { proposal_id } = findToolResultJson(messages, 't-propose');
      // Adversarial: wrong confirmation_id, wrong device_id — the planner must ignore both.
      return toolUseResponse('t-execute', 'execute_action', {
        proposal_id,
        device_id: 'dev_kitchen_plug_1',
        action: 'turn_off',
        confirmation_id: 'HACKED',
      });
    },
    () => textResponse('Done.'),
  ];

  const turns = await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'confirm',
  });

  assert.ok(turns.length > 0);
  const executeCalls = calls.filter((c) => c.name === 'execute_action');
  assert.equal(executeCalls.length, 1, 'execute_action should reach the real server exactly once');
  assert.equal(executeCalls[0].args.device_id, 'dev_living_room_light_1', 'must use the proposed device, not the model’s');
  assert.equal(executeCalls[0].args.action, 'set_brightness', 'must use the proposed action, not the model’s');
  assert.deepEqual(executeCalls[0].args.params, { brightness: 50 });
  assert.equal(executeCalls[0].args.confirmation_id, realConfirmationId, 'must use the real minted token, not "HACKED"');
  assert.notEqual(executeCalls[0].args.confirmation_id, 'HACKED');

  const lightState = await client.callTool('get_device_state', { device_id: 'dev_living_room_light_1' });
  assert.equal(lightState.structuredContent.state.brightness, 50, 'the real device state must have actually changed');

  const audit = await client.callTool('read_audit_log', {});
  assert.equal(audit.structuredContent.entries.length, 1);

  await client.close();
});

test('decline never reaches execute_action, even when the model tries anyway', async () => {
  const client = new McpHttpClient(serverUrl);
  const calls = spyOnCallTool(client);

  const steps = [
    () =>
      toolUseResponse('t-propose', 'propose_action', {
        device_id: 'dev_kitchen_plug_1',
        action: 'turn_off',
        params: {},
      }),
    (messages) => {
      const { proposal_id } = findToolResultJson(messages, 't-propose');
      return toolUseResponse('t-execute', 'execute_action', {
        proposal_id,
        device_id: 'dev_kitchen_plug_1',
        action: 'turn_off',
        confirmation_id: 'FORCED',
      });
    },
    () => textResponse('Understood, leaving it alone.'),
  ];

  await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'decline',
  });

  const executeCalls = calls.filter((c) => c.name === 'execute_action');
  assert.equal(executeCalls.length, 0, 'execute_action must never reach the real server for a declined proposal');

  const plugState = await client.callTool('get_device_state', { device_id: 'dev_kitchen_plug_1' });
  assert.equal(plugState.structuredContent.state.power, 'off', 'declined action must leave the device untouched');

  const audit = await client.callTool('read_audit_log', {});
  assert.equal(audit.structuredContent.entries.length, 0, 'a decline must never produce an audit entry');

  await client.close();
});

test('two proposals in flight before either executes both execute with their own correct values, never clobbered', async () => {
  const client = new McpHttpClient(serverUrl);
  const calls = spyOnCallTool(client);

  const approvals = {};
  const originalApprove = client.approveProposal.bind(client);
  client.approveProposal = async (proposalId) => {
    const result = await originalApprove(proposalId);
    approvals[proposalId] = result.confirmation_id;
    return result;
  };

  const steps = [
    () =>
      toolUseResponse('t-propose-A', 'propose_action', {
        device_id: 'dev_living_room_light_1',
        action: 'set_brightness',
        params: { brightness: 50 },
      }),
    () =>
      toolUseResponse('t-propose-B', 'propose_action', {
        device_id: 'dev_kitchen_plug_1',
        action: 'turn_off',
        params: {},
      }),
    (messages) => {
      const { proposal_id } = findToolResultJson(messages, 't-propose-A');
      return toolUseResponse('t-execute-A', 'execute_action', { proposal_id });
    },
    (messages) => {
      const { proposal_id } = findToolResultJson(messages, 't-propose-B');
      return toolUseResponse('t-execute-B', 'execute_action', { proposal_id });
    },
    () => textResponse('Both done.'),
  ];

  await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'confirm',
  });

  const executeCalls = calls.filter((c) => c.name === 'execute_action');
  assert.equal(executeCalls.length, 2, 'both confirmed proposals should execute');

  const lightCall = executeCalls.find((c) => c.args.device_id === 'dev_living_room_light_1');
  const plugCall = executeCalls.find((c) => c.args.device_id === 'dev_kitchen_plug_1');
  assert.ok(lightCall, 'the living room light execute call must reach the server');
  assert.ok(plugCall, 'the kitchen plug execute call must reach the server');
  assert.equal(lightCall.args.action, 'set_brightness');
  assert.deepEqual(lightCall.args.params, { brightness: 50 });
  assert.equal(plugCall.args.action, 'turn_off');

  // Neither call's confirmation_id was swapped with the other's.
  const confirmationIds = Object.values(approvals);
  assert.equal(confirmationIds.length, 2);
  assert.notEqual(lightCall.args.confirmation_id, plugCall.args.confirmation_id);
  assert.ok(confirmationIds.includes(lightCall.args.confirmation_id));
  assert.ok(confirmationIds.includes(plugCall.args.confirmation_id));

  const lightState = await client.callTool('get_device_state', { device_id: 'dev_living_room_light_1' });
  assert.equal(lightState.structuredContent.state.brightness, 50);
  const plugState = await client.callTool('get_device_state', { device_id: 'dev_kitchen_plug_1' });
  assert.equal(plugState.structuredContent.state.power, 'off');

  const audit = await client.callTool('read_audit_log', {});
  assert.equal(audit.structuredContent.entries.length, 2);

  await client.close();
});

test('an execute attempt with no matching pending proposal is refused locally, never reaching execute_action', async () => {
  const client = new McpHttpClient(serverUrl);
  const calls = spyOnCallTool(client);

  const steps = [
    () => toolUseResponse('t-execute', 'execute_action', { proposal_id: 'prop_never-existed-0000' }),
    (messages) => {
      const refusal = findToolResultJson(messages, 't-execute');
      assert.ok(refusal.error, 'a refusal-shaped toolResult must be fed back to the model');
      assert.match(refusal.error, /no confirmed proposal/i);
      return textResponse('Understood, nothing to execute.');
    },
  ];

  await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'confirm',
  });

  const executeCalls = calls.filter((c) => c.name === 'execute_action');
  assert.equal(executeCalls.length, 0, 'execute_action must never reach the real server with no confirmed proposal');

  await client.close();
});

test('a replayed execute_action for an already-consumed proposal_id is refused the second time', async () => {
  const client = new McpHttpClient(serverUrl);
  const calls = spyOnCallTool(client);

  const steps = [
    () =>
      toolUseResponse('t-propose', 'propose_action', {
        device_id: 'dev_living_room_light_1',
        action: 'set_brightness',
        params: { brightness: 50 },
      }),
    (messages) => {
      const { proposal_id } = findToolResultJson(messages, 't-propose');
      return toolUseResponse('t-execute-1', 'execute_action', { proposal_id });
    },
    (messages) => {
      // Replay: the model asks for the same proposal_id again, after it was already
      // consumed by the first execute_action call above.
      const { proposal_id } = findToolResultJson(messages, 't-propose');
      return toolUseResponse('t-execute-2', 'execute_action', { proposal_id });
    },
    (messages) => {
      const refusal = findToolResultJson(messages, 't-execute-2');
      assert.ok(refusal.error, 'the replayed execute must come back as a refusal, not a second success');
      assert.match(refusal.error, /no confirmed proposal/i);
      return textResponse('Understood.');
    },
  ];

  await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'confirm',
  });

  const executeCalls = calls.filter((c) => c.name === 'execute_action');
  assert.equal(executeCalls.length, 1, 'execute_action must reach the real server exactly once, never on replay');

  const audit = await client.callTool('read_audit_log', {});
  assert.equal(audit.structuredContent.entries.length, 1, 'a replay must never produce a second audit entry');

  await client.close();
});

test('a read-only tool call (list_devices) passes straight through to the real server', async () => {
  const client = new McpHttpClient(serverUrl);

  let sawDevices = false;
  const steps = [
    () => toolUseResponse('t-list', 'list_devices', {}),
    (messages) => {
      const result = findToolResultJson(messages, 't-list');
      assert.equal(result.devices.length, 5);
      sawDevices = true;
      return textResponse('There are 5 devices.');
    },
  ];

  await runBedrockConversation(client, {
    bedrockClient: mockBedrockClient(steps),
    onConfirmRequest: async () => 'confirm',
  });

  assert.ok(sawDevices, 'the real list_devices result must flow back into the next Converse message');
  await client.close();
});

// #130: bedrock-planner.js no longer imports the AWS SDK or constructs a
// BedrockRuntimeClient — with no `opts.bedrockClient` override, it POSTs to this same
// origin's `/bedrock/converse` (server.js) instead. These two tests exercise exactly
// that default path, stubbing only `fetch()` calls aimed at `/bedrock/converse` — every
// other fetch (McpHttpClient's real calls to the real spawned server above) passes
// through untouched, so this is still a real server underneath, matching every other
// test in this file.
function stubBedrockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (typeof url === 'string' && url.endsWith('/bedrock/converse')) {
      return handler(init);
    }
    return originalFetch(url, init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('with no bedrockClient override, the default path POSTs to /bedrock/converse and uses its JSON response', async () => {
  const client = new McpHttpClient(serverUrl);
  let capturedBody;
  const restore = stubBedrockFetch(async (init) => {
    capturedBody = JSON.parse(init.body);
    return { ok: true, json: async () => textResponse('Hello from the proxy.') };
  });

  try {
    const turns = await runBedrockConversation(client, { onConfirmRequest: async () => 'confirm' });
    assert.equal(capturedBody.modelId, DEFAULT_MODEL_ID);
    assert.ok(Array.isArray(capturedBody.messages), 'the posted body must carry the Converse messages array');
    assert.ok(
      turns.some((t) => t.text === 'Hello from the proxy.'),
      'the proxy response must flow back into the conversation turns'
    );
  } finally {
    restore();
    await client.close();
  }
});

test('a non-ok /bedrock/converse response surfaces as a thrown Error carrying the proxy\'s message', async () => {
  const client = new McpHttpClient(serverUrl);
  const restore = stubBedrockFetch(async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: 'AccessDeniedException: mock, never real AWS' }),
  }));

  try {
    await assert.rejects(
      () => runBedrockConversation(client, { onConfirmRequest: async () => 'confirm' }),
      /AccessDeniedException: mock, never real AWS/
    );
  } finally {
    restore();
    await client.close();
  }
});

test('exceeding maxIterations rejects with a clear error instead of hanging', async () => {
  const client = new McpHttpClient(serverUrl);

  const bedrockClient = {
    async send() {
      return toolUseResponse('t-loop', 'list_devices', {});
    },
  };

  await assert.rejects(
    () => runBedrockConversation(client, { bedrockClient, maxIterations: 3, onConfirmRequest: async () => 'confirm' }),
    /maxIterations/i
  );

  await client.close();
});
