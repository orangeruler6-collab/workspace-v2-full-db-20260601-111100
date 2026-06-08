export type StreamEvent =
  | { type: "stage"; stage: string; message: string; progress?: number }
  | { type: "delta"; delta: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

function encodeEvent(event: StreamEvent) {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export function createNdjsonStream(
  handler: (emit: (event: StreamEvent) => void) => Promise<void>
) {
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          closed = true;
        }
      };

      try {
        await handler(emit);
        emit({ type: "done" });
      } catch (error) {
        if (!closed) {
          emit({
            type: "error",
            message: error instanceof Error ? error.message : "请求处理失败"
          });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {}
        }
      }
    },
    cancel() {
      closed = true;
    }
  });
}
