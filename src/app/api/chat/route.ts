import { runChatTurn, type ChatEvent } from '@/lib/ai/chat';

export const runtime = 'nodejs';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(request: Request) {
  let message = '';
  try {
    ({ message } = (await request.json()) as { message?: string });
  } catch {
    /* handled by the empty check below */
  }
  if (!message?.trim()) {
    return Response.json({ error: 'Send { message: string }.' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(frame(event, data)));
      try {
        const emit = (e: ChatEvent) =>
          e.type === 'text'
            ? send('text', { delta: e.delta })
            : send('tool', { name: e.name, input: e.input, output: e.output });
        send('done', { message: await runChatTurn(message.trim(), emit) });
      } catch (err) {
        // Never substitute a scripted reply: say what actually went wrong.
        send('error', { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
}
