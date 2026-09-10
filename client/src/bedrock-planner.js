// The Bedrock (AWS Converse API) tool-use-loop planner (SPEC.md section 10, #122): the
// model chooses which tools to call and in what order, in place of planner.js's fixed
// script — but it still has to reach every tool through the exact same
// `mcpClient.callTool()` chokepoint (CLAUDE.md "Agent and human share one surface"), and
// it still has to pass through the exact same human confirm gate to mint a token
// (planner.js's header explains why that gate is never a tool call). This file is the
// only place those two guarantees are re-proven for a reasoning planner instead of a
// scripted one.
//
// The hard invariant: the model can reason about anything, but it can never (a) mint its
// own confirmation_id, (b) redirect an execution to a different device/action/params
// than what was actually proposed and confirmed, (c) replay a confirmation token twice,
// or (d) clobber one pending proposal with another when two are in flight before either
// executes. All four are enforced by `confirmedProposals`, a Map keyed by proposal_id
// that is LOCAL to each call of runBedrockConversation (never module-level — this must
// be per-conversation state, not shared across concurrent conversations or tests). Only
// this function's own code ever writes to it, and only with values it read directly off
// the real `mcpClient.approveProposal()` response — never off anything the model said.
//
// Tool-call contract for execute_action/execute_scene (this file's own design choice,
// not an MCP-server requirement): the model is instructed, via the system prompt below,
// to call execute_action/execute_scene with ONLY `{ proposal_id }` — the id returned by
// the propose_action/compose_scene call it is executing. Any other field the model
// includes (device_id, action, params, scene_name, confirmation_id) is read from the
// tool-use input and then thrown away; only `proposal_id` is ever looked at, and it is
// used solely as a lookup key into `confirmedProposals`. The device_id/action/params/
// confirmation_id actually sent to the real server always come from what that map holds
// — i.e. from what a person really confirmed — never from the model's tool-call
// arguments. propose_action/compose_scene are the one exception: the model's args there
// are passed straight through, because they are harmless (just a proposed device_id/
// action/params, no token involved) — proposing something is not executing it.
//
// #130: this file imports NO AWS SDK code and holds NO AWS credential. A real browser
// tab cannot resolve `@aws-sdk/client-bedrock-runtime`'s bare import (no bundler here,
// see index.html's import map), and even patching that around, the SDK's default
// credential chain (env vars, `~/.aws/credentials`, IMDS) is Node-only and always
// crashes in a browser — confirmed live by actually opening this client in a real tab.
// There is also no *safe* fix that keeps the call here: shipping a real AWS credential
// to browser-served code would expose it to anyone who opens dev tools. So the default
// `bedrockClient` below is a thin same-origin proxy (`defaultBedrockClient()`) — the
// real `BedrockRuntimeClient`/`ConverseCommand` now live only in server.js, which runs
// under Node and can resolve credentials the normal, safe way. Everything below this
// point (the confirm-gate loop, `confirmedProposals`, the tool-schema override) is
// unchanged and still never touches AWS — it only ever needs `bedrockClient.send(cmd)`
// to return a Converse-shaped `{ output, stopReason }`, which the proxy still does.

/**
 * The default `bedrockClient`: POSTs the Converse request to this same origin's
 * `/bedrock/converse` (see server.js) instead of calling AWS directly. Tests and the
 * (never-shipped) direct-AWS path both go through `opts.bedrockClient` instead — this
 * function is only ever reached when a caller supplies neither.
 */
function defaultBedrockClient() {
  return {
    async send(command) {
      const res = await fetch('/bedrock/converse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Bedrock proxy returned HTTP ${res.status}.`);
      }
      return body;
    },
  };
}

// Cheapest Bedrock model confirmed to support Converse tool-use as of 2026-09-10
// ($0.035/$0.14 per 1M input/output tokens — see entries/alexa-plus/SPEC.md section 10
// for the comparison against Claude Haiku 4.5 and Nova Lite that led here). Anthropic's
// own Claude 3.5 Sonnet was the original default but no longer appears in Bedrock's
// supported-models list at all.
export const DEFAULT_MODEL_ID = 'amazon.nova-micro-v1:0';

const DEFAULT_USER_REQUEST =
  'Turn on the living room light and set it to 50% brightness, then check the thermostat.';

