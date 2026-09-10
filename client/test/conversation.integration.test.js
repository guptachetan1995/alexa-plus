// Integration test for issue #35's DoD: drives the SPEC.md conversation's read-only
// turns against a REAL, separately-spawned server process — never by importing server
// code (client/ imports nothing from server/; this file only shells out to
// `node server/src/server.js` and talks to it over HTTP, exactly like a browser would).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpHttpClient } from '../src/mcp-client.js';
import { runConversation, realToolTurns } from '../src/planner.js';
import { CONVERSATION_SCRIPT } from '../src/conversation-script.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'server', 'src', 'server.js');

let serverProcess;
let serverUrl;

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
      // Any HTTP response — even a protocol-level error for a bare, session-less
      // request — proves the process is up and accepting connections.
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

before(async () => {
  const port = await getFreePort();
  serverUrl = `http://127.0.0.1:${port}/mcp`;
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(serverUrl);
});

after(() => {
  serverProcess?.kill();
});

test('the script calls every SPEC.md tool now that issue #36 registered the remaining six', () => {
  const real = realToolTurns(CONVERSATION_SCRIPT);
  assert.deepEqual(
    real.map((t) => t.tool.name),
    [
      'list_devices',
      'get_device_state',
      'check_automation_policy',
      'propose_action',
      'execute_action', // runs only when confirmed; runIf is not evaluated by this static filter
      'get_device_state',
      'check_automation_policy',
      'propose_action',
      'execute_action',
      'read_audit_log',
    ]
  );
});

test('list_devices (real, read-only) returns the 5 seeded devices across 3 rooms', async () => {
  const client = new McpHttpClient(serverUrl);
  await client.initialize();
  const result = await client.callTool('list_devices', {});
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.devices.length, 5);
  const rooms = new Set(result.structuredContent.devices.map((d) => d.room));
  assert.equal(rooms.size, 3);
  await client.close();
});

test('get_device_state (real, read-only) reads the actual seeded living room light and thermostat', async () => {
  const client = new McpHttpClient(serverUrl);
  await client.initialize();

  const light = await client.callTool('get_device_state', { device_id: 'dev_living_room_light_1' });
  assert.ok(!light.isError);
  assert.equal(light.structuredContent.device_id, 'dev_living_room_light_1');
  assert.equal(light.structuredContent.state.power, 'on');

  const thermostat = await client.callTool('get_device_state', { device_id: 'dev_thermostat_1' });
  assert.ok(!thermostat.isError);
  assert.equal(thermostat.structuredContent.state.mode, 'heat');

  await client.close();
});

test('runConversation walks the full SPEC.md script against the live server, confirming the first proposal and declining the second (DoD: one confirmed and one declined action)', async () => {
  const client = new McpHttpClient(serverUrl);

  let confirmRequests = 0;
  // Deterministic stand-in for a person clicking Confirm the first time this fires
  // (dimming the living room light) and Decline the second time (the kitchen plug) —
  // exactly the two-outcome demo SPEC.md section 5's issue #36 amendment describes.
  const onConfirmRequest = async () => (confirmRequests++ === 0 ? 'confirm' : 'decline');

  const turns = await runConversation(client, { script: CONVERSATION_SCRIPT, onConfirmRequest });

  const confirmTurns = turns.filter((t) => t.kind === 'confirm');
  assert.equal(confirmTurns.length, 2);
  assert.equal(confirmTurns[0].decision, 'confirm');
  assert.equal(confirmTurns[1].decision, 'decline');

  const toolTurns = turns.filter((t) => t.tool);
  for (const turn of toolTurns) {
    assert.ok(turn.tool.real, `${turn.tool.name} should be tagged real`);
  }

  // The confirmed action actually executed against the live server...
  const executeTurns = toolTurns.filter((t) => t.tool.name === 'execute_action');
  assert.equal(executeTurns.length, 1, 'execute_action should run once (confirmed) and be skipped once (declined)');
  assert.ok(!executeTurns[0].tool.result.isError);
  assert.equal(executeTurns[0].tool.result.structuredContent.new_state.brightness, 50);

  // ...and the declined one produced a plain narration turn instead of a tool call.
  const declineNarration = turns.find(
    (t) => t.speaker === 'agent' && !t.tool && typeof t.text === 'string' && t.text.includes('Coffee Maker Plug')
  );
  assert.ok(declineNarration, 'a narration turn should explain the decline');
  assert.ok(!declineNarration.tool, 'the decline narration turn is plain dialogue, not a tool call');

  const lightState = await client.callTool('get_device_state', { device_id: 'dev_living_room_light_1' });
  assert.equal(lightState.structuredContent.state.brightness, 50);

  const plugState = await client.callTool('get_device_state', { device_id: 'dev_kitchen_plug_1' });
  assert.equal(plugState.structuredContent.state.power, 'off', 'declined action must leave the plug untouched');

  const auditTurn = toolTurns.find((t) => t.tool.name === 'read_audit_log');
  assert.equal(auditTurn.tool.result.structuredContent.entries.length, 1, 'only the confirmed action is audited');

  await client.close();
});

test('a confirm without a matching proposal is refused end to end through the client (declined action cannot be forced through)', async () => {
  const client = new McpHttpClient(serverUrl);
  await client.initialize();

  const result = await client.callTool('execute_action', {
    device_id: 'dev_kitchen_plug_1',
    action: 'turn_off',
    params: {},
    confirmation_id: 'confirm_never-approved',
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no matching pending proposal/i);

  await client.close();
});
