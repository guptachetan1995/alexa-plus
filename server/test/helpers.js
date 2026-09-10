'use strict';

const request = require('supertest');

const MCP_ACCEPT = 'application/json, text/event-stream';

/** POSTs a JSON-RPC message with the headers every Streamable HTTP request needs. */
function postRpc(app, body, { sessionId } = {}) {
  const req = request(app)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', MCP_ACCEPT);
  if (sessionId) req.set('Mcp-Session-Id', sessionId);
  return req.send(body);
}

/** Runs the initialize handshake + initialized notification, returns the session id. */
async function initializeSession(app, { clientName = 'conformance-test-client' } = {}) {
  const initRes = await postRpc(app, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: clientName, version: '0.0.1' },
    },
  });
  const sessionId = initRes.headers['mcp-session-id'];
  await postRpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, { sessionId });
  return { sessionId, initRes };
}

module.exports = { postRpc, initializeSession, MCP_ACCEPT };