const SYSTEM_PROMPT = [
  'You are the planning agent for the alexa-plus simulated smart-home client.',
  'You may call list_devices, get_device_state, check_automation_policy, and read_audit_log freely — they never change anything.',
  'To change a device, call propose_action (one device) or compose_scene (multiple devices). Never call execute_action or execute_scene for a change you have not proposed first.',
  'The propose_action/compose_scene tool result reports back {"proposal_id", "status": "confirmed" | "declined"} once a person has reviewed it in the client — you cannot see or influence that decision, and it is made exactly once.',
  'To execute a confirmed proposal, call execute_action or execute_scene with ONLY {"proposal_id": "<the proposal_id from the propose/compose step>"}. Do not include device_id, action, params, scene_name, or confirmation_id in that call — the client ignores them and uses only the real, already-approved values it holds.',
  'If a proposal was declined, or you never proposed it, do not attempt to execute it — the call will be refused with no effect.',
].join(' ');

const PROPOSE_TOOLS = new Set(['propose_action', 'compose_scene']);
const EXECUTE_KIND_BY_TOOL = { execute_action: 'action', execute_scene: 'scene' };

// The real server's execute_action/execute_scene schemas (from tools/list) declare
// device_id/action/scene_name/confirmation_id as their real, required input — because a
// caller going through mcp-client.js directly (the scripted planner, a person using the
// MCP Inspector) supplies those for real. This planner is different: per the tool-call
// contract in the header above, the model is only ever supposed to send `proposal_id`,
// and handleToolUse() ignores anything else it sends anyway. If we handed Bedrock the
// raw server schema, a model that (correctly, per Converse's own contract) treats
// `required` as binding would keep trying to invent device_id/action/confirmation_id to
// satisfy it instead of ever emitting proposal_id — so the execute half of the loop
// would never fire. These narrower, hand-written schemas are what's actually declared to
// the model for these two tools; the server-declared schema is used for every other tool
// unmodified.
const EXECUTE_TOOL_SPEC_OVERRIDE = {
  execute_action: {
    type: 'object',
    properties: {
      proposal_id: {
        type: 'string',
        description: 'The proposal_id returned by propose_action for the action you are executing.',
      },
    },
    required: ['proposal_id'],
  },
  execute_scene: {
    type: 'object',
    properties: {
      proposal_id: {
        type: 'string',
        description: 'The proposal_id returned by compose_scene for the scene you are executing.',
      },
    },
    required: ['proposal_id'],
  },
};

function refusalContent(text) {
  return { error: text };
}

function toolResultJson(result) {
  return result.isError
    ? refusalContent(result.content?.[0]?.text ?? 'Tool call refused.')
    : result.structuredContent;
}

/**
 * Handles one toolUse block. `confirmedProposals` is the calling conversation's Map —
 * threaded through explicitly (never closed over a module-level variable) so it can
 * never leak between concurrent conversations.
 */
async function handleToolUse({ mcpClient, name, input, onConfirmRequest, onTurn, confirmedProposals }) {
  if (PROPOSE_TOOLS.has(name)) {
    const result = await mcpClient.callTool(name, input ?? {});
    if (result.isError) {
      return toolResultJson(result);
    }
    const proposal = result.structuredContent;
    // Always ask — even a policy-blocked proposal goes through the same gate, matching
    // planner.js's confirm turn (the client-side Confirm button is already disabled for
    // a blocked proposal; approveProposal() below refuses it server-side regardless).
    const decision = await onConfirmRequest(proposal);
    const confirmTurn = { speaker: 'system', kind: 'confirm', proposal, decision };
    if (onTurn) onTurn(confirmTurn);

    if (decision === 'confirm') {
      const approval = await mcpClient.approveProposal(proposal.proposal_id);
      const entry =
        name === 'compose_scene'
          ? { kind: 'scene', scene_name: proposal.scene_name, confirmation_id: approval.confirmation_id }
          : {
              kind: 'action',
              device_id: proposal.device_id,
              action: proposal.action,
              params: proposal.params,
              confirmation_id: approval.confirmation_id,
            };
      confirmedProposals.set(proposal.proposal_id, entry);
      return { proposal_id: proposal.proposal_id, status: 'confirmed' };
    }
    if (decision === 'decline') {
      await mcpClient.rejectProposal(proposal.proposal_id);
      return { proposal_id: proposal.proposal_id, status: 'declined' };
    }
    throw new Error(`onConfirmRequest must resolve to "confirm" or "decline", got "${decision}".`);
  }

  const executeKind = EXECUTE_KIND_BY_TOOL[name];
  if (executeKind) {
    const proposalId = input?.proposal_id;
    const held = proposalId ? confirmedProposals.get(proposalId) : undefined;
    if (!held || held.kind !== executeKind) {
      return refusalContent(
        'No confirmed proposal found for that id — propose and wait for confirmation first.'
      );
    }
    const result =
      name === 'execute_action'
        ? await mcpClient.callTool('execute_action', {
            device_id: held.device_id,
            action: held.action,
            params: held.params,
            confirmation_id: held.confirmation_id,
          })
        : await mcpClient.callTool('execute_scene', {
            scene_name: held.scene_name,
            confirmation_id: held.confirmation_id,
          });
    // One-shot: a confirmed proposal is consumed the moment it is used, matching the
    // server's own one-time confirmation_id semantics — a replay attempt now finds
    // nothing in the map either.
    confirmedProposals.delete(proposalId);
    return toolResultJson(result);
  }

  // Read-only tools (list_devices, get_device_state, check_automation_policy,
  // read_audit_log): the model's args are passed straight through, no gate.
  const result = await mcpClient.callTool(name, input ?? {});
  return toolResultJson(result);
}

