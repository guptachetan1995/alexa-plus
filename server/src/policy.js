'use strict';

/**
 * The home's automation policy engine. Pure and stateless: given a proposed action and
 * the device registry to check it against, decide allow/deny and say why. Used both by
 * the `check_automation_policy` tool (an agent can ask in advance) and internally by
 * `execute_action`/`execute_scene` (which re-check at execute time rather than trusting
 * a stale earlier check — see tools.js).
 */
function checkAutomationPolicy({ device_id: deviceId, action, params = {} }, registry) {
  const device = registry.getDevice(deviceId);
  if (!device) {
    return {
      allowed: false,
      rule: 'unknown_device',
      reason: `No device with device_id "${deviceId}" exists in the registry.`,
    };
  }

  if (!device.supported_actions.includes(action)) {
    return {
      allowed: false,
      rule: 'unsupported_action',
      reason: `${device.name} does not support "${action}". Supported actions: ${device.supported_actions.join(', ')}.`,
    };
  }

  if (action === 'set_brightness') {
    const brightness = Number(params.brightness);
    if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
      return {
        allowed: false,
        rule: 'invalid_range',
        reason: 'brightness must be a number between 0 and 100.',
      };
    }
  }

  if (action === 'set_target_temp') {
    const targetTempF = Number(params.target_temp_f);
    if (!Number.isFinite(targetTempF) || targetTempF < 60 || targetTempF > 80) {
      return {
        allowed: false,
        rule: 'energy_limit',
        reason: 'target_temp_f must be between 60 and 80 to stay within the home’s energy policy.',
      };
    }
  }

  return { allowed: true, rule: 'no_restrictions', reason: '' };
}

module.exports = { checkAutomationPolicy };
