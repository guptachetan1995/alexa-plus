'use strict';

const request = require('supertest');

const MCP_ACCEPT = 'application/json, text/event-stream';

// The owner key every test app is built with, and the helper that plays the owner's
// Confirm/Decline: a POST to the owner-only route carrying that key.
const TEST_OWNER_KEY = 'test-owner-key';

function decide(app, proposalId, decision, { key = TEST_OWNER_KEY } = {}) {
  const req = request(app).post(`/proposals/${proposalId}/${decision}`);
  if (key) req.set('Authorization', `Bearer ${key}`);
  return req.send();
}

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

module.exports = { postRpc, initializeSession, decide, TEST_OWNER_KEY, MCP_ACCEPT };
