import { NextRequest } from 'next/server';
import { ownedRun, errorResponse } from '@/server/audit/http';
import { isTerminal } from '@/contracts/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  if (!ownedRun(request, id)) return errorResponse('未找到此任务。', 404);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSeq = -1, closed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        request.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* The browser may already have cancelled. */ }
      };
      cleanup = close;
      request.signal.addEventListener('abort', close, { once: true });
      let beats = 0;
      const tick = () => {
        if (closed) return;
        try {
          const run = ownedRun(request, id);
          if (!run) { close(); return; }
          if (run.seq !== lastSeq) {
            controller.enqueue(encoder.encode(`id: ${run.seq}\nevent: snapshot\ndata: ${JSON.stringify(run)}\n\n`));
            lastSeq = run.seq;
          } else if (++beats % 20 === 0) controller.enqueue(encoder.encode(': heartbeat\n\n'));
          if (isTerminal(run.status)) close();
        } catch { close(); }
      };
      timer = setInterval(tick, 500);
      tick();
      if (request.signal.aborted) close();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
  } });
}
