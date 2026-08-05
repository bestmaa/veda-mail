import { describe, expect, it } from "vitest";

import {
  jmapEventSourceUrl,
  readJmapStateEvent,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-event-source";

const stream = (chunks: readonly string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});

describe("Stalwart JMAP event source", () => {
  it("expands only the bounded state-change subscription", () => {
    expect(jmapEventSourceUrl(
      "https://mail.example.com/jmap/event?types={types}&closeafter={closeafter}&ping={ping}",
    )).toBe(
      "https://mail.example.com/jmap/event?types=Email%2CMailbox&closeafter=state&ping=30",
    );
  });

  it("accepts a valid state event split across chunks", async () => {
    const body = stream([
      ": ping\r\n\r\nevent: state\r\ndata: {\"changed\":{",
      "\"account-1\":{\"Email\":\"state-2\"}}}\r\n\r\n",
    ]);

    await expect(readJmapStateEvent(body)).resolves.toBe(true);
  });

  it("ignores malformed and unrelated provider events", async () => {
    const body = stream([
      "event: message\ndata: {}\n\n",
      "event: state\ndata: {not-json}\n\n",
    ]);

    await expect(readJmapStateEvent(body)).resolves.toBe(false);
  });

  it("rejects an event that exceeds the bounded parser buffer", async () => {
    const body = stream([`event: state\ndata: ${"x".repeat(70_000)}`]);

    await expect(readJmapStateEvent(body)).rejects.toThrow(
      "exceeded the safe size limit",
    );
  });
});
