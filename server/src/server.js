'use strict';

const { randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');

const { DeviceRegistry } = require('./device-registry.js');
const { AuditLog } = require('./audit.js');
const { ProposalStore } = require('./proposals.js');
const { checkAutomationPolicy } = require('./policy.js');
const { registerReadOnlyTools, registerMutatingTools } = require('./tools.js');

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'alexa-plus-smart-home-agent';
const SERVER_VERSION = '0.1.0';

// The simulated client's default origins. Only these may call /proposals/* from a
// browser unless OWNER_ORIGINS says otherwise.
const DEFAULT_OWNER_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

/**
 * One McpServer per HTTP session, each wired to the same shared registry/audit/
 * proposals instances — state (device state, audit entries, pending proposals) lives
 * at the app level, not the session level, since a proposal made in one session must
 * still be approvable/executable if the client reconnects with a new session id.
 */
function buildMcpServer({ registry, audit, proposals, policy }) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } }
  );
  registerReadOnlyTools(server, { registry, audit, policy });
  registerMutatingTools(server, { registry, proposals, audit, policy });
  return server;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest();
}

/**
 * Guards the owner-only decision routes. The key is compared as fixed-length digests
 * with timingSafeEqual, so response timing says nothing about how much of a guess was
 * right. With no ownerKey configured the routes fail closed: nothing can be approved.
 */
function requireOwnerKey(ownerKey) {
  const expected = ownerKey ? sha256(ownerKey) : null;
  return (req, res, next) => {
    if (!expected) {
      res.status(503).json({
        error: 'Owner approval is disabled: this server was started without OWNER_KEY, so no proposal can be approved or declined.',
      });
      return;
    }
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!match || !timingSafeEqual(sha256(match[1]), expected)) {
      res.set('WWW-Authenticate', 'Bearer');
      res.status(401).json({
        error: 'Only the home owner can approve or decline a proposal: send the owner key as "Authorization: Bearer <key>". Nothing was minted or changed.',
      });
      return;
    }
    next();
  };
}

/**
 * Builds the Express app for the MCP endpoint. Exported (not auto-listening) so tests
 * can drive it in-process with supertest without binding a real port. `ownerKey` is the
 * secret the owner-only /proposals routes require; `policy` is the automation policy
 * every tool checks (injectable so a test can change it between approval and execution).
 */
