import { describe, expect, it } from "vitest";

import {
  MAX_JMAP_JSON_RESPONSE_BYTES,
  readJmapResponseJson,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-http";

describe("bounded JMAP JSON responses", () => {
  it("parses a valid streamed response", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"value":'));
          controller.enqueue(encoder.encode("42}"));
          controller.close();
        },
      }),
    );

    await expect(readJmapResponseJson(response, 64)).resolves.toEqual({
      value: 42,
    });
  });

  it("rejects an oversized declared response before buffering it", async () => {
    const response = new Response("{}", {
      headers: {
        "content-length": String(MAX_JMAP_JSON_RESPONSE_BYTES + 1),
      },
    });

    await expect(readJmapResponseJson(response)).rejects.toThrow(
      "invalid JSON size",
    );
  });

  it("rejects a chunked response that crosses the byte budget", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(5));
          controller.enqueue(new Uint8Array(5));
          controller.close();
        },
      }),
    );

    await expect(readJmapResponseJson(response, 8)).rejects.toThrow(
      "invalid JSON",
    );
  });

  it("rejects malformed UTF-8 and invalid budgets generically", async () => {
    await expect(
      readJmapResponseJson(new Response(new Uint8Array([0xff])), 8),
    ).rejects.toThrow("invalid JSON");
    await expect(readJmapResponseJson(new Response("{}"), 0)).rejects.toThrow(
      "positive safe integer",
    );
  });
});
