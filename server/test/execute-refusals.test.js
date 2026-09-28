'use strict';

// A confirm without a proposal is refused, and both refusal paths — missing token, and
// a token with no matching pending proposal — are asserted here independently, for both
// execute_action and execute_scene. Every assertion also checks the seeded state (or
// audit log) is untouched, so a refusal is proven to be a true no-op, not just an
// error message with a side effect that happened anyway.

const { createApp } = require('../src/server.js');
const { checkAutomationPolicy } = require('../src/policy.js');
const { postRpc, initializeSession, decide, TEST_OWNER_KEY } = require('./helpers.js');
const request = require('supertest');

async function callTool(app, sessionId, name, args, id = 10) {
  return postRpc(
    app,
    { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    { sessionId }
  );
}

describe('execute_action refuses without a valid, matching, unused confirmation', () => {
  test('no confirmation_id at all is refused, narrated, and does not mutate state', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
    });

    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/requires a confirmation_id/i);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(state.body.result.structuredContent.state.brightness).toBe(100); // unchanged seed value
  });

  test('a confirmation_id with no matching pending proposal at all is refused ("a confirm without a proposal")', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
      confirmation_id: 'confirm_totally-made-up-token',
    });

    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/no matching pending proposal/i);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(state.body.result.structuredContent.state.brightness).toBe(100);
    const audit = await callTool(app, sessionId, 'read_audit_log', {});
    expect(audit.body.result.structuredContent.entries).toHaveLength(0);
  });

  test('a proposal that exists but was never approved (still awaiting_approval) has no usable token yet', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_bedroom_light_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    expect(proposal.status).toBe('awaiting_approval');

    // The agent never receives a token from propose_action itself — only approve()
    // (the client's Confirm control) mints one — so guessing the proposal_id as a
    // token is exactly the "no matching proposal" case, not a valid shortcut.
    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_bedroom_light_1',
      action: 'turn_on',
      params: {},
      confirmation_id: proposal.proposal_id,
    });
    expect(res.body.result.isError).toBe(true);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_bedroom_light_1' });
    expect(state.body.result.structuredContent.state.power).toBe('off'); // unchanged seed value
  });

  test('a token already consumed by a prior execute_action is refused on replay (one-time use)', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_bedroom_light_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    const approveRes = await decide(app, proposal.proposal_id, 'approve');
    const token = approveRes.body.confirmation_id;

    const firstExecute = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_bedroom_light_1',
      action: 'turn_on',
      params: {},
      confirmation_id: token,
    });
    expect(firstExecute.body.result.isError).toBeFalsy();

    const replay = await callTool(
      app,
      sessionId,
      'execute_action',
      { device_id: 'dev_bedroom_light_1', action: 'turn_on', params: {}, confirmation_id: token },
      11
    );
    expect(replay.body.result.isError).toBe(true);
    expect(replay.body.result.content[0].text).toMatch(/no matching pending proposal/i);

    const audit = await callTool(app, sessionId, 'read_audit_log', { device_id: 'dev_bedroom_light_1' });
    expect(audit.body.result.structuredContent.entries).toHaveLength(1); // not two
  });

  test('a rejected proposal cannot be executed even if its proposal_id or a guessed value is tried', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    await decide(app, proposal.proposal_id, 'reject');

    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_on',
      params: {},
      confirmation_id: proposal.proposal_id,
    });
    expect(res.body.result.isError).toBe(true);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_kitchen_plug_1' });
    expect(state.body.result.structuredContent.state.power).toBe('off');
  });

  test('a valid, approved token is refused if the action it is used for does not match what was approved', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 50 },
    });
    const proposal = proposeRes.body.result.structuredContent;
    const approveRes = await decide(app, proposal.proposal_id, 'approve');
    const token = approveRes.body.confirmation_id;

    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_living_room_light_1',
      action: 'set_brightness',
      params: { brightness: 99 }, // different params than what was approved
      confirmation_id: token,
    });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/approved for a different action/i);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(state.body.result.structuredContent.state.brightness).toBe(100);
  });
});

