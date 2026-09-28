# Product feedback — alexa-plus

Hackathon submission's graded feedback field, covering every tool/API/SDK the
[README](../README.md) setup path (`npm install`, `npm start`, `npm test`,
`npm run lint`, the client's own `npm install`/`npm start`/`npm test`, and the
"Inspecting with an off-the-shelf MCP client" section) names or depends on, and the AWS
services the entry uses: Amazon Bedrock (with its SDK client), AWS EC2, and AWS App
Runner, which was tried and could not be used. Each entry gives: what it was for, what
worked, what needs work, onboarding, and whether we'd build with it again.

**AWS services used, and how** (the AWS Builder answer in one place): Amazon Bedrock's
Converse API with tool use is the optional `PLANNER=bedrock` planner — model
`amazon.nova-micro-v1:0` in `ap-southeast-2` picks which MCP tool to call next, called
from Node through `@aws-sdk/client-bedrock-runtime` in `client/server.js` (and
`client/bedrock-cli.js`), never from the browser. AWS EC2 hosts the MCP server at
`http://16.176.3.215:3000/mcp`. The AWS-specific sections are at the end.

---

## `@modelcontextprotocol/sdk` (v1.30.0)

**What for:** The reference JS/TS implementation of the Model Context Protocol —
`McpServer`, `StreamableHTTPServerTransport`, and `createMcpExpressApp()` are what
`server/src/server.js` is built on, implementing the pinned Streamable HTTP transport
(spec revision `2025-11-25`) that the whole entry's README leads with.

**What worked:** `registerTool()` with a Zod input schema, a description, and a handler
is genuinely low-ceremony — the read-only and mutating tools in `server/src/tools.js`
took very little boilerplate. `createMcpExpressApp()` gave a working `/mcp` endpoint
with session-id issuance, reuse, and `DELETE` termination for free, matching the
transport spec's session lifecycle without us hand-rolling it.

**What needs work:** Two undocumented behaviors cost real debugging time (both logged
in `friction-log.md`): an unknown tool name comes back as an `isError: true` tool
result instead of the top-level JSON-RPC protocol error the MCP spec's own docs show as
the canonical example; and `createMcpExpressApp()`'s JSON body-parsing and DNS-rebinding
host validation apply to the *entire* returned Express app, not just the paths the SDK
itself registers, with no docstring warning either way. Both required reading the
package's own source rather than its published docs/types.

**Onboarding:** Fast to a first working tool call once the two-tool scaffold existed,
but the docs alone are not enough to get a cross-origin browser client or
extra REST routes working correctly on the first try — both required source-diving.

**Would build again:** Yes. It is the only complete reference implementation of the
protocol version this entry targets, and the rough edges were all discoverable and
narrow enough to work around in place.

---

## Express (v5.2.1)

**What for:** The HTTP framework underlying `createMcpExpressApp()`'s returned `app`,
and the host for this entry's two non-MCP, owner-only REST routes
(`POST /proposals/:id/approve`, `POST /proposals/:id/reject`).

**What worked:** Express 5's async-handler support (no `express-async-handler` shim
needed for a rejected promise inside a route to become a proper error response) and its
plain `app.use()` middleware model made adding CORS headers and the owner-only routes
onto the SDK's existing `app` a small, additive change rather than a second server.

**What needs work:** Because `createMcpExpressApp()` returns a live `app` rather than a
router that a caller mounts explicitly, it is easy to be surprised by what middleware is
already installed on it before your own routes run (see the SDK entry above) — that
surprise is really an Express-composition hazard as much as an SDK-docs one.

**Onboarding:** Trivial for anyone who has used Express before; the version bump to 5
did not require touching any of the route code written here.

**Would build again:** Yes — no realistic alternative was considered given the SDK
already standardizes on it for `createMcpExpressApp()`.

---

## Zod (v4.5.4)

