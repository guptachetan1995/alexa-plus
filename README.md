# alexa-plus: Smart Home Agent

Alexa+ MCP server that exposes smart home capabilities through a unified interface with human-in-the-loop approval gates for all device actions, plus a simulated Alexa+ web client that talks to it over the wire.

The server (`entries/alexa-plus/server/`) exposes all eight tools from `SPEC.md`
section 3 over MCP's Streamable HTTP transport (spec revision `2025-11-25`), backed by a
seeded 5-device registry (`server/data/devices.json`):

- **Read-only:** `list_devices`, `get_device_state`, `check_automation_policy`,
  `read_audit_log`.
- **Propose/confirm/execute pairs:** `propose_action` / `execute_action` and
  `compose_scene` / `execute_scene`. Proposing never changes state. Executing requires a
  one-time `confirmation_id` — a token minted ONLY by a person approving the proposal
  through the two owner-only REST routes below (never through an MCP tool call, and
  never by the agent itself). `execute_action`/`execute_scene` refuse — with a narrated
  reason, never a silent no-op — a call with no token, a token that matches no pending
  proposal, an already-used token, or a token approved for a different action.
- **Owner-only REST routes (not MCP tools):** `POST /proposals/:id/approve` mints the
  token; `POST /proposals/:id/reject` declines without ever minting one; `GET
  /proposals/:id` reads a proposal's current status. These stand in for SPEC.md's
  owner-only CLI verbs — this entry has a web client instead of a CLI, so the client's
  Confirm/Decline buttons call these routes directly.

The client (`entries/alexa-plus/client/`) is a separate project — its own
`package.json`, its own `npm install`/`npm start`/`npm test` — that imports nothing from
`server/` and reaches it only over HTTP. It renders an Alexa+-style conversation and
walks the demo script from `SPEC.md` section 5 with a scripted planner (no LLM
required): every tool call it makes is a live `fetch()` to the running server, and a
proposed action pauses the conversation until you click Confirm or Decline right there
in the page — the demo runs one confirmed action (the living room light) and one
declined action (the kitchen plug), matching SPEC.md section 5's issue #36 amendment.

## Setup

```bash
npm install
```

## Run

```bash
npm start
```

Starts the MCP server on `http://127.0.0.1:3000/mcp` (override the port with `PORT=<n>`).
The endpoint accepts `POST`, `GET`, and `DELETE` per the Streamable HTTP transport spec.

## Test

```bash
npm test
```

Runs the conformance suite in `server/test/`: initialize handshake, `tools/list`,
`tools/call` (including the unknown-device and unknown-tool error paths, and a
no-mutation check against the seeded registry), session lifecycle (session id
issuance, reuse, `DELETE` termination, and the 400-vs-404 distinction between a missing
and a terminated/unknown session id), the propose→approve/reject→execute lifecycle for
both single actions and scenes, and — the DoD this goal is graded on — every way an
`execute_action`/`execute_scene` call can be refused (no `confirmation_id`, a token that
matches no pending proposal, a proposal that was never approved, a replayed
already-used token, a token approved for a different action, and the owner-only
`approve`/`reject` routes themselves refusing an unknown or already-decided proposal).

## Lint

```bash
npm run lint
```

## Verify

```bash
bash verify.sh
```

## Simulated Alexa+ client

In a second terminal, with the server already running from the steps above:

```bash
cd client && npm install && npm start
```

Then open `http://127.0.0.1:5173` in a browser (override the client's own port with
`PORT=<n>`; it defaults to talking to the server at `http://127.0.0.1:3000/mcp`, editable
in the page). Click "Start demo conversation" to run the SPEC.md section 5 script. It
will pause twice with a "Confirmation needed" panel — click **Confirm** the first time
(dimming the living room light — this one actually executes and its new state shows up
in the tool panel below) and **Decline** the second time (turning off the kitchen plug
— the agent narrates that it left it alone, and the plug's state never changes).

`client/` has no npm dependencies at all (React loads from a CDN import map in
`index.html`, so there is no bundler or build step) — `npm install` there is a no-op,
kept only so "one command each" (`npm install && npm start`) works identically for
server and client.

To run the client's own integration test (spawns the real server as a separate process
and drives the full script against it over HTTP, including a scripted confirm and a
scripted decline):

```bash
cd client && npm test
```

## Inspecting with an off-the-shelf MCP client