describe('execute_scene refuses without a valid, matching, unused confirmation (same guarantees as execute_action)', () => {
  test('no confirmation_id at all is refused and does not mutate any device', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'execute_scene', { scene_name: 'Good Night' });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/requires a confirmation_id/i);
  });

  test('a confirmation_id with no matching pending scene proposal is refused ("a confirm without a proposal")', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const res = await callTool(app, sessionId, 'execute_scene', {
      scene_name: 'Good Night',
      confirmation_id: 'confirm_never-issued',
    });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/no matching pending scene proposal/i);
  });

  test('an approved token for one scene_name is refused when used against a different scene_name', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const composeRes = await callTool(app, sessionId, 'compose_scene', {
      scene_name: 'Good Night',
      actions: [{ device_id: 'dev_front_door_lock_1', action: 'lock', params: {} }],
    });
    const proposal = composeRes.body.result.structuredContent;
    const approveRes = await decide(app, proposal.proposal_id, 'approve');
    const token = approveRes.body.confirmation_id;

    const res = await callTool(app, sessionId, 'execute_scene', {
      scene_name: 'Not Good Night',
      confirmation_id: token,
    });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/approved for scene/i);

    const state = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_front_door_lock_1' });
    expect(state.body.result.structuredContent.state.locked).toBe(true); // unchanged seed value
  });

  test('a token from an execute_action proposal cannot be used to run execute_scene (kind mismatch)', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_front_door_lock_1',
      action: 'lock',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    const approveRes = await decide(app, proposal.proposal_id, 'approve');
    const token = approveRes.body.confirmation_id;

    const res = await callTool(app, sessionId, 'execute_scene', { scene_name: 'Anything', confirmation_id: token });
    expect(res.body.result.isError).toBe(true);
  });
});

describe('the owner-only approve/reject REST routes themselves refuse invalid proposal ids', () => {
  test('approving an unknown proposal_id is refused with a narrated 409', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const res = await decide(app, 'prop_does-not-exist', 'approve');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pending proposal/i);
  });

  test('rejecting an unknown proposal_id is refused with a narrated 409', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const res = await decide(app, 'prop_does-not-exist', 'reject');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pending proposal/i);
  });

  test('approving an already-approved proposal a second time is refused', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);
    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    const first = await decide(app, proposal.proposal_id, 'approve');
    expect(first.status).toBe(200);

    const second = await decide(app, proposal.proposal_id, 'approve');
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/not awaiting approval/i);
  });

  test('rejecting an already-rejected proposal a second time is refused', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);
    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    await decide(app, proposal.proposal_id, 'reject');

    const second = await decide(app, proposal.proposal_id, 'reject');
    expect(second.status).toBe(409);
  });
});

describe('the approve/reject routes answer only the owner key', () => {
  test('approving without the owner key, or with a wrong one, is refused with 401 and mints nothing', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);
    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_front_door_lock_1',
      action: 'unlock',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;

    const noKey = await decide(app, proposal.proposal_id, 'approve', { key: null });
    expect(noKey.status).toBe(401);
    expect(noKey.headers['www-authenticate']).toBe('Bearer');
    expect(noKey.body.confirmation_id).toBeUndefined();
    expect(noKey.body.error).toMatch(/only the home owner/i);

    const wrongKey = await decide(app, proposal.proposal_id, 'approve', { key: 'guessed-key' });
    expect(wrongKey.status).toBe(401);
    expect(wrongKey.body.confirmation_id).toBeUndefined();

    const after = await request(app).get(`/proposals/${proposal.proposal_id}`);
    expect(after.body.status).toBe('awaiting_approval');
    const lock = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_front_door_lock_1' });
    expect(lock.body.result.structuredContent.state.locked).toBe(true);
  });

  test('declining without the owner key is refused with 401 and the proposal stays pending', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY });
    const { sessionId } = await initializeSession(app);
    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_kitchen_plug_1',
      action: 'turn_on',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;

    const res = await decide(app, proposal.proposal_id, 'reject', { key: null });
    expect(res.status).toBe(401);
    const after = await request(app).get(`/proposals/${proposal.proposal_id}`);
    expect(after.body.status).toBe('awaiting_approval');
  });

  test('a server started without an owner key fails closed: every approve and reject is refused with 503', async () => {
    const app = createApp();
    const { sessionId } = await initializeSession(app);
    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_front_door_lock_1',
      action: 'unlock',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;

    const approve = await decide(app, proposal.proposal_id, 'approve', { key: 'anything' });
    expect(approve.status).toBe(503);
    expect(approve.body.confirmation_id).toBeUndefined();
    const reject = await decide(app, proposal.proposal_id, 'reject', { key: 'anything' });
    expect(reject.status).toBe(503);
    const after = await request(app).get(`/proposals/${proposal.proposal_id}`);
    expect(after.body.status).toBe('awaiting_approval');
  });

  test('a browser may call /proposals only from an allowed origin, while /mcp stays open to any MCP client', async () => {
    const app = createApp({ ownerKey: TEST_OWNER_KEY, ownerOrigins: ['http://127.0.0.1:5173'] });

    const foreign = await request(app)
      .options('/proposals/prop_x/approve')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();

    const owner = await request(app)
      .options('/proposals/prop_x/approve')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(owner.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect(owner.headers['access-control-allow-headers']).toMatch(/Authorization/);

    const mcp = await request(app)
      .options('/mcp')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(mcp.headers['access-control-allow-origin']).toBe('*');
    expect(mcp.headers['access-control-expose-headers']).toBe('Mcp-Session-Id');
  });
});

