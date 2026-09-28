// Unit tests for the device panel's model (client/src/device-state.js). The panel is fed
// only by tool results the conversation already received, so what matters is that a
// refusal changes nothing and a real execute result changes exactly its device.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyToolResult, devicesFromTurns, summarizeResult, summarizeState } from '../src/device-state.js';

const listed = {
  name: 'list_devices',
  result: {
    structuredContent: {
      devices: [
        { device_id: 'l1', name: 'Lamp', type: 'light', room: 'den', state: { power: 'on', brightness: 100 } },
        { device_id: 'd1', name: 'Door', type: 'lock', room: 'hall', state: { locked: true } },
      ],
    },
  },
};

test('a refusal leaves the panel untouched; a real execute result changes exactly its device', () => {
  const refused = {
    name: 'execute_action',
    result: { isError: true, content: [{ type: 'text', text: 'refused' }] },
  };
  const executed = {
    name: 'execute_action',
    result: { structuredContent: { device_id: 'l1', new_state: { power: 'on', brightness: 50 }, result: 'success' } },
  };

  const afterRefusal = devicesFromTurns([{ tool: listed }, { tool: refused }]);
  assert.deepEqual(afterRefusal.changed, []);
  assert.equal(afterRefusal.devices.find((d) => d.device_id === 'l1').state.brightness, 100);

  const afterExecute = devicesFromTurns([{ tool: listed }, { tool: refused }, { tool: executed }]);
  assert.deepEqual(afterExecute.changed, ['l1']);
  assert.equal(afterExecute.devices.find((d) => d.device_id === 'l1').state.brightness, 50);
  assert.equal(afterExecute.devices.find((d) => d.device_id === 'd1').state.locked, true);

  assert.equal(applyToolResult({}, { name: 'read_audit_log', result: { structuredContent: { entries: [] } } }).l1, undefined);

  assert.equal(summarizeState({ type: 'light', state: { power: 'on', brightness: 50 } }), 'On · 50%');
  assert.equal(summarizeState({ type: 'light', state: { power: 'off', brightness: 0 } }), 'Off');
  assert.equal(summarizeState({ type: 'lock', state: { locked: true } }), 'Locked');
  assert.equal(summarizeState({ type: 'lock', state: { locked: false } }), 'Unlocked');
  assert.equal(summarizeState({ type: 'thermostat', state: { power: 'on', mode: 'heat', target_temp_f: 70 } }), 'heat · set 70°F');
  assert.equal(summarizeState({ type: 'plug', state: { power: 'off' } }), 'Off');

  assert.equal(summarizeResult('list_devices', listed.result.structuredContent), '2 devices');
  assert.equal(
    summarizeResult('read_audit_log', {
      entries: [{ action: 'set_brightness', device_id: 'l1', actor: 'user' }],
    }),
    '1 entry: set_brightness on l1 by user'
  );
  assert.equal(summarizeResult('check_automation_policy', { allowed: false, rule: 'energy_limit', reason: 'too hot' }), 'denied (energy_limit): too hot');
});
