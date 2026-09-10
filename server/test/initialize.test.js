'use strict';

const { createApp, PROTOCOL_VERSION } = require('../src/server.js');
const { postRpc, initializeSession } = require('./helpers.js');

describe('initialize handshake', () => {
  test('POST initialize returns the negotiated protocol version, a session id, and serverInfo', async () => {
    const app = createApp();
    const res = await postRpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'jest-client', version: '0.0.1' },
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeTruthy();
    expect(res.body.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(res.body.result.serverInfo).toMatchObject({ name: expect.any(String) });
    expect(res.body.result.capabilities.tools).toBeDefined();
  });

  test('POST notifications/initialized on the new session is accepted (202) with no body', async () => {
    const app = createApp();
    const initRes = await postRpc(app, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'jest-client', version: '0.0.1' },
      },
    });
    const sessionId = initRes.headers['mcp-session-id'];

    const ackRes = await postRpc(
      app,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { sessionId }
    );
    expect(ackRes.status).toBe(202);
    expect(ackRes.text).toBe('');
  });

  test('a second initialize on the same app issues a distinct session id', async () => {
    const app = createApp();
    const { sessionId: first } = await initializeSession(app);
    const { sessionId: second } = await initializeSession(app);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});