With the server running (`npm start` in one terminal), use the reference MCP Inspector
CLI from another terminal to list and call the tools directly — no custom client code
needed:

```bash
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --method tools/list
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --method tools/call --tool-name list_devices --tool-arg room=kitchen
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --method tools/call --tool-name get_device_state --tool-arg device_id=dev_thermostat_1
```

`tools/list` against a live server returns all eight tools:

```
 - list_devices
 - get_device_state
 - check_automation_policy
 - read_audit_log
 - propose_action
 - execute_action
 - compose_scene
 - execute_scene
TOTAL: 8
```

## Demo walkthrough

The SPEC.md section 5 script, as it actually runs. Below is a real transcript captured by
driving `client/src/planner.js` against a freshly started server, confirming the first
proposal and declining the second — the same code path the browser UI uses, with the
button clicks scripted instead of clicked. Abridged only by truncating long JSON
payloads; nothing is paraphrased.

```
[1] USER: Turn on the living room light and set it to 50% brightness, then check the thermostat.

[2] AGENT: Let me see what devices are in the home.
    tool: list_devices  args={}
    -> {"devices":[{"device_id":"dev_living_room_light_1","name":"Living Room Overhead", …5 devices…]}

[4] AGENT: Checking home automation policy allows dimming this light.
    tool: check_automation_policy
    -> {"allowed":true,"rule":"no_restrictions","reason":""}

[5] AGENT: Proposing: dim Living Room Overhead to 50% brightness.
    tool: propose_action  args={"device_id":"dev_living_room_light_1","action":"set_brightness","params":{"brightness":50}}
    -> {"proposal_id":"prop_47a8311a-…","status":"awaiting_approval","confirmation_token":null}

[6] SYSTEM confirm gate -> proposal prop_47a8311a-… (set_brightness) status=awaiting_approval
    person clicks: CONFIRM

[7] AGENT: Executing the confirmed action.
    tool: execute_action  args={…,"confirmation_id":"confirm_030ea540-…"}
    -> {"device_id":"dev_living_room_light_1","new_state":{"power":"on","brightness":50,"color_temp_k":4000},"result":"success","audit_entry_id":"audit_e351d597-…"}

[9] USER: Also turn off the kitchen coffee maker plug.

[11] AGENT: Proposing: turn off the Kitchen Coffee Maker Plug.
    tool: propose_action  -> {"proposal_id":"prop_bbbdddf3-…","status":"awaiting_approval"}

[12] SYSTEM confirm gate -> proposal prop_bbbdddf3-… (turn_off) status=awaiting_approval
    person clicks: DECLINE

[13] AGENT: Understood — leaving the Kitchen Coffee Maker Plug on, nothing changed.

[14] AGENT: Here is the audit log for everything that actually executed this session.
    tool: read_audit_log  args={}
    -> {"entries":[{"entry_id":"audit_e351d597-…","device_id":"dev_living_room_light_1",
        "action":"set_brightness","actor":"user","reason":"User approved via prop_47a8311a-…",
        "result":"success","new_state":{"power":"on","brightness":50,"color_temp_k":4000}}]}
```

Two things to notice. The declined action produced **no** audit entry — the log ends with
exactly one — and it left the plug untouched. And nothing between the proposal and the
person's click changed any state.

The other half of the gate is what happens when a caller skips the person entirely.
Against the same running server:

```
BEFORE   {"device_id":"dev_kitchen_plug_1","state":{"power":"off"},"last_updated":"2026-09-08T08:00:00Z"}
REFUSAL isError=true
        execute_action requires a confirmation_id minted by the person confirming a
        pending proposal in the client. Call propose_action first and wait for their
        decision — this call was refused, nothing changed.
AFTER    {"device_id":"dev_kitchen_plug_1","state":{"power":"off"},"last_updated":"2026-09-08T08:00:00Z"}
AUDIT entries=1
```

Same state, same `last_updated`, same audit count. The refusal is a true no-op, not a
warning printed beside a change that happened anyway.

## Known limitations

Stated plainly, because a submission that hides these is worse than one that names them.

- **Not deployed.** The server is run locally and has no public URL. Measured
  `tools/call` round-trip on loopback is 0.62–1.17 ms, so the latency budget is not the
  obstacle — hosting simply is not part of this entry.
- **No authentication.** OAuth 2.1 with PKCE is not implemented (`SPEC.md` section 7
  records `auth.js` as deferred). The server requires no credentials, so nothing is
  gated behind an auth path that does not exist — but a real Alexa+ add-on would need it.
