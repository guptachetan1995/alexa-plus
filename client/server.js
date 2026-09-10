// Zero-dependency static file server for the simulated Alexa+ client. No bundler is
// needed (index.html loads React straight from a CDN via an import map, and app.js/
// planner.js/mcp-client.js are plain ES modules), so this is the entire "build".
// Deliberately serves only this directory's own files — a fixed allowlist of
// extensions, not a general-purpose static file server — since this page is the whole
// deliverable and nothing outside client/ needs to be reachable through it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;

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

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const filePath = resolveRequestPath(pathname);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`alexa-plus simulated client listening on http://127.0.0.1:${PORT}`);
  console.log(
    'Open that URL in a browser. It talks to the MCP server URL entered in the page ' +
      '(default http://127.0.0.1:3000/mcp — start the server with npm start in ../).'
  );
});