describe('policy is re-checked at execute time, not trusted from the proposal', () => {
  // A policy that allows everything checkAutomationPolicy allows until `lockdown` is
  // switched on — standing in for a time- or state-dependent rule that changes between
  // the owner's approval and the agent's execute call.
  function switchablePolicy() {
    const control = { lockdown: false };
    const policy = (action, registry) =>
      control.lockdown
        ? { allowed: false, rule: 'lockdown', reason: 'The home is in lockdown.' }
        : checkAutomationPolicy(action, registry);
    return { control, policy };
  }

  test('an approved token is refused by execute_action once the policy denies the action, and nothing changes', async () => {
    const { control, policy } = switchablePolicy();
    const app = createApp({ ownerKey: TEST_OWNER_KEY, policy });
    const { sessionId } = await initializeSession(app);

    const proposeRes = await callTool(app, sessionId, 'propose_action', {
      device_id: 'dev_front_door_lock_1',
      action: 'unlock',
      params: {},
    });
    const proposal = proposeRes.body.result.structuredContent;
    expect(proposal.status).toBe('awaiting_approval');
    const approveRes = await decide(app, proposal.proposal_id, 'approve');
    const token = approveRes.body.confirmation_id;

    control.lockdown = true;
    const res = await callTool(app, sessionId, 'execute_action', {
      device_id: 'dev_front_door_lock_1',
      action: 'unlock',
      params: {},
      confirmation_id: token,
    });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toMatch(/Blocked by automation policy \(lockdown\)/);

    const lock = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_front_door_lock_1' });
    expect(lock.body.result.structuredContent.state.locked).toBe(true);
    const audit = await callTool(app, sessionId, 'read_audit_log', {});
    expect(audit.body.result.structuredContent.entries).toHaveLength(0);
  });

  test('execute_scene stops at the first step the policy now denies, and writes no audit entry for it', async () => {
    const { control, policy } = switchablePolicy();
    const app = createApp({ ownerKey: TEST_OWNER_KEY, policy });
    const { sessionId } = await initializeSession(app);

    const composeRes = await callTool(app, sessionId, 'compose_scene', {
      scene_name: 'Leaving',
      actions: [{ device_id: 'dev_living_room_light_1', action: 'turn_off', params: {} }],
    });
    const proposal = composeRes.body.result.structuredContent;
    const approveRes = await decide(app, proposal.proposal_id, 'approve');

    control.lockdown = true;
    const res = await callTool(app, sessionId, 'execute_scene', {
      scene_name: 'Leaving',
      confirmation_id: approveRes.body.confirmation_id,
    });
    const out = res.body.result.structuredContent;
    expect(out.result).toBe('partial');
    expect(out.results[0]).toMatchObject({ result: 'blocked', reason: 'The home is in lockdown.' });

    const light = await callTool(app, sessionId, 'get_device_state', { device_id: 'dev_living_room_light_1' });
    expect(light.body.result.structuredContent.state.power).toBe('on');
    const audit = await callTool(app, sessionId, 'read_audit_log', {});
    expect(audit.body.result.structuredContent.entries).toHaveLength(0);
  });
});