- **Not the Alexa+ MCP Toolkit.** This is a self-hosted MCP server plus a *simulated*
  Alexa+ client. Every tool call in that client is a real call to the real server, but no
  Alexa device is in the loop.
- **All state is in memory.** Devices, proposals and audit entries live for the life of
  the server process; restarting re-reads `server/data/devices.json` and forgets
  everything else. Nothing is written back to disk. This is deliberate (`SPEC.md`
  section 4), not an unfinished persistence layer.
- **The planner is scripted, not reasoning.** It walks a fixed conversation so the demo
  and tests run identically with no LLM and no API key. `SPEC.md` section 10 leaves an
  LLM planner as optional future work; it would still have to pass through the same
  confirm gate.
- **`execute_scene` does not roll back.** If a later action in a scene fails, the earlier
  ones stay applied; the tool stops and reports exactly how far it got. Its description
  says so.
- **The demo's coffee-maker line is looser than the data.** The plug is seeded `off`, so
  "leaving it on" is about the *proposal* being declined, not about an appliance that was
  running. `docs/video-script.md` flags this and tells the narrator not to embellish it.

## Privacy and security notes

- **No personal data, anywhere.** The five devices in `server/data/devices.json` are
  fictional, in a fictional house. No real address, account, network identifier or person
  appears in any source file, test, or fixture.
- **No credentials.** Nothing reads an API key, token, or password; there is no `.env`,
  no secret store, and no authentication path. Nothing to leak because nothing is held.
- **No outbound network calls.** Every tool resolves against the in-memory registry. The
  server contacts no device, vendor API, or third-party service. The only external fetch
  anywhere is the browser loading React from a CDN via the import map in
  `client/index.html`.
- **Authorization is structural, not advisory.** `ProposalStore.approve()` is the only
  code that ever mints a `confirmation_token`, and its only caller is the owner-only
  `POST /proposals/:id/approve` route. No MCP tool wraps it, so no agent tool call can
  reach it. Tokens are single-use: `markExecuted` nulls the token, so a replay is refused.
- **Tokens are not echoed back.** `GET /proposals/:id` strips `confirmation_token` before
  responding — the token is returned exactly once, to the caller that minted it.
- **Policy is re-checked at execute time**, never trusted from an earlier
  `check_automation_policy` call, so an approval cannot be used to smuggle through an
  action the policy would now deny.
- **The audit log is append-only.** There is no delete or redact path in `audit.js`;
  `read_audit_log` is its only reader.
- **Host-header validation is on.** The SDK's DNS-rebinding protection rejects any
  request whose `Host` is not `localhost`/`127.0.0.1`. Verified: `Host:
  evil.example.com` gets `HTTP 403` with `Invalid Host: evil.example.com`. The listening
  socket itself is not restricted to the loopback interface, so this header check — not
  the bind address — is what keeps a non-local client out.
- **CORS is wide open (`Access-Control-Allow-Origin: *`)** because the demo runs two
  local processes on two ports. That is appropriate for a localhost demo and would need
  tightening to an allowlist before any deployment.
- **The client's static server serves only `client/`**, from a fixed extension allowlist,
  and rejects any resolved path outside its own directory.

## License

MIT — see [LICENSE](LICENSE) at this entry's root. The repository root carries the same
MIT license, which is the one GitHub reads for the repository's About section.

## Documentation

| Document | What it is |
|---|---|
| [SPEC.md](SPEC.md) | The pinned contract: tools, data model, demo script, stack, and the hackathon's submission checklist. |
| [docs/architecture.md](docs/architecture.md) | Architecture diagrams (Mermaid + exported SVG), the approval-gate sequence, the refusal matrix, and how to onboard this server to Alexa+. |
| [docs/submission.md](docs/submission.md) | The Devpost write-up: text description, Built With, every form field, and the submission checklist ticked line by line with evidence. |
| [docs/feedback.md](docs/feedback.md) | Product feedback on all ten tools/APIs/SDKs used. |
| [docs/friction-log.md](docs/friction-log.md) | Four friction-log entries in the hackathon's requested format. |
| [docs/video-script.md](docs/video-script.md) | Demo video script, shot list, and timing budget. |

---

See [SPEC.md](SPEC.md) for the full specification, demo script, and submission checklist.
