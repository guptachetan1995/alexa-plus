'use strict';

// Direct unit coverage for policy.js's deny branches (SPEC.md section 8: "Policy
// tests: Verify the policy engine correctly allows/blocks actions based on configured
// rules"). The propose/execute tests elsewhere only exercise the allow path plus one
// energy-limit denial in passing — this file is the dedicated one.

const { checkAutomationPolicy } = require('../src/policy.js');
const { DeviceRegistry } = require('../src/device-registry.js');

describe('checkAutomationPolicy', () => {
  const registry = new DeviceRegistry();

  test('denies an unknown device with a narrated reason', () => {
    const result = checkAutomationPolicy({ device_id: 'nope', action: 'turn_on', params: {} }, registry);
    expect(result.allowed).toBe(false);
    expect(result.rule).toBe('unknown_device');
    expect(result.reason).toMatch(/nope/);
  });

  test('denies an action the device does not support', () => {
    const result = checkAutomationPolicy(
      { device_id: 'dev_front_door_lock_1', action: 'set_brightness', params: { brightness: 50 } },
      registry
    );
    expect(result.allowed).toBe(false);
    expect(result.rule).toBe('unsupported_action');
    expect(result.reason).toMatch(/Front Door Lock/);
  });

  test('denies set_brightness outside 0-100', () => {
    const tooHigh = checkAutomationPolicy(
      { device_id: 'dev_living_room_light_1', action: 'set_brightness', params: { brightness: 150 } },
      registry
    );
    expect(tooHigh.allowed).toBe(false);
    expect(tooHigh.rule).toBe('invalid_range');

    const negative = checkAutomationPolicy(
      { device_id: 'dev_living_room_light_1', action: 'set_brightness', params: { brightness: -1 } },
      registry
    );
    expect(negative.allowed).toBe(false);
    expect(negative.rule).toBe('invalid_range');
  });

  test('denies set_target_temp outside the 60-80F energy limit', () => {
    const tooHot = checkAutomationPolicy(
      { device_id: 'dev_thermostat_1', action: 'set_target_temp', params: { target_temp_f: 95 } },
      registry
    );
    expect(tooHot.allowed).toBe(false);
    expect(tooHot.rule).toBe('energy_limit');

    const tooCold = checkAutomationPolicy(
      { device_id: 'dev_thermostat_1', action: 'set_target_temp', params: { target_temp_f: 40 } },
      registry
    );
    expect(tooCold.allowed).toBe(false);
    expect(tooCold.rule).toBe('energy_limit');
  });

  test('allows set_target_temp within 60-80F, and lock/unlock on a lock device', () => {
    const withinLimit = checkAutomationPolicy(
      { device_id: 'dev_thermostat_1', action: 'set_target_temp', params: { target_temp_f: 72 } },
      registry
    );
    expect(withinLimit).toEqual({ allowed: true, rule: 'no_restrictions', reason: '' });

    const lockAction = checkAutomationPolicy(
      { device_id: 'dev_front_door_lock_1', action: 'unlock', params: {} },
      registry
    );
    expect(lockAction).toEqual({ allowed: true, rule: 'no_restrictions', reason: '' });
  });
});
