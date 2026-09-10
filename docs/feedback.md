# Product feedback — alexa-plus

Hackathon submission's graded feedback field, covering every tool/API/SDK the
`entries/alexa-plus/README.md` setup path (`npm install`, `npm start`, `npm test`,
`npm run lint`, the client's own `npm install`/`npm start`/`npm test`, and the
"Inspecting with an off-the-shelf MCP client" section) names or depends on. Each entry
gives: what it was for, what worked, what needs work, onboarding, and whether we'd
build with it again.

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

**Onboarding:** Fast to a first working tool call once the two-tool scaffold existed
(see PR #75), but the docs alone are not enough to get a cross-origin browser client or
extra REST routes working correctly on the first try — both required source-diving.

**Would build again:** Yes. It is the only complete reference implementation of the
protocol version this entry targets, and the rough edges were all discoverable and
narrow enough to work around in place.

---

## Express (v5.2.1)

**What for:** The HTTP framework underlying `createMcpExpressApp()`'s returned `app`,
and the host for this entry's two non-MCP, owner-only REST routes
(`POST /proposals/:id/approve`, `POST /proposals/:id/reject`) added in PR #81.

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

**What worked:** Flat-config (`eslint.config.js`) at the entry root applied cleanly to
`server/` with no per-file overrides needed; `npm run lint` came back clean on every PR
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
message it throws (logged in `friction-log.md` entry 1, PR #75).

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
step" — `client/`'s `npm install` is a documented no-op, and `npm start` just serves
static files. For a demo-scripted UI with a small, fixed component tree, this was
strictly simpler than wiring a bundler for one page.

**What needs work:** The approach only stays simple because the client's dependency
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
and `tools/call` transcripts included in PR #75.

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

## Node.js (>=20, per `engines` in both `package.json` files)

**What for:** The runtime for both the server (`node server/src/server.js`) and the
client's own tiny static file server (`client/server.js`), and for the client's test
runner (`node --test`).

**What worked:** Node's built-in `--test` runner was enough for the client's
integration test (spawning the real server as a separate process and driving the full
demo script over HTTP) — no separate test-framework dependency needed on the client
side at all.

**What needs work:** Nothing entry-specific surfaced against the `>=20` floor.

**Onboarding:** Trivial for anyone with a current Node install; the `engines` pin
communicates the floor clearly without enforcing it at install time.

**Would build again:** Yes.
