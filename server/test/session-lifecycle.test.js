'use strict';

const request = require('supertest');
const { createApp } = require('../src/server.js');
const { postRpc, initializeSession, MCP_ACCEPT } = require('./helpers.js');

describe('session lifecycle', () => {
  test('a non-initialize POST with no session id is 400 Bad Request', async () => {
    const app = createApp();
    const res = await postRpc(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(400);
  });

  test('a GET with no session id is 400 Bad Request', async () => {
    const app = createApp();
    const res = await request(app).get('/mcp').set('Accept', 'text/event-stream');
    expect(res.status).toBe(400);
  });

  test('DELETE terminates a live session, and later requests against it are 404', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const deleteRes = await request(app).delete('/mcp').set('Mcp-Session-Id', sessionId);
    expect(deleteRes.status).toBeLessThan(300);

    const postAfter = await postRpc(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { sessionId }
    );
    expect(postAfter.status).toBe(404);

    const getAfter = await request(app)
      .get('/mcp')
      .set('Accept', 'text/event-stream')
      .set('Mcp-Session-Id', sessionId);
    expect(getAfter.status).toBe(404);
  });

  test('DELETE with an unknown session id is 404, not a crash', async () => {
    const app = createApp();
    const res = await request(app).delete('/mcp').set('Mcp-Session-Id', 'never-existed');
    expect(res.status).toBe(404);
  });

  test('a request that reuses another session\'s id after that session never initialized is rejected', async () => {
    const app = createApp();
    const res = await postRpc(
      app,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { sessionId: 'made-up-session-id' }
    );
    expect(res.status).toBe(404);
  });

  test('the server accepts the MCP-Protocol-Version header on operational requests', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', MCP_ACCEPT)
      .set('Mcp-Session-Id', sessionId)
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect(res.status).toBe(200);
  });
});
