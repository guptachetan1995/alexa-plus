// Tests server.js's config-injection: PLANNER/BEDROCK_MODEL_ID from the process env get
// templated into `window.__ALEXA_PLUS_CONFIG__` in the served HTML, so app.js can read
// them without ever touching process.env itself (browser JS has none). AWS_REGION is
// deliberately NOT part of this template (#130) — it only matters to the real
// BedrockRuntimeClient server.js constructs for itself, and the browser no longer
// constructs one at all, so it has nothing to read it for.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_MODEL_ID } from '../src/bedrock-planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'server.js');

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

async function startClientServer(extraEnv) {
  const port = await getFreePort();
  const env = { ...process.env, PORT: String(port) };
  delete env.PLANNER;
  delete env.AWS_REGION;
  delete env.BEDROCK_MODEL_ID;
  Object.assign(env, extraEnv);

  const proc = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://127.0.0.1:${port}/`;

  const deadline = Date.now() + 8000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return { proc, url };
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proc.kill();
  throw new Error(`client/server.js did not become ready: ${lastErr}`);
}

function extractConfig(html) {
  const match = html.match(/window\.__ALEXA_PLUS_CONFIG__\s*=\s*(\{[^;]*\});/);
  assert.ok(match, 'served HTML must assign window.__ALEXA_PLUS_CONFIG__ before </head>');
  assert.ok(html.indexOf(match[0]) < html.indexOf('</head>'), 'the config script must run before </head>');
  return JSON.parse(match[1]);
}

const spawned = [];
after(() => {
  for (const proc of spawned) proc.kill();
});

test('PLANNER=bedrock and BEDROCK_MODEL_ID are templated into window.__ALEXA_PLUS_CONFIG__; AWS_REGION is not', async () => {
  const { proc, url } = await startClientServer({ PLANNER: 'bedrock', AWS_REGION: 'eu-west-1', BEDROCK_MODEL_ID: 'foo' });
  spawned.push(proc);

  const res = await fetch(url);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  const config = extractConfig(html);

  assert.equal(config.planner, 'bedrock');
  assert.equal(config.modelId, 'foo');
  assert.equal(config.region, undefined, 'AWS_REGION must never reach the browser-templated config (#130)');

  proc.kill();
});

test('with no PLANNER/BEDROCK_MODEL_ID set, the config falls back to scripted/the default model id', async () => {
  const { proc, url } = await startClientServer({});
  spawned.push(proc);

  const html = await (await fetch(url)).text();
  const config = extractConfig(html);

  assert.equal(config.planner, 'scripted');
  assert.equal(config.modelId, DEFAULT_MODEL_ID);
  assert.equal(config.region, undefined);

  proc.kill();
});

test('a non-HTML response (a .js file) is served unmodified, with no config script injected', async () => {
  const { proc, url } = await startClientServer({});
  spawned.push(proc);

  const res = await fetch(new URL('src/app.js', url));
  assert.equal(res.status, 200);
  const body = await res.text();
  // app.js itself legitimately *reads* window.__ALEXA_PLUS_CONFIG__ (#122) — what this
  // asserts is that server.js never *injects an assignment* into a non-HTML response.
  assert.ok(
    !body.includes('window.__ALEXA_PLUS_CONFIG__ ='),
    'only .html responses get the config assignment script injected'
  );

  proc.kill();
});
