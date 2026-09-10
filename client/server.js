// Static file server for the simulated Alexa+ client. No bundler is needed (index.html
// loads React straight from a CDN via an import map, and app.js/planner.js/
// mcp-client.js are plain ES modules), so this is the entire "build" — except for the
// one HTML response, which is no longer a byte-for-byte pass-through: it gets a small
// `window.__ALEXA_PLUS_CONFIG__` script templated in (see below) so app.js can read the
// planner choice without app.js ever touching process.env itself (there is none in a
// browser). Every other extension/content-type is untouched.
// Deliberately serves only this directory's own files — a fixed allowlist of
// extensions, not a general-purpose static file server — since this page is the whole
// deliverable and nothing outside client/ needs to be reachable through it.
//
// #130: this is also the ONE place in the whole client that imports the AWS SDK or
// resolves an AWS credential. `POST /bedrock/converse` proxies the Bedrock Converse call
// for bedrock-planner.js's browser-side tool-use loop — a real browser tab cannot
// resolve the SDK's bare import (no bundler here) and, even patched around, the SDK's
// default credential chain is Node-only and can never run in a browser safely (see
// bedrock-planner.js's header). Node can resolve AWS credentials the normal way (local
// env/`~/.aws/credentials` in dev, an IAM role if this process is ever deployed), so the
// AWS call moves here; the browser only ever POSTs a Converse request body and reads
// back its JSON response over this same origin — no credential of any kind crosses that
// boundary in either direction.
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import { DEFAULT_MODEL_ID } from './src/bedrock-planner.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
// Server-side only — the browser no longer needs to know which AWS region is in play,
// since it never constructs an AWS client itself any more (#130).
const REGION = process.env.AWS_REGION || 'ap-southeast-2';

// #122: which planner app.js runs, read once at server startup — never inside a
// request handler, and never by app.js reaching for process.env, which does not exist
// in a browser. No AWS credentials are read or embedded here or anywhere in this
// template — `modelId` just tells the browser which model name to display/request.
const CLIENT_CONFIG = {
  planner: process.env.PLANNER || 'scripted',
  modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
};
const CONFIG_SCRIPT = `<script>window.__ALEXA_PLUS_CONFIG__ = ${JSON.stringify(CLIENT_CONFIG)};</script>\n  `;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function resolveRequestPath(urlPath) {
  const clean = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(path.join(ROOT, clean));
  if (!resolved.startsWith(ROOT)) return null; // reject any attempt to escape client/
  return resolved;
}

async function readJsonBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * `POST /bedrock/converse` — reads a Converse request body from the browser's
 * `defaultBedrockClient()` (bedrock-planner.js), makes the real, credentialed call, and
 * returns `{ output, stopReason }` untouched. Never leaks a raw AWS error/stack to the
 * browser — just `err.message`, which for a real AWS SDK error is already a clear,
 * actionable string (e.g. missing/invalid credentials, access denied, throttling).
 */
async function handleBedrockConverse(req, res, bedrockClient) {
  let input;
  try {
    input = await readJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Bad request body: ${err.message}` }));
    return;
  }
  try {
    const response = await bedrockClient.send(new ConverseCommand(input));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ output: response.output, stopReason: response.stopReason }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Bedrock request failed.' }));
  }
}

/**
 * Builds the server. Exported (not auto-listening) so tests can inject a fake
 * `bedrockClient` and drive `/bedrock/converse` without a real AWS credential or
 * network call — mirrors `server/src/server.js`'s `createApp()` on the MCP side.
 */
export function createServer({ bedrockClient = new BedrockRuntimeClient({ region: REGION }) } = {}) {
  return createHttpServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && pathname === '/bedrock/converse') {
      await handleBedrockConverse(req, res, bedrockClient);
      return;
    }

    const filePath = resolveRequestPath(pathname);
    if (!filePath) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      if (ext === '.html') {
        const html = data.toString('utf8').replace('</head>', `${CONFIG_SCRIPT}</head>`);
        res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] });
        res.end(html);
        return;
      }
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

function main() {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`alexa-plus simulated client listening on http://127.0.0.1:${PORT}`);
    console.log(
      'Open that URL in a browser. It talks to the MCP server URL entered in the page ' +
        '(default http://127.0.0.1:3000/mcp — start the server with npm start in ../).'
    );
  });
}

// Only listen when run directly (`node server.js` / `npm start`) — importing
// `createServer` from a test must never have the side effect of binding a real port.
if (process.argv[1] === THIS_FILE) {
  main();
}