function createApp({
  registry = new DeviceRegistry(),
  audit = new AuditLog(),
  proposals = new ProposalStore(),
  policy = checkAutomationPolicy,
  ownerKey,
  ownerOrigins = DEFAULT_OWNER_ORIGINS,
} = {}) {
  // createMcpExpressApp()'s own DNS-rebinding Host check — not the
  // StreamableHTTPServerTransport below — is what enforces localhost-only by
  // default (via its `host` option, independent of what this process actually
  // binds to). `host: '0.0.0.0'` opts out of that automatic allowlist, the same
  // tradeoff already made for /mcp's CORS: the agent surface has no auth and no
  // origin allowlist, so this one check wasn't real protection — just this SDK
  // helper's localhost default. The owner routes are protected by the owner key.
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  // The simulated Alexa+ client runs on its own origin/port and talks to
  // this server only over HTTP, so cross-origin fetches need explicit CORS — including
  // exposing Mcp-Session-Id, which a browser's fetch() otherwise hides on cross-origin
  // responses even though the header is present on the wire.
  //
  // Two policies. /mcp is the agent's surface and stays open to any origin (any MCP
  // client may connect). /proposals/* is the owner's surface: a browser may call it only
  // from an allowlisted origin, on top of the owner key the decision routes require.
  const allowedOwnerOrigins = new Set(ownerOrigins);
  app.use((req, res, next) => {
    if (req.path.startsWith('/proposals')) {
      res.header('Vary', 'Origin');
      if (allowedOwnerOrigins.has(req.headers.origin)) {
        res.header('Access-Control-Allow-Origin', req.headers.origin);
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
    } else {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
      res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Session id -> live transport. A session begins at `initialize` and ends on
  // DELETE or transport close; there is no persistence across process restarts,
  // by design: all state lives in memory for the life of the process.
  const transports = {};

  const mcpPostHandler = async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    try {
      let transport;
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            delete transports[sid];
          }
        };
        const server = buildMcpServer({ registry, audit, proposals, policy });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else if (sessionId) {
        // A session id was presented but is not (or no longer) live: per spec
        // section "Session Management" item 3, a terminated/unknown session gets
        // 404 so the client knows to re-initialize, distinct from the 400 below.
        res.status(404).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: `Session not found: ${sessionId}` },
        });
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: `Internal server error: ${err.message}` },
        });
      }
    }
  };

  const requireKnownSession = (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId) {
      res.status(400).send('Missing Mcp-Session-Id header');
      return null;
    }
    if (!transports[sessionId]) {
      res.status(404).send(`Session not found: ${sessionId}`);
      return null;
    }
    return transports[sessionId];
  };

  const mcpGetHandler = async (req, res) => {
    const transport = requireKnownSession(req, res);
    if (!transport) return;
    await transport.handleRequest(req, res);
  };

  const mcpDeleteHandler = async (req, res) => {
    const transport = requireKnownSession(req, res);
    if (!transport) return;
    await transport.handleRequest(req, res);
  };

  app.post('/mcp', mcpPostHandler);
  app.get('/mcp', mcpGetHandler);
  app.delete('/mcp', mcpDeleteHandler);

  // Owner-only proposal decisions — the `approve`/`reject` verbs, as REST routes because
  // this entry's client is a web page, not a CLI. These are plain REST routes, NOT
  // MCP tools: no agent tool call can reach them. And they require the owner key, so an
  // HTTP caller who is not the owner cannot reach them either — together that is what
  // makes the confirmation token "minted only by the owner's Confirm" true.
  const ownerOnly = requireOwnerKey(ownerKey);

  app.post('/proposals/:proposalId/approve', ownerOnly, (req, res) => {
    const outcome = proposals.approve(req.params.proposalId);
    if (!outcome.ok) {
      res.status(409).json({ error: outcome.reason });
      return;
    }
    res.json({
      proposal_id: outcome.proposal.proposal_id,
      status: outcome.proposal.status,
      confirmation_id: outcome.token,
    });
  });

  app.post('/proposals/:proposalId/reject', ownerOnly, (req, res) => {
    const outcome = proposals.reject(req.params.proposalId);
    if (!outcome.ok) {
      res.status(409).json({ error: outcome.reason });
      return;
    }
    res.json({ proposal_id: outcome.proposal.proposal_id, status: outcome.proposal.status });
  });

  app.get('/proposals/:proposalId', (req, res) => {
    const proposal = proposals.get(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ error: `No proposal with proposal_id "${req.params.proposalId}".` });
      return;
    }
    // Never leak the raw token over this read path — approve() already returned it
    // once, directly to the caller that minted it; nothing else needs to see it.
    const safe = Object.assign({}, proposal);
    delete safe.confirmation_token;
    res.json(safe);
  });

  return app;
}

function main() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const ownerOrigins = process.env.OWNER_ORIGINS
    ? process.env.OWNER_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : DEFAULT_OWNER_ORIGINS;
  const app = createApp({ ownerKey: process.env.OWNER_KEY, ownerOrigins });
  app.listen(port, () => {
    console.log(`alexa-plus MCP server (Streamable HTTP, ${PROTOCOL_VERSION}) listening on http://127.0.0.1:${port}/mcp`);
    if (!process.env.OWNER_KEY) {
      console.log('OWNER_KEY is not set: every approve/reject is refused until the server is restarted with one.');
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = { createApp, buildMcpServer, PROTOCOL_VERSION };
