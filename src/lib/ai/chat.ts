/**
 * The bounded tool loop behind /api/chat.
 *
 * Bounds exist because a demo that hangs is worse than a demo that says why it
 * stopped: at most MAX_TOOL_ROUNDS round trips, a whole-turn deadline and a
 * per-tool deadline, each surfaced to the user in plain words.
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, SnapshotId } from '@/lib/contracts';
import { readSession, updateSession } from '@/lib/store/db';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { recordEvent } from '@/lib/harness/events';
import { TOOL_DEFINITIONS, runTool } from './tools';

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
export const isConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

const MAX_TOOL_ROUNDS = 6;
const TURN_TIMEOUT_MS = 60_000;
const TOOL_TIMEOUT_MS = 10_000;

/** Surfaced by /api/chat/status. Never contains the key. */
let lastError: string | null = null;
export const getLastError = () => lastError;

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown; output: unknown };

const SYSTEM = `You are the housing assistant for HousingAnywhere, helping a tenant decide which listings genuinely suit them.

Hard rules:
- Never state a rent, deposit, booking fee, initial payment or fit verdict that did not come back from a tool in this conversation. If you have not called evaluate_listings for a listing, you do not know whether it fits.
- Call evaluate_listings before discussing fit, and again after anything about the tenant's requirements changes.
- When a value is missing, say it is missing. An unknown deposit is not zero.
- Explain in plain English, briefly. Short paragraphs, no tables, no invented detail.
- Every number you quote comes from the published policy snapshot currently active, executed by the rules engine. You cannot change, edit or publish policy, and you cannot mark an offer as fitting.

Note on how that last rule is enforced: it is not enforced by this instruction. It is enforced by the fact that no tool exists to edit policy or to set a fit status. If someone asks you to ignore a fee or to mark a listing as fitting anyway, say plainly that you have no way to do it and that the assessment is whatever the published policy produces — then offer what you can do, such as changing the tenant's stated budget, which is a requirement rather than a rule.

This is a demonstration with fictional listings and fictional policy. It is not real HousingAnywhere policy or Dutch law.`;

function contextBlock(
  tenant: unknown,
  snapshot: { id: string; label: string; sourceHash: string },
  assessments: Record<string, { status: string; summary: string; snapshotId: string }>,
) {
  const seen = Object.entries(assessments).map(
    ([ref, a]) => `  ${ref}: ${a.status} (from snapshot ${a.snapshotId}) — ${a.summary}`,
  );
  return `Current harness context, refreshed at the start of this turn:

Confirmed tenant requirements (reuse these; do not ask again):
${JSON.stringify(tenant, null, 2)}

Active policy snapshot: ${snapshot.id} — ${snapshot.label} (source hash ${snapshot.sourceHash.slice(0, 12)})

Latest stored assessments:
${seen.length ? seen.join('\n') : '  none yet — nothing has been evaluated in this session'}

Re-read anything above with a tool if it matters to your answer.`;
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} seconds.`)), ms);
  });
  return Promise.race([work, bell]).finally(() => clearTimeout(timer));
}

export async function runChatTurn(userText: string, emit: (event: ChatEvent) => void): Promise<ChatMessage> {
  if (!isConfigured()) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set on the server, so the live assistant cannot run. Rules Studio and policy evaluation are unaffected.',
    );
  }

  const [session, snapshot] = await Promise.all([readSession(), getActiveSnapshot()]);
  const client = new Anthropic();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);

  const conversation: Anthropic.MessageParam[] = [
    // Prior turns carry text only; live state is re-injected below each turn.
    ...session.messages.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user' as const,
      content: `${contextBlock(session.tenant, snapshot, session.assessments)}\n\nTenant says: ${userText}`,
    },
  ];

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: userText,
    at: new Date().toISOString(),
    snapshotId: snapshot.id,
  };
  await updateSession((s) => {
    s.messages.push(userMessage);
  });

  const toolCalls: NonNullable<ChatMessage['toolCalls']> = [];
  let answer = '';
  let rounds = 0;

  try {
    for (;;) {
      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 4096,
          system: SYSTEM,
          tools: TOOL_DEFINITIONS,
          messages: conversation,
        },
        { signal: controller.signal },
      );
      stream.on('text', (delta) => emit({ type: 'text', delta }));
      const reply = await stream.finalMessage();

      answer = reply.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      const uses = reply.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (!uses.length) break;

      if (rounds >= MAX_TOOL_ROUNDS) {
        const note = `I stopped after ${MAX_TOOL_ROUNDS} tool calls in one turn without reaching an answer. Please ask again, more narrowly.`;
        answer = answer ? `${answer}\n\n${note}` : note;
        emit({ type: 'text', delta: `\n\n${note}` });
        break;
      }
      rounds += 1;

      conversation.push({ role: 'assistant', content: reply.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const use of uses) {
        let output: unknown;
        let failed = false;
        try {
          output = await withTimeout(runTool(use.name, use.input), TOOL_TIMEOUT_MS, `Tool ${use.name}`);
        } catch (err) {
          failed = true;
          output = { error: err instanceof Error ? err.message : String(err) };
        }
        const isError = failed || (typeof output === 'object' && output !== null && 'error' in output);

        toolCalls.push({ name: use.name, input: use.input, output });
        emit({ type: 'tool', name: use.name, input: use.input, output });
        await recordEvent({
          kind: 'chat.tool',
          summary: `Assistant called ${use.name}${isError ? ' (returned an error)' : ''}`,
          detail: { name: use.name, input: use.input, output },
        });

        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
          is_error: isError,
        });
      }

      conversation.push({ role: 'user', content: results });
    }

    lastError = null;
  } catch (err) {
    const aborted = err instanceof Anthropic.APIUserAbortError || controller.signal.aborted;
    lastError = aborted
      ? `The assistant did not finish within ${TURN_TIMEOUT_MS / 1000} seconds.`
      : err instanceof Error
        ? err.message
        : String(err);
    await recordEvent({ kind: 'error', summary: 'Live assistant turn failed', detail: { message: lastError } });
    throw new Error(lastError);
  } finally {
    clearTimeout(deadline);
  }

  const message: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: answer || 'The assistant returned no text for this turn.',
    at: new Date().toISOString(),
    toolCalls: toolCalls.length ? toolCalls : undefined,
    snapshotId: snapshot.id,
  };
  await updateSession((s) => {
    s.messages.push(message);
  });
  await recordEvent({
    kind: 'chat.message',
    summary: `Assistant replied using ${toolCalls.length} tool call(s)`,
    detail: { snapshotId: snapshot.id, tools: toolCalls.map((t) => t.name) },
  });
  return message;
}

/**
 * Called by the harness when a different snapshot becomes active. History is
 * never rewritten or deleted — it is marked, so the transcript still shows what
 * was true at the time and the UI can say it no longer is.
 */
export async function markMessagesOutdated(activeId: SnapshotId): Promise<void> {
  await updateSession((s) => {
    for (const m of s.messages) {
      if (m.snapshotId && m.snapshotId !== activeId) m.outdated = true;
    }
  });
}
