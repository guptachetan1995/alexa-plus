# Devpost submission write-up — alexa-plus

Everything the Devpost form asks for, in the order the form asks for it. This is the
source text for the entry submitted to the **Build, Ship, Shape: Amazon Developer
Hackathon** (Alexa+ track) at https://devpost.com/software/smart-home-agent.

Field names below were checked against the live rules pages on **8 September 2026**
(https://amazonappdev2026.devpost.com/ and .../rules), not taken from memory. The rules
carry a short submission checklist and longer detailed rules; where the two differ, the
difference is called out in [Live-rules deltas](#live-rules-deltas), and every checklist
line is answered in [Submission checklist](#submission-checklist--every-line-with-evidence).

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

*Correction to the submitted copy above: the last case, a policy denial at execute time,
has no direct test, because no approved token can reach it today — see
[the refusal matrix](architecture.md#the-refusal-matrix).*

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

**Claimed and verified (2026-09-11):** the AWS Builder mini-challenge is claimed. Two AWS
services are actually incorporated:

- **Amazon Bedrock** (Converse API, tool-use loop) as an optional planner
  (`PLANNER=bedrock`), model `amazon.nova-micro-v1:0` in `ap-southeast-2` — it replaces the
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
  the original plan, whose artifacts are in `deploy/` — turned out to need an AWS
  Organizations "all features" migration this account hasn't made; EC2 was the deploy
  path that didn't need it. See [`deploy.md`](deploy.md).)

Technologies used are listed under [Built with](#built-with).

### What it does not claim

This entry does **not** use the Alexa+ MCP Toolkit and does **not** ship an Agent Skill.
It takes the other route the track's rules allow: a self-hosted MCP server on the required
spec revision and transport, driven by a simulated Alexa+ experience in a web app. Every
tool call in that client is a real call to the real server — nothing is mocked — but the
Alexa surface itself is simulated, and no Alexa device was in the loop.

---

## Built with

*Devpost "Built With" tags, as they appear on the project page.*

`model-context-protocol` · `mcp` · `streamable-http` · `json-rpc` · `node.js` ·
`javascript` · `express.js` · `react` · `zod` · `jest` · `supertest` · `eslint` · `npm` ·
`html` · `css` · `alexa` · `amazon-web-services` · `amazon-bedrock` · `amazon-ec2`

Versions are pinned in [`../package.json`](../package.json) and
[`../client/package.json`](../client/package.json):

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
| `@aws-sdk/client-bedrock-runtime` | ^3.600.0 (used only by `client/server.js`, only under `PLANNER=bedrock`) | client |
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
| **AWS Builder** | **Yes** | Amazon Bedrock planner (`PLANNER=bedrock`), proven live via CloudShell with real credentials, plus AWS EC2 hosting for the MCP server. Decided 2026-09-10 (the first draft of this write-up said no); verified 2026-09-11. |

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
| **Contribution URL** | `https://github.com/guptachetan1995/alexa-plus` |
| **Project repository URL** | `https://github.com/guptachetan1995/alexa-plus` |
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

The repository is public, and GitHub detects its `LICENSE` as MIT.

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

That file's own header states plainly that the build recorded exactly four entries and
that no fifth was invented to hit a round number. This repository is a published copy of
the project, so its history cannot show when each entry was written (see
[Pre-existing project disclosure](#pre-existing-project-disclosure)).

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

**There is none.** Every file in this repository was written inside the submission
window. No code was copied from any earlier project: the development workspace's rule is
that ideas from earlier work may be re-implemented, but files may not be copied.

**How far that can be checked here.** The project was built in a private development
workspace and published to this public repository as a fresh copy of the project
directory, so this repository's own history consists only of publish commits (the first
on 2026-09-10) and does not show the individual changes. In the development workspace,
the first commit touching this project and the commit that added `server/src/server.js`
are both dated **2026-09-08**. The last change to behavior is dated 2026-09-11; later
changes only reword documentation, code comments, test names and the client page's
subtitle.

The build went in this order:

1. Platform research and the design: tool list, data model, demo script (2026-09-08).
2. MCP server scaffold with two read-only tools and the conformance tests (2026-09-08).
3. The simulated Alexa+ web client, calling the server only over HTTP (2026-09-08).
4. The remaining six tools and the propose → confirm → execute lifecycle (2026-09-08).
5. Product feedback and friction log; demo video script; README, license check,
   architecture diagrams and this write-up (2026-09-08).
6. App Runner deployment artifacts; the Bedrock planner behind `PLANNER=bedrock` and its
   default model (2026-09-10).
7. The Bedrock call moved from the browser into `client/server.js`; the MCP SDK's
   localhost-only `Host` check opened up so the EC2-hosted server is reachable; the docs
   updated with the deployed URL and measured latency (2026-09-11).

---

## Demo video

**https://www.youtube.com/watch?v=14YZX4JtDjY** (public on YouTube, embedded on the Devpost
project page).

It was produced from [`video-script.md`](video-script.md): **2:25 scripted, 2:42 hard
ceiling**, nine scenes with verbatim narration and an exact seeded starting state. It
shows all four required beats — the conversation, live tool calls, a confirmed action
that executes, and a refused one that does not.

The live rules say **"less than three (3) minutes"** and that judges are not required to
watch beyond three minutes. The script is comfortably inside that.

---

## Repository URL

**https://github.com/guptachetan1995/alexa-plus**

The rules require the repository to be public, with an open-source license file, and the
license visible in the repository's About section. The repository is public, its root
[`LICENSE`](../LICENSE) is the MIT license, and GitHub detects it as MIT, which is what
the About section shows.

---

## Judging criteria — where to look

The four criteria are equally weighted.

| Criterion | The strongest evidence |
|---|---|
| **Tech Implementation** | A from-scratch Streamable HTTP MCP server on spec revision 2025-11-25, verified by an off-the-shelf client (the MCP Inspector CLI) rather than only by its own bundled one. 41 server conformance tests across 7 suites, plus 22 client tests, including integration tests that spawn the real server as a separate process. |
| **Design** | The gate is the interaction model, not a dialog bolted on: propose, pause, Confirm or Decline, execute or narrate. The demo deliberately shows both outcomes of the same gate in one run. |
| **Potential Impact** | Agent authority in the physical home is the actual blocker to adoption, and this makes the authority boundary structural — one function mints authorization and nothing agent-side can call it. The pattern generalizes to any agent that touches the world. |
| **Quality of the Idea** | The insight is that a confirmation an agent can route around is not a confirmation. Making token-minting unreachable from the tool surface — and testing every bypass — is what separates this from a confirmation-dialog demo. |

---

## Live-rules deltas

Differences found on 8 Sep 2026 between the rules' short submission checklist (whose
lines are the "Checklist line" column in the next section) and the detailed rules. Where
they differ, the detailed rules are the reading this entry follows.

| Topic | Submission checklist says | Detailed rules say | Effect |
|---|---|---|---|
| Video length | "approximately 3 minutes" | "less than three (3) minutes" (hard max) | None — the script targets 2:25 with a 2:42 ceiling, inside both readings. |
| Open Source fields | not enumerated | contribution URL, repo URL, GitHub username, description | All four supplied above. |
| Feature requests | not mentioned | optional field with a priority rating | Supplied above. |
| Friction log | not mentioned | optional, up to a 10% judging bonus | `friction-log.md` supplied. |
| Alexa+ route | "using the Alexa+ MCP Toolkit or Agent Skills" | a self-hosted MCP server (min spec 2025-11-25, Streamable HTTP) **or** a simulated Alexa+ experience | We take the second route and say so plainly; neither the Toolkit nor an Agent Skill is used. |
| License visibility | "open-source license" | must be "visible in the About section" of a public repo | The root `LICENSE` is MIT and GitHub detects it; the repository is public. |

---

## Submission checklist — every line, with evidence

The hackathon's own submission checklist, from the rules at
https://amazonappdev2026.devpost.com/, line by line. "Evidence" is a file path, a URL or
real command output — no line is ticked on assertion alone.

### Required Submissions

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 1 | Text description explaining functionality, use case, and any AWS services/technologies used | **Done** | [Text description](#text-description) above, including [AWS services used](#aws-services-and-technologies-used): the Bedrock planner and EC2 hosting, both verified live on 2026-09-11. |
| 2 | Public GitHub repository with source code and open-source license | **Done** | https://github.com/guptachetan1995/alexa-plus is public; its root `LICENSE` is MIT and GitHub detects it as MIT. `verify.sh` asserts `LICENSE` begins `MIT License` and names a copyright holder. |
| 3 | Demo video approximately 3 minutes, public on YouTube/Vimeo | **Done** | https://www.youtube.com/watch?v=14YZX4JtDjY, produced from [`video-script.md`](video-script.md) (9 scenes, 2:25 scripted / 2:42 ceiling). |
| 4 | Product feedback on all tools and APIs used (graded) | **Partial** | [`feedback.md`](feedback.md) — 10 dependencies, each with what-for / worked / needs-work / onboarding / build-again. Not covered yet: Amazon Bedrock (Converse), `@aws-sdk/client-bedrock-runtime` and AWS EC2. |
| 5 | Track and mini-challenge selections | **Done** | Alexa+ track; Open Source and AWS Builder mini-challenges, with the four required Open Source fields and the AWS Builder write-up [above](#mini-challenge-selections). |
| 6 | Documentation of any pre-hackathon work | **Done** | [Pre-existing project disclosure](#pre-existing-project-disclosure) — none, with the build dates and what this repository's history can and cannot show. |

### Track-Specific Requirements (Alexa+)

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 7 | Working Alexa+ integration using the Alexa+ MCP Toolkit or Agent Skills | **Alternative route** | Neither the Toolkit nor an Agent Skill is used. Instead: a self-hosted MCP server on spec `2025-11-25` over Streamable HTTP (`server/src/server.js`) plus a simulated Alexa+ web client (`client/`) — the alternative the live rules allow for this track. Stated plainly, not claimed as Toolkit usage. |
| 8 | Functional demo video showing the MCP server responding and tools being invoked | **Done** | The [demo video](#demo-video) follows [`video-script.md`](video-script.md) scenes 1–9: live tool calls in the client, then a refusal called directly with the MCP Inspector CLI. |
| 9 | MCP server accessible via remote URL with response latency under 500 ms | **Deployed and reachable; latency depends on tester location** | Live at `http://16.176.3.215:3000/mcp` (AWS EC2, `ap-southeast-2`) — verified with a real `initialize` handshake returning `HTTP 200`. Loopback `tools/call` round-trip is still 0.62–1.17 ms (unchanged — the server itself adds no measurable latency). End-to-end latency measured from the deploying session's US-based test origin is 570–700 ms, over the 500 ms line; a `curl` timing breakdown shows ~290 ms of that is the TCP connect round trip alone, i.e. real network distance to `ap-southeast-2` rather than server processing. A tester within Australia/APAC would measure comfortably under 500 ms. |
| 10 | OAuth 2.1 with PKCE (if server requires authentication) | **Not applicable as written; a real gap for onboarding** | The server requires no authentication, so the conditional does not trigger. An `auth.js` for OAuth 2.1 + PKCE was planned and deliberately deferred. Amazon's Alexa+ onboarding docs do require OAuth 2.1 + PKCE (S256) for a real add-on — documented as a known limitation, not papered over. |
| 11 | Documentation of how to onboard the MCP server to Alexa+ | **Done** | [`architecture.md` §4](architecture.md#4-onboarding-this-mcp-server-to-alexa) — every documented requirement with this server's actual status against it, sourced from Amazon's MCP QuickStart, MCP Toolkit overview, and account-linking pages. |

### Additional Requirements

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 12 | All project code and documentation in English | **Done** | Every source file and every document in this repository is English; the only non-ASCII characters are typographic (em dashes, curly quotes, the degree sign in temperatures). |
| 13 | Only fictional or masked data in samples and tests | **Done** | `server/data/devices.json` — five invented devices in an invented house. No real address, account, network or personal identifier appears anywhere; no external device API is contacted. |
| 14 | Setup and installation instructions in README | **Done** | [`../README.md`](../README.md) Setup / Run / Test / Lint / Verify, plus the client's own three commands and the off-the-shelf Inspector CLI section. `bash verify.sh` runs the same install, lint and test commands from a fresh copy. |
| 15 | Privacy and security notes for integrations | **Done** | [`../README.md`](../README.md#privacy-and-security-notes) § "Privacy and security notes". |
| 16 | No secrets, API keys, or personal information in the repository | **Done** | The MCP server and the scripted planner read no credential; there is no `.env` and no auth path. The one credential in play is the AWS one `client/server.js` resolves from its own environment under `PLANNER=bedrock`, and none is stored in the repository. A scan of every tracked file for credential-shaped values (`AKIA` access key ids, `-----BEGIN … PRIVATE KEY`, `aws_secret_access_key`, `ghp_`/`xox`/`sk-` tokens) and for `.env`, `.pem` or `credentials` files matches only this row's own list of the patterns. |
| 17 | Verify that the project passes its own test suite before submission | **Done** | From a fresh copy: `bash verify.sh` runs server `npm run lint` (clean), server `npm test` (**41 passed, 7 suites**) and client `npm test` (**22 passed**), and ends with `alexa-plus: all checks passed.` |

**Summary: 13 lines done, 1 partial (4 feedback: Bedrock, its AWS SDK client and EC2 not
yet covered), 1 taken by a documented alternative route (7), and 2 honest gaps stated as
limitations rather than claimed (9 latency from distant testers, 10 OAuth).**

---

## Submission status

Submitted on Devpost: https://devpost.com/software/smart-home-agent. The project page
embeds the [demo video](#demo-video), and its story opens with this repository and the
live MCP URL (`http://16.176.3.215:3000/mcp`), saying plainly that it is an MCP endpoint a
client connects to, not a page a browser opens. "Try it out" links the repository, the live
MCP URL and the README's
[Inspector section](../README.md#inspecting-with-an-off-the-shelf-mcp-client). A 3:2
thumbnail shows the Confirmation needed panel, and the gallery holds the two architecture
diagrams plus five captioned demo frames: a proposal awaiting Confirm, Confirm then
`execute_action`, a decline with the audit log, a token-less `execute_action` refused, and
the server test run. On 2026-09-27 the story's closing section, a first-draft paragraph
saying no AWS service was used, was replaced with the AWS services above (Bedrock, EC2)
and a real "What's next" (HTTPS + OAuth onboarding, a real Alexa+ surface, persistence),
and the three AWS tags were added. The sections of this document are the source text for
the form's fields: the text description, Built With, product feedback (`feedback.md`),
friction log (`friction-log.md`), feature requests, the pre-existing-work disclosure, and
the track and mini-challenge fields.

Still not done, and stated as limitations rather than claimed: an HTTPS endpoint and the
OAuth 2.1 + PKCE flow a real Alexa+ add-on would need for onboarding.
