// Tests server.js's config-injection: PLANNER/BEDROCK_MODEL_ID from the process env get
// templated into `window.__ALEXA_PLUS_CONFIG__` in the served HTML, so app.js can read
// them without ever touching process.env itself (browser JS has none). AWS_REGION is
// deliberately NOT part of this template — it only matters to the real
// BedrockRuntimeClient server.js constructs for itself, and the browser no longer
// constructs one at all, so it has nothing to read it for.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
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
  delete env.OWNER_KEY;
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

// fetch() will not send a Host header of the caller's choosing; node:http will.
function rawGet(port, pathname, host, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { Host: host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
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

test('PLANNER=bedrock, BEDROCK_MODEL_ID and OWNER_KEY are templated into window.__ALEXA_PLUS_CONFIG__, served only to a local Host; AWS_REGION is not', async () => {
  const { proc, url } = await startClientServer({
    PLANNER: 'bedrock',
    AWS_REGION: 'eu-west-1',
    BEDROCK_MODEL_ID: 'foo',
    OWNER_KEY: 'k</script><b>',
  });
  spawned.push(proc);

  const res = await fetch(url);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  const config = extractConfig(html);

  assert.equal(config.planner, 'bedrock');
  assert.equal(config.modelId, 'foo');
  assert.equal(config.region, undefined, 'AWS_REGION must never reach the browser-templated config');
  // The owner key is templated for the page's own Confirm/Decline, escaped so it can
  // never close the script element it sits in.
  assert.equal(config.ownerKey, 'k</script><b>');
  assert.ok(!html.includes('k</script><b>'), 'a "<" in a configured value must be escaped in the HTML');

  // DNS rebinding: a request that reached 127.0.0.1 under someone else's hostname gets
  // neither the page (with the key in it) nor the Bedrock proxy. `localhost` still works.
  const { port } = new URL(url);
  const rebound = await rawGet(port, '/', `attacker.example:${port}`);
  assert.equal(rebound.status, 403);
  assert.ok(!rebound.body.includes('k\\u003c/script>'), 'a foreign Host must never receive the owner key');
  assert.equal((await rawGet(port, '/bedrock/converse', `attacker.example:${port}`, 'POST')).status, 403);
  assert.equal((await rawGet(port, '/', `127.0.0.1:${Number(port) + 1}`)).status, 403, 'the port is part of the check');
  assert.equal((await rawGet(port, '/', `localhost:${port}`)).status, 200);

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
  assert.equal(config.ownerKey, null);

  proc.kill();
});

test('a non-HTML response (a .js file) is served unmodified, with no config script injected', async () => {
  const { proc, url } = await startClientServer({});
  spawned.push(proc);

  const res = await fetch(new URL('src/app.js', url));
  assert.equal(res.status, 200);
  const body = await res.text();
  // app.js itself legitimately *reads* window.__ALEXA_PLUS_CONFIG__ — what this
  // asserts is that server.js never *injects an assignment* into a non-HTML response.
  assert.ok(
    !body.includes('window.__ALEXA_PLUS_CONFIG__ ='),
    'only .html responses get the config assignment script injected'
  );

  proc.kill();
});
