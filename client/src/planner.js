// The scripted planner (SPEC.md section 10: deterministic by default, no LLM required).
// It walks CONVERSATION_SCRIPT turn by turn and, for any turn with a tool call, always
// routes it through the SAME McpHttpClient.callTool() used everywhere else in this
// client — the UI never calls a tool by any other path (CLAUDE.md "Agent and human
// share one surface"). The one deliberate exception is a `kind: 'confirm'` turn: there
// the planner calls McpHttpClient's approveProposal()/rejectProposal(), which are plain
// REST calls to the server's owner-only /proposals routes, never tools/call — because
// minting (or withholding) a confirmation token is the PERSON's decision, made through
// the client's Confirm/Decline control, not something an agent tool call can do on its
// own. `onConfirmRequest`, supplied by the caller (the browser UI or a test), is the
// only way that decision reaches the planner — it is awaited exactly where a real
// person would need to actually click something.
//
// An optional LLM planner may replace turn selection later behind an env var per
// SPEC.md section 10; it would still have to call runTurn() below to reach a tool, and
// still have to go through the same confirm gate to mint a token, so both
// chokepoint guarantees hold regardless of which planner is active.

import { CONVERSATION_SCRIPT } from './conversation-script.js';

/**
 * Runs one turn against the running context `ctx` (built up as the conversation
 * proceeds: `ctx.lastProposal` is always the most recently proposed action/scene;
 * `ctx[turn.contextKey]` after a confirm turn holds `{proposal, decision, token}` so
 * later turns' `args` functions can read it). Returns the completed turn annotated
 * with its outcome, or `null` if a `runIf` predicate skipped it.
 */
export async function runTurn(mcpClient, turn, ctx, { onConfirmRequest } = {}) {
  if (turn.runIf && !turn.runIf(ctx)) {
    return null;
  }

  if (turn.kind === 'confirm') {
    const proposal = ctx.lastProposal;
    const decision = await onConfirmRequest(proposal);
    let token = null;
    if (decision === 'confirm') {
      const approval = await mcpClient.approveProposal(proposal.proposal_id);
      token = approval.confirmation_id;
    } else if (decision === 'decline') {
      await mcpClient.rejectProposal(proposal.proposal_id);
    } else {
      throw new Error(`onConfirmRequest must resolve to "confirm" or "decline", got "${decision}".`);
    }
    ctx[turn.contextKey] = { proposal, decision, token };
    return { ...turn, proposal, decision };
  }

  if (!turn.tool) {
    return { ...turn };
  }

  const { name, args } = turn.tool;
  const resolvedArgs = typeof args === 'function' ? args(ctx) : args;
  const result = await mcpClient.callTool(name, resolvedArgs);
  if (name === 'propose_action' || name === 'compose_scene') {
    ctx.lastProposal = result.structuredContent;
  }
  return { ...turn, tool: { ...turn.tool, args: resolvedArgs, result, real: true } };
}

/**
 * Runs the whole scripted conversation against a live server, in order, via one shared
 * McpHttpClient session. `onTurn`, if given, is called with each completed turn as soon
 * as it resolves (used by the UI to render turns as they arrive rather than all at
 * once). `onConfirmRequest(proposal)` must resolve to `'confirm'` or `'decline'` — the
 * browser UI resolves it from the person clicking a button; a test can resolve it
 * immediately with a scripted sequence.
 */
export async function runConversation(
  mcpClient,
  { script = CONVERSATION_SCRIPT, onTurn, onConfirmRequest = async () => 'confirm' } = {}
) {
  await mcpClient.initialize();
  const ctx = {};
  const completed = [];
  for (const turn of script) {
    const done = await runTurn(mcpClient, turn, ctx, { onConfirmRequest });
    if (done === null) continue;
    completed.push(done);
    if (onTurn) onTurn(done);
  }
  return completed;
}

/** Just the turns backed by a real tool call — what the integration test drives. */
export function realToolTurns(script = CONVERSATION_SCRIPT) {
  return script.filter((turn) => turn.tool);
}
