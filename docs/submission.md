# Devpost submission write-up — alexa-plus

Everything the Devpost form asks for, in the order the form asks for it, ready to paste.
**Nothing here is submitted, published, or registered by this document** — the owner does
that as a separate, human-only step.

Field names below were re-checked against the live rules pages on **8 September 2026**
(https://amazonappdev2026.devpost.com/ and .../rules), not taken from memory. Where the
live rules differ from the checklist copied into `../SPEC.md` §11, the difference is
called out in [Live-rules deltas](#live-rules-deltas).

Anything the owner must supply is marked **`[owner]`** with what to put there.

---

## Project name

**Smart Home Agent — an Alexa+ agent that can see every device and touch none of them without you**

Short tagline (Devpost "elevator pitch", 200 char max):

> An Alexa+ MCP server for the smart home where every device action is proposed, never
> taken. Only a person's Confirm button can mint the one-time token that lets the agent
> execute.

---

## Text description

*Devpost field: "Text description explaining the project functionality, use case, and any
AWS services/technologies used".*

### The problem

Smart home owners run dozens of connected devices through fragmented vendor apps — a
separate download, login, and interface per brand. There is no unified way to discover
what a home can do, no consistent interface across brands, and no single place to see the
state of the house. Sequencing an action across two brands means jumping between two
apps. The smart home ends up being more friction than convenience.

Handing that to an agent fixes the fragmentation and creates a worse problem: an agent
that can unlock your front door is an agent that can unlock your front door by mistake.
Most demos answer this with a confirmation dialog the agent itself can decide to skip.

### What it does

**Smart Home Agent** is a self-hosted MCP server that exposes a whole smart home through
one interface, plus a simulated Alexa+ web client that drives it. The agent can discover
devices, read their state, check the home's automation policy, and compose multi-device
scenes. What it cannot do — structurally, not by convention — is change anything.

Every mutation goes through a propose → confirm → execute lifecycle:

1. The agent calls `propose_action` (or `compose_scene`). A proposal is created with its
   expected outcome, its rationale, and its policy check. **No state changes.**
2. The conversation stops. A "Confirmation needed" panel appears with Confirm and
   Decline.
3. Only if the person clicks Confirm does the server mint a **one-time confirmation
   token**. That token is minted by exactly one function, reachable through exactly one
   owner-only REST route — never through any tool the agent can call.
4. `execute_action` accepts that token once, for that exact device, action and
   parameters, and only after re-checking the automation policy. Then it writes an audit
   entry recording the person as the actor.

Try to skip any of that and the call is refused with a narrated reason, not a silent
no-op: no token, an unknown token, an unapproved proposal, a replayed token, a token
approved for a different action, or a policy denial at execute time. Each of those is
covered by its own test.

The result is a smart home an agent can operate fluently and cannot operate unilaterally,
with an append-only audit log that says who decided what and why.

### Use case

A household that wants voice control across every brand of device it owns, without
granting an autonomous agent the standing authority to unlock doors, run appliances, or
change the thermostat. The gate is the product: the agent does the discovery, the
sequencing and the policy reasoning; the person keeps the decision.

### How it is built

- **MCP server** (`server/`) — Express 5 + the official `@modelcontextprotocol/sdk`,
  speaking **Streamable HTTP at spec revision `2025-11-25`** on `/mcp` (POST, GET,
  DELETE, with full session-id issuance, reuse and termination). Eight tools: four
  read-only (`list_devices`, `get_device_state`, `check_automation_policy`,
  `read_audit_log`) and two propose/execute pairs (`propose_action`/`execute_action`,
  `compose_scene`/`execute_scene`).
- **Simulated Alexa+ client** (`client/`) — a React conversation UI with no bundler and
  no build step (React loads from a CDN import map). It is a genuinely separate project:
  its own `package.json`, and it imports nothing from `server/` — it reaches the server
  only over HTTP, which the entry's `verify.sh` enforces with a cross-import check.
- **The approval boundary** — `ProposalStore.approve()` is the only code in the system
  that ever sets a confirmation token, and its only caller is the owner-only
  `POST /proposals/:id/approve` REST route. No MCP tool wraps it. That is what makes
  "only a person can authorize a change" a property of the architecture rather than a
  promise in a prompt.
- **Deterministic by default** — the planner walks a scripted conversation, so the demo
  and the tests run identically with no LLM and no API key.

### AWS services and technologies used

**Claimed and verified (2026-09-11, see [issue #32](https://github.com/guptachetan1995/hackathons-2026/issues/32)/[#124](https://github.com/guptachetan1995/hackathons-2026/issues/124)):** the AWS Builder mini-challenge is claimed. Two AWS services are actually
incorporated:

- **Amazon Bedrock** (Converse API, tool-use loop) as an optional planner
  (`PLANNER=bedrock`, [#122](https://github.com/guptachetan1995/hackathons-2026/issues/122)), model `amazon.nova-micro-v1:0` in `ap-southeast-2` — it replaces the
  scripted planner's turn selection with real model reasoning, while every tool call
  still routes through the same MCP client chokepoint and every proposal still requires
  the same human confirm gate; the model has no path to mint its own confirmation token.
  Proven against real AWS, not just mocked: a live `ConverseCommand` call from AWS
  CloudShell, using that environment's own ambient credentials, returned a genuine
  tool-use decision (`list_devices`) with `HTTP 200` — the same call shape
  `client/server.js`'s `POST /bedrock/converse` route makes.
- **AWS EC2** hosts the MCP server itself at a real, public, judge-testable URL:
  `http://16.176.3.215:3000/mcp` (`t3.micro`, Amazon Linux 2023, `ap-southeast-2`),
  verified with a real `initialize` handshake returning `HTTP 200`. (AWS App Runner —
  the original plan in [#123](https://github.com/guptachetan1995/hackathons-2026/issues/123) — turned out to need an AWS Organizations "all features"
  migration this account hasn't made; EC2 was the deploy path that didn't need it.)

Technologies used are listed under [Built with](#built-with).

### What it does not claim

This entry does **not** use the Alexa+ MCP Toolkit and does **not** ship an Agent Skill.
It takes the other route the track's rules allow: a self-hosted MCP server on the required
spec revision and transport, driven by a simulated Alexa+ experience in a web app. Every
tool call in that client is a real call to the real server — nothing is mocked — but the
Alexa surface itself is simulated, and no Alexa device was in the loop.

---

## Built with

*Devpost "Built With" tags.*

`model-context-protocol` · `mcp` · `streamable-http` · `json-rpc` · `node.js` ·
`javascript` · `express` · `react` · `zod` · `jest` · `supertest` · `eslint` · `npm` ·
`html` · `css` · `alexa`

Versions are pinned in `../package.json` and `../client/package.json`:

| Component | Version | Where |
|---|---|---|
| Node.js | >= 20 (`engines`) | both packages |
| `@modelcontextprotocol/sdk` | ^1.30.0 | server |
| Express | ^5.2.1 | server |
| Zod | ^4.5.4 | server |
| Jest | ^30.5.1 | server (dev) |
| Supertest | ^7.2.2 | server (dev) |
| ESLint | ^10.10.0 | server (dev) |
| React | 18.3.1 (CDN import map) | client |
| `node:test` | built in | client |
| MCP spec revision | 2025-11-25 | `server/src/server.js` |

---

## Track selection

**Primary track: Alexa+.**

---

## Mini-challenge selections

| Mini-challenge | Selected | Why |
|---|---|---|
| **Open Source** | **Yes** | New MIT-licensed project created inside the submission window. |
| **AWS Builder** | **Yes** | Amazon Bedrock planner (#122), proven live via CloudShell with real credentials, plus AWS EC2 hosting for the MCP server (#124). Revised 2026-09-10, see #32; verified 2026-09-11. |

Both decisions are recorded as binding in `../SPEC.md` §9.

### AWS Builder mini-challenge — required field

The live form's exact prompt: *"AWS Builder Mini Challenge Submission Requirement:
Which AWS services did you incorporate and how? If no description/write up provided,
you will not be considered for the AWS Builder Mini Challenge."*

Final answer, pasted into the live Devpost submission 2026-09-11:

> Two AWS services power this entry. **Amazon Bedrock** (Converse API, tool-use loop,
> model `amazon.nova-micro-v1:0`) is an optional planner (`PLANNER=bedrock`) that
> replaces the scripted demo's fixed turn sequence with real model reasoning: given the
> user's request and the MCP server's tool schemas, it decides which tool to call and
> when to propose an action — but every execution still requires the same human
> confirmation gate the scripted planner uses, and the model has no path to mint a
> confirmation token itself. Proven against real AWS: a live Converse call from AWS
> CloudShell, using that environment's own credentials, returned a genuine tool-use
> decision (HTTP 200). **AWS EC2** hosts the MCP server itself at a real, public,
> judge-testable URL (`http://16.176.3.215:3000/mcp`, `t3.micro`, Amazon Linux 2023,
> `ap-southeast-2`), verified with a real MCP `initialize` handshake returning HTTP 200.

### Open Source mini-challenge — required fields

The live rules ask for four specific fields:

| Field | Value |
|---|---|
| **Contribution URL** | `https://github.com/guptachetan1995/hackathons-2026/tree/main/entries/alexa-plus` |
| **Project repository URL** | `https://github.com/guptachetan1995/hackathons-2026` |
| **GitHub username** | `guptachetan1995` |
| **Description of the work** | See below. |

**Description of work, how it functions, and why it matters:**

> A new, MIT-licensed MCP server and simulated Alexa+ client for smart home control,
> written from scratch during the hackathon window. It implements the Model Context
> Protocol's Streamable HTTP transport at spec revision 2025-11-25 and exposes eight
> tools covering device discovery, state reads, automation-policy checks, an append-only
> audit log, and two propose/execute pairs for single actions and multi-device scenes.
>
> It functions as two independent processes that share no code: the MCP server, and a
> zero-build React client that reaches it only over HTTP. Mutations are gated by a
> one-time confirmation token that only a person's Confirm control can mint — the
> minting route is plain REST and is deliberately not exposed as an MCP tool, so no
> agent tool call can reach it. Every way of trying to bypass that gate returns a
> narrated refusal, each covered by a test.
>
> It matters because the hard part of putting an agent in a home is not capability, it is
> authority. Most agent demos gate risky actions with a confirmation the agent itself
> can route around. This one makes the gate structural: there is exactly one function
> that mints authorization, and nothing on the agent's side of the wire can call it. The
> pattern generalizes past smart homes to any agent that touches the physical or
> financial world, and the whole thing is MIT-licensed and runs offline with no API key.

**`[owner]`** The repository is **private** as of this write-up. The Open Source
mini-challenge and the "public repository" requirement both need it public before
submitting — see [Owner steps](#owner-steps-before-submitting).

---

## Product feedback

*Devpost field: which tools/APIs/SDKs were used, what worked well, what needs work,
onboarding experience, whether you'd build with them again. Graded.*

**Paste the full contents of [`feedback.md`](feedback.md).** It covers ten dependencies
in exactly that five-part shape: `@modelcontextprotocol/sdk`, Express, Zod, ESLint, Jest,
Supertest, React (via CDN import map), the MCP Inspector CLI, npm, and Node.js.

The two findings most worth the reviewer's attention:

- `createMcpExpressApp()` ships **no CORS handling**, and the failure mode is a bare
  `Failed to fetch` in the browser with the real cause (a preflight 404 and a missing
  `Access-Control-Expose-Headers: Mcp-Session-Id`) visible only in the console. A Node
  integration test cannot catch it, because Node's `fetch` is not subject to CORS.
- Jest 30 renamed `--testPathPattern` to `--testPathPatterns` as a **hard error with no
  deprecated alias**, so every still-current Jest tutorial produces a first-run failure.

---

## Friction log

*Optional field; the rules state submissions including friction logs "score higher in
judging (up to 10% bonus)".*

**Paste the full contents of [`friction-log.md`](friction-log.md).** Four entries, each in
the rules' requested shape (task / steps / expected vs. actual / severity / workaround /
suggestion), indexed by severity at the end of that file: one Medium (the CORS gap) and
three Low.

That file's own header states plainly that its git history contains exactly four entries
and that no fifth was invented to hit a round number. That claim is checkable:

```bash
git log -p -- entries/alexa-plus/docs/friction-log.md
```

---

## Feature requests

*Optional field: description, why it matters, priority (Critical / Important /
Nice-to-have).*

Each of these is the `Suggestion:` field of a friction-log entry, restated as a request.
Nothing here is new — every one traces to a problem actually hit during the build.

| # | Request | Why it matters | Priority |
|---|---|---|---|
| 1 | Give `createMcpExpressApp()` an opt-in `cors` option (allowed origins, and whether to expose `Mcp-Session-Id`). | Any MCP server called from a browser client on another origin needs this every single time, and the missing-exposed-header failure is invisible until you already know to look for it. A "simulated Alexa+ web client" is exactly that shape. | Important |
| 2 | Document that `createMcpExpressApp()`'s middleware (JSON body parsing, DNS-rebinding host validation) applies to the **whole** returned app, not just the MCP endpoint. | A caller who assumes it is scoped to `/mcp` can double-install a body parser (Express throws) or, worse, assume their own route has no Host-header protection when it silently does. Today the only way to learn this is reading the package source. | Important |
| 3 | Reconcile the MCP spec's "Unknown tools → Protocol Errors" worked example with the reference SDK, which returns unknown tools as an `isError: true` tool result instead. | The spec chose that exact case as its illustrative example, and the reference implementation disagrees with it — which is precisely where someone writing spec-literal conformance tests will look first. | Nice-to-have |
| 4 | Have Jest keep `--testPathPattern` working as a deprecated alias for one major version. | The rename is a hard failure with no grace period, and the new name is discoverable only from the error message. Every existing Jest tutorial is now a first-run failure. | Nice-to-have |

---

## Pre-existing project disclosure

*Devpost field: "Documentation of any pre-hackathon work (with clear separation of new
code)".*

**There is none.** Every file under `entries/alexa-plus/` was created inside the
submission window, in this repository, which was itself created on **7 September 2026**.
No code was copied from any earlier project. The repository's own convention (`CLAUDE.md`,
"Nothing copied from other repos") forbids it: ideas from earlier work may be
re-implemented, files may not be copied.

Checkable:

```bash
git log --reverse --format='%h %ad %s' --date=short -- entries/alexa-plus | head -1
git log --diff-filter=A --format='%ad %s' --date=short -- entries/alexa-plus/server/src/server.js
```

The build is traceable to seven issues, each with its own pull request: #33 (platform
research and `SPEC.md`), #34 (server scaffold + two tools + conformance tests), #35 (the
simulated client), #36 (the remaining six tools and the propose/confirm/execute
lifecycle), #37 (feedback + friction-log consolidation), #39 (the demo video script), and
#38 (README, license, architecture, this write-up). The two remaining open issues, #32
and #40, are both human-only by design and are listed under
[Owner steps](#owner-steps-before-submitting).

---

## Demo video

**`[owner]`** Record from [`video-script.md`](video-script.md) and paste the public
YouTube or Vimeo URL here.

The script is complete and timed: **2:25 scripted, 2:42 hard ceiling**, nine scenes with
verbatim narration, an exact seeded starting state, and a documented trim order if a take
runs long. It shows all four required beats — the conversation, live tool calls, a
confirmed action that executes, and a refused one that does not.

The live rules say **"less than three (3) minutes"** and that judges are not required to
watch beyond three minutes. The script is comfortably inside that.

---

## Repository URL

`https://github.com/guptachetan1995/hackathons-2026` — the entry lives at
`entries/alexa-plus/`.

The rules require the repository to be public, with an open-source license file, and the
license visible in the repository's About section. Both LICENSE files are in place and
MIT: the repository root's (which is what GitHub reads for the About section) and this
entry's own at `entries/alexa-plus/LICENSE`. **`[owner]`** The repository is still
private; making it public is the remaining step.

---

## Judging criteria — where to look

The four criteria are equally weighted.

| Criterion | The strongest evidence |
|---|---|
| **Tech Implementation** | A from-scratch Streamable HTTP MCP server on spec revision 2025-11-25, verified by an off-the-shelf client (the MCP Inspector CLI) rather than only by its own bundled one. 41 server conformance tests across 7 suites plus 5 client integration tests that spawn the real server as a separate process. |
| **Design** | The gate is the interaction model, not a dialog bolted on: propose, pause, Confirm or Decline, execute or narrate. The demo deliberately shows both outcomes of the same gate in one run. |
| **Potential Impact** | Agent authority in the physical home is the actual blocker to adoption, and this makes the authority boundary structural — one function mints authorization and nothing agent-side can call it. The pattern generalizes to any agent that touches the world. |
| **Quality of the Idea** | The insight is that a confirmation an agent can route around is not a confirmation. Making token-minting unreachable from the tool surface — and testing every bypass — is what separates this from a confirmation-dialog demo. |

---

## Live-rules deltas

Differences found on 8 Sep 2026 between the live rules pages and the checklist copied
verbatim into `../SPEC.md` §11. SPEC.md's copy is left as-is (it is the pinned contract);
these are the readings to honor.

| Topic | SPEC.md §11 | Live rules | Effect |
|---|---|---|---|
| Video length | "approximately 3 minutes" | "less than three (3) minutes" (hard max) | None — the script targets 2:25 with a 2:42 ceiling, inside both readings. |
| Open Source fields | not enumerated | contribution URL, repo URL, GitHub username, description | All four supplied above. |
| Feature requests | not mentioned | optional field with a priority rating | Supplied above. |
| Friction log | not mentioned | optional, up to a 10% judging bonus | `friction-log.md` supplied. |
| Alexa+ route | "using the Alexa+ MCP Toolkit or Agent Skills" | a self-hosted MCP server (min spec 2025-11-25, Streamable HTTP) **or** a simulated Alexa+ experience | We take the second route and say so plainly; neither the Toolkit nor an Agent Skill is used. |
| License visibility | "open-source license" | must be "visible in the About section" of a public repo | Root LICENSE is MIT (what GitHub reads); repo must be made public. |

---

## Submission checklist — every line, with evidence

`../SPEC.md` §11, line by line. "Evidence" is a file path or real command output — no
line is ticked on assertion alone.

### Required Submissions

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 1 | Text description explaining functionality, use case, and any AWS services/technologies used | **In progress** | [AWS services used](#aws-services-and-technologies-used) above — Bedrock planner (#122) + App Runner hosting (#123/#124) not yet built; do not submit the final write-up until they're real. |
| 2 | Public GitHub repository with source code and open-source license | **Owner** | Both LICENSE files present and MIT (`LICENSE` at repo root, `entries/alexa-plus/LICENSE`); `verify.sh` asserts the entry LICENSE begins `MIT License`. Repo is currently private — making it public is the owner's step. |
| 3 | Demo video approximately 3 minutes, public on YouTube/Vimeo | **Owner** | [`video-script.md`](video-script.md): 9 scenes, verbatim narration, 2:25 scripted / 2:42 ceiling. Recording and upload are the owner's step. |
| 4 | Product feedback on all tools and APIs used (graded) | **Done** | [`feedback.md`](feedback.md) — 10 dependencies, each with what-for / worked / needs-work / onboarding / build-again. |
| 5 | Track and mini-challenge selections | **In progress** | Alexa+; Open Source yes, AWS Builder **yes** (revised 2026-09-10, see #32). Pinned in `../SPEC.md` §9, restated above with the four required Open Source fields. |
| 6 | Documentation of any pre-hackathon work | **Done** | [Pre-existing project disclosure](#pre-existing-project-disclosure) — none, with the git commands that prove it. |

### Track-Specific Requirements (Alexa+)

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 7 | Working Alexa+ integration using the Alexa+ MCP Toolkit or Agent Skills | **Alternative route** | Neither the Toolkit nor an Agent Skill is used. Instead: a self-hosted MCP server on spec `2025-11-25` over Streamable HTTP (`server/src/server.js`) plus a simulated Alexa+ web client (`client/`) — the alternative the live rules allow for this track. Stated plainly, not claimed as Toolkit usage. |
| 8 | Functional demo video showing the MCP server responding and tools being invoked | **Owner** | [`video-script.md`](video-script.md) scenes 1–9 cover exactly this, including a live refusal via the MCP Inspector CLI. |
| 9 | MCP server accessible via remote URL with response latency under 500 ms | **Deployed and reachable; latency depends on tester location** | Live at `http://16.176.3.215:3000/mcp` (AWS EC2, `ap-southeast-2`, #124) — verified with a real `initialize` handshake returning `HTTP 200`. Loopback `tools/call` round-trip is still 0.62–1.17 ms (unchanged — the server itself adds no measurable latency). End-to-end latency measured from the deploying session's US-based test origin is 570–700 ms, over the 500 ms line; a `curl` timing breakdown shows ~290 ms of that is the TCP connect round trip alone, i.e. real network distance to `ap-southeast-2` rather than server processing. A tester within Australia/APAC would measure comfortably under 500 ms. |
| 10 | OAuth 2.1 with PKCE (if server requires authentication) | **Not applicable as written; a real gap for onboarding** | The server requires no authentication, so the conditional does not trigger. `../SPEC.md` §7 records `auth.js` as deliberately deferred. Amazon's Alexa+ onboarding docs do require OAuth 2.1 + PKCE (S256) for a real add-on — documented as a known limitation, not papered over. |
| 11 | Documentation of how to onboard the MCP server to Alexa+ | **Done** | [`architecture.md` §4](architecture.md#4-onboarding-this-mcp-server-to-alexa) — every documented requirement with this server's actual status against it, sourced from Amazon's MCP QuickStart, MCP Toolkit overview, and account-linking pages. |

### Additional Requirements

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 12 | All project code and documentation in English | **Done** | Every source file and every document in `entries/alexa-plus/` is English; the only non-ASCII characters are typographic (em dashes, curly quotes, the degree sign in temperatures). |
| 13 | Only fictional or masked data in samples and tests | **Done** | `server/data/devices.json` — five invented devices in an invented house. No real address, account, network or personal identifier appears anywhere; no external device API is contacted. |
| 14 | Setup and installation instructions in README | **Done** | `../README.md` Setup / Run / Test / Lint / Verify, plus the client's own three commands and the off-the-shelf Inspector CLI section. Re-run from a clean checkout for this write-up — output in the pull request. |
| 15 | Privacy and security notes for integrations | **Done** | `../README.md` § "Privacy and security notes". |
| 16 | No secrets, API keys, or personal information in the repository | **Done** | No credential of any kind is read or stored; there is no `.env` and no auth path. A scan for key/secret/password/token/private-key patterns across the entry (excluding `node_modules`) returns only the literal words inside `verify.sh`'s own check list and SPEC.md's checklist text. |
| 17 | Verify that the project passes its own test suite before submission | **Done** | From a clean checkout: server `npm run lint` clean, `npm test` **41 passed, 7 suites**; client `npm test` **5 passed**; `bash verify.sh` passes end to end. Literal output in the pull request. |

**Summary: 12 lines done or ready to paste, 3 waiting on the owner (make the repo public,
record and upload the video, submit), 1 taken by a documented alternative route (7), and
2 honest gaps stated as limitations rather than claimed (9 hosting, 10 OAuth).**

---

## Owner steps before submitting

Everything below is human-only under `CLAUDE.md`'s design watches — no agent goal does
any of it. Two open issues carry these steps: **#32** (register on Devpost, create an AWS
Builder ID, choose the mini-challenges) and **#40** (record the video, publish, submit).

1. **Make the repository public** and confirm the MIT license shows in the About section.
   (Required by checklist line 2 *and* by the Open Source mini-challenge.)
2. **Record the demo video** from [`video-script.md`](video-script.md), upload it publicly
   to YouTube or Vimeo, and paste the URL into [Demo video](#demo-video) above.
3. **Optional, if a public endpoint is wanted for checklist line 9:** deploy the server
   behind an HTTPS URL. Not required for the simulated-experience route this entry takes;
   it would be required to onboard a real Alexa+ add-on, which would also need the OAuth
   2.1 + PKCE work that `../SPEC.md` §7 defers.
4. **Register on Devpost** (issue #32, if not already done) **and submit**, pasting: the
   text description, the Built With tags,
   the repository URL, the video URL, the full text of `feedback.md`, the full text of
   `friction-log.md`, the feature requests, the pre-existing-work disclosure, the track
   selection (Alexa+), and the mini-challenge selection (Open Source) with its four
   required fields.
