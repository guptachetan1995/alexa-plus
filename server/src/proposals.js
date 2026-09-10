'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Tracks propose/confirm state for both single-device actions and multi-device scenes.
 *
 * SPEC.md's owner-only CLI verbs (`approve <proposal_id>`, `reject <proposal_id>`) are
 * "Never Registered on Agent" — this entry has no CLI, so `approve`/`reject` are called
 * only from the two owner-only REST routes in server.js (the client's Confirm/Decline
 * buttons hit those directly; no MCP tool wraps them, and no tool call can reach them).
 * `approve()` is the ONLY method that ever sets a `confirmation_token` — this is what
 * makes the token "minted only by the client's Confirm control": nothing on the agent
 * side, including `propose_action`/`compose_scene` themselves, can produce one.
 *
 * `execute_action`/`execute_scene` (tools.js) are the only readers of that token, via
 * `findByToken` (a peek, so the caller can validate device/action/params match BEFORE
 * consuming it) followed by `markExecuted` (the actual one-time consumption).
 */
class ProposalStore {
  constructor() {
    this._proposals = new Map();
  }

  createAction({ device_id: deviceId, action, params, expectedOutcome, rationale, policyCheck }) {
    return this._create({
      kind: 'action',
      device_id: deviceId,
      action,
      params,
      expected_outcome: expectedOutcome,
      rationale,
      policy_check: policyCheck,
    });
  }

  createScene({ sceneName, actions, policyChecks }) {
    return this._create({
      kind: 'scene',
      scene_name: sceneName,
      actions,
      policy_checks: policyChecks,
    });
  }

  _create(fields) {
    const proposalId = `prop_${randomUUID()}`;
    const allowed = fields.kind === 'scene'
      ? fields.policy_checks.every((p) => p.allowed)
      : fields.policy_check.allowed;
    const record = {
      proposal_id: proposalId,
      ...fields,
      status: allowed ? 'awaiting_approval' : 'blocked_by_policy',
      created_at: new Date().toISOString(),
      confirmation_token: null,
    };
    this._proposals.set(proposalId, record);
    return record;
  }

  /** The raw proposal record, or undefined. Read-only — never mutates. */
  get(proposalId) {
    return this._proposals.get(proposalId);
  }

  /** Owner-only: mints the one-time confirmation_token. Refuses anything not awaiting approval. */
  approve(proposalId) {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      return { ok: false, reason: `No pending proposal with proposal_id "${proposalId}".` };
    }
    if (proposal.status !== 'awaiting_approval') {
      return {
        ok: false,
        reason: `Proposal "${proposalId}" is ${proposal.status}, not awaiting approval — it cannot be confirmed.`,
      };
    }
    proposal.confirmation_token = `confirm_${randomUUID()}`;
    proposal.status = 'approved';
    return { ok: true, proposal, token: proposal.confirmation_token };
  }

  /** Owner-only: declines a pending proposal. No token is ever minted for it. */
  reject(proposalId) {
    const proposal = this._proposals.get(proposalId);
    if (!proposal) {
      return { ok: false, reason: `No pending proposal with proposal_id "${proposalId}".` };
    }
    if (proposal.status !== 'awaiting_approval') {
      return {
        ok: false,
        reason: `Proposal "${proposalId}" is ${proposal.status}, not awaiting approval — it cannot be declined.`,
      };
    }
    proposal.status = 'rejected';
    return { ok: true, proposal };
  }

  /** Peek by token: finds the proposal it belongs to (any status), without consuming it. */
  findByToken(token) {
    if (!token) return undefined;
    for (const proposal of this._proposals.values()) {
      if (proposal.confirmation_token === token) return proposal;
    }
    return undefined;
  }

  /** One-time consumption: marks a proposal executed and invalidates its token. */
  markExecuted(proposalId) {
    const proposal = this._proposals.get(proposalId);
    if (proposal) {
      proposal.status = 'executed';
      proposal.confirmation_token = null;
    }
    return proposal;
  }
}

module.exports = { ProposalStore };
