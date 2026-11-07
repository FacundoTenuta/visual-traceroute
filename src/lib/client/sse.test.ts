import { describe, expect, it } from "vitest";
import { SseDecoder } from "./sse";

describe("SseDecoder", () => {
  it("decodes complete data frames", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"type":"start"}\n\ndata: {"type":"done"}\n\n')).toEqual([
      { type: "start" },
      { type: "done" },
    ]);
  });

  it("buffers frames split across chunks", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"type":')).toEqual([]);
    expect(decoder.push('"hop"}\n')).toEqual([]);
    expect(decoder.push("\n")).toEqual([{ type: "hop" }]);
  });

  it("ignores comments and malformed frames", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": keepalive\n\ndata: not-json\n\ndata: {\"ok\":1}\n\n")).toEqual([{ ok: 1 }]);
  });
});
