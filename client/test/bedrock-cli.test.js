// bedrock-cli.js against a REAL spawned server, with only the Bedrock client mocked (no
// AWS call, no credential). The person's answers are scripted: an unrecognized answer is
// asked again, "c" confirms the light, "d" declines the front door. The terminal wiring is
// the real one, on in-memory streams, so a prompt leaking into the transcript fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { runCli, terminalIo } from '../bedrock-cli.js';
import { McpHttpClient } from '../src/mcp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', '..', 'server', 'src', 'server.js');
const OWNER_KEY = 'cli-test-owner-key';

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

before(async () => {
  const port = await getFreePort();
  serverUrl = `http://127.0.0.1:${port}/mcp`;
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, PORT: String(port), OWNER_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const deadline = Date.now() + 8000;
  for (;;) {
    try {
      await fetch(serverUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
});

after(() => {
  serverProcess?.kill();
});

function toolUse(id, name, input) {
  return {
    output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: id, name, input } }] } },
    stopReason: 'tool_use',
  };
}

function resultFor(messages, toolUseId) {
  for (const msg of messages) {
    for (const block of msg.content || []) {
      if (block.toolResult?.toolUseId === toolUseId) return block.toolResult.content[0].json;
    }
  }
  return undefined;
}

test('bedrock-cli prints what the model did and waits on the person at every proposal', async () => {
  const steps = [
    () => toolUse('t1', 'propose_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
    }),
    (messages) => toolUse('t2', 'execute_action', { proposal_id: resultFor(messages, 't1').proposal_id }),
    () => toolUse('t3', 'propose_action', { device_id: 'dev_front_door_lock_1', action: 'unlock', params: {} }),
    () => ({
      output: { message: { role: 'assistant', content: [{ text: 'The light is at 50%; the door stays locked.' }] } },
      stopReason: 'end_turn',
    }),
  ];
  let call = 0;
  const bedrockClient = { send: async (command) => steps[call++](command.input.messages) };

  // The same wiring main() uses, on streams: the person answers each prompt as it appears
  // on the prompt stream, and the transcript stream is what `| tee` would record.
  const input = new PassThrough();
  const output = new PassThrough();
  const promptOutput = new PassThrough();
  const answers = ['maybe', 'c', 'd'];
  let prompts = '';
  promptOutput.on('data', (chunk) => {
    prompts += chunk;
    if (String(chunk).includes('[c]onfirm / [d]ecline')) input.write(`${answers.shift()}\n`);
  });
  let transcript = '';
  output.on('data', (chunk) => {
    transcript += chunk;
  });
  const io = terminalIo({ input, output, promptOutput });

  let lines;
  try {
    lines = await runCli({
      url: serverUrl,
      request: 'Dim the living room light to 50%, then unlock the front door.',
      ownerKey: OWNER_KEY,
      bedrockClient,
      modelId: 'mock-model',
      ask: io.ask,
      print: io.print,
    });
  } finally {
    io.close();
  }

  assert.equal(prompts.match(/\[c\]onfirm \/ \[d\]ecline/g).length, 3, 'an unrecognized answer is asked again');
  assert.equal(transcript, `${lines.join('\n')}\n`, 'the transcript stream holds the transcript and no prompt');
  assert.match(transcript, /^\[gate\] set_brightness /m);
  assert.match(transcript, /^\[gate\] unlock /m);
  const text = lines.join('\n');
  assert.match(text, /\[gate\] set_brightness on dev_living_room_light_1 \(prop_[^)]+\) -> person chose CONFIRM/);
  assert.match(text, /\[tool\] execute_action .*"confirmation_id":"confirm_/);
  assert.match(text, /"brightness":50/);
  assert.match(text, /\[gate\] unlock on dev_front_door_lock_1 \(prop_[^)]+\) -> person chose DECLINE/);
  assert.match(text, /\[agent\] The light is at 50%; the door stays locked\./);

  const reader = new McpHttpClient(serverUrl);
  await reader.initialize();
  const door = await reader.callTool('get_device_state', { device_id: 'dev_front_door_lock_1' });
  assert.equal(door.structuredContent.state.locked, true);
  const audit = await reader.callTool('read_audit_log', {});
  assert.equal(audit.structuredContent.entries.length, 1);
  await reader.close();
});
