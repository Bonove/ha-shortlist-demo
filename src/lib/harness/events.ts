import { randomUUID } from 'node:crypto';
import type { HarnessEvent, SessionState } from '@/lib/contracts';
import { transact } from '@/lib/store/db';

const CAP = 300;

/** Append to a session already open inside a transaction. Newest first. */
export function appendEvent(
  session: SessionState,
  kind: HarnessEvent['kind'],
  summary: string,
  detail?: Record<string, unknown>,
): HarnessEvent {
  const event: HarnessEvent = { id: randomUUID(), at: new Date().toISOString(), kind, summary, detail };
  session.events.unshift(event);
  session.events.length = Math.min(session.events.length, CAP);
  return event;
}

/** Append from outside a transaction, e.g. an assistant tool call. */
export function recordEvent(event: {
  kind: HarnessEvent['kind'];
  summary: string;
  detail?: Record<string, unknown>;
}): Promise<HarnessEvent> {
  return transact((doc) => appendEvent(doc.session, event.kind, event.summary, event.detail));
}