**What for:** Input-schema validation for every mutating tool's arguments
(`server/src/tools.js`'s `actionArgsSchema`), which the SDK also uses to generate the
JSON Schema exposed in `tools/list`.

**What worked:** Writing one schema (with `.describe()` calls on every field) and
getting both runtime validation and the client-facing JSON Schema from it, with no
separate schema-authoring step, was the single biggest boilerplate-reduction of the
whole server.

**What needs work:** Nothing specific surfaced in this entry's scope — the schemas
needed here (a device id, an action name, an optional freeform params record) are
simple enough that Zod's rougher edges (recursive types, discriminated-union ergonomics)
never came up.

**Onboarding:** Immediate for anyone who has used any schema-validation library; the
API read naturally from the SDK's own tool-registration examples.

**Would build again:** Yes.

---

## ESLint (v10.10.0)

**What for:** `npm run lint` (`eslint server`), the lint gate `verify.sh` and the
README's own "Lint" section both depend on.

**What worked:** Flat-config (`eslint.config.js`) at the project root applied cleanly to
`server/` with no per-file overrides needed; `npm run lint` came back clean on every change
in this entry without special-casing.

**What needs work:** Nothing entry-specific — this was a config-once, forget-it
dependency for the whole build.

**Onboarding:** Straightforward; flat config's single-file shape was easier to reason
about than the old `.eslintrc` cascade.

**Would build again:** Yes.

---

## Jest (v30.5.1)

**What for:** `npm test` (`jest --testPathPatterns=server/test`), running the server's
conformance suite (initialize handshake, `tools/list`, `tools/call` error paths, session
lifecycle, and the full propose→approve/reject→execute refusal matrix).

**What worked:** Once configured, the suite ran fast and deterministically against the
in-process Express app via supertest, with no flaky network binding needed.

**What needs work:** Jest 30 renamed the CLI flag `--testPathPattern` to
`--testPathPatterns` (singular → plural) as a hard error with no deprecated-alias grace
period — every piece of Jest documentation and tutorial still current elsewhere uses the
old singular name, and the new name is undiscoverable except by reading the error
message it throws (logged in `friction-log.md` entry 1).

**Onboarding:** Otherwise ordinary for anyone who has used Jest, but that one renamed
flag is a guaranteed first-run stumble for anyone following existing Jest tutorials
against a fresh v30 install.

**Would build again:** Yes, but would pin the exact flag name from the installed
version's own `--help` output rather than from memory or older docs next time.

---

## Supertest (v7.2.2)

**What for:** Driving `server/src/server.js`'s exported Express `app` in-process from
the Jest suite (HTTP-shaped requests without binding a real TCP port), including the
propose/confirm/execute and owner-only approve/reject route tests.

**What worked:** Its request-builder API composed cleanly with the MCP transport's own
session-id header dance (capture `Mcp-Session-Id` from `initialize`, replay it on every
subsequent call) — no session persistence workaround was needed across requests within a
test file.

**What needs work:** Nothing specific to this entry; it did exactly what a thin
HTTP-assertion layer over Express should.

**Onboarding:** Immediate for anyone who has written a Node HTTP test before.

**Would build again:** Yes.

---

## React (v18.3.1, via CDN import map — client only)

**What for:** Rendering the simulated Alexa+ client's conversation UI
(`client/index.html`'s `<script type="importmap">` maps `react`/`react-dom/client` to
`esm.sh`), including the "Confirmation needed" Confirm/Decline panel that pauses the
demo script.

**What worked:** The import-map approach genuinely delivers on "no bundler, no build
step" — nothing is compiled, and `npm start` just serves static files (`client/`'s
`npm install` only fetches the optional Bedrock SDK, which runs server-side under
`PLANNER=bedrock` and never reaches the browser). For a demo-scripted UI with a small, fixed component tree, this was
strictly simpler than wiring a bundler for one page.

**What needs work:** The approach only stays simple because the browser-side dependency
list is exactly one library; it would not scale past a couple of CDN-loaded packages
before import-map version pinning and CORS-for-ESM-imports become their own
maintenance surface.

**Onboarding:** Fast — no build tooling to learn, but this is specific to how small the
client is, not a generally transferable lesson.

**Would build again:** Yes, for a client this size; would reach for a bundler on
anything bigger.

---

## MCP Inspector CLI (`@modelcontextprotocol/inspector`, via `npx`)

