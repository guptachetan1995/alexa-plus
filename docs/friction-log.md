# Friction log — alexa-plus (consolidated)

Consolidates every friction-log entry appended to this file across the three build
goals that shipped the server and client (issues #34, #35, #36), one section per goal,
in the hackathon's graded feedback format: task / steps / expected vs. actual /
severity / workaround / suggestion. Every entry below is reproduced from this file's own
git history verbatim in substance (only the field labels are normalized to the six
above — "Expected" and "Actual" are merged into one "Expected vs. actual" field per
entry); none are invented, added, or paraphrased away from what each goal originally
recorded.

**Entry count note:** this file's real git history (`git log -p -- entries/alexa-plus/docs/friction-log.md`)
contains exactly four entries in total — two from issue #34, one from issue #35, one
from issue #36. That is fewer than this consolidation issue's own "≥5 entries" target;
per this issue's explicit "do not invent entries" instruction, no fifth entry has been
fabricated to reach that number. All four genuine entries are consolidated below.

---

## Issue #34 — MCP server scaffold with two tools and conformance tests (PR #75)

### 1. Jest 30 silently renamed `--testPathPattern` to `--testPathPatterns`

**Task:** Wire up `npm test` to run only `entries/alexa-plus/server/test/**` (the
entry's `package.json` is at `entries/alexa-plus/`, one level above `server/`, so the
test runner needs a path filter rather than relying on Jest's default "everything
under the CWD" discovery).

**Steps:**
1. `npm install jest@^30` (the version resolved from SPEC.md's "Jest" test-runner pin,
   pulling latest 30.x).
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

## Issue #35 — simulated Alexa+ web client calling the server (PR #79)

### 3. `createMcpExpressApp()` ships no CORS handling, and the failure is silent in a way that hides the real cause

**Task:** Wire the simulated Alexa+ client (`client/`, its own origin/port, per issue
#35) to call the MCP server (a different origin/port) straight from the browser with
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
`createMcpExpressApp()` (used by `server/src/server.js`, built in issue #34) sets up
JSON body parsing and DNS-rebinding host-header validation but no CORS handling at
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

## Issue #36 — mutating tools as propose/confirm pairs with client confirmation (PR #81)

### 4. `createMcpExpressApp()`'s "pre-configured for MCP servers" middleware is undocumented as applying to every route on the returned app, not just `/mcp`

**Task:** Add two new, non-MCP REST routes (`POST /proposals/:id/approve`, `POST
/proposals/:id/reject` — issue #36's owner-only "Confirm control" surface, since
SPEC.md's CLI verbs have no CLI to live in here) onto the exact same Express `app`
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

## Index by severity

| Severity | Entry | Issue | PR |
|---|---|---|---|
| Medium | 3. `createMcpExpressApp()` ships no CORS handling, failure is silent | #35 | #79 |
| Low | 1. Jest 30 renamed `--testPathPattern` to `--testPathPatterns` | #34 | #75 |
| Low | 2. SDK reports unknown tool as a tool result, not a protocol error | #34 | #75 |
| Low | 4. `createMcpExpressApp()` middleware applies repo-wide, undocumented | #36 | #81 |
