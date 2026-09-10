// Minimal Streamable HTTP MCP client: just enough of the 2025-11-25 transport spec to
// initialize a session and call tools against a live alexa-plus server. Written fresh
// against the wire protocol (not imported from server/), so it works identically from a
// browser <script type="module"> and from Node's test runner — both provide global
// fetch. This is the ONE place either the UI or the planner sends a tool call through;
// neither gets its own path to the network (see CLAUDE.md "Agent and human share one
// surface").

const PROTOCOL_VERSION = '2025-11-25';
const MCP_ACCEPT = 'application/json, text/event-stream';

export class McpHttpClient {
  constructor(url) {
    this.url = url;
    this.sessionId = null;
    this._nextId = 1;
  }

  /** Runs the initialize handshake + initialized notification; returns serverInfo. */
  async initialize(clientInfo = { name: 'alexa-plus-simulated-client', version: '0.1.0' }) {
    const result = await this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    await this._notify('notifications/initialized');
    return result;
  }

  /** Calls one registered tool by name; returns the tool's CallToolResult. */
  async callTool(name, args = {}) {
    return this._request('tools/call', { name, arguments: args });
  }

  /** Ends the session (DELETE per the transport spec). Safe to call without a session. */
  async close() {
    if (!this.sessionId) return;
    await fetch(this.url, { method: 'DELETE', headers: this._headers() });
  }

  /**
   * The owner-only "Confirm control" surface: plain REST POSTs to the server's
   * /proposals/:id/approve|reject routes — NOT tools/call. These are never routed
   * through callTool() on purpose (see CLAUDE.md's "Agent and human share one surface"
   * — this is the one place that guarantee does NOT apply, because minting a
   * confirmation token is the person's decision, never the agent's). Only ever called
   * from the UI's Confirm/Decline button handlers in app.js.
   */
  async approveProposal(proposalId) {
    return this._proposalDecision(proposalId, 'approve');
  }

  async rejectProposal(proposalId) {
    return this._proposalDecision(proposalId, 'reject');
  }

  async _proposalDecision(proposalId, decision) {
    const proposalsUrl = new URL('/proposals/' + encodeURIComponent(proposalId) + '/' + decision, this.url);
    const res = await fetch(proposalsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || `Server refused to ${decision} proposal "${proposalId}".`);
    }
    return body;
  }

  _headers() {
    const headers = { 'Content-Type': 'application/json', Accept: MCP_ACCEPT };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    return headers;
  }

  async _request(method, params) {
    const id = this._nextId++;
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sessionId = res.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    if (!res.ok && res.status !== 200) {
      throw new Error(`MCP transport error: HTTP ${res.status} calling ${method}`);
    }
    const body = await res.json();
    if (body.error) {
      const err = new Error(body.error.message || `MCP protocol error calling ${method}`);
      err.code = body.error.code;
      throw err;
    }
    return body.result;
  }

  async _notify(method, params) {
    await fetch(this.url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    });
  }
}
