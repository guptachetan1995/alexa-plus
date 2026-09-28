#!/usr/bin/env node
// PLANNER=bedrock without a browser. Runs the same runBedrockConversation() loop the page
// runs, under Node, so it can be driven from a terminal that already holds AWS
// credentials (AWS CloudShell, for one) and prints a transcript of what the model did.
//
// The confirm gate is the person at this terminal: every proposal waits for them to type
// c (confirm) or d (decline). Only then does McpHttpClient carry OWNER_KEY to the
// server's owner-only /proposals/:id/approve|reject route. The model never sees the key
// and has no tool that reaches that route.
//
//   OWNER_KEY=<the server's key> node bedrock-cli.js [mcp-url] ["request"] | tee transcript.txt
//
// The transcript goes to stdout and the prompts to stderr, so the file holds only the
// transcript while the prompts still show in the terminal.
//
// AWS_REGION (default ap-southeast-2) and BEDROCK_MODEL_ID (default Nova Micro) are read
// the same way client/server.js reads them. Each run is a few real, metered Converse calls.
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import { McpHttpClient } from './src/mcp-client.js';
import { runBedrockConversation, DEFAULT_MODEL_ID } from './src/bedrock-planner.js';

const DEFAULT_URL = 'http://127.0.0.1:3000/mcp';
const DEFAULT_REQUEST =
  'Dim the living room light to 50%, then unlock the front door, then show me the audit log.';

function clip(text, max = 240) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One transcript line (or block) per turn, in the order the conversation produced them. */
export function formatTurn(turn) {
  if (turn.kind === 'confirm') {
    const p = turn.proposal;
    const what = p.scene_name ? `scene "${p.scene_name}"` : `${p.action} on ${p.device_id}`;
    return `[gate] ${what} (${p.proposal_id}) -> person chose ${turn.decision.toUpperCase()}`;
  }
  if (turn.tool) {
    const { name, args, result } = turn.tool;
    const out = result.isError
      ? `REFUSED: ${result.content?.[0]?.text ?? ''}`
      : JSON.stringify(result.structuredContent);
    return `[tool] ${name} ${JSON.stringify(args)}\n       -> ${clip(out)}`;
  }
  return `[${turn.speaker}] ${turn.text}`;
}

/**
 * Runs one conversation and returns its transcript lines. `ask(question)` resolves to
 * the person's answer; `print(line)` receives each line as it happens. Both are injected
 * so a test can drive this with a mocked Bedrock client and scripted answers.
 */
export async function runCli({ url, request, ownerKey, bedrockClient, modelId, ask, print }) {
  const client = new McpHttpClient(url, { ownerKey });
  const lines = [];
  const emit = (line) => {
    lines.push(line);
    print(line);
  };
  emit(`MCP server: ${url}   model: ${modelId}`);
  try {
    await runBedrockConversation(client, {
      bedrockClient,
      modelId,
      userRequest: request,
      onTurn: (turn) => emit(formatTurn(turn)),
      onConfirmRequest: async (proposal) => {
        const what = proposal.scene_name
          ? `scene "${proposal.scene_name}"`
          : `${proposal.action} on ${proposal.device_id} ${JSON.stringify(proposal.params)}`;
        for (;;) {
          const answer = (await ask(`Confirm ${what}? [c]onfirm / [d]ecline: `)).trim().toLowerCase();
          if (answer === 'c' || answer === 'confirm') return 'confirm';
          if (answer === 'd' || answer === 'decline') return 'decline';
        }
      },
    });
  } finally {
    await client.close().catch(() => {});
  }
  return lines;
}

/**
 * The terminal wiring: transcript lines go to `output`, the confirm prompts (and the
 * typed answers readline echoes) to `promptOutput`. Kept apart so `node bedrock-cli.js |
 * tee transcript.txt` records only the transcript: a prompt has no trailing newline, so
 * on the same stream it would glue itself to the start of the next `[gate]` line.
 */
export function terminalIo({ input, output, promptOutput }) {
  const rl = readline.createInterface({ input, output: promptOutput });
  return {
    ask: (question) => rl.question(question),
    print: (line) => output.write(`${line}\n`),
    close: () => rl.close(),
  };
}

async function main() {
  const [url = DEFAULT_URL, request = DEFAULT_REQUEST] = process.argv.slice(2);
  const runtime = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'ap-southeast-2' });
  const io = terminalIo({ input: process.stdin, output: process.stdout, promptOutput: process.stderr });
  try {
    await runCli({
      url,
      request,
      ownerKey: process.env.OWNER_KEY || null,
      // bedrock-planner.js builds plain `{ input }` commands; the real SDK wants a ConverseCommand.
      bedrockClient: { send: (command) => runtime.send(new ConverseCommand(command.input)) },
      modelId: process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID,
      ask: io.ask,
      print: io.print,
    });
  } finally {
    io.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`bedrock-cli: ${err.message}`);
    process.exit(1);
  });
}
