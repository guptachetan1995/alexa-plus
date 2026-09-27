# Deploying the alexa-plus MCP server

## What is actually live

The public server at `http://16.176.3.215:3000/mcp` runs on **AWS EC2** (`t3.micro`,
Amazon Linux 2023, `ap-southeast-2`), set up by hand through the EC2 console on
2026-09-11, with the server listening on port 3000. It was verified with a real MCP
`initialize` handshake returning `HTTP 200` with the expected `protocolVersion`,
`capabilities` and `serverInfo`. The README's
[Known limitations](../README.md#known-limitations) section has the measured latency.

It is not on App Runner, although the rest of this document is the App Runner runbook.
On the AWS account used, App Runner needed an AWS Organizations "all features" migration
the account had not made, and `us-east-1` was blocked by an Organizations service control
policy, so the App Runner path below was never run against real AWS. The image build
(Step 1) was run and is captured below; Steps 2 and 3 show typical output only.

One code change was needed for any remote deployment, EC2 or App Runner: the MCP SDK's
`createMcpExpressApp()` allows only `localhost`/`127.0.0.1` `Host` headers by default,
which refused every request to the instance's public IP with `HTTP 403 Invalid Host`.
`server/src/server.js` now calls `createMcpExpressApp({ host: '0.0.0.0' })` to opt out of
that allowlist (see [Privacy and security notes](../README.md#privacy-and-security-notes)
in the README for the tradeoff).

## The App Runner runbook

The server ships as a container image behind AWS App Runner: App Runner pulls from a
private ECR repo, no ALB to manage, `0.25 vCPU` / `0.5 GB` is the smallest instance size.
**Deploying is done by a person, by hand**, because it creates billable AWS resources —
this document is the runbook that person follows; nothing in this repo's automation runs
the push/create-service commands for you.

### Prerequisites

- **Build step**: Docker (Engine or Desktop) with a version that supports
  `docker build --platform`. Nothing else — no AWS account, no credentials.
- **Deploy step** (run by a person, by hand): AWS CLI v2 and an AWS account with the
  permissions in [`deploy/iam-policy.json`](../deploy/iam-policy.json).

Run this locally, with no AWS credentials configured, to confirm the build step's
prerequisites:

```
which aws || echo "aws CLI not installed in this environment"
docker --version
docker info --format '{{.OSType}}/{{.Architecture}}'
```

Real output captured in this environment — `which aws` failing is itself the proof no
AWS credential path exists here, stronger than an empty `aws configure list`:

```
$ which aws || echo "aws CLI not installed in this environment"
aws CLI not installed in this environment
$ docker --version
Docker version 29.7.2, build a7dcaa6
$ docker info --format '{{.OSType}}/{{.Architecture}}'
linux/aarch64
```

The host is `aarch64` (Apple Silicon); App Runner's `ImageRepository` source only
deploys x86_64 images, so `build.sh` pins `--platform linux/amd64` regardless of host
architecture (see Environment variables below) — the build below is a cross-arch build
under QEMU emulation, not a native one.

### Environment variables

None of these are ever hard-coded in either script — every one is read as
`${VAR:-default}`.

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `AWS_REGION` | `deploy.sh` | `us-east-1` | |
| `AWS_PROFILE` | `deploy.sh` | `default` | |
| `SERVICE_NAME` | `deploy.sh` | `alexa-plus-mcp-server` | must match `iam-policy.json`'s ARN if overridden |
| `ECR_REPOSITORY` | `deploy.sh` | `alexa-plus-server` | must match `iam-policy.json`'s ARN if overridden |
| `IMAGE_TAG` | `build.sh`, `deploy.sh` | `alexa-plus-server:local` (`build.sh`) / build timestamp (`deploy.sh`) | `deploy.sh` reassigns it to the full ECR URI before calling `build.sh` |
| `PORT` | Dockerfile (`ENV` default), `deploy.sh` | `3000` | must match what `server.js`'s `process.env.PORT` resolves to at runtime |
| `PLATFORM` | `build.sh` | `linux/amd64` | App Runner's `ImageRepository` source deploys x86_64; pinned so a build on Apple Silicon is still deployable |
| `ACCESS_ROLE_NAME` | `deploy.sh` | `alexa-plus-apprunner-ecr-access` | must match `iam-policy.json`'s ARN if overridden |
| `APP_RUNNER_CPU` | `deploy.sh` | `0.25 vCPU` | smallest App Runner instance size |
| `APP_RUNNER_MEMORY` | `deploy.sh` | `0.5 GB` | smallest App Runner instance size |

If you override `SERVICE_NAME`, `ECR_REPOSITORY`, or `ACCESS_ROLE_NAME` from their
defaults, update the matching resource ARNs in
[`deploy/iam-policy.json`](../deploy/iam-policy.json) to match — the policy's ARNs are
pinned to the default names, not derived from these variables.

### Step 1 — Build (local, no AWS credential needed)

From the project root (the directory holding `README.md`):

```
time IMAGE_TAG=alexa-plus-server:local bash deploy/build.sh
```

Real captured output from this environment (cross-arch build, `aarch64` host ->
`linux/amd64` target, under QEMU emulation — no layer here was cached, every step ran
fresh):

```
#0 building with "desktop-linux" instance using docker driver

#1 [internal] load remote build context
#1 DONE 0.0s

#2 copy /context /
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:20-alpine
#3 DONE 2.8s

#4 [deps 1/4] FROM docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
#4 DONE 4.9s

#5 [deps 2/4] WORKDIR /app
#5 DONE 0.1s

#6 [deps 3/4] COPY package.json package-lock.json ./
#6 DONE 0.0s

#7 [deps 4/4] RUN npm ci --omit=dev
#7 7.808
#7 7.808 added 94 packages, and audited 95 packages in 7s
#7 7.809
#7 7.809 33 packages are looking for funding
#7 7.809   run `npm fund` for details
#7 7.813
#7 7.813 found 0 vulnerabilities
#7 DONE 7.9s

#8 [runtime 3/6] COPY --from=deps /app/node_modules ./node_modules
#8 DONE 0.2s

#9 [runtime 4/6] COPY package.json ./package.json
#9 DONE 0.0s

#10 [runtime 5/6] COPY server/src ./server/src
#10 DONE 0.0s

#11 [runtime 6/6] COPY server/data ./server/data
#11 DONE 0.0s

#12 exporting to image
#12 exporting layers 0.3s done
#12 exporting manifest sha256:781298784847049255def97a62831d52b68a0f04e5c374f9e776a51d82b80b08 done
#12 exporting config sha256:9addfbbc0baf3788c45d1afe24c514ba5978157ffc2873cde7999b1360d43653 done
#12 naming to docker.io/library/alexa-plus-server:local done
#12 DONE 0.3s
built alexa-plus-server:local for linux/amd64

IMAGE_TAG=alexa-plus-server:local bash deploy/build.sh  0.11s user 0.11s system 1% cpu 16.617 total
```

Confirms the target platform actually took effect and reports image size:

```
$ docker image inspect alexa-plus-server:local --format '{{.Os}}/{{.Architecture}}'
linux/amd64
$ docker image inspect alexa-plus-server:local --format '{{.Size}}'
51743709
(≈49.3 MB)
```

#### Optional local smoke check

Ran the built image, cross-arch under QEMU, and drove a real MCP `initialize` handshake
against it to confirm the container actually starts and binds `PORT`:

```
$ docker run -d --platform linux/amd64 -p 3010:3000 --name alexa-plus-smoke alexa-plus-server:local
$ docker logs alexa-plus-smoke
alexa-plus MCP server (Streamable HTTP, 2025-11-25) listening on http://127.0.0.1:3000/mcp

$ curl -s -i -X POST http://127.0.0.1:3010/mcp \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0.0.1"}}}'
HTTP/1.1 200 OK
content-type: application/json
mcp-session-id: fdb59a19-2b40-4062-b5c0-19b8fd1937b1

{"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"alexa-plus-smart-home-agent","version":"0.1.0"}},"jsonrpc":"2.0","id":1}
```

Container stopped and removed afterward (`docker stop`/`docker rm`) — this smoke check
proves the image runs, it is not a standing service.

### Step 2 — Push and deploy (run by a person, needs AWS credentials)

```
AWS_REGION=us-east-1 AWS_PROFILE=default bash deploy/deploy.sh
```

**Typical output, not executed in this environment (no AWS credentials configured
here — see Prerequisites above); field values like account ID and ARNs will differ per
account**:

```
Login Succeeded
[+] Building ...
built 123456789012.dkr.ecr.us-east-1.amazonaws.com/alexa-plus-server:20260910140000 for linux/amd64
The push refers to repository [123456789012.dkr.ecr.us-east-1.amazonaws.com/alexa-plus-server]
20260910140000: digest: sha256:... size: 1988
waiting for alexa-plus-mcp-server to become RUNNING...
deployed alexa-plus-mcp-server; image 123456789012.dkr.ecr.us-east-1.amazonaws.com/alexa-plus-server:20260910140000
service url: https://abcd1234.us-east-1.awsapprunner.com/mcp
```

`deploy.sh` is idempotent — every AWS resource is checked before it's created, so
re-running it against an existing deployment only pushes a new image tag and updates
the service, without recreating the ECR repo, access role, or App Runner service.

### Step 3 — Verify the deployed URL

```
curl -s -X POST "$SERVICE_URL/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"verify","version":"0.0.1"}}}'
# expect: 200, an `Mcp-Session-Id` response header, and a result body matching the
# smoke-check shape above (protocolVersion, capabilities, serverInfo)
```

The Alexa+ track requires "response latency under 500ms" for the deployed URL, so
measure it against the real service URL; the loopback measurement in README.md's "Known
limitations" section (0.62-1.17 ms) is not a substitute for it, since network latency to
a hosted service is not loopback. For the EC2 deployment that measurement was 570–700 ms
from a US-based origin, almost all of it network distance to `ap-southeast-2` (see the
README).

### Rollback

Every pushed image tag stays in ECR until pruned, so rollback is just repointing the
service at a previous tag — no new resources needed.

```
aws ecr describe-images --repository-name "$ECR_REPOSITORY" \
  --query 'imageDetails[].imageTags'

aws apprunner update-service --service-arn "$SERVICE_ARN" \
  --source-configuration '{"ImageRepository":{"ImageIdentifier":"<ecr_uri>:<previous-tag>","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"3000"}},"AuthenticationConfiguration":{"AccessRoleArn":"<access_role_arn>"}}'
```

(Typical output, not executed in this environment — no AWS credentials configured
here.)

### Cost

App Runner's smallest instance (`0.25 vCPU` / `0.5 GB`) bills per-active-second while
handling requests, plus a small always-on provisioned-capacity minimum — unlike a Lambda
Function URL, **App Runner is not scale-to-zero**; a running service
costs something even at zero traffic. This is a real tradeoff being made for App
Runner's simpler ECR-image deploy model, not something hidden from the submission.

## Known limitations

- **In-memory state, now observable once deployed.** README.md's "Known limitations"
  already states devices/proposals/audit entries live only for the server process's
  lifetime and nothing is written back to disk. That was moot while the server only ran
  locally; on a deployed server, a process restart or redeploy silently loses all
  in-flight proposals and audit history, and every caller of the public URL shares the
  same registry, proposals and audit log.
- **No `/health` route.** `server/src/server.js` has no dedicated health endpoint, so
  App Runner's `HealthCheckConfiguration` in `deploy.sh` uses `Protocol=TCP` against the configured
  port rather than an HTTP path. `deploy.sh`'s `health_check_config` is the one line
  that changes once a real `/health` route exists.
- **No auth.** OAuth 2.1 with PKCE (`auth.js`) was deliberately deferred; the deployed
  URL is reachable by anyone who has it, same tradeoff README.md already states for the
  local server.
- **This runbook only deploys the MCP server, not the client.** `PLANNER=bedrock`'s AWS
  Bedrock call lives in `client/server.js` (a second, separate Node process from the one
  this document deploys) — `iam-policy.json` above has no
  `bedrock:InvokeModel` statement because nothing it provisions ever calls Bedrock. If
  the client is ever deployed too (as opposed to run locally, which is all this repo
  does today), whatever hosts it needs its own execution role carrying that permission —
  a separate, later decision, not part of this runbook.
