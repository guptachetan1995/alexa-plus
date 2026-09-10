# alexa-plus Demo Video — Script & Shot List

Deliverable for issue #39. The owner records the final video (a separate, human-only
step); this document is everything they need to do it without improvising: narration
text, shot list, the exact seeded state to start from, and the timing budget.

## Target runtime

**Scripted length: ~2:25. Hard ceiling: 2:42** (Devpost asks for "approximately 3
minutes"; the issue's DoD asks for under 3:00 with 10% headroom, i.e. 2:42). Every tool
call in this demo resolves against an in-memory registry on localhost — visibly instant
on screen, no loading state to wait out — so there is no network- or provider-bound
segment like call-e's real phone call. On-screen pacing is entirely narration-paced and
clicking-paced, not technical latency, so this script's timing is not a nominal
estimate: it is exactly what a person clicking through it at a normal, unhurried pace
will see.

## Recording setup — exact seeded state

Two terminals plus a browser, all opened before recording starts:

```bash
# Terminal 1 — server
cd entries/alexa-plus
npm install
npm start   # MCP server on http://127.0.0.1:3000/mcp
```

```bash
# Terminal 2 — client
cd entries/alexa-plus/client
npm install   # no-op, kept only so the two-line "install && start" pattern matches server/
npm start     # simulated Alexa+ client on http://127.0.0.1:5173
```

Check nothing else is already bound to 5173 before starting the client (a stray process
from an earlier session will make `npm start` fail with `EADDRINUSE`); if so, run
`PORT=<n> npm start` instead and open that port.

Open a third terminal in `entries/alexa-plus`, ready but not yet run — it is used only
for Scene 7 (the server-refusal beat) and should stay hidden until then so it does not
leak the outcome early. Pre-warm it once before recording:

```bash
npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --method tools/list
```

(`npx -y` downloads/caches the Inspector package on first use — doing this once before
recording means Scene 7's actual command runs instantly on camera instead of pausing on
a package fetch.)

Open `http://127.0.0.1:5173` in a browser window sized so the whole conversation column
is visible without the page's own internal scrolling being distracting on camera. Do not
click anything before recording starts. The seeded state that must be on screen at 0:00
is the idle page:

- Title "Alexa+ Smart Home — Simulated Client", the one-paragraph explainer, an "MCP
  server URL" field pre-filled `http://127.0.0.1:3000/mcp`, and a single "Start demo
  conversation" button. No conversation turns yet.

The registry behind it (`server/data/devices.json`, read fresh by the server on start,
never mutated by anything except a genuinely executed `execute_action`) is 5 devices in
3 rooms:

| Device | Room | Seeded state |
|---|---|---|
| Living Room Overhead (light) | living room | power on, brightness 100, 4000K |
| Bedroom Lamp (light) | bedroom | power off, brightness 0 |
| Living Room Thermostat | living room | power on, heat, target 70°F, current 68°F |
| Front Door Lock | living room | locked, battery 82% |
| Kitchen Coffee Maker Plug | kitchen | **power off** |

## Findings from the dry run that shaped this script

Confirmed by actually starting both the server and the client fresh (`npm install` +
`npm start` in each) and walking the full conversation in a real browser tab against the
live server, then separately calling the server directly, before writing a line of
narration:

- **The Kitchen Coffee Maker Plug starts `off` in the seed data**, not `on`. The
  in-app script's own agent line after the decline — "leaving the Kitchen Coffee Maker
  Plug on, nothing changed" — and the user's line that prompts it — "Also turn off the
  kitchen coffee maker plug" — both read as if the plug were currently powering the
  machine. It is not; the device registry the demo reads from already has it off before
  that turn ever runs, and the on-screen `list_devices` JSON from the very first turn
  shows `"power": "off"` for it in plain sight. **The voiceover below narrates the
  mechanic being demonstrated — a proposal being declined and never executed — and does
  not claim the coffee maker is actively running.** Do not ad-lib a line like "so the
  coffee keeps brewing"; nothing on screen supports it.
- **The scripted conversation never makes the server refuse a call.** Its two
  propose/confirm turns only ever call `execute_action` when the person clicks Confirm
  (e.g. `runIf: (ctx) => ctx.dimLivingRoom.decision === 'confirm'`, in
  `client/src/conversation-script.js`)
  — a Decline just skips the call entirely, it does not attempt and get refused. The
  app's `ToolPanel` component has full support for rendering a refusal (a red "REFUSED"
  badge and the narrated reason text, styled distinctly from a successful "REAL — server
  call" result) but nothing in the demo's own scripted path ever triggers it. **The
  refusal beat this issue requires has to be shown from outside the app**, against the
  same running server, using the MCP Inspector CLI the README already documents for
  exactly this kind of direct inspection (see Scene 7).
- **Every tool call is genuinely real, not simulated** — `client/src/planner.js` routes
  every turn through the one `McpHttpClient.callTool()`/`approveProposal()`/
  `rejectProposal()` path, the same path a raw `tools/call` or the owner-only REST routes
  use. There is nothing to caveat about a shot showing "REAL — server call": it is.
- Exact text and values confirmed live against a freshly started server (2026-09-08):
  - The propose→confirm→execute sequence for the light produces a `new_state` of
    `{"power": "on", "brightness": 50, "color_temp_k": 4000}` and writes exactly one
    audit entry (`actor: "user"`, `reason: "User approved via <proposal_id>"`).
  - After the decline, `read_audit_log` returns **exactly one entry** — the light's —
    proving the declined plug action produced zero side effects, not just that the UI
    chose not to show one.
  - Calling `execute_action` with no `confirmation_id` at all (device_id
    `dev_kitchen_plug_1`, action `turn_off`) returns
    `isError: true` with the text: *"execute_action requires a confirmation_id minted by
    the person confirming a pending proposal in the client. Call propose_action first
    and wait for their decision — this call was refused, nothing changed."* A follow-up
    `get_device_state` on the same device afterward still reads `{"power": "off"}` with
    the original, untouched `last_updated` timestamp — the refusal was a true no-op, not
    a soft warning.

## Shot list & narration

| # | Time | Visual | Action | Narration (verbatim) |
|---|------|--------|--------|------------------------|
| 1 | 0:00–0:10 | Browser, idle seeded page | No action — hold, then click **Start demo conversation** | "This is an Alexa+ smart-home agent. It can see every device in the house — but it can't touch one without a person saying yes. Watch." |
| 2 | 0:10–0:30 | Browser, turns arriving in sequence: `list_devices` → `get_device_state` → `check_automation_policy` → `propose_action`, ending on the **Confirmation needed** panel | Let each tool panel render for a beat, then hold on the confirm panel (do not click yet) | "The user asks to dim the living room light and check the thermostat. The agent looks up the device, checks it against home policy, and proposes the change — then stops. It hasn't touched the light yet." |
| 3 | 0:30–0:50 | Browser, click **Confirm**; `execute_action` tool panel appears with the "REAL — server call" badge and `new_state` showing brightness 50 | Click Confirm | "One click mints a one-time confirmation token — only this button can mint it, never the agent. `execute_action` runs, and the light is genuinely at 50% now — the first and only moment its state actually changed." |
| 4 | 0:50–1:05 | Browser, thermostat check, then the second **Confirmation needed** panel (Kitchen Coffee Maker Plug, turn_off) | Let the thermostat turn and the new proposal render | "It checks the thermostat, then the user asks it to also turn off the kitchen plug. Same gate, second time — propose, then wait." |
| 5 | 1:05–1:25 | Browser, click **Decline**; scroll to the final `read_audit_log` tool panel | Click Decline | "This time, decline. The agent never calls `execute_action` for the plug — and the audit log at the end proves it: one entry, total. The light. Nothing else ever executed." |
| 6 | 1:25–1:35 | Cut to the pre-opened third terminal, `entries/alexa-plus` | No action yet — just the prompt | "So confirming and declining both worked, inside the app. What stops the agent from just skipping the person entirely?" |
| 7 | 1:35–2:00 | Terminal — run: `npx -y @modelcontextprotocol/inspector --cli http://127.0.0.1:3000/mcp --method tools/call --tool-name execute_action --tool-arg device_id=dev_kitchen_plug_1 --tool-arg action=turn_off` — zoom on the `isError` field and the message text | Run the command, pause on the output | "Calling `execute_action` on that plug directly — no confirmation id at all. `isError: true`. It needs a confirmation id minted by a person confirming a pending proposal, and this call didn't have one." |
| 8 | 2:00–2:15 | Terminal — run `get_device_state` for the same device (same Inspector CLI pattern, `--tool-name get_device_state`) | Run the command | "Check the device afterward: still off, same timestamp as before. This isn't a warning beside a change that happened anyway. Nothing happened." |
| 9 | 2:15–2:25 | Terminal — `npm test` from the entry root, scrolled to the summary line | Run the command, hold on the green summary | "Forty-one tests hold this gate from every angle. One button an agent can never press for itself: confirm." |

## Timing contingency

Every segment above is either a fixed narration read or a near-instant tool call — there
is no variable-duration real-world step like call-e's phone call. If a take runs long,
trim in this order without dropping any of the four required beats (the conversation,
an inline tool call, a confirmed action, and a refused one): shorten Scene 9's line to
its first sentence ("Forty-one tests hold this gate from every angle."); then shorten
Scene 2's narration by cutting the "checks it against home policy" clause, since the
policy-check panel is still visible on screen without being narrated line-by-line.

## What this script does not show

- `compose_scene`/`execute_scene` — real, tested (`server/test/proposal-lifecycle.test.js`,
  `policy.test.js`), but SPEC.md section 5's demo script only exercises single-device
  `propose_action`/`execute_action`, and adding a scene here would push well past the
  strongest-30-seconds framing for no new beat the DoD asks for.
- The owner-only CLI verbs from SPEC.md section 3 (`approve`, `reject`, `list-proposals`,
  `audit`) — this entry has no CLI; SPEC.md section 7's file-layout note (issue #36)
  records that they became two REST routes instead (`POST /proposals/:id/approve` and
  `/reject`), which is what the Confirm/Decline buttons call. Nothing to film separately.
- OAuth 2.1 with PKCE — SPEC.md section 7 records this as not yet built (a later goal);
  the demo runs against the unauthenticated local server, matching what actually exists.
- A `blocked_by_policy` proposal (the `ConfirmPanel`'s grayed-out "Blocked by automation
  policy" state, `disabled` Confirm button) — real in the code (`app.js`'s `ConfirmPanel`
  checks `proposal.status === 'blocked_by_policy'`), but neither of SPEC.md section 5's
  two scripted actions trips a policy rule (both come back `allowed: true`), so it never
  renders during this script and is out of scope for the four required beats.

## Dry-run verification (this goal)

Walked the full path above against a freshly started server and client (`npm install &&
npm start` in `entries/alexa-plus/`, then the same in `entries/alexa-plus/client/`, a
real browser tab pointed at `http://127.0.0.1:5199` — a non-default port, only because
another concurrent session on this machine already held 5173 during this run) end to
end: idle page → `list_devices` → `get_device_state` → `check_automation_policy` →
`propose_action` → **Confirm** clicked → `execute_action` succeeded (`new_state`
brightness 50) → thermostat `get_device_state` → second `propose_action` → **Decline**
clicked → `read_audit_log` returned exactly one entry. Every tool panel, badge, and JSON
body quoted above is copied verbatim from that live run's rendered page text, not
invented. Separately, against the same running server, `execute_action` called with no
`confirmation_id` via the MCP Inspector CLI returned the exact refusal text quoted above,
and a follow-up `get_device_state` on the same device confirmed its state and
`last_updated` were unchanged.

The automated browser used for this dry run runs headless/background for this
particular session (a shared pane across several concurrent agent sessions on this
machine), so most of the run was captured as rendered page text/accessibility-tree
content rather than pixel screenshots — two pixel screenshots were captured successfully
before the pane went out of view (the idle seeded page at 0:00, and the mid-conversation
page with the `list_devices` result panel open), matching the sequence described above
exactly.
The full text transcript (every tool call and result, in order) and a description of
both captured screenshots are pasted in the pull request for this issue. A real screen
recording on the owner's own machine does not have this constraint — the browser is
simply visible the whole time.

`npm test` (41 tests, 7 suites) and `bash verify.sh` both pass against this same
worktree; see the PR for the literal output.
