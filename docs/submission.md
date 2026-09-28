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

**Smart Home Agent** (the Devpost title; unchanged).

Short tagline (Devpost "elevator pitch", 200 char max). **Paste to replace the current
one once the EC2 host runs the owner-key build** (the `curl` in
[`deploy.md`](deploy.md#redeploying-the-ec2-server-with-the-owner-key) step 7 answers
`401`); until then the live host's approve route does not check the owner's key, and the
pitch has no room for the caveat the story carries:

> An Alexa+ MCP server for the smart home where every device action is proposed, never
> taken. Only the owner's Confirm can mint the one-time token that lets the agent execute.

(173 characters.)

---

## Text description

*Devpost field: "About the project" (the story), which the rules call the "Text description
explaining the project functionality, use case, and any AWS services/technologies used".*

**Paste everything between the two rules below, replacing the whole current story** (its
headings are the story's own `##` headings). The one-line block quote marked "until the
redeploy" goes in only if the EC2 host has not yet been redeployed with the owner key —
check with the `curl` in [`deploy.md`](deploy.md#redeploying-the-ec2-server-with-the-owner-key)
step 7: `409` means old build (include the line), `401` means redeployed (leave it out).

---

Source code (MIT): [github.com/guptachetan1995/alexa-plus](https://github.com/guptachetan1995/alexa-plus). Live MCP server: `http://16.176.3.215:3000/mcp` on AWS EC2. It speaks MCP over Streamable HTTP, so a browser tab shows HTTP 400; connect an MCP client instead, for example `npx -y @modelcontextprotocol/inspector --cli http://16.176.3.215:3000/mcp --method tools/list` ([details](https://github.com/guptachetan1995/alexa-plus#inspecting-with-an-off-the-shelf-mcp-client)).

> Until the redeploy: the public host still runs the 2026-09-11 build, whose approve route predates the owner key; the redeploy steps are in [docs/deploy.md](https://github.com/guptachetan1995/alexa-plus/blob/main/docs/deploy.md#redeploying-the-ec2-server-with-the-owner-key).

## Inspiration

An agent that can unlock your front door can unlock it by mistake, or because something it read told it to. MCP gives hosts two ways to be careful: tool annotations, which are hints a host may act on, and elicitation, which is a way to ask the user. Neither one stops a call the host decides to make anyway, and a confirmation inside the agent's own loop is something the agent's side of the wire can skip.

We wanted approval to be enforcement instead: something the agent's side of the wire cannot produce, whatever the model decides. The people who need that are homes where more than one person has a say over the same devices: households running several brands of device, renters and landlords sharing a smart lock, and caregivers who need a record of who approved what.

## What it does

Smart Home Agent is a self-hosted MCP server that exposes a smart home through one interface, plus a simulated Alexa+ web client that drives it. The agent can discover devices, read their state, check the home's automation policy and compose multi-device scenes. It cannot change anything on its own.

Every change goes through propose → confirm → execute. The agent calls `propose_action` (or `compose_scene`), which records the proposal with its expected outcome, rationale and policy check, and changes nothing. The conversation stops on a "Confirmation needed" panel. Only the owner's Confirm mints a one-time confirmation token: exactly one function mints it, on an approve route that no MCP tool reaches and that requires the owner's key. `execute_action` accepts that token once, for that exact device, action and parameters, re-checks the automation policy, and only then changes the device and writes an audit entry naming the person as the actor.

In the demo the agent dims the living room light (the owner confirms, and the light's tile moves to 50%) and then proposes unlocking the front door (the owner declines, the door stays locked, and the audit log holds one entry: the light).

Try to skip the owner and the call is refused with a narrated reason, and nothing changes: no token, an unknown token, an unapproved proposal, a replayed token, a token approved for a different action, a policy that denies the action at execute time, or an approve call without the owner's key. Each of those has its own test.

## How we built it

- **MCP server** (`server/`) — Express 5 and the official `@modelcontextprotocol/sdk`, speaking Streamable HTTP at spec revision 2025-11-25 on `/mcp` (POST, GET, DELETE, with session-id issuance, reuse and termination). Eight tools: four read-only (`list_devices`, `get_device_state`, `check_automation_policy`, `read_audit_log`) and two propose/execute pairs (`propose_action`/`execute_action`, `compose_scene`/`execute_scene`). Each carries MCP tool annotations for hosts that prompt on them; the gate does not depend on them.
- **The approval boundary** — `ProposalStore.approve()` is the only code that ever sets a confirmation token. Its only caller is `POST /proposals/:id/approve`, which requires the owner key (`Authorization: Bearer`, compared as digests with `timingSafeEqual`) and answers browsers only from allowlisted origins. No MCP tool wraps it, so "only the owner can authorize a change" is a property of the architecture, not a promise in a prompt.
- **Simulated Alexa+ client** (`client/`) — a React conversation UI with no bundler and no build step, a separate project that imports nothing from `server/` and reaches it only over HTTP. Device tiles above the conversation are rebuilt from the real tool results, so a Confirm visibly changes a device and a Decline visibly does not.
- **Deterministic by default** — the scripted planner runs the demo and the tests with no LLM and no API key; `PLANNER=bedrock` swaps in Amazon Bedrock.
- **Tests** — 47 server tests (Jest and Supertest) and 25 client tests (`node:test`), including integration tests that spawn the real server as a separate process.

## Challenges we ran into

- The MCP SDK's `createMcpExpressApp()` ships no CORS handling, so a browser client on another origin fails with a bare "Failed to fetch" whose real cause (a preflight 404 and a missing `Access-Control-Expose-Headers: Mcp-Session-Id`) is invisible to a Node integration test.
- AWS App Runner could not be used: building the service from its GitHub source needed an AWS Organizations "all features" migration the account had not made, and `us-east-1` was blocked by a service control policy. The server went to EC2 in `ap-southeast-2` instead, which is why a US tester sees 570–700 ms end to end.
- `@aws-sdk/client-bedrock-runtime` in a zero-build browser page failed with a minified `TypeError: AC is not a function`; the real cause was the Node-only credential chain. The Bedrock call moved server-side, where credentials belong anyway.
- The planner's first default model, Claude 3.5 Sonnet, had left Bedrock's catalog; we switched to Nova Micro, in-Region in `ap-southeast-2`.

All seven friction points are written up in the [friction log](https://github.com/guptachetan1995/alexa-plus/blob/main/docs/friction-log.md).

## AWS services used

- **Amazon Bedrock** (Converse API, tool-use loop, model `amazon.nova-micro-v1:0`) is an optional planner (`PLANNER=bedrock`) that replaces the scripted turn sequence with real model reasoning. It is called from Node (`client/server.js`, or `client/bedrock-cli.js` in a terminal), never from the browser. Every tool call still goes through the same MCP client, and every change still needs the owner's Confirm: the model has no path to mint a confirmation token. Proven with a live Converse call from AWS CloudShell that returned a real tool-use decision (HTTP 200). A full run of the loop against the MCP server with a real model has not been recorded yet.
- **AWS EC2** hosts the MCP server at `http://16.176.3.215:3000/mcp` (`t3.micro`, Amazon Linux 2023, `ap-southeast-2`).
- **AWS App Runner** was the planned host; its container artifacts are in the repository, and the account restriction above kept it from being used.

This entry is also in the Open Source mini-challenge: a new, MIT-licensed project created inside the submission window.

## What's next

- An HTTPS endpoint (a route that needs no new account is written up in [docs/deploy.md](https://github.com/guptachetan1995/alexa-plus/blob/main/docs/deploy.md#https-without-a-new-account-not-done)) and the OAuth 2.1 + PKCE onboarding a real Alexa+ add-on needs, which would also replace the single owner key with per-person identity in the audit log.
- A real Alexa+ surface in the loop (the Alexa+ MCP Toolkit or an Agent Skill) in place of the simulated client.
- A recorded `PLANNER=bedrock` run against the live server.
- Persistence for devices, proposals and the audit log, which live in memory today.

---

### What the story does not claim

It does **not** say the entry uses the Alexa+ MCP Toolkit or ships an Agent Skill: it
takes the other route the track's rules allow, a self-hosted MCP server on the required
spec revision and transport driven by a simulated Alexa+ experience. Every tool call in
that client is a real call to the real server, but no Alexa device was in the loop. It
does not name or characterize other entries. And it does not claim a real-model
`PLANNER=bedrock` run against the server, which has not happened yet.

### Corrections this replaces

The story submitted on 2026-09-11 said the refusal cases, including "a policy denial at
execute time", were each "covered by its own test". That was not true then: the
execute-time policy re-check had no test. It has one now
(`server/test/execute-refusals.test.js`, which switches the policy to deny between the
owner's approval and the execute call), so the new story's sentence is true. The old
story also opened with brand fragmentation ("no unified way to discover what a home can
do"), which describes what Alexa already solves; the new one leads with authority.

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
| Node.js | >= 20 / >= 20.10 (`engines`) | server / client |
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
| **AWS Builder** | **Yes** | Amazon Bedrock planner (`PLANNER=bedrock`), a live Converse call proven from CloudShell with real credentials, plus AWS EC2 hosting for the MCP server. Decided 2026-09-10 (the first draft of this write-up said no); verified 2026-09-11. |

### AWS Builder mini-challenge — required field

The live form's exact prompt: *"AWS Builder Mini Challenge Submission Requirement:
Which AWS services did you incorporate and how? If no description/write up provided,
you will not be considered for the AWS Builder Mini Challenge."*

Pasted into the live Devpost submission 2026-09-11. **Paste this to replace it** (adds
where the Bedrock call runs, App Runner, and what has not been run yet):

> Two AWS services power this entry. **Amazon Bedrock** (Converse API, tool-use loop,
> model `amazon.nova-micro-v1:0`) is an optional planner (`PLANNER=bedrock`) that
> replaces the scripted demo's fixed turn sequence with real model reasoning: given the
> user's request and the MCP server's tool schemas, it decides which tool to call and
> when to propose an action. It runs from Node (`client/server.js` proxies the browser's
> Converse calls; `client/bedrock-cli.js` runs the same loop in a terminal such as AWS
> CloudShell), so no AWS credential reaches the browser. Every execution still requires
> the owner's Confirm, and the model has no path to mint a confirmation token. Proven
> against real AWS: a live Converse call from AWS CloudShell, on that environment's own
> credentials, returned a genuine tool-use decision (HTTP 200); a full real-model run of
> the loop against the MCP server has not been recorded yet. **AWS EC2** hosts the MCP
> server at a public, judge-testable URL (`http://16.176.3.215:3000/mcp`, `t3.micro`,
> Amazon Linux 2023, `ap-southeast-2`), verified with a real MCP `initialize` handshake
> returning HTTP 200. **AWS App Runner** was the planned host; an AWS Organizations
> "all features" requirement on this account blocked it, and its container artifacts
> remain in the repository. The Product Feedback answer covers all three services.

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
> one-time confirmation token that only the owner's Confirm can mint — the minting route
> is plain REST, requires the owner's key, and is deliberately not exposed as an MCP
> tool, so no agent tool call can reach it. Every way of trying to bypass that gate
> returns a narrated refusal, each covered by a test.
>
> It matters because the hard part of putting an agent in a home is not capability, it is
> authority. A confirmation step inside the agent's own loop is one the agent's side of
> the wire can skip. This one makes the gate structural: there is exactly one function
> that mints authorization, and nothing on the agent's side of the wire can call it. The
> pattern generalizes past smart homes to any agent that touches the physical or
> financial world, and the whole thing is MIT-licensed and runs offline with no API key.

**Paste the description above to replace the current one**, once the EC2 host runs the
owner-key build (the `curl` in [`deploy.md`](deploy.md#redeploying-the-ec2-server-with-the-owner-key)
step 7 answers `401`): its second paragraph now says the minting route requires the
owner's key, which the live host does not enforce until then. Its third paragraph no
longer characterizes other agent demos.

The repository is public, and GitHub detects its `LICENSE` as MIT.

The Contribution URL is the same repository as the track entry. The rules also accept "a
new, additional open-source project"; a separate repository for the approval gate
(`ProposalStore`, token mint and consume, the audit log) or an upstream contribution to
the MCP SDK would make the Open Source entry "additional" beyond doubt. Neither exists
yet; both are the owner's call.

---

## Product feedback

*Devpost field: which tools/APIs/SDKs were used, what worked well, what needs work,
onboarding experience, whether you'd build with them again. Graded.*

**Paste the full contents of [`feedback.md`](feedback.md), replacing the current
answer.** It covers fourteen tools, APIs and services in exactly that five-part shape:
`@modelcontextprotocol/sdk`, Express, Zod, ESLint, Jest, Supertest, React (via CDN
import map), the MCP Inspector CLI, npm, Node.js, **Amazon Bedrock** (Converse with Nova
Micro), **`@aws-sdk/client-bedrock-runtime`**, **AWS EC2** and **AWS App Runner** (tried).
Its opening paragraph states which AWS services are used and how, which the AWS Builder
rules ask for in this answer.

The findings most worth the reviewer's attention:

- App Runner's account prerequisites (AWS Organizations "all features"; `us-east-1`
  blocked by a service control policy) surfaced only at creation time and decided both
  the service and the region.
- `@aws-sdk/client-bedrock-runtime` in a browser fails with a minified `TypeError`, not a
  message saying the default credential chain is Node-only.
- `createMcpExpressApp()` ships **no CORS handling**, and the failure mode is a bare
  `Failed to fetch` in the browser with the real cause (a preflight 404 and a missing
  `Access-Control-Expose-Headers: Mcp-Session-Id`) visible only in the console. A Node
  integration test cannot catch it, because Node's `fetch` is not subject to CORS.

---

## Friction log

*Optional field; the rules state submissions including friction logs "score higher in
judging (up to 10% bonus)".*

**Paste the full contents of [`friction-log.md`](friction-log.md), replacing the current
answer.** Seven entries, each in the rules' requested shape (task / steps / expected vs.
actual / severity / workaround / suggestion), indexed by severity at the end of that
file: one High, three Medium, three Low. Three are about AWS (App Runner's account
prerequisites, the Bedrock model catalog, the Bedrock SDK in a browser), since Amazon's
own team assesses this log.

That file's header says where each entry comes from: entries 1–4 were written during the
server and client steps, and entries 5–7 were added on 2026-09-28 from what the Bedrock
and deployment steps recorded when they happened. This repository is a published copy of
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
| 5 | Show App Runner's account prerequisites (AWS Organizations "all features", regions a service control policy blocks) on the create-service page before the form is filled in. | Here they surfaced only as the reason creation could not proceed, and they decided both the service and the region — and so the latency every US tester sees. | Important |
| 6 | One filterable Bedrock table of model × Region × Converse feature (tool use first) × price, and a notice when a model id leaves the catalog. | The planner's first default had silently left the catalog, and confirming a cheap model supports Converse tool use meant a per-model docs check. | Important |
| 7 | Have `@aws-sdk/client-bedrock-runtime` throw a readable error when constructed in a browser with no explicit credentials. | The actual failure was a minified `TypeError: AC is not a function`, with nothing pointing at the Node-only credential chain. | Nice-to-have |

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
are both dated **2026-09-08**. Behavior changed on 2026-09-11 and again on
2026-09-28 (step 8 below); the changes between those dates only reworded documentation,
code comments, test names and the client page's subtitle.

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
8. After submission, inside the still-open submission window (2026-09-28): the owner key
   on the approve/reject routes and a `/proposals/*` origin allowlist; an injectable
   policy with a test for the execute-time policy re-check; MCP tool annotations; the
   client's device tiles, collapsed JSON, and the front-door unlock as the declined demo
   action; `client/bedrock-cli.js`; three AWS friction-log entries and four AWS feedback
   sections; the redeploy and HTTPS notes in `deploy.md`.

---

## Demo video

**https://www.youtube.com/watch?v=14YZX4JtDjY** (public on YouTube, embedded on the Devpost
project page).

That video (2:25, rendered 2026-09-10 and submitted 2026-09-11) shows the demo as it was
then: the kitchen plug as the declined action, and a subtitle that has since changed. [`video-script.md`](video-script.md) is now
the script for its replacement — the front-door unlock declined, the device tiles, the
live EC2 endpoint, the owner-key refusal, and optionally a real Bedrock run — **2:08
without the Bedrock beat, 2:24 with it, 2:42 hard ceiling**. Once it is rendered and
uploaded as Public, its link replaces the one above here, in the README and on Devpost.
Both show all four required beats — the conversation, live tool calls, a confirmed
action that executes, and a refused one that does not.

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
| **Tech Implementation** | A from-scratch Streamable HTTP MCP server on spec revision 2025-11-25, verified by an off-the-shelf client (the MCP Inspector CLI) rather than only by its own bundled one, with MCP tool annotations. 47 server tests across 7 suites, plus 25 client tests, including integration tests that spawn the real server as a separate process. Amazon Bedrock's Converse tool use as a planner, called only from Node; AWS EC2 hosting. |
| **Design** | The gate is the interaction model, not a dialog bolted on: propose, pause, Confirm or Decline, execute or narrate — and device tiles that visibly change on Confirm and visibly do not on Decline. The demo shows both outcomes of the same gate in one run, on a light and on the front door. |
| **Potential Impact** | Agent authority in the physical home is the actual blocker to adoption, most of all where several people share devices: households with several brands, renters and landlords sharing a lock, caregivers who need an audit of who approved what. The route to them is an Alexa+ add-on once OAuth 2.1 + PKCE onboarding is built. |
| **Quality of the Idea** | Annotations are hints and elicitation is UX; neither stops a call. Here the token that authorizes a change is minted on a route no tool reaches and only with the owner's key, every bypass is tested, and the audit log records every executed change. |

---

## Live-rules deltas

Differences found on 8 Sep 2026 between the rules' short submission checklist (whose
lines are the "Checklist line" column in the next section) and the detailed rules. Where
they differ, the detailed rules are the reading this entry follows.

| Topic | Submission checklist says | Detailed rules say | Effect |
|---|---|---|---|
| Video length | "approximately 3 minutes" | "less than three (3) minutes" (hard max) | None — the published video is 2:25, and the re-cut script runs 2:08 (2:24 with the Bedrock beat) with a 2:42 ceiling, inside both readings. |
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
| 1 | Text description explaining functionality, use case, and any AWS services/technologies used | **Done** | [Text description](#text-description) above, including [AWS services used](#aws-services-used): the Bedrock planner and EC2 hosting, both verified live on 2026-09-11. |
| 2 | Public GitHub repository with source code and open-source license | **Done** | https://github.com/guptachetan1995/alexa-plus is public; its root `LICENSE` is MIT and GitHub detects it as MIT. `verify.sh` asserts `LICENSE` begins `MIT License` and names a copyright holder. |
| 3 | Demo video approximately 3 minutes, public on YouTube/Vimeo | **Done; re-cut scripted** | https://www.youtube.com/watch?v=14YZX4JtDjY (2:25, Public). [`video-script.md`](video-script.md) is the script for its replacement (2:08, or 2:24 with the Bedrock beat; 2:42 ceiling), not yet rendered. |
| 4 | Product feedback on all tools and APIs used (graded) | **Done** | [`feedback.md`](feedback.md) — 14 tools, APIs and services, each with what-for / worked / needs-work / onboarding / build-again, including Amazon Bedrock (Converse), `@aws-sdk/client-bedrock-runtime`, AWS EC2 and AWS App Runner, and an opening paragraph on which AWS services are used and how. |
| 5 | Track and mini-challenge selections | **Done** | Alexa+ track; Open Source and AWS Builder mini-challenges, with the four required Open Source fields and the AWS Builder write-up [above](#mini-challenge-selections). |
| 6 | Documentation of any pre-hackathon work | **Done** | [Pre-existing project disclosure](#pre-existing-project-disclosure) — none, with the build dates and what this repository's history can and cannot show. |

### Track-Specific Requirements (Alexa+)

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 7 | Working Alexa+ integration using the Alexa+ MCP Toolkit or Agent Skills | **Alternative route** | Neither the Toolkit nor an Agent Skill is used. Instead: a self-hosted MCP server on spec `2025-11-25` over Streamable HTTP (`server/src/server.js`) plus a simulated Alexa+ web client (`client/`) — the alternative the live rules allow for this track. Stated plainly, not claimed as Toolkit usage. |
| 8 | Functional demo video showing the MCP server responding and tools being invoked | **Done** | The published [demo video](#demo-video) shows live tool calls in the client, then a refusal called directly with the MCP Inspector CLI. The scripted re-cut ([`video-script.md`](video-script.md)) adds `tools/list` against the live EC2 endpoint and the owner-key refusal. |
| 9 | MCP server accessible via remote URL with response latency under 500 ms | **Deployed and reachable; latency depends on tester location** | Live at `http://16.176.3.215:3000/mcp` (AWS EC2, `ap-southeast-2`) — verified with a real `initialize` handshake returning `HTTP 200`. Loopback `tools/call` round-trip is still 0.62–1.17 ms (unchanged — the server itself adds no measurable latency). End-to-end latency measured from the deploying session's US-based test origin is 570–700 ms, over the 500 ms line; a `curl` timing breakdown shows ~290 ms of that is the TCP connect round trip alone, i.e. real network distance to `ap-southeast-2` rather than server processing. A tester within Australia/APAC would measure comfortably under 500 ms. |
| 10 | OAuth 2.1 with PKCE (if server requires authentication) | **Not applicable as written; a real gap for onboarding** | The MCP endpoint requires no authentication, so the conditional does not trigger for the agent's surface; the owner-only approve/reject routes use a static owner key, not an OAuth flow. An `auth.js` for OAuth 2.1 + PKCE was planned and deliberately deferred. Amazon's Alexa+ onboarding docs do require OAuth 2.1 + PKCE (S256) for a real add-on — documented as a known limitation, not papered over. |
| 11 | Documentation of how to onboard the MCP server to Alexa+ | **Done** | [`architecture.md` §4](architecture.md#4-onboarding-this-mcp-server-to-alexa) — every documented requirement with this server's actual status against it, sourced from Amazon's MCP QuickStart, MCP Toolkit overview, and account-linking pages. |

### Additional Requirements

| # | Checklist line | Status | Evidence |
|---|---|---|---|
| 12 | All project code and documentation in English | **Done** | Every source file and every document in this repository is English; the only non-ASCII characters are typographic (em dashes, curly quotes, the degree sign in temperatures). |
| 13 | Only fictional or masked data in samples and tests | **Done** | `server/data/devices.json` — five invented devices in an invented house. No real address, account, network or personal identifier appears anywhere; no external device API is contacted. |
| 14 | Setup and installation instructions in README | **Done** | [`../README.md`](../README.md) Setup / Run / Test / Lint / Verify, plus the client's own three commands and the off-the-shelf Inspector CLI section. `bash verify.sh` runs the same install, lint and test commands from a fresh copy. |
| 15 | Privacy and security notes for integrations | **Done** | [`../README.md`](../README.md#privacy-and-security-notes) § "Privacy and security notes". |
| 16 | No secrets, API keys, or personal information in the repository | **Done** | The MCP tools and the planners read no credential, and there is no `.env`. The two credentials in play are both read from the process environment at run time and neither is stored in the repository: `OWNER_KEY` (the server and the client read it; the tests use fixed test-only strings) and, under `PLANNER=bedrock`, the AWS credential `client/server.js` resolves. A scan of every tracked file for credential-shaped values (`AKIA` access key ids, `-----BEGIN … PRIVATE KEY`, `aws_secret_access_key`, `ghp_`/`xox`/`sk-` tokens) and for `.env`, `.pem` or `credentials` files matches only this row's own list of the patterns. |
| 17 | Verify that the project passes its own test suite before submission | **Done** | From a fresh copy: `bash verify.sh` runs server `npm run lint` (clean), server `npm test` (**47 passed, 7 suites**) and client `npm test` (**25 passed**), and ends with `alexa-plus: all checks passed.` |

**Summary: 14 lines done (3 with a re-cut video scripted), 1 taken by a documented
alternative route (7), and 2 honest gaps stated as limitations rather than claimed (9
latency from distant testers, 10 OAuth).**

---

## Submission status

Submitted on Devpost: https://devpost.com/software/smart-home-agent. The project page
embeds the [demo video](#demo-video), and its story opens with this repository and the
live MCP URL (`http://16.176.3.215:3000/mcp`), saying plainly that it is an MCP endpoint a
client connects to, not a page a browser opens. "Try it out" links the repository, the live
MCP URL and the README's
[Inspector section](../README.md#inspecting-with-an-off-the-shelf-mcp-client). The gallery
holds the two architecture diagrams plus five captioned frames of the published video
(rendered 2026-09-10).

### Devpost fields to update (prepared 2026-09-28, not yet pasted)

Each field's exact text is in this document; paste in this order, after the repository is
republished so every link resolves:

| Field | Source | Change |
|---|---|---|
| Elevator pitch | [Project name](#project-name) | "a person's Confirm button" → "the owner's Confirm". Paste only once `deploy.md` step 7 answers `401`. |
| About the project (story) | [Text description](#text-description) | Whole story replaced: authority framing and audience, the owner key, the front-door demo, the corrected test claim, AWS challenges, App Runner. Include the "until the redeploy" line only if the EC2 check still answers `409`. |
| Product feedback | [`feedback.md`](feedback.md), whole file | Adds Bedrock, the Bedrock SDK, EC2 and App Runner, and the AWS-services paragraph. |
| Friction log | [`friction-log.md`](friction-log.md), whole file | Adds entries 5–7 (AWS). |
| Feature requests | [Feature requests](#feature-requests) | Adds requests 5–7. |
| AWS Builder: which AWS services and how | [AWS Builder field](#aws-builder-mini-challenge--required-field) | Adds where the Bedrock call runs, App Runner, and the unrecorded real-model run. |
| Open Source: description of work | [Open Source fields](#open-source-mini-challenge--required-fields) | Second paragraph mentions the owner key; third no longer characterizes other agent demos. Paste only once `deploy.md` step 7 answers `401`. |
| Thumbnail | [`devpost-thumbnail.png`](devpost-thumbnail.png) (1500×1000, 3:2): "Smart Home Agent", "The agent proposes. Only your Confirm can execute.", and a real crop of the front-door Confirmation panel | Replaces the 333×222 crop of proposal JSON. |
| Gallery | [`screenshot-confirm.png`](screenshot-confirm.png) now; frames of the re-cut once it is rendered | Add the screenshot with the caption below. Replace the published video's five frames only when the re-cut replaces the video, so frames and video agree. |
| Video link | [Demo video](#demo-video) | Only after the re-cut is uploaded as Public. |

Caption for `screenshot-confirm.png`:

> The simulated client after the owner confirmed dimming the light (its tile now reads On ·
> 50%) and while the agent's proposal to unlock the front door waits on Confirm or
> Decline. The door's tile still reads Locked.

Captions for frames of the re-cut, one per beat, to use when those frames replace the old
ones:

> 1. The agent proposes dimming the living room light to 50% and stops at Confirmation needed; nothing has changed yet.
> 2. The owner clicks Confirm: execute_action runs with the one-time token, and the light's tile moves to 50%.
> 3. The agent proposes unlocking the front door. The owner declines; the lock's tile still reads Locked, and the audit log holds one entry, the light.
> 4. tools/list against the live MCP server on AWS EC2 returns all eight tools.
> 5. execute_action called directly with no confirmation_id: isError true, and the door stays locked.
> 6. An approve call without the owner's key: HTTP 401, nothing minted.
> 7. The server's test suite passing.

Still not done, and stated as limitations rather than claimed: an HTTPS endpoint, the
OAuth 2.1 + PKCE flow a real Alexa+ add-on would need for onboarding, redeploying the EC2
host with the owner key, and a recorded real-model `PLANNER=bedrock` run.
