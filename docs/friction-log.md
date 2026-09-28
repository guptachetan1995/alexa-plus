# Friction log — alexa-plus (consolidated)

Consolidates every friction-log entry recorded while building the server, the client and
the AWS side (Bedrock planner, deployment), one section per build step, in the
hackathon's graded feedback format: task / steps / expected vs. actual / severity /
workaround / suggestion. Only the field labels are normalized to those six ("Expected"
and "Actual" are merged into one field per entry); none are invented, and none are
paraphrased away from what was originally recorded.

**Where the entries come from.** Entries 1–4 were written while the server and client
steps were being built. Entries 5–7, the three about AWS, were added to this file on
2026-09-28 from what the Bedrock and deployment steps recorded at the time they happened
(2026-09-10 and 2026-09-11): the notes and commit messages written during those steps,
and the error text they captured. Nothing in them is reconstructed from memory. (This
repository is a published copy of the project, so its own git history starts at
publication and does not show when each entry was written.)

---

## Server scaffold — two tools and conformance tests

### 1. Jest 30 silently renamed `--testPathPattern` to `--testPathPatterns`

**Task:** Wire up `npm test` to run only `server/test/**` (the project's
`package.json` is at the project root, one level above `server/`, so the
test runner needs a path filter rather than relying on Jest's default "everything
under the CWD" discovery).

**Steps:**
1. `npm install jest@^30` (the project's chosen test runner, pulling latest 30.x).
2. Set `"test": "jest --testPathPattern=server/test"` in `package.json` — this is the
   flag name in every piece of Jest documentation and tutorial still current as of
   training-time knowledge, and in Jest's own CLI docs page for versions ≤29.
3. Run `npm test`.

**Expected vs. actual:** Expected Jest to filter to files under `server/test/` and run
the conformance suite. Actual: Jest 30 exits non-zero before running anything —
```
Option "testPathPattern" was replaced by "--testPathPatterns". "--testPathPatterns" is
only available as a command-line option.
```
The flag was renamed (singular → plural) between Jest 29 and 30, and the old name is a
hard error, not a deprecation warning — there is no grace period where both work.

**Severity:** Low (caught immediately by running the test script; no silent wrong
behavior), but it would have been a confusing first-run failure for anyone following
Jest's own still-widely-published `testPathPattern` examples, and it is exactly the
kind of breakage `npm test` in a from-scratch scaffold is supposed to catch before it
reaches a judge running the same command.

**Workaround:** Changed the script to `"test": "jest --testPathPatterns=server/test"`.

**Suggestion:** Jest's migration guide for 30.x could keep the old flag name working as
a deprecated alias for at least one major version, the way most CLIs handle a rename,
instead of a hard failure with no exit-code-0 fallback.

---

### 2. The SDK reports an unknown tool name as a tool result, not the protocol error its own spec docs describe

**Task:** Write a conformance test asserting that calling a `tools/call` with a tool
name the server never registered surfaces as a JSON-RPC protocol-level error — the MCP
spec's own `server/tools` reference page lists "Unknown tools" under "Protocol Errors"
(with a worked example returning a top-level `error: {code: -32602, message: "Unknown
tool: invalid_tool_name"}`), distinct from "Tool Execution Errors" (`isError: true`
inside a normal result).

**Steps:**
1. Initialize a session against the running server.
2. Send `tools/call` with `name: "turn_off_everything"` (a tool that was never
   `registerTool`-ed).
3. Assert the response has a top-level `error` field and no `result` field.

**Expected vs. actual:** Expected a JSON-RPC error response shaped like the spec's own
example. Actual: `@modelcontextprotocol/sdk`'s `McpServer` (v1.30.0) catches the "tool
not found" condition itself and returns HTTP 200 with a normal `CallToolResult` —
```json
{"result":{"content":[{"type":"text","text":"MCP error -32602: Tool turn_off_everything not found"}],"isError":true}}
```
i.e. the same `-32602` code the spec associates with a protocol error, but delivered as
an `isError: true` tool result rather than a top-level `error` object.

**Severity:** Low for this scaffold (both shapes are handled by well-behaved clients,
and the test was simply updated to assert the actual shape), but worth flagging for
anyone writing spec-literal conformance tests against the reference SDK rather than
against a live server — the two are not always in lockstep for this exact case.

**Workaround:** Asserted on `result.isError === true` and the embedded message text
instead of a top-level `error` field.

**Suggestion:** Either the MCP spec's "Unknown tools → Protocol Errors" example or the
reference TypeScript SDK's `McpServer` tool-dispatch behavior should be reconciled,
since right now they disagree on exactly the case the spec chose to show as its
example.

---

## Client — simulated Alexa+ web client calling the server

### 3. `createMcpExpressApp()` ships no CORS handling, and the failure is silent in a way that hides the real cause

**Task:** Wire the simulated Alexa+ client (`client/`, its own origin/port) to call the
MCP server (a different origin/port) straight from the browser with
`fetch`, the same way the integration test's Node client already did successfully.

**Steps:**
1. Point `client/src/mcp-client.js` at `http://127.0.0.1:3000/mcp` from a page served
   on `http://127.0.0.1:5173`.
2. Click "Start demo conversation" in the browser.
3. Open the browser console.

**Expected vs. actual:** Expected the same `initialize` → `tools/call` exchange that
already passed in the Node integration test (server and client talking over plain
HTTP, no shared code). Actual: the UI just showed `Error: Failed to fetch` — `fetch`'s
own error carries no detail. The real cause only appeared in the browser console: a
CORS preflight (`OPTIONS /mcp`) got back a plain Express 404 with no
`Access-Control-Allow-Origin` header, because `@modelcontextprotocol/sdk`'s
`createMcpExpressApp()` (used by `server/src/server.js`, built in the server scaffold
step) sets up JSON body parsing and DNS-rebinding host-header validation but no CORS handling at
all — reasonable for a same-origin MCP host, but this entry's own demo is explicitly
two separate processes on two separate ports.

**Severity:** Medium — this would have completely blocked the browser demo (the Node
integration test can't catch it, since Node's `fetch` isn't subject to CORS), and the
generic "Failed to fetch" gives no hint that the fix lives in server-side response
headers rather than in the client's request code.

**Workaround:** Added a small CORS middleware to `server/src/server.js`
(`Access-Control-Allow-Origin: *`, allowing the `Mcp-Session-Id`/`Content-Type`/`Accept`
request headers, answering `OPTIONS` with 204, and — the part that is easy to miss —
setting `Access-Control-Expose-Headers: Mcp-Session-Id`, since a cross-origin `fetch()`
response hides every response header except the CORS-safelisted ones unless the server
explicitly exposes it; without that line the preflight and the POST both succeed but
the client can never read the session id back out of `res.headers`).

**Suggestion:** `createMcpExpressApp()` could take an opt-in `cors` option (allowed
origins, whether to expose `Mcp-Session-Id`), since any MCP server meant to be called
from a browser-based client on a different origin — which is exactly what a "simulated
Alexa+ web client" is — needs this every time, and the missing-exposed-header failure
mode in particular is invisible until you already know to look for it.

---

## Propose/confirm — mutating tools as propose/confirm pairs with client confirmation

### 4. `createMcpExpressApp()`'s "pre-configured for MCP servers" middleware is undocumented as applying to every route on the returned app, not just `/mcp`

**Task:** Add two new, non-MCP REST routes (`POST /proposals/:id/approve`, `POST
/proposals/:id/reject` — the owner-only "Confirm control" surface; the design's
owner-only approve/reject CLI verbs had no CLI to live in, since this entry's client is a
web page) onto the exact same Express `app`
object `server.js` already builds via `createMcpExpressApp()` and mounts `/mcp` on,
rather than starting a second app/port.

**Steps:**
1. Write the two route handlers assuming they would need their own `express.json()`
   middleware to read `req.body.proposalId`-style POST data, the way a plain
   `express()` app would.
2. Before adding that, check whether stacking a second body parser on the same app
   causes a conflict (double-consuming the request stream throws in Express).
3. Read `@modelcontextprotocol/sdk`'s `server/express.js` source directly (its own
   README/type docs for `createMcpExpressApp()` describe it only as "pre-configured
   for MCP servers", with no mention of what that means for routes a caller adds
   afterward).

**Expected vs. actual:** Expected either the helper to scope its middleware to just the
paths it registers (so a caller's own routes need their own setup), or the docs to say
plainly that everything mounted on the returned app inherits it. Actual:
`createMcpExpressApp()` calls `app.use(express.json())` and (for the default
`127.0.0.1`/`localhost` host) `app.use(localhostHostValidation())` unconditionally,
before returning the app — both are plain `app.use()` calls with no path argument, so
they run for literally every route later added to that `app`, `/mcp` or not. Neither
behavior is mentioned in the function's docstring or the one code example in its JSDoc.

**Severity:** Low here (both effects turned out to be exactly what the new routes
needed — free JSON body parsing, and free DNS-rebinding protection on an endpoint that
mints a security-relevant one-time token — so no code changed as a result), but this
is easy to get backwards: a caller who assumed the helper's effects were scoped to
`/mcp` could add their own conflicting `express.json()` (Express throws on a second
body read) or, worse, assume a non-`/mcp` route has no Host-header protection and skip
thinking about it, when it silently already does.

**Workaround:** None needed — read the source once, added the two routes directly on
the same `app` with no extra middleware, and confirmed via the browser demo that a
cross-origin `POST /proposals/:id/approve` from the client's own origin still worked
under the same CORS middleware `server.js` already applies to every route.

**Suggestion:** `createMcpExpressApp()`'s docstring could say explicitly that its
middleware (JSON parsing, DNS-rebinding host validation) applies to the whole returned
`app`, not just the MCP endpoint(s) a caller mounts on it — useful information either
way, but only if a reader can get it without opening the package's source.

---

## AWS — the Bedrock planner and the deployment

### 5. App Runner could not be used on this account: an AWS Organizations "all features" requirement, and `us-east-1` blocked by a service control policy

**Task:** Put the MCP server on a public URL on AWS for judges to call, using App Runner
(an always-on container with an HTTPS service URL and no load balancer to manage), which
had been chosen over Lambda because the server keeps session and proposal state in
memory.

**Steps:**
1. Wrote the App Runner artifacts (`deploy/Dockerfile`, `build.sh`, `deploy.sh`,
   `iam-policy.json`, `docs/deploy.md`), defaulting to `us-east-1`, and ran the image
   build locally: it built for `linux/amd64` and answered a real MCP `initialize` in a
   local smoke run.
2. `deploy.sh` needs the AWS CLI and Docker on the deploying machine, and the owner did
   not want the AWS CLI installed locally, so the deploy moved to the AWS console.
3. Tried to create the App Runner service from the console, built from the GitHub source.

**Expected vs. actual:** Expected the console to create an App Runner service in the
default region the runbook used. Actual: App Runner's GitHub-source build required an
AWS Organizations "all features" migration that this account had not made, and
`us-east-1` was blocked outright by an Organizations service control policy.
`ap-southeast-2` was the only region proven usable that session.

**Severity:** High for the deployment plan: it ruled out the planned service and the
planned region. The region choice has a visible cost: a tester in the US measured
570–700 ms end to end to `ap-southeast-2`, over the track's 500 ms line, while the server
itself answers in about 1 ms on loopback.

**Workaround:** Launched an EC2 instance (`t3.micro`, Amazon Linux 2023,
`ap-southeast-2`) from the EC2 console and ran the server on port 3000. The App Runner
artifacts stay in `deploy/`, never run against real AWS, and `docs/deploy.md` says so.

**Suggestion:** Say on App Runner's create-service page, before the form is filled in,
that the account needs Organizations "all features" (and which regions a service control
policy blocks for this account), rather than surfacing it as the reason creation cannot
proceed.

---

### 6. The planned Bedrock default model was gone from the catalog, and finding a cheap model with Converse tool use took a per-model docs check

**Task:** Give `PLANNER=bedrock` a default model that supports the Converse API's tool
use, costs as little as possible, and is available in-Region in `ap-southeast-2`.

**Steps:**
1. The planner first shipped with `anthropic.claude-3-5-sonnet-20241022-v2:0` as its
   default model id, in `us-east-1`, and the owner-side plan expected a per-model
   access request in the Bedrock console before first use.
2. Checked the id against Bedrock's current model catalog before any real call.
3. Looked for the cheapest model whose documentation confirms Converse tool use.

**Expected vs. actual:** Expected the default to be a current model and the first real
call to need a model-access grant. Actual: that Claude 3.5 Sonnet id no longer appeared in
Bedrock's Anthropic model catalog at all, so the shipped default would have failed at
invoke time. Most current Anthropic models in `us-east-1` also needed a cross-region
inference profile. The model-access request the plan expected turned out not to be
needed: a Nova Micro call in the Bedrock playground succeeded without one ("alexa-plus
Bedrock check OK", 12 input / 9 output tokens, 255 ms).

**Severity:** Medium. Caught before any real call, but a default that silently stopped
existing is a first-run failure for anyone who copies it.

**Workaround:** Defaulted to `amazon.nova-micro-v1:0` in `ap-southeast-2`: in-Region there,
Converse tool use confirmed in AWS's own model documentation, and $0.035/$0.14 per million
input/output tokens (Claude Haiku 4.5 also supports tool use, at roughly 30 times the
price). A live Converse call from AWS CloudShell then returned a real tool-use decision
(`list_devices`, HTTP 200).

**Suggestion:** One filterable table in the Bedrock docs or console of model × Region ×
Converse feature (tool use, streaming tool use, system prompts) × price, and a notice
when a model id leaves the catalog.

---

### 7. `@aws-sdk/client-bedrock-runtime` in a browser failed with a minified `TypeError: AC is not a function`, not a message about credentials

**Task:** Run the Bedrock planner's Converse loop from the simulated client, a zero-build
browser page (React from a CDN import map, no bundler).

**Steps:**
1. `client/src/bedrock-planner.js` imported `BedrockRuntimeClient` and `ConverseCommand`
   from `@aws-sdk/client-bedrock-runtime`. Its tests passed under Node with a mocked
   client.
2. Started the server and client with `PLANNER=bedrock`, opened the page in a real Chrome
   tab, clicked "Start demo conversation".
3. Added an import-map entry pointing the package at an esm.sh browser build and tried
   again.

**Expected vs. actual:** Expected either a working call or a clear error about
credentials. Actual: first `Failed to resolve module specifier
"@aws-sdk/client-bedrock-runtime"` (expected with no bundler); then, with the import map
patched, `new BedrockRuntimeClient({ region })` threw `TypeError: AC is not a function` in
its own constructor. The root cause, which the error does not mention, is that the SDK's
default credential chain (environment variables,
`~/.aws/credentials`, instance metadata) exists only under Node.

**Severity:** Medium. It made `PLANNER=bedrock` unusable in the browser, and the tests
could not catch it, because Node resolves both the package and the credential chain.

**Workaround:** Moved the AWS call server-side: `client/server.js` now owns the only
`BedrockRuntimeClient` (`POST /bedrock/converse`, credentials resolved the normal Node
way), and the browser POSTs the Converse request to its own origin. A real click-through
then reached a clean `Could not load credentials from any providers` on a machine with no
AWS credentials, shown through the page's normal error path. This was also the safer
design: a credential shipped to browser code is readable by anyone who opens dev tools.

**Suggestion:** When the client is constructed in a browser with no explicit
`credentials`, throw a readable error ("the default credential provider chain is not
available in browsers; pass credentials, e.g. from Cognito, or call Bedrock from a
server") instead of a minified `TypeError`.

---

## Index by severity

| Severity | Entry | Build step |
|---|---|---|
| High | 5. App Runner blocked by Organizations "all features"; `us-east-1` blocked by an SCP | AWS deployment |
| Medium | 3. `createMcpExpressApp()` ships no CORS handling, failure is silent | client |
| Medium | 6. Bedrock default model gone from the catalog; tool-use support checked per model | Bedrock planner |
| Medium | 7. Bedrock runtime SDK in a browser: minified `TypeError`, not a credentials message | Bedrock planner |
| Low | 1. Jest 30 renamed `--testPathPattern` to `--testPathPatterns` | server scaffold |
| Low | 2. SDK reports unknown tool as a tool result, not a protocol error | server scaffold |
| Low | 4. `createMcpExpressApp()` middleware applies app-wide, undocumented | propose/confirm |
