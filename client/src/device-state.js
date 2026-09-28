// The device panel's model. It is derived only from tool results the conversation
// already received through McpHttpClient.callTool(): the panel has no network path of
// its own, so it can only show a state the server actually reported, and it changes
// exactly when a real execute_action/execute_scene result says it did.

function patch(devices, deviceId, state) {
  const known = devices[deviceId] || { device_id: deviceId, name: deviceId };
  return { ...devices, [deviceId]: { ...known, state: { ...known.state, ...state } } };
}

/** Folds one completed tool call into the device map; refusals and other tools change nothing. */
export function applyToolResult(devices, tool) {
  const data = tool?.result?.structuredContent;
  if (!data || tool.result.isError) return devices;
  switch (tool.name) {
    case 'list_devices':
      return data.devices.reduce((next, d) => ({ ...next, [d.device_id]: { ...d } }), devices);
    case 'get_device_state':
      return patch(devices, data.device_id, data.state);
    case 'execute_action':
      return patch(devices, data.device_id, data.new_state);
    case 'execute_scene':
      return data.results
        .filter((r) => r.result === 'success')
        .reduce((next, r) => patch(next, r.device_id, r.new_state), devices);
    default:
      return devices;
  }
}

/** Device map for a conversation so far, plus the ids the latest execute actually changed. */
export function devicesFromTurns(turns) {
  let devices = {};
  let changed = [];
  for (const turn of turns) {
    if (!turn.tool) continue;
    devices = applyToolResult(devices, turn.tool);
    const data = turn.tool.result?.structuredContent;
    if (turn.tool.result?.isError || !data) continue;
    if (turn.tool.name === 'execute_action') changed = [data.device_id];
    if (turn.tool.name === 'execute_scene') {
      changed = data.results.filter((r) => r.result === 'success').map((r) => r.device_id);
    }
  }
  return { devices: Object.values(devices), changed };
}

/** One short line a person can read at a glance, per device type. */
export function summarizeState(device) {
  const s = device.state || {};
  switch (device.type) {
    case 'light':
      return s.power === 'on' ? `On · ${s.brightness}%` : 'Off';
    case 'thermostat':
      return s.power === 'on' ? `${s.mode} · set ${s.target_temp_f}°F` : 'Off';
    case 'lock':
      return s.locked ? 'Locked' : 'Unlocked';
    case 'plug':
      return s.power === 'on' ? 'On' : 'Off';
    default:
      return JSON.stringify(s);
  }
}

/** One line saying what a successful tool result means, shown above its collapsed JSON. */
export function summarizeResult(name, data) {
  if (!data) return '';
  switch (name) {
    case 'list_devices':
      return `${data.devices.length} device${data.devices.length === 1 ? '' : 's'}`;
    case 'get_device_state':
      return `${data.device_id}: ${JSON.stringify(data.state)}`;
    case 'check_automation_policy':
      return data.allowed ? `allowed (${data.rule})` : `denied (${data.rule}): ${data.reason}`;
    case 'propose_action':
    case 'compose_scene':
      return `proposal ${data.status}`;
    case 'execute_action':
      return `${data.result}: ${data.device_id} is now ${JSON.stringify(data.new_state)}`;
    case 'execute_scene':
      return `${data.result}: ${data.results.length} step(s) run`;
    case 'read_audit_log': {
      const n = data.entries.length;
      const list = data.entries.map((e) => `${e.action} on ${e.device_id} by ${e.actor}`).join('; ');
      return `${n} entr${n === 1 ? 'y' : 'ies'}${n ? `: ${list}` : ''}`;
    }
    default:
      return '';
  }
}