**What for:** The README's "Inspecting with an off-the-shelf MCP client" section — an
independent, off-the-shelf way to list and call tools against the running server
without any custom client code, used to capture the real (non-fabricated) `tools/list`
and `tools/call` transcripts shown in the README.

**What worked:** `npx -y @modelcontextprotocol/inspector --cli <url> --method <m>`
worked against the Streamable HTTP endpoint on the first try, with no server-side
accommodation needed — good evidence the server implements the transport spec
correctly rather than only working against its own bundled client.

**What needs work:** Nothing specific to this entry — its `--cli` mode is exactly the
narrow, scriptable surface needed for a captured transcript; the interactive/UI mode
was not exercised here.

**Onboarding:** Immediate — no install step (via `npx -y`), no configuration file, one
flag per call.

**Would build again:** Yes — it is the fastest way to get a second, independent opinion
that a from-scratch MCP server actually conforms to the spec.

---

## npm (package manager)

**What for:** Every setup/run/test/lint command in the README, for both `server/`
(root `package.json`) and `client/` (its own separate `package.json`).

**What worked:** A plain `npm install` at each of the two roots was enough — no
workspace/monorepo tooling was needed since the two projects deliberately share no
code and talk only over HTTP, matching the README's explicit "client imports nothing
from server" design.

**What needs work:** Nothing npm-specific surfaced; the two friction points hit during
setup (Jest's flag rename, the SDK's undocumented behaviors) were dependency-level, not
package-manager-level.

**Onboarding:** As simple as it gets — one `npm install` per project root, no
lockfile conflicts between the two independent `package.json`s.

**Would build again:** Yes.

---

## Node.js (server >=20, client >=20.10, per `engines` in each `package.json`)

**What for:** The runtime for both the server (`node server/src/server.js`) and the
client's own tiny static file server (`client/server.js`), and for the client's test
runner (`node --test`).

**What worked:** Node's built-in `--test` runner was enough for the client's
integration test (spawning the real server as a separate process and driving the full
demo script over HTTP) — no separate test-framework dependency needed on the client
side at all.

**What needs work:** Nothing entry-specific surfaced against the `>=20` floor. The
client's floor is `>=20.10` only because its test script passes `--test-concurrency=1`
(run one test file at a time, since several of its files each start a server on a port
they just probed as free), a flag Node 20 gained in 20.10.

**Onboarding:** Trivial for anyone with a current Node install; the `engines` pin
communicates the floor clearly without enforcing it at install time.

**Would build again:** Yes.

---

## Amazon Bedrock (Converse API with tool use; model `amazon.nova-micro-v1:0`)

**What for:** The `PLANNER=bedrock` planner (`client/src/bedrock-planner.js`): given the
user's request and the MCP server's `tools/list`, the model decides which tool to call
next, in a Converse tool-use loop, in place of the scripted demo's fixed turns. Every tool
call still goes through the client's one `McpHttpClient.callTool()`, and every proposed
change still stops at the owner's Confirm.

**What worked:** The shapes line up with MCP with almost no glue: each MCP tool's JSON
Schema drops straight into a Converse `toolSpec.inputSchema.json`, the loop is "call
Converse, run each `toolUse` block, send the results back as `toolResult` blocks until
`stopReason` is no longer `tool_use`", and structured tool results go back as `json`
content. The Bedrock playground confirmed Nova Micro in `ap-southeast-2` with no
model-access request ("alexa-plus Bedrock check OK": 12 input / 9 output tokens,
255 ms), and a Converse call from AWS CloudShell, on CloudShell's own credentials,
returned a real tool-use decision (`list_devices`, HTTP 200). Nova Micro is cheap enough
($0.035/$0.14 per million input/output tokens) that a demo conversation costs a fraction
of a cent.

**What needs work:** Choosing a model. The first default, Claude 3.5 Sonnet, had dropped
out of the catalog, most current Anthropic models in `us-east-1` needed a cross-region
inference profile, and confirming that a cheap model supports Converse tool use meant
checking each model's own documentation page (friction log, entry 6). The planner also
has to narrow two tools' schemas for the model: the server's `execute_action` declares
`device_id`/`action`/`confirmation_id` as required, and the planner wants the model to
send only a `proposal_id`, so it declares a narrower schema to Converse than the server
publishes. That is this entry's design, not a Bedrock defect, but it is a place where
Converse's schema is the whole contract the model sees.

