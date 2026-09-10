'use strict';

const { createApp } = require('../src/server.js');
const { postRpc, initializeSession } = require('./helpers.js');
const request = require('supertest');

async function callTool(app, sessionId, name, args, id = 10) {
  return postRpc(
    app,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    { sessionId }
  );
}

describe('propose -> approve -> execute (the happy path both refusal tests contrast against)', () => {
  test('propose_action -> approve (REST) -> execute_action mutates state and writes one audit entry', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
    });
    expect(proposeRes.body.result.isError).toBeFalsy();
    const proposal = proposeRes.body.result.structuredContent;
    expect(proposal.status).toBe('awaiting_approval');
    expect(proposal.policy_check.allowed).toBe(true);

    const approveRes = await request(app).post(`/proposals/${proposal.proposal_id}/approve`).send();
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('approved');
    const token = approveRes.body.confirmation_id;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const executeRes = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
      confirmation_id: token,
    });
    expect(executeRes.body.result.isError).toBeFalsy();
    expect(executeRes.body.result.structuredContent.new_state.brightness).toBe(50);
    expect(executeRes.body.result.structuredContent.result).toBe('success');

    const auditRes = await callTool(app, sessionId, 'read_audit_log', { device_id: 'dev_living_room_light_1' });
    const { entries } = auditRes.body.result.structuredContent;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: 'user', action: 'set_brightness', result: 'success' });

    const stateRes = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(stateRes.body.result.structuredContent.state.brightness).toBe(50);
  });

  test('declining a proposal (REST reject) leaves it un-executable and leaves state unchanged', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_off',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;

    const rejectRes = await request(app).post(`/proposals/${proposal.proposal_id}/reject`).send();
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('rejected');

    const beforeState = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_kitchen_plug_1' });
    expect(beforeState.body.result.structuredContent.state.power).toBe('off');
  });

  test('compose_scene -> approve -> execute_scene applies every action and writes one audit entry per device', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const composeRes = await callTool(app, sessionId, 'compose_scene', {
      scene_name: 'Good Night',
      actions: [
        { device_id: 'dev_front_door_lock_1', action: 'lock', params: {} },
        { device_id: 'dev_living_room_light_1', action: 'turn_off', params: {} },
      ],
    });
    expect(composeRes.body.result.isError).toBeFalsy();
    const proposal = composeRes.body.result.structuredContent;
    expect(proposal.status).toBe('awaiting_approval');

    const approveRes = await request(app).post(`/proposals/${proposal.proposal_id}/approve`).send();
    const token = approveRes.body.confirmation_id;

    const executeRes = await callTool(app, sessionId, 'execute_scene', {
      scene_name: 'Good Night',
      confirmation_id: token,
    });
    expect(executeRes.body.result.isError).toBeFalsy();
    const out = executeRes.body.result.structuredContent;
    expect(out.result).toBe('success');
    expect(out.results).toHaveLength(2);
    expect(out.results.every((r) => r.result === 'success')).toBe(true);

    const auditRes = await callTool(app, sessionId, 'read_audit_log', {});
    expect(auditRes.body.result.structuredContent.entries).toHaveLength(2);

    const lockState = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_front_door_lock_1' });
    expect(lockState.body.result.structuredContent.state.locked).toBe(true);
    const lightState = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(lightState.body.result.structuredContent.state.power).toBe('off');
  });

  test('a scene with any action blocked by policy is blocked_by_policy end to end and cannot be approved', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);

    const composeRes = await callTool(app, sessionId, 'compose_scene', {
      scene_name: 'Overheat',
      actions: [{ device_id: 'dev_thermostat_1', action: 'set_target_temp', params: { target_temp_f: 95 } }],
    });
    const proposal = composeRes.body.result.structuredContent;
    expect(proposal.status).toBe('blocked_by_policy');

    const approveRes = await request(app).post(`/proposals/${proposal.proposal_id}/approve`).send();
    expect(approveRes.status).toBe(409);
    expect(approveRes.body.error).toMatch(/not awaiting approval/);
  });
});
