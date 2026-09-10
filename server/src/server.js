'use strict';

const { randomUUID } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');

const { DeviceRegistry } = require('./device-registry.js');
const { AuditLog } = require('./audit.js');
const { ProposalStore } = require('./proposals.js');
const { registerReadOnlyTools, registerMutatingTools } = require('./tools.js');

const PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'alexa-plus-smart-home-agent';
const SERVER_VERSION = '0.1.0';

/**
 * One McpServer per HTTP session, each wired to the same shared registry/audit/
 * proposals instances — state (device state, audit entries, pending proposals) lives
 * at the app level, not the session level, since a proposal made in one session must
 * still be approvable/executable if the client reconnects with a new session id.
 */
function buildMcpServer({ registry, audit, proposals }) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } }
  );
  registerReadOnlyTools(server, { registry, audit });
  registerMutatingTools(server, { registry, proposals, audit });
  return server;
}

/**
 * Builds the Express app for the MCP endpoint. Exported (not auto-listening) so tests
 * can drive it in-process with supertest without binding a real port.
 */
function createApp({
  registry = new DeviceRegistry(),
  audit = new AuditLog(),
  proposals = new ProposalStore(),
} = {}) {
  // createMcpExpressApp()'s own DNS-rebinding Host check — not the
  // StreamableHTTPServerTransport below — is what enforces localhost-only by
  // default (via its `host` option, independent of what this process actually
  // binds to). `host: '0.0.0.0'` opts out of that automatic allowlist, the same
  // tradeoff already made for CORS: no auth, no origin allowlist, so this one
  // check wasn't real protection — just this SDK helper's localhost default (#124).
  const app = createMcpExpressApp({ host: '0.0.0.0' });

  // The simulated Alexa+ client (issue #35) runs on its own origin/port and talks to
  // this server only over HTTP, so cross-origin fetches need explicit CORS — including
  // exposing Mcp-Session-Id, which a browser's fetch() otherwise hides on cross-origin
  // responses even though the header is present on the wire.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Session id -> live transport. A session begins at `initialize` and ends on
  // DELETE or transport close; there is no persistence across process restarts,
  // matching SPEC.md's "state lives in memory during a run" data model.
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
        const server = buildMcpServer({ registry, audit, proposals });
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

  // Owner-only proposal decisions — SPEC.md's `approve`/`reject` CLI verbs, adapted to
  // this entry's web client since there is no CLI. These are plain REST routes, NOT
  // MCP tools: no agent tool call can reach them, which is what makes the confirmation
  // token "minted only by the client's Confirm control" true rather than aspirational.
  app.post('/proposals/:proposalId/approve', (req, res) => {
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

  app.post('/proposals/:proposalId/reject', (req, res) => {
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
  const app = createApp();
  app.listen(port, () => {
    console.log(`alexa-plus MCP server (Streamable HTTP, ${PROTOCOL_VERSION}) listening on http://127.0.0.1:${port}/mcp`);
  });
}

if (require.main === module) {
  main();
}

module.exports = { createApp, buildMcpServer, PROTOCOL_VERSION };