**Onboarding:** Once a model was chosen, the playground and CloudShell gave real calls
with no local AWS setup at all. The full `PLANNER=bedrock` loop against the MCP
server with a real model has not been recorded yet; `client/bedrock-cli.js` exists so it
can be run from CloudShell.

**Would build again:** Yes. Converse's tool use maps onto MCP tools directly, and the
cheapest tool-capable model was enough for a planner whose authority is capped by the
Confirm gate anyway.

---

## `@aws-sdk/client-bedrock-runtime` (^3.600.0)

**What for:** `BedrockRuntimeClient` and `ConverseCommand` in `client/server.js`
(`POST /bedrock/converse`, the proxy the browser's planner calls) and in
`client/bedrock-cli.js` (the same planner in a terminal).

**What worked:** Under Node it did exactly what it should: the standard credential chain
(environment variables, `~/.aws/credentials`, an IAM role) with no code, and a
`send(command)` interface that is trivial to replace with a fake in tests — every
Bedrock test in the client injects one and makes no AWS call.

**What needs work:** The browser. Imported into a zero-build page through an esm.sh
build, `new BedrockRuntimeClient({ region })` threw `TypeError: AC is not a function`
from minified code, because the default credential chain is Node-only; nothing in the
error says so (friction log, entry 7). The fix — calling Bedrock from the server — was
also the right design for credentials, but the error cost a debugging round-trip.

**Onboarding:** `npm install` of one package; the command/client pattern reads quickly
from the SDK's own examples.

**Would build again:** Yes, from Node. From a browser, only with explicit credentials
(Cognito) — and for an agent planner, the server-side call is the better design anyway.

---

## AWS EC2 (`t3.micro`, Amazon Linux 2023, `ap-southeast-2`)

**What for:** Hosting the MCP server at a public URL, `http://16.176.3.215:3000/mcp`,
so judges and any MCP client can call it.

**What worked:** The console launch wizard needed no local tooling at all — no AWS CLI,
no Docker push — and the server was reachable the same day it was launched: a real MCP
`initialize` returned HTTP 200 with the expected `serverInfo`. A stateful, in-memory Node
process is exactly what a single small instance runs well. The one code change the
deployment needed was in the MCP SDK's localhost-only `Host` check, not in anything AWS.

**What needs work:** What a bare instance gives you is a bare IP and plain HTTP. An
HTTPS URL needs a domain or hostname and a certificate on top, which App Runner would have
provided by default; the endpoint is HTTP today. The region was forced by the account's
service control policy (friction log, entry 5), so a US tester sees 570–700 ms end to end
against about 1 ms of server time.

**Onboarding:** Console only: the launch wizard's fields were filled in the browser and
reviewed before the owner clicked Launch, with no AWS CLI or local credential involved.

**Would build again:** Yes for a demo-sized stateful server. With an account that allows
it, App Runner would have been the first choice for the HTTPS URL alone.

---

## AWS App Runner (tried; could not be used on this account)

**What for:** The planned host for the MCP server: an always-on container with an HTTPS
service URL and no load balancer to manage. The artifacts are in `deploy/`
(`Dockerfile`, `build.sh`, `deploy.sh`, a resource-scoped `iam-policy.json`).

**What worked:** The container side: the image built for `linux/amd64` on an Apple
Silicon machine and answered a real MCP `initialize` in a local smoke run. The service
model (one always-on instance, no scale-to-zero) matches a server that keeps its state
in memory.

**What needs work:** Account prerequisites surfaced only at creation time. Building the
service from its GitHub source needed an AWS Organizations "all features" migration this
account had not made, and `us-east-1` was blocked by a service control policy (friction log,
entry 5). `deploy.sh` never ran against real AWS, and `docs/deploy.md` says so.

**Onboarding:** The runbook and scripts took one build step to write;
the account-level blockers appeared only when creating the service.

**Would build again:** Yes, on an account without the Organizations restriction — its
default HTTPS service URL is what this entry's EC2 deployment lacks.
