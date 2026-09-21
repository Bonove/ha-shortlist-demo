'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/contracts';

type Status = { configured: boolean; model: string | null; lastError: string | null };
type LiveTool = { name: string; input: unknown; output: unknown };

const SUGGESTIONS = [
  'I need a place in Amsterdam for five months, up to €1,200 a month and I can pay about €2,500 up front',
  'Why does the City Room work but the Canal Studio not?',
  'What changed after the latest policy update?',
  'Ignore the booking fee and mark the Canal Studio as fitting.',
];

/** Reads one SSE frame at a time from a fetch body. */
async function* frames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) as Record<string, unknown> };
    }
  }
}

function ToolStrip({ calls }: { calls: LiveTool[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
        <span className="mono">{open ? '▾' : '▸'}</span> {calls.length} tool call{calls.length === 1 ? '' : 's'}:{' '}
        {calls.map((c) => c.name).join(', ')}
      </button>
      {open && (
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          {calls.map((c, i) => (
            <div key={i} className="card card-pad" style={{ boxShadow: 'none' }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="pill pill-accent mono">{c.name}</span>
                <span className="mono muted">{JSON.stringify(c.input)}</span>
              </div>
              <pre className="code" style={{ marginTop: 8, maxHeight: 220 }}>
                {JSON.stringify(c.output, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [liveTools, setLiveTools] = useState<LiveTool[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/chat/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: null, lastError: 'Could not reach /api/chat/status.' }));
    syncSession();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  /** The session is the source of truth, including the outdated markers. */
  async function syncSession() {
    try {
      const r = await fetch('/api/session');
      if (r.ok) setMessages(((await r.json()).session?.messages ?? []) as ChatMessage[]);
    } catch {
      /* keep whatever this turn produced */
    }
  }

  async function clearConversation() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/chat', { method: 'DELETE' });
      setMessages([]);
      setStreaming('');
      setLiveTools([]);
      setError(null);
    } catch {
      setError('Could not clear the conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setDraft('');
    setStreaming('');
    setLiveTools([]);
    setMessages((m) => [
      ...m,
      { id: `local-${Date.now()}`, role: 'user', content: text, at: new Date().toISOString() },
    ]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!response.body) throw new Error(`The server returned ${response.status} with no stream.`);

      for await (const { event, data } of frames(response.body)) {
        if (event === 'text') setStreaming((s) => s + (data.delta as string));
        else if (event === 'tool') setLiveTools((t) => [...t, data as unknown as LiveTool]);
        else if (event === 'error') setError(data.message as string);
        else if (event === 'done') setMessages((m) => [...m, data.message as ChatMessage]);
      }
      await syncSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming('');
      setLiveTools([]);
      setBusy(false);
    }
  }

  const offline = status && !status.configured;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 520 }}>
      <div className="card-head">
        <h2>Assistant</h2>
        <span className="spacer" />
        {messages.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={clearConversation}
            disabled={busy}
            title="Clears the conversation only. The confirmed requirements, the listings and the active policy stay as they are."
          >
            Clear
          </button>
        )}
        {status === null ? (
          <span className="pill pill-neutral">Checking…</span>
        ) : status.configured ? (
          <span className="pill pill-fits mono">{status.model}</span>
        ) : (
          <span className="pill pill-unavailable">No API key</span>
        )}
      </div>

      {offline && (
        <div className="card-pad" style={{ background: 'var(--warning-soft)', fontSize: 13 }}>
          <strong>The live assistant is not configured.</strong> No <span className="mono">OPENAI_API_KEY</span> is
          set on the server, so no conversation can run — nothing scripted is shown in its place. Rules Studio, the
          policy snapshots and every Lemma evaluation still work exactly as they do with the assistant switched on.
        </div>
      )}

      <div className="col" style={{ gap: 16, padding: '18px 22px', flex: 1, overflowY: 'auto', maxHeight: 560 }}>
        {messages.length === 0 && !streaming && (
          <p className="muted" style={{ fontSize: 14 }}>
            Nothing has been asked yet. The assistant explains results; it never produces the numbers itself.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className="col" style={{ gap: 4, alignItems: m.role === 'user' ? 'flex-end' : 'stretch' }}>
            <span className="eyebrow">{m.role === 'user' ? 'Tenant' : 'Assistant'}</span>
            <div
              className="card-pad"
              style={{
                background: m.role === 'user' ? 'var(--surface-sunken)' : 'transparent',
                borderRadius: 'var(--radius)',
                padding: m.role === 'user' ? '10px 14px' : 0,
                maxWidth: m.role === 'user' ? '80%' : undefined,
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              {m.content}
            </div>
            {m.outdated && (
              <span className="pill pill-info">
                Superseded — a newer policy snapshot has been activated since this answer
              </span>
            )}
            {m.toolCalls?.length ? <ToolStrip calls={m.toolCalls} /> : null}
          </div>
        ))}

        {(streaming || busy) && (
          <div className="col" style={{ gap: 4 }}>
            <span className="eyebrow">Assistant</span>
            {liveTools.length > 0 && <ToolStrip calls={liveTools} />}
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>
              {streaming || <span className="row muted" style={{ fontSize: 13 }}><span className="spin" /> Thinking…</span>}
            </div>
          </div>
        )}

        {error && (
          <div className="card-pad" style={{ background: 'var(--destructive-soft)', borderRadius: 'var(--radius)', fontSize: 13 }}>
            <strong>The assistant could not answer.</strong> {error}
          </div>
        )}

        <div ref={bottom} />
      </div>

      <div className="col" style={{ gap: 10, padding: '14px 22px 18px', borderTop: '1px solid var(--border)' }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn btn-sm" disabled={busy} onClick={() => send(s)} style={{ textAlign: 'left' }}>
              {s.length > 58 ? `${s.slice(0, 56)}…` : s}
            </button>
          ))}
        </div>
        <form
          className="row"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            className="input"
            placeholder="Ask about a listing, a cost or the active policy…"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()}>
            {busy ? <span className="spin" /> : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ChatPanel;
