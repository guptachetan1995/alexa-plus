'use strict';

const { z } = require('zod');
const { checkAutomationPolicy } = require('./policy.js');

const actionArgsSchema = z.object({
  device_id: z.string().min(1).describe('The device_id to act on, as returned by list_devices.'),
  action: z.string().min(1).describe('One of the device’s supported_actions (see list_devices).'),
  params: z
    .record(z.string(), z.any())
    .optional()
    .default({})
    .describe('Action-specific parameters, e.g. {"brightness": 50} for set_brightness.'),
});

/** A narrated tool-execution error result (isError: true), never a bare protocol error. */
function errorResult(text) {
  return { isError: true, content: [{ type: 'text', text }] };
}

function okResult(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/**
 * Registers the four read-only tools this server exposes. Descriptions are written for
 * a model that cannot see the device registry or any UI: each one states what the tool
 * returns AND what it explicitly will not do, so a planner does not assume side effects
 * (or freshness guarantees) that do not exist.
 */
function registerReadOnlyTools(server, { registry, audit }) {
  server.registerTool(
    'list_devices',
    {
      title: 'List smart home devices',
      description:
        'Return every connected smart home device, or only the devices in one room ' +
        'when a room name is given. Each device in the result includes its device_id, ' +
        'name, type (light, thermostat, lock, or plug), room, current state, and the ' +
        'list of capabilities and supported_actions it exposes. This tool does NOT ' +
        'control, turn on/off, or otherwise change any device; it does NOT create or ' +
        'remove devices from the registry; and it does NOT guess at devices that are ' +
        'not in the seeded registry. If a room name matches no device, it returns an ' +
        'empty list rather than an error.',
      inputSchema: {
        room: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Exact room name to filter by (e.g. "living room", "bedroom", "kitchen"), ' +
              'case-insensitive. Omit to list every device in the home.'
          ),
      },
    },
    async ({ room }) => {
      const devices = registry.listDevices(room);
      return okResult({ devices });
    }
  );

  server.registerTool(
    'get_device_state',
    {
      title: 'Get one device’s current state',
      description:
        'Return the current state (e.g. power, brightness, temperature, lock status) ' +
        'and the last_updated timestamp for exactly one device, looked up by its ' +
        'device_id. This tool does NOT change any device state, does NOT cache or ' +
        'memoize the result for later calls, and does NOT predict or estimate a ' +
        'future state — every call re-reads the current record. If device_id does ' +
        'not exist in the registry, the tool reports an error result rather than ' +
        'guessing at a plausible state; call list_devices first to find valid ids.',
      inputSchema: {
        device_id: z
          .string()
          .min(1)
          .describe('The device_id of the device to read, as returned by list_devices.'),
      },
    },
    async ({ device_id: deviceId }) => {
      const device = registry.getDevice(deviceId);
      if (!device) {
        return errorResult(
          `No device with device_id "${deviceId}" exists in the registry. Call list_devices to see valid ids.`
        );
      }
      return okResult({
        device_id: device.device_id,
        state: device.state,
        last_updated: device.last_updated,
      });
    }
  );

  server.registerTool(
    'check_automation_policy',
    {
      title: 'Check whether the home’s automation policy allows a proposed action',
      description:
        'Verify a proposed device action against the home’s automation policy (energy ' +
        'limits, unsupported actions, unknown devices) BEFORE proposing it. Returns ' +
        '{allowed, rule, reason}. This tool does NOT execute the action, does NOT ' +
        'override or change the policy, and does NOT write an audit entry — it is a ' +
        'read-only advisory check. `execute_action`/`execute_scene` re-check the same ' +
        'policy themselves at execute time, so calling this first cannot be used to ' +
        'bypass a later denial; it only lets an agent avoid proposing something the ' +
        'policy will refuse anyway.',
      inputSchema: {
        action: actionArgsSchema.describe(
          'The action to check: {device_id, action, params}, same shape as propose_action’s arguments.'
        ),
      },
    },
    async ({ action }) => okResult(checkAutomationPolicy(action, registry))
  );

  server.registerTool(
    'read_audit_log',
    {
      title: 'Read the home automation audit log',
      description:
        'Return audit entries — one per executed device action — newest first, ' +
        'optionally filtered to a single device_id and capped at `limit` (default 50). ' +
        'Each entry has timestamp, device_id, action, params, actor ("user" for every ' +
        'entry today, since every mutation requires a confirmed proposal), reason, ' +
        'result, and the device’s new_state after the action. This tool does NOT write, ' +
        'delete, or redact entries, and does NOT include proposals that were declined ' +
        'or never confirmed — only actions that actually executed.',
      inputSchema: {
        device_id: z
          .string()
          .min(1)
          .optional()
          .describe('Restrict to one device’s entries. Omit for every device.'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(50)
          .describe('Maximum number of entries to return (default 50).'),
      },
    },
    async ({ device_id: deviceId, limit }) => okResult({ entries: audit.list({ device_id: deviceId, limit }) })
  );
}

/**
 * Registers the propose/confirm/execute tool pairs. Mutating a device only ever
 * happens inside `execute_action`/`execute_scene`, and only for a `confirmation_id`
 * that resolves — via the shared `proposals` store — to a proposal the owner-only
 * REST routes in server.js already approved. Nothing in this file ever mints a
 * confirmation token; see proposals.js for why that guarantee holds.
 */
function registerMutatingTools(server, { registry, proposals, audit }) {
  server.registerTool(
    'propose_action',
    {
      title: 'Propose a single-device action for the person to review',
      description:
        'Describe a proposed action on one device in a structured proposal (expected ' +
        'outcome, rationale, and the automation-policy check) for a person to review ' +
        'and confirm in the client UI. Returns {proposal_id, status, expected_outcome, ' +
        'rationale, policy_check}. This tool does NOT execute anything, does NOT change ' +
        'any device state, does NOT assume the person approves, and does NOT itself ' +
        'produce a usable confirmation token — only the person confirming the proposal ' +
        'in the client mints one. If the automation policy already denies the action, ' +
        'the proposal is still created (for visibility) but its status is ' +
        '"blocked_by_policy" and it can never be approved; call check_automation_policy ' +
        'first to avoid proposing something that cannot proceed.',
      inputSchema: {
        device_id: z.string().min(1).describe('The device_id to act on.'),
        action: z.string().min(1).describe('One of the device’s supported_actions.'),
        params: z
          .record(z.string(), z.any())
          .optional()
          .default({})
          .describe('Action-specific parameters, e.g. {"brightness": 50}.'),
      },
    },
    async ({ device_id: deviceId, action, params }) => {
      const device = registry.getDevice(deviceId);
      if (!device) {
        return errorResult(
          `No device with device_id "${deviceId}" exists in the registry. Call list_devices to see valid ids.`
        );
      }
      const policyCheck = checkAutomationPolicy({ device_id: deviceId, action, params }, registry);
      const proposal = proposals.createAction({
        device_id: deviceId,
        action,
        params,
        expectedOutcome: policyCheck.allowed
          ? `${device.name} will have ${action} applied with ${JSON.stringify(params)}.`
          : 'No change — this action is blocked by automation policy.',
        rationale: `Requested ${action} on ${device.name} (${device.room}).`,
        policyCheck,
      });
      return okResult(proposal);
    }
  );

  server.registerTool(
    'execute_action',
    {
      title: 'Execute a previously proposed action, if the person confirmed it',
      description:
        'Execute a device action, but ONLY when `confirmation_id` is a one-time token ' +
        'that the person’s Confirm control in the client already minted for this exact ' +
        'device_id/action/params. Writes an audit entry (actor: "user") and returns the ' +
        'device’s new_state. This tool does NOT execute without a valid, matching, ' +
        'unused confirmation_id; does NOT accept a confirmation_id approved for a ' +
        'different action; and does NOT override the automation policy, which is ' +
        're-checked at execute time even if it passed earlier. Every refusal comes back ' +
        'as an isError result with a specific, narrated reason — never a silent no-op.',
      inputSchema: {
        device_id: z.string().min(1),
        action: z.string().min(1),
        params: z.record(z.string(), z.any()).optional().default({}),
        confirmation_id: z
          .string()
          .min(1)
          .optional()
          .describe(
            'The one-time token from the person confirming this exact proposal in the ' +
              'client. Omitting it always refuses the call.'
          ),
      },
    },
    async ({ device_id: deviceId, action, params, confirmation_id: confirmationId }) => {
      if (!confirmationId) {
        return errorResult(
          'execute_action requires a confirmation_id minted by the person confirming a ' +
            'pending proposal in the client. Call propose_action first and wait for ' +
            'their decision — this call was refused, nothing changed.'
        );
      }
      const proposal = proposals.findByToken(confirmationId);
      if (!proposal || proposal.kind !== 'action') {
        return errorResult(
          `No matching pending proposal for confirmation_id "${confirmationId}". It may ` +
            'be invalid, already used, or the proposal it belonged to was never ' +
            'approved — nothing changed.'
        );
      }
      if (proposal.status !== 'approved') {
        return errorResult(
          `Proposal "${proposal.proposal_id}" is ${proposal.status}, not approved — a ` +
            'confirmation_id only works once, immediately after approval. Nothing changed.'
        );
      }
      if (
        proposal.device_id !== deviceId ||
        proposal.action !== action ||
        JSON.stringify(proposal.params) !== JSON.stringify(params)
      ) {
        return errorResult(
          `confirmation_id "${confirmationId}" was approved for a different action ` +
            `(device_id "${proposal.device_id}", action "${proposal.action}"), not for ` +
            `device_id "${deviceId}", action "${action}". Nothing changed.`
        );
      }
      const policyCheck = checkAutomationPolicy({ device_id: deviceId, action, params }, registry);
      if (!policyCheck.allowed) {
        return errorResult(
          `Blocked by automation policy (${policyCheck.rule}): ${policyCheck.reason} Nothing changed.`
        );
      }

      let device;
      try {
        device = registry.applyAction(deviceId, action, params);
      } catch (err) {
        return errorResult(`${err.message} Nothing changed.`);
      }

      proposals.markExecuted(proposal.proposal_id);
      const entry = audit.record({
        device_id: deviceId,
        action,
        params,
        actor: 'user',
        reason: `User approved via ${proposal.proposal_id}`,
        result: 'success',
        new_state: device.state,
      });
      return okResult({
        device_id: deviceId,
        new_state: device.state,
        result: 'success',
        audit_entry_id: entry.entry_id,
      });
    }
  );

  server.registerTool(
    'compose_scene',
    {
      title: 'Propose a multi-device scene for the person to review',
      description:
        'Propose a named, multi-device scene (e.g. "Good Night": lock the front door, ' +
        'turn off the lights, set the thermostat) as one structured proposal covering ' +
        'every listed action, each checked against automation policy. Returns ' +
        '{proposal_id, scene_name, status, actions, policy_checks}. This tool does NOT ' +
        'execute anything, does NOT persist the scene for reuse beyond this one ' +
        'proposal, and does NOT assume approval. If ANY action in the scene is denied ' +
        'by policy, the whole scene proposal is "blocked_by_policy" and cannot be ' +
        'approved — approve/execute is all-or-nothing at the scene level.',
      inputSchema: {
        scene_name: z.string().min(1).describe('A short, human-readable name for the scene, e.g. "Good Night".'),
        actions: z
          .array(
            z.object({
              device_id: z.string().min(1),
              action: z.string().min(1),
              params: z.record(z.string(), z.any()).optional().default({}),
            })
          )
          .min(1)
          .describe('The devices actions this scene will apply, executed in this order.'),
      },
    },
    async ({ scene_name: sceneName, actions }) => {
      const policyChecks = actions.map((a) => checkAutomationPolicy(a, registry));
      const proposal = proposals.createScene({ sceneName, actions, policyChecks });
      return okResult(proposal);
    }
  );

  server.registerTool(
    'execute_scene',
    {
      title: 'Execute a previously proposed scene, if the person confirmed it',
      description:
        'Execute every action in a proposed scene, in order, but ONLY when ' +
        '`confirmation_id` is a one-time token the person’s Confirm control already ' +
        'minted for this exact scene_name. Writes one audit entry per successfully ' +
        'executed device action (actor: "user"). This tool does NOT execute without a ' +
        'valid, matching, unused confirmation_id; does NOT skip the policy re-check at ' +
        'execute time; and does NOT roll back actions that already succeeded if a later ' +
        'action in the same scene fails — it stops at the first failure and reports ' +
        'exactly how far it got.',
      inputSchema: {
        scene_name: z.string().min(1),
        confirmation_id: z
          .string()
          .min(1)
          .optional()
          .describe('The one-time token from the person confirming this exact scene proposal.'),
      },
    },
    async ({ scene_name: sceneName, confirmation_id: confirmationId }) => {
      if (!confirmationId) {
        return errorResult(
          'execute_scene requires a confirmation_id minted by the person confirming a ' +
            'pending scene proposal in the client. Call compose_scene first and wait ' +
            'for their decision — this call was refused, nothing changed.'
        );
      }
      const proposal = proposals.findByToken(confirmationId);
      if (!proposal || proposal.kind !== 'scene') {
        return errorResult(
          `No matching pending scene proposal for confirmation_id "${confirmationId}". ` +
            'It may be invalid, already used, or the proposal it belonged to was never ' +
            'approved — nothing changed.'
        );
      }
      if (proposal.status !== 'approved') {
        return errorResult(
          `Scene proposal "${proposal.proposal_id}" is ${proposal.status}, not approved ` +
            '— a confirmation_id only works once, immediately after approval. Nothing changed.'
        );
      }
      if (proposal.scene_name !== sceneName) {
        return errorResult(
          `confirmation_id "${confirmationId}" was approved for scene ` +
            `"${proposal.scene_name}", not "${sceneName}". Nothing changed.`
        );
      }

      proposals.markExecuted(proposal.proposal_id);
      const results = [];
      for (const step of proposal.actions) {
        const policyCheck = checkAutomationPolicy(step, registry);
        if (!policyCheck.allowed) {
          results.push({ ...step, result: 'blocked', reason: policyCheck.reason });
          break;
        }
        let device;
        try {
          device = registry.applyAction(step.device_id, step.action, step.params);
        } catch (err) {
          results.push({ ...step, result: 'error', reason: err.message });
          break;
        }
        const entry = audit.record({
          device_id: step.device_id,
          action: step.action,
          params: step.params,
          actor: 'user',
          reason: `User approved scene "${sceneName}" via ${proposal.proposal_id}`,
          result: 'success',
          new_state: device.state,
        });
        results.push({ ...step, result: 'success', new_state: device.state, audit_entry_id: entry.entry_id });
      }

      const allSucceeded = results.length === proposal.actions.length && results.every((r) => r.result === 'success');
      return okResult({
        scene_name: sceneName,
        proposal_id: proposal.proposal_id,
        results,
        result: allSucceeded ? 'success' : 'partial',
      });
    }
  );
}

module.exports = { registerReadOnlyTools, registerMutatingTools };
