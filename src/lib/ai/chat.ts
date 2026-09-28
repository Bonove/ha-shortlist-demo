/**
 * The bounded tool loop behind /api/chat, on the OpenAI Responses API.
 *
 * Bounds exist because a demo that hangs is worse than a demo that says why it
 * stopped: at most MAX_TOOL_ROUNDS round trips, a whole-turn deadline and a
 * per-tool deadline, each surfaced to the user in plain words.
 */

import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, SnapshotId } from '@/lib/contracts';
import { readSession, updateSession } from '@/lib/store/db';
import { getActiveSnapshot } from '@/lib/policy/snapshots';
import { recordEvent } from '@/lib/harness/events';
import { TOOL_DEFINITIONS, runTool } from './tools';

const DEFAULT_MODEL = 'gpt-5.6';

/**
 * A model name is shown in the browser, so it must never be able to carry a
 * secret. Pasting a key into OPENAI_MODEL by mistake is easy and would
 * otherwise publish it through /api/status; refuse anything key-shaped and
 * fall back to the default instead.
 */
function configuredModel(): string {
  const raw = (process.env.OPENAI_MODEL || '').trim();
  if (!raw) return DEFAULT_MODEL;
  if (/^sk-/.test(raw) || raw.length > 60 || !/^[A-Za-z0-9._-]+$/.test(raw)) {
    console.warn('OPENAI_MODEL does not look like a model name; ignoring it.');
    return DEFAULT_MODEL;
  }
  return raw;
}

export const MODEL = configuredModel();
export const isConfigured = () => Boolean(process.env.OPENAI_API_KEY);

const MAX_TOOL_ROUNDS = 6;
const TURN_TIMEOUT_MS = 60_000;
const TOOL_TIMEOUT_MS = 10_000;

/**
 * Surfaced by /api/chat/status. On globalThis because Next bundles each route
 * handler separately in dev, so a module-level value would not be shared.
 */
const errorSlot = globalThis as typeof globalThis & { __haChatLastError?: string | null };
export const getLastError = () => errorSlot.__haChatLastError ?? null;

/** Upstream auth errors quote the key back at you; it never leaves this file. */
const redactKeys = (message: string) => message.replace(/sk-[A-Za-z0-9_*-]+/g, '[redacted]');

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; input: unknown; output: unknown };

const SYSTEM = `You are the housing assistant for HousingAnywhere, helping a tenant decide which listings genuinely suit them.

The same tenancy has three later decision moments — the contract as offered, a renewal offer and the settlement of the deposit — and each is answered by its own spec in the same published bundle, through get_journey_facts, evaluate_moment and explain_moment.

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
      'OPENAI_API_KEY is not set on the server, so the live assistant cannot run. Rules Studio and policy evaluation are unaffected.',
    );
  }

  const [session, snapshot] = await Promise.all([readSession(), getActiveSnapshot()]);
  const client = new OpenAI();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);

  const input: OpenAI.Responses.ResponseInput = [
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
      const stream = await client.responses.create(
        {
          model: MODEL,
          instructions: SYSTEM,
          tools: TOOL_DEFINITIONS,
          input,
          // Nothing about this demo needs to live on OpenAI's servers.
          store: false,
          stream: true,
        },
        { signal: controller.signal },
      );

      const calls: OpenAI.Responses.ResponseFunctionToolCall[] = [];
      answer = '';
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          answer += event.delta;
          emit({ type: 'text', delta: event.delta });
        } else if (event.type === 'response.output_item.done') {
          // Replaying every output item keeps reasoning items intact with store: false.
          input.push(event.item as OpenAI.Responses.ResponseInputItem);
          if (event.item.type === 'function_call') calls.push(event.item);
        } else if (event.type === 'response.failed' || event.type === 'error') {
          throw new Error(
            ('message' in event ? event.message : event.response?.error?.message) || 'The model reported a failure.',
          );
        }
      }
      answer = answer.trim();

      if (!calls.length) break;

      if (rounds >= MAX_TOOL_ROUNDS) {
        const note = `I stopped after ${MAX_TOOL_ROUNDS} tool calls in one turn without reaching an answer. Please ask again, more narrowly.`;
        answer = answer ? `${answer}\n\n${note}` : note;
        emit({ type: 'text', delta: `\n\n${note}` });
        break;
      }
      rounds += 1;

      for (const call of calls) {
        let parsed: unknown = {};
        let output: unknown;
        try {
          parsed = JSON.parse(call.arguments || '{}');
          output = await withTimeout(runTool(call.name, parsed), TOOL_TIMEOUT_MS, `Tool ${call.name}`);
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
        }
        const isError = typeof output === 'object' && output !== null && 'error' in output;

        toolCalls.push({ name: call.name, input: parsed, output });
        emit({ type: 'tool', name: call.name, input: parsed, output });
        await recordEvent({
          kind: 'chat.tool',
          summary: `Assistant called ${call.name}${isError ? ' (returned an error)' : ''}`,
          detail: { name: call.name, input: parsed, output },
        });

        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }

    errorSlot.__haChatLastError = null;
  } catch (err) {
    const message = redactKeys(
      controller.signal.aborted
        ? `The assistant did not finish within ${TURN_TIMEOUT_MS / 1000} seconds.`
        : err instanceof Error
          ? err.message
          : String(err),
    );
    errorSlot.__haChatLastError = message;
    await recordEvent({ kind: 'error', summary: 'Live assistant turn failed', detail: { message } });
    throw new Error(message);
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
