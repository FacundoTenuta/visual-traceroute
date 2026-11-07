/** Incremental decoder for `data:` server-sent event frames carrying JSON. */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const frames = this.buffer.split("\n\n");
    this.buffer = frames.pop() ?? "";
    const out: unknown[] = [];
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        out.push(JSON.parse(data));
      } catch {
        // Ignore malformed frames instead of aborting the whole trace.
      }
    }
    return out;
  }
}
