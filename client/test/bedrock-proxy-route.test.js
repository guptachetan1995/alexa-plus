// Tests server.js's POST /bedrock/converse route in isolation (#130): a fake
// bedrockClient is injected via createServer({ bedrockClient }), so this suite never
// needs a real AWS credential and never makes a real network call to AWS — the whole
// point of moving the AWS SDK here (out of the browser) was to make this testable the
// normal Node way, which was structurally impossible for the browser-side code it
// replaced.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';

import { createServer } from '../server.js';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

async function startServer(bedrockClient) {
  const server = createServer({ bedrockClient });
  const port = await getFreePort();
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${port}` };
}

const started = [];
after(() => {
  for (const server of started) server.close();
});

test('POST /bedrock/converse forwards the body to bedrockClient.send() and returns only {output, stopReason}', async () => {
  let capturedInput;
  const fakeClient = {
    async send(command) {
      capturedInput = command.input;
      return {
        output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
        stopReason: 'end_turn',
        // A real Converse response carries $metadata (request id, http status, etc.) —
        // the route must not leak it to the browser, only output/stopReason.
        $metadata: { httpStatusCode: 200 },
      };
    },
  };
  const { server, url } = await startServer(fakeClient);
  started.push(server);

  const res = await fetch(`${url}/bedrock/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId: 'amazon.nova-micro-v1:0',
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    output: { message: { role: 'assistant', content: [{ text: 'hi' }] } },
    stopReason: 'end_turn',
  });
  assert.equal(capturedInput.modelId, 'amazon.nova-micro-v1:0');
});

test('a bedrockClient rejection comes back as HTTP 502 with a JSON {error} body, never a raw stack trace', async () => {
  const fakeClient = {
    async send() {
      throw new Error('AccessDeniedException: mock, not real AWS');
    },
  };
  const { server, url } = await startServer(fakeClient);
  started.push(server);

  const res = await fetch(`${url}/bedrock/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'x', messages: [] }),
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'AccessDeniedException: mock, not real AWS');
});

test('a malformed JSON body is refused with HTTP 400, never reaching bedrockClient.send()', async () => {
  let sendCalled = false;
  const fakeClient = {
    async send() {
      sendCalled = true;
    },
  };
  const { server, url } = await startServer(fakeClient);
  started.push(server);

  const res = await fetch(`${url}/bedrock/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });

  assert.equal(res.status, 400);
  assert.equal(sendCalled, false);
});

test('GET /bedrock/converse falls through to the ordinary static-file 404, never reaching bedrockClient.send()', async () => {
  let sendCalled = false;
  const fakeClient = {
    async send() {
      sendCalled = true;
    },
  };
  const { server, url } = await startServer(fakeClient);
  started.push(server);

  const res = await fetch(`${url}/bedrock/converse`);

  assert.equal(res.status, 404);
  assert.equal(sendCalled, false);
});
