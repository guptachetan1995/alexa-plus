// The SPEC.md section 5 demo script, as data the scripted planner walks turn by turn.
// Device ids match the seeded registry in server/data/devices.json (read fresh, never
// copied, since client/ cannot import server/ files).
//
// Issue #36 registered the server's remaining tools, so every tool call below is real
// (mode: 'real') — there is nothing left to simulate. It also added a genuine
// human-in-the-loop gate: a `kind: 'confirm'` turn pauses the whole conversation and
// waits for planner.js's `onConfirmRequest` hook (wired to the UI's Confirm/Decline
// buttons in app.js) to resolve with the person's actual decision. Nothing after that
// point is scripted in advance — the next turn's `tool.args`, when it is a function,
// reads the outcome (the proposal that was confirmed/declined, and the one-time
// confirmation_id if it was confirmed) out of the running context object planner.js
// builds as it goes.
//
// The script deliberately runs two propose/confirm cycles so the demo shows both
// outcomes of the same gate: dimming the living room light is CONFIRMED and executed;
// turning off the kitchen plug is DECLINED and left untouched (SPEC.md section 5's
// issue #36 amendment).

export const CONVERSATION_SCRIPT = [
  {
    speaker: 'user',
    text: 'Turn on the living room light and set it to 50% brightness, then check the thermostat.',
  },
  {
    speaker: 'agent',
    text: 'Let me see what devices are in the home.',
    tool: { name: 'list_devices', args: {} },
  },
  {
    speaker: 'agent',
    text: "Reading the living room light's current state before proposing a change.",
    tool: { name: 'get_device_state', args: { device_id: 'dev_living_room_light_1' } },
  },
  {
    speaker: 'agent',
    text: 'Checking home automation policy allows dimming this light.',
    tool: {
      name: 'check_automation_policy',
      args: {
        action: { device_id: 'dev_living_room_light_1', action: 'set_brightness', params: { brightness: 50 } },
      },
    },
  },
  {
    speaker: 'agent',
    text: 'Proposing: dim Living Room Overhead to 50% brightness.',
    tool: {
      name: 'propose_action',
      args: { device_id: 'dev_living_room_light_1', action: 'set_brightness', params: { brightness: 50 } },
    },
  },
  {
    speaker: 'system',
    kind: 'confirm',
    contextKey: 'dimLivingRoom',
  },
  {
    speaker: 'agent',
    text: 'Executing the confirmed action.',
    tool: {
      name: 'execute_action',
      args: (ctx) => ({
        device_id: 'dev_living_room_light_1',
        action: 'set_brightness',
        params: { brightness: 50 },
        confirmation_id: ctx.dimLivingRoom.token,
      }),
    },
    runIf: (ctx) => ctx.dimLivingRoom.decision === 'confirm',
  },
  {
    speaker: 'agent',
    text: 'The person declined dimming the living room light — leaving it as-is, nothing changed.',
    runIf: (ctx) => ctx.dimLivingRoom.decision === 'decline',
  },
  {
    speaker: 'agent',
    text: 'Now checking the thermostat.',
    tool: { name: 'get_device_state', args: { device_id: 'dev_thermostat_1' } },
  },
  {
    speaker: 'user',
    text: 'Also turn off the kitchen coffee maker plug.',
  },
  {
    speaker: 'agent',
    text: 'Checking home automation policy allows turning off the kitchen plug.',
    tool: {
      name: 'check_automation_policy',
      args: { action: { device_id: 'dev_kitchen_plug_1', action: 'turn_off', params: {} } },
    },
  },
  {
    speaker: 'agent',
    text: 'Proposing: turn off the Kitchen Coffee Maker Plug.',
    tool: {
      name: 'propose_action',
      args: { device_id: 'dev_kitchen_plug_1', action: 'turn_off', params: {} },
    },
  },
  {
    speaker: 'system',
    kind: 'confirm',
    contextKey: 'turnOffPlug',
  },
  {
    speaker: 'agent',
    text: 'Executing the confirmed action.',
    tool: {
      name: 'execute_action',
      args: (ctx) => ({
        device_id: 'dev_kitchen_plug_1',
        action: 'turn_off',
        params: {},
        confirmation_id: ctx.turnOffPlug.token,
      }),
    },
    runIf: (ctx) => ctx.turnOffPlug.decision === 'confirm',
  },
  {
    speaker: 'agent',
    text: 'Understood — leaving the Kitchen Coffee Maker Plug on, nothing changed.',
    runIf: (ctx) => ctx.turnOffPlug.decision === 'decline',
  },
  {
    speaker: 'agent',
    text: 'Here is the audit log for everything that actually executed this session.',
    tool: { name: 'read_audit_log', args: {} },
  },
];
