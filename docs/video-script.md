# alexa-plus Demo Video — Script & Shot List

The production script for the re-cut of the demo video. The video published at
https://www.youtube.com/watch?v=14YZX4JtDjY was rendered from the previous version of this
script on 2026-09-10 and submitted on 2026-09-11; this version replaces it. Everything
needed to render it without improvising is here: narration text, shot list, the exact
seeded state to start from, the commands whose real output fills the terminal beats, and
the timing budget. Paths and commands below are relative to the root of this repository.

## What changed from the published video, and why

- **The declined action is the front-door unlock, not the kitchen plug.** The plug is
  seeded `off`, so the old script proposed turning off a plug that was already off and
  then said it was "leaving it on". The lock is seeded `locked`; declining the unlock
  leaves it locked, and the words and the data agree. It is also the example the whole
  entry is about.
- **The client subtitle no longer names a design document** that is not in this
  repository; the old video showed the earlier wording.
- **The ten-second bare `$` prompt is gone.** In its place, the MCP Inspector lists the
  eight tools of the live server on AWS EC2 — the only beat that shows the deployed
  endpoint.
- **New beats for what was built since:** device tiles that visibly change on Confirm
  and do not on Decline, the owner-key refusal on the approve route, and, only if a real
  transcript exists, the Bedrock planner (beat 10).
- **The narration names who it is for** and no longer speaks a test count; the terminal
  beat shows whatever count `npm test` really prints at render time.

## Target runtime

**2:08 without beat 10, 2:24 with it. Hard ceiling: 2:42** (the rules cap the video at
"less than three (3) minutes"; 2:42 keeps 10% headroom). Every tool call resolves against
an in-memory registry, so on-screen pacing is set by narration and clicks, not latency.
Each beat is a still held for exactly its duration, so the render's length is the sum of
the durations below.

## Recording setup — exact seeded state

A fresh server and client on two ports nothing else is using, with a throwaway owner key
and the client's origin allowed on the owner routes:

```bash
export OWNER_KEY="$(node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))")"
# Terminal 1 — server, from the repository root
npm install
PORT=<server-port> OWNER_ORIGINS=http://127.0.0.1:<client-port> npm start
# Terminal 2 — client
cd client && npm install && PORT=<client-port> npm start
```

Open `http://127.0.0.1:<client-port>/` and set the page's "MCP server URL" to
`http://127.0.0.1:<server-port>/mcp`. The seeded state at 0:00 is the idle page: the
title, the one-paragraph explainer, the server URL field and the "Start demo
conversation" button, with no device tiles and no turns yet.

The registry behind it (`server/data/devices.json`, read fresh on start, changed only by
a confirmed `execute_action`) is 5 devices in 3 rooms:

| Device | Room | Seeded state |
|---|---|---|
| Living Room Overhead (light) | living room | power on, brightness 100, 4000K |
| Bedroom Lamp (light) | bedroom | power off, brightness 0 |
| Living Room Thermostat | living room | power on, heat, target 70°F, current 68°F |
| Front Door Lock | living room | **locked**, battery 82% |
| Kitchen Coffee Maker Plug | kitchen | power off |

Check the audit log is empty before the take and holds exactly one entry (the light)
after it, directly against the server — not by eye on a frame.

## Shot list & narration

Durations are exact (whole 40 ms frames). Narration is spoken as written — "Execute
action" rather than `execute_action`, "Alexa Plus" rather than "Alexa+" — because it is
read by a text-to-speech voice.

| # | Time | Duration | Visual | Action | Narration (verbatim) |
|---|---|---|---|---|---|
| 1 | 0:00.0 | 13.0 s + 0.8 s | Browser, idle seeded page | Hold, then click **Start demo conversation** (the 0.8 s second still) | "A smart-home agent for Alexa Plus, for homes where more than one person has a say. It can see every device, but it can't change one until the owner says yes." |
| 2 | 0:13.8 | 16.0 s | Browser: device tiles fill in; `list_devices` → `get_device_state` → `check_automation_policy` → `propose_action`, ending on **Confirmation needed** for `set_brightness` | Wait for the Confirm button, scroll to the bottom | "The user asks to dim the living room light. The agent reads the devices, checks home policy, and proposes the change, then stops. The tiles along the top haven't moved." |
| 3 | 0:29.8 | 16.0 s | Browser: **Confirm** clicked; `execute_action` with the "REAL — server call" badge; the light's tile outlined, reading On · 50% | Click Confirm, wait for the outlined tile | "One click mints a one-time token, and only the owner's Confirm can mint it. Execute action runs, and the light's tile moves to fifty percent: the first moment anything changed." |
| 4 | 0:45.8 | 11.0 s | Browser: thermostat read, "Also unlock the front door.", policy check, and the second **Confirmation needed** (`unlock on dev_front_door_lock_1`) | Scroll to the bottom | "It checks the thermostat. Then the user asks it to unlock the front door. Same gate: propose, then wait." |
| 5 | 0:56.8 | 14.0 s | Browser: **Decline** clicked; "Understood — the Front Door Lock stays locked."; `read_audit_log` summary "1 entry: set_brightness on dev_living_room_light_1 by user"; the lock's tile still Locked | Click Decline, scroll to the bottom | "This time, decline. The agent never executes it, the door's tile still says Locked, and the audit log at the end holds one entry: the light." |
| 6 | 1:10.8 | 11.0 s | Terminal: `npx -y @modelcontextprotocol/inspector --cli http://16.176.3.215:3000/mcp --method tools/list \| jq -r '.tools[].name'` and the eight names | — | "The same server runs on AWS EC2 in Sydney. Any MCP client can list its eight tools; this is the MCP Inspector." |
| 7 | 1:21.8 | 13.0 s | Terminal: the Inspector calling `execute_action` with `device_id=dev_front_door_lock_1`, `action=unlock` and no `confirmation_id` against the local server; `"isError": true` and the reason | — | "Now skip the person. Call execute action to unlock the door with no confirmation id. Refused, with the reason, and nothing changed." |
| 8 | 1:34.8 | 10.0 s | Terminal: `curl -s -w '\nHTTP %{http_code}\n' -X POST http://127.0.0.1:<server-port>/proposals/<a pending proposal_id>/approve` with no key; the `Only the home owner…` error and `HTTP 401` | — | "And the approve route itself turns away anyone without the owner's key: four oh one, nothing minted." |
| 9 | 1:44.8 | 8.0 s | Terminal: the Inspector calling `get_device_state` for the lock: `"locked": true`, `"last_updated": "2026-09-08T08:00:00Z"` | — | "The door is still locked, with the same timestamp as before." |
| 10 | 1:52.8 | 16.0 s | *Only with a real transcript.* Terminal: the output of `node bedrock-cli.js` — `[tool]` lines for the calls Amazon Nova Micro chose, `[gate]` lines for each Confirm/Decline typed by the person | — | "With the Bedrock planner, Amazon Nova Micro picks the tools through the Converse API, and every change it proposes still waits for the person at the same gate." |
| 11 | 1:52.8 (2:08.8 with 10) | 9.0 s | Terminal: `npm test` from the repository root, ending on the Jest summary | — | "The server's test suite covers every one of these refusals. One button the agent can never press for itself: Confirm." |
| 12 | 2:01.8 (2:17.8 with 10) | 6.0 s | Terminal-style card: "Smart Home Agent", the repository, the live MCP URL, the Devpost page | — | "Links are in the description." |

