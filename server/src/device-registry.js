'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEVICES_PATH = path.join(__dirname, '..', 'data', 'devices.json');

/** Computes the state patch for one supported_action, or throws for an invalid one. */
function computeStatePatch(device, action, params) {
  switch (action) {
    case 'turn_on':
      return { power: 'on' };
    case 'turn_off':
      return { power: 'off' };
    case 'set_brightness': {
      const brightness = Number(params.brightness);
      if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
        throw new Error('brightness must be a number between 0 and 100.');
      }
      return { brightness };
    }
    case 'set_color_temp': {
      const colorTempK = Number(params.color_temp_k);
      if (!Number.isFinite(colorTempK)) {
        throw new Error('color_temp_k must be a number.');
      }
      return { color_temp_k: colorTempK };
    }
    case 'set_target_temp': {
      const targetTempF = Number(params.target_temp_f);
      if (!Number.isFinite(targetTempF)) {
        throw new Error('target_temp_f must be a number.');
      }
      return { target_temp_f: targetTempF };
    }
    case 'set_mode': {
      if (typeof params.mode !== 'string' || params.mode.length === 0) {
        throw new Error('mode must be a non-empty string.');
      }
      return { mode: params.mode };
    }
    case 'lock':
      return { locked: true };
    case 'unlock':
      return { locked: false };
    default:
      throw new Error(`Unrecognized action "${action}".`);
  }
}

/**
 * View over the seeded device registry. Reads (`listDevices`/`getDevice`) never
 * mutate. `applyAction` (added by issue #36 — the propose/confirm/execute tools are
 * the only callers, and only after a confirmed proposal) is the one write path: it
 * replaces a device entry with a new, independently-frozen snapshot rather than
 * mutating fields in place, so any earlier snapshot a caller is still holding (e.g. an
 * in-flight audit entry) stays exactly as it was read.
 */
class DeviceRegistry {
  constructor(devicesPath = DEVICES_PATH) {
    const raw = fs.readFileSync(devicesPath, 'utf8');
    this._devices = JSON.parse(raw).map((d) => Object.freeze(d));
  }

  /** All devices, optionally filtered by exact room name (case-insensitive). */
  listDevices(room) {
    if (room === undefined || room === null || room === '') {
      return this._devices.slice();
    }
    const wanted = String(room).toLowerCase();
    return this._devices.filter((d) => d.room.toLowerCase() === wanted);
  }

  /** A single device by id, or undefined if it does not exist. */
  getDevice(deviceId) {
    return this._devices.find((d) => d.device_id === deviceId);
  }

  /**
   * Applies one supported_action to a device's state and returns the updated device.
   * Throws (never returns a partial/invalid device) if the device is unknown, the
   * action isn't in its supported_actions, or a param is out of range — callers (the
   * mutating tools in tools.js) catch this and turn it into a narrated isError result.
   */
  applyAction(deviceId, action, params = {}) {
    const index = this._devices.findIndex((d) => d.device_id === deviceId);
    if (index === -1) {
      throw new Error(`No device with device_id "${deviceId}" exists in the registry.`);
    }
    const device = this._devices[index];
    if (!device.supported_actions.includes(action)) {
      throw new Error(
        `${device.name} does not support "${action}". Supported actions: ${device.supported_actions.join(', ')}.`
      );
    }
    const patch = computeStatePatch(device, action, params);
    const updated = Object.freeze({
      ...device,
      state: Object.freeze({ ...device.state, ...patch }),
      last_updated: new Date().toISOString(),
    });
    this._devices[index] = updated;
    return updated;
  }
}

module.exports = { DeviceRegistry, DEVICES_PATH };
