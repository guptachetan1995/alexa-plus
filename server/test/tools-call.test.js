'use strict';

const fs = require('node:fs');
const { createApp } = require('../src/server.js');
const { DEVICES_PATH } = require('../src/device-registry.js');
const { postRpc, initializeSession } = require('./helpers.js');

async function callTool(app, sessionId, name, args, id = 10) {
  return postRpc(
    app,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    { sessionId }
  );
}

describe('tools/call', () => {
  test('list_devices with no arguments returns all 5 seeded devices across 3 rooms', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'list_devices', {});
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeFalsy();
    const { devices } = res.body.result.structuredContent;
    expect(devices).toHaveLength(5);
    expect(new Set(devices.map((d) => d.room)).size).toBe(3);
  });

  test('list_devices filters by room, case-insensitively', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'list_devices', { room: 'KITCHEN' });
    const { devices } = res.body.result.structuredContent;
    expect(devices).toHaveLength(1);
    expect(devices[0].device_id).toBe('dev_kitchen_plug_1');
  });

  test('list_devices returns an empty list (not an error) for an unknown room', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'list_devices', { room: 'garage' });
    expect(res.body.result.isError).toBeFalsy();
    expect(res.body.result.structuredContent.devices).toEqual([]);
  });

  test('get_device_state returns state + last_updated for a known device', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'get_device_state', {
      device_id: 'dev_thermostat_1',
    });
    expect(res.body.result.isError).toBeFalsy();
    expect(res.body.result.structuredContent).toMatchObject({
      device_id: 'dev_thermostat_1',
      state: { power: 'on', mode: 'heat' },
    });
    expect(res.body.result.structuredContent.last_updated).toBeTruthy();
  });

  test('get_device_state reports a tool execution error (isError, not a protocol error) for an unknown device', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'get_device_state', {
      device_id: 'does-not-exist',
    });
    expect(res.status).toBe(200); // protocol-level success; the error is inside the result
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/does-not-exist/);
    expect(res.body.error).toBeUndefined();
  });

  test('an unregistered tool name comes back as an error result, not silently as if it ran', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'turn_off_everything', {});
    // The SDK's McpServer reports an unknown tool as a CallToolResult with
    // isError: true (embedding JSON-RPC code -32602 in the message) rather than a
    // bare top-level JSON-RPC error — either is spec-legal; assert the actual shape.
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/turn_off_everything/);
  });

  test('read-only tools never mutate the seeded device registry on disk', async () => {
    const before = fs.readFileSync(DEVICES_PATH, 'utf8');

    const app = createApp();
    const { sessionId } = await initializeSession(app);
    await callTool(app, sessionId, 'list_devices', {});
    await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_kitchen_plug_1' });
    await callTool(app, sessionId, 'get_device_state', { device_id: 'missing' });

    const after = fs.readFileSync(DEVICES_PATH, 'utf8');
    expect(after).toBe(before);
  });
});