## Where each terminal beat's text comes from

Every terminal beat shows the real output of the command it shows, captured at render
time, never typed by hand; the render stops if the output does not say what the
narration says (eight tool names; `isError` with the confirmation reason; `HTTP 401`; the
lock still `locked` with the seed timestamp; a passing Jest summary).

- Beat 6 runs against the live EC2 server, read-only.
- Beat 8 needs a pending proposal id; one is created on the local server with
  `propose_action` before the take (proposing changes no device), and is never approved.
- Beat 10 is the one beat that cannot be produced here. It needs a real run of
  `client/bedrock-cli.js` with AWS credentials, which costs a few metered Converse calls,
  so it is the owner's to record (for example in AWS CloudShell, where the credentials
  already are), saving the terminal output to a file:

  ```bash
  OWNER_KEY="$OWNER_KEY" AWS_REGION=ap-southeast-2 node bedrock-cli.js http://127.0.0.1:3000/mcp \
    "Dim the living room light to 50%, then unlock the front door, then show me the audit log." \
    | tee bedrock-transcript.txt
  ```

  `bedrock-cli.js` writes the transcript to stdout and its Confirm/Decline prompts to
  stderr, so the prompts show in the terminal and the file holds only the transcript,
  with every `[gate]` line starting its own line.

  Without that file the beat is left out and the video runs 2:08; it is never stood in
  for. If the model's run does not propose anything (no `[gate]` line), the beat is left
  out too, because its narration would not be true.

## Render order

1. The EC2 server is redeployed with the owner key first. Beat 6 says the server on EC2
   is this same server, so the renderer (the video tooling is kept outside this
   repository) refuses a real render while the live host's key-less approve answers
   anything but `401`.
2. Then one render, with the beat 10 transcript passed in if the owner recorded one.

## Timing contingency

Every beat is a held still, so a take cannot run long. If a narration line is trimmed
at its beat's end (the renderer warns), shorten the line rather than the beat: beat 1's
second sentence can lose "but it can't change one" → "and changes nothing until the owner
says yes", and beat 3 can drop ": the first moment anything changed".

## What this script does not show

- `compose_scene`/`execute_scene` — real and tested (`server/test/proposal-lifecycle.test.js`,
  `execute-refusals.test.js`), but the demo conversation only runs single-device
  proposals, and a scene adds no new required beat.
- A `blocked_by_policy` proposal (the Confirm button disabled) — real in `app.js`, but
  both demo actions are allowed by the policy.
- The execute-time policy re-check firing — it is tested by switching the policy between
  approval and execution, which the demo conversation has no reason to do.
- OAuth 2.1 with PKCE — not implemented; the owner key is a single shared secret, and the
  video does not suggest otherwise.
- A real Alexa device. The client is a simulated Alexa+ surface, and beat 1 says "for
  Alexa Plus", not "on".

## Dry-run verification (2026-09-28)

The terminal beats were captured once against a freshly started server on two unused
ports and against the live EC2 server: the Inspector listed all eight tools from
`http://16.176.3.215:3000/mcp`; the token-less `execute_action` returned `"isError": true`
with the reason quoted in the README; the key-less approve returned `HTTP 401` with the
`Only the home owner…` error; `get_device_state` showed the lock `locked` with
`last_updated` `2026-09-08T08:00:00Z`; and `npm test` printed 47 passing tests in 7
suites. The browser states of beats 2–5 were reached in headless Chromium against the
same kind of fresh pair (the README's screenshot is the beat 4 state). The video itself
has not been rendered from this version yet.
