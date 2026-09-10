'use strict';

const { createApp } = require('../src/server.js');
const { postRpc, initializeSession } = require('./helpers.js');

describe('tools/list', () => {
  test('lists exactly the eight SPEC.md tools, each with a real description and input schema', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await postRpc(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { sessionId }
    );

    expect(res.status).toBe(200);
    const { tools } = res.body.result;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'check_automation_policy',
      'compose_scene',
      'execute_action',
      'execute_scene',
      'get_device_state',
      'list_devices',
      'propose_action',
      'read_audit_log',
    ]);

    for (const tool of tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(20);
      // Every tool description documents what it does NOT do (CLAUDE.md "Tools are
      // documentation" watch) — assert the negative-space language is actually present.
      expect(tool.description).toMatch(/does NOT/);
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }

    const getDeviceState = tools.find((t) => t.name === 'get_device_state');
    expect(getDeviceState.inputSchema.required).toContain('device_id');
  });

  test('tools/list requires a live session (no session id -> 400)', async () => {
    const app = createApp();
    const res = await postRpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
  });
});
