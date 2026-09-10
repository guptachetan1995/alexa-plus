// The Alexa+-style conversation UI. Loaded directly by the browser as a native ES
// module (import map in index.html resolves "react"/"react-dom/client" to a CDN build)
// so no bundler is needed to ship a real React client. Plain React.createElement is used
// instead of JSX for the same reason — JSX would need a build step this client doesn't
// have.
//
// This file calls tools through the exact same runConversation()/McpHttpClient path the
// integration test drives (see client/test/) — there is no separate "UI-only" way to
// reach the server, per CLAUDE.md's "Agent and human share one surface". The one
// exception, by design (see planner.js): minting or withholding a confirmation token
// happens only through this file's Confirm/Decline buttons, via McpHttpClient's
// approveProposal()/rejectProposal() — never through a tool call.
//
// #122: which planner runs is decided once, here, from `window.__ALEXA_PLUS_CONFIG__`
// (templated in by server.js — see there for why app.js never reads process.env
// itself). The scripted path below is completely unchanged; PLANNER=bedrock only adds a
// dynamic import of bedrock-planner.js, which is wired to the exact same onTurn/
// onConfirmRequest callbacks runConversation() already used.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { McpHttpClient } from './mcp-client.js';
import { runConversation } from './planner.js';

const h = React.createElement;
const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000/mcp';
const CONFIG = window.__ALEXA_PLUS_CONFIG__ || { planner: 'scripted' };

function proposalSummary(proposal) {
  if (!proposal) return '';
  if (proposal.scene_name) {
    return `Scene "${proposal.scene_name}": ${proposal.actions.length} device action(s)`;
  }
  return `${proposal.action} on ${proposal.device_id}`;
}

/** The one place a confirmation decision is made — see planner.js for why this is not a tool call. */
function ConfirmPanel({ proposal, onDecide }) {
  const blocked = proposal.status === 'blocked_by_policy';
  return h(
    'div',
    { className: 'confirm-panel' },
    h('div', { className: 'confirm-panel-head' }, 'Confirmation needed'),
    h('p', { className: 'confirm-summary' }, proposalSummary(proposal)),
    proposal.rationale ? h('p', { className: 'confirm-rationale' }, proposal.rationale) : null,
    proposal.expected_outcome ? h('p', { className: 'confirm-outcome' }, proposal.expected_outcome) : null,
    blocked
      ? h(
          'p',
          { className: 'confirm-blocked' },
          `Blocked by automation policy: ${proposal.policy_check?.reason || 'not allowed'}. It cannot be confirmed.`
        )
      : null,
    h(
      'div',
      { className: 'confirm-actions' },
      h('button', { className: 'btn-confirm', onClick: () => onDecide('confirm'), disabled: blocked }, 'Confirm'),
      h('button', { className: 'btn-decline', onClick: () => onDecide('decline') }, 'Decline')
    )
  );
}

/** Narrates the decision already made, once a confirm turn has completed. */
function ConfirmOutcome({ turn }) {
  const label = turn.decision === 'confirm' ? 'Confirmed' : 'Declined';
  return h(
    'div',
    { className: `confirm-outcome-panel confirm-outcome-${turn.decision}` },
    h('strong', null, label),
    ' — ',
    proposalSummary(turn.proposal)
  );
}

function ToolPanel({ tool }) {
  const isError = Boolean(tool.result?.isError);
  const badge = isError
    ? h('span', { className: 'badge badge-error' }, 'REFUSED')
    : h('span', { className: 'badge badge-real' }, 'REAL — server call');
  const resultText = isError
    ? tool.result?.content?.[0]?.text ?? 'Refused (no reason text returned).'
    : JSON.stringify(tool.result?.structuredContent ?? tool.result, null, 2);

  return h(
    'div',
    { className: `tool-panel${isError ? ' tool-panel-error' : ''}` },
    h('div', { className: 'tool-panel-head' }, h('code', null, tool.name), badge),
    h(
      'details',
      { open: true },
      h('summary', null, 'arguments'),
      h('pre', null, JSON.stringify(tool.args, null, 2))
    ),
    h(
      'details',
      { open: true },
      h('summary', null, isError ? 'refusal reason' : 'result'),
      h('pre', null, resultText)
    )
  );
}

function Turn({ turn }) {
  if (turn.kind === 'confirm') {
    return h('div', { className: 'turn turn-system' }, h(ConfirmOutcome, { turn }));
  }
  return h(
    'div',
    { className: `turn turn-${turn.speaker}` },
    h('div', { className: 'turn-speaker' }, turn.speaker === 'user' ? 'You' : 'Alexa+ Agent'),
    h('div', { className: 'turn-text' }, turn.text),
    turn.tool ? h(ToolPanel, { tool: turn.tool }) : null
  );
}

function App() {
  const [serverUrl, setServerUrl] = React.useState(DEFAULT_SERVER_URL);
  const [turns, setTurns] = React.useState([]);
  const [status, setStatus] = React.useState('idle'); // idle | running | done | error
  const [error, setError] = React.useState(null);
  const [pendingConfirm, setPendingConfirm] = React.useState(null); // {proposal, resolve} | null

  // The bridge between the planner (which awaits a decision) and the person (who
  // clicks a button): the promise stays unresolved until decide() below runs.
  const onConfirmRequest = (proposal) =>
    new Promise((resolve) => {
      setPendingConfirm({ proposal, resolve });
    });

  const decide = (decision) => {
    if (!pendingConfirm) return;
    pendingConfirm.resolve(decision);
    setPendingConfirm(null);
  };

  const start = async () => {
    setTurns([]);
    setError(null);
    setPendingConfirm(null);
    setStatus('running');
    const client = new McpHttpClient(serverUrl);
    try {
      if (CONFIG.planner === 'bedrock') {
        const { runBedrockConversation } = await import('./bedrock-planner.js');
        await runBedrockConversation(client, {
          modelId: CONFIG.modelId,
          onTurn: (turn) => setTurns((prev) => [...prev, turn]),
          onConfirmRequest,
        });
      } else {
        await runConversation(client, {
          onTurn: (turn) => setTurns((prev) => [...prev, turn]),
          onConfirmRequest,
        });
      }
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    } finally {
      setPendingConfirm(null);
      await client.close().catch(() => {});
    }
  };

  return h(
    'div',
    { className: 'app' },
    h('h1', null, 'Alexa+ Smart Home — Simulated Client'),
    h(
      'p',
      { className: 'subtitle' },
      'Runs the SPEC.md demo conversation against the real MCP server below. Every tool ' +
        'call shown here is a live server call; a proposed device action pauses the ' +
        'conversation until you Confirm or Decline it right here in the UI, and the ' +
        'server refuses execute_action/execute_scene calls that lack a valid, matching ' +
        'confirmation.'
    ),
    h(
      'div',
      { className: 'controls' },
      h('label', { htmlFor: 'server-url' }, 'MCP server URL'),
      h('input', {
        id: 'server-url',
        type: 'text',
        value: serverUrl,
        disabled: status === 'running',
        onChange: (e) => setServerUrl(e.target.value),
      }),
      h(
        'button',
        { onClick: start, disabled: status === 'running' },
        status === 'running' ? 'Running…' : 'Start demo conversation'
      )
    ),
    error ? h('div', { className: 'error' }, `Error: ${error}`) : null,
    h(
      'div',
      { className: 'conversation' },
      turns.map((turn, i) => h(Turn, { turn, key: i })),
      pendingConfirm ? h(ConfirmPanel, { proposal: pendingConfirm.proposal, onDecide: decide }) : null
    )
  );
}

createRoot(document.getElementById('root')).render(h(App));