/**
 * Runs a Bedrock Converse tool-use loop against a live MCP server, in place of
 * planner.js's fixed script. `onTurn`/`onConfirmRequest` have the same contract as
 * runConversation() — the confirm turn is shaped identically (`{speaker:'system',
 * kind:'confirm', proposal, decision}`) so app.js's existing Turn/ConfirmOutcome
 * components render it with zero changes.
 */
export async function runBedrockConversation(mcpClient, opts = {}) {
  const {
    modelId = DEFAULT_MODEL_ID,
    userRequest = DEFAULT_USER_REQUEST,
    onTurn,
    onConfirmRequest = async () => 'confirm',
    maxIterations = 10,
  } = opts;
  // #130: which AWS region to call is server.js's decision now (it constructs the real
  // client), not this browser-side loop's — there is no `region` option here any more.
  // Only ever the proxy when the caller doesn't supply one. Every test supplies its own
  // bedrockClient, so defaultBedrockClient()'s fetch() never runs under test.
  const bedrockClient = opts.bedrockClient || defaultBedrockClient();

  await mcpClient.initialize();
  const { tools } = await mcpClient.listTools();
  const toolConfig = {
    tools: tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: EXECUTE_TOOL_SPEC_OVERRIDE[tool.name] || tool.inputSchema },
      },
    })),
  };

  const messages = [{ role: 'user', content: [{ text: userRequest }] }];
  const completed = [{ speaker: 'user', text: userRequest }];
  if (onTurn) onTurn(completed[0]);

  // Local to this call only — see the file header for why this must never be shared
  // across concurrent conversations.
  const confirmedProposals = new Map();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // #130: a plain `{ input }` object, not a real `ConverseCommand` — this file no
    // longer imports the AWS SDK at all. `bedrockClient.send()` (a test's mock, or
    // defaultBedrockClient() above) only ever reads `.input`.
    const response = await bedrockClient.send({
      input: { modelId, system: [{ text: SYSTEM_PROMPT }], messages, toolConfig },
    });
    const { output, stopReason } = response;
    const message = output.message;
    messages.push(message);

    const text = (message.content || [])
      .filter((block) => typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
    if (text) {
      const turn = { speaker: 'agent', text };
      completed.push(turn);
      if (onTurn) onTurn(turn);
    }

    if (stopReason !== 'tool_use') {
      return completed;
    }

    const toolUseBlocks = (message.content || []).filter((block) => block.toolUse);
    const toolResultContent = [];
    for (const block of toolUseBlocks) {
      const { toolUseId, name, input } = block.toolUse;
      const json = await handleToolUse({
        mcpClient,
        name,
        input,
        onConfirmRequest,
        onTurn,
        confirmedProposals,
      });
      toolResultContent.push({ toolResult: { toolUseId, content: [{ json }] } });
    }
    messages.push({ role: 'user', content: toolResultContent });
  }

  throw new Error(
    `runBedrockConversation exceeded maxIterations (${maxIterations}) without the model finishing ` +
      "(stopReason never left 'tool_use'). Increase maxIterations or check for a planner/script loop."
  );
}
