import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClamAvAttachmentScanner,
  MagicNumberMimeDetector,
} from "@/server/security/attachment-inspection";

const servers: net.Server[] = [];

const startClamd = async (reply: string | null, terminate = true) => {
  let received = Buffer.alloc(0);
  const server = net.createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let commandRead = false;
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!commandRead) {
        const end = buffered.indexOf(0);
        if (end < 0) return;
        expect(buffered.subarray(0, end).toString("ascii")).toBe("zINSTREAM");
        buffered = buffered.subarray(end + 1);
        commandRead = true;
      }
      while (buffered.byteLength >= 4) {
        const size = buffered.readUInt32BE(0);
        if (buffered.byteLength < 4 + size) return;
        buffered = buffered.subarray(4);
        if (size === 0) {
          if (reply) socket.end(terminate ? `${reply}\0` : reply);
          return;
        }
        received = Buffer.concat([received, buffered.subarray(0, size)]);
        buffered = buffered.subarray(size);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  return { port: address.port, received: () => received };
};

const content = async function* (...chunks: string[]) {
  for (const chunk of chunks) yield Buffer.from(chunk);
};

const delayedContent = async function* (delayMs: number, ...chunks: string[]) {
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield Buffer.from(chunk);
  }
};

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("attachment inspection", () => {
  it("streams every byte through ClamAV and accepts only an explicit OK", async () => {
    const clamd = await startClamd("stream: OK");
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: clamd.port,
      verdictTimeoutMs: 1_000,
    });

    await expect(scanner.scan(content("hello ", "world"))).resolves.toEqual({
      verdict: "clean",
    });
    expect(clamd.received().toString()).toBe("hello world");
  });

  it("returns an infected verdict without leaking a signature name", async () => {
    const clamd = await startClamd("stream: Eicar-Test-Signature FOUND");
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: clamd.port,
      verdictTimeoutMs: 1_000,
    });
    await expect(scanner.scan(content("malware"))).resolves.toEqual({
      reason: "Malware signature detected.",
      verdict: "infected",
    });
  });

  it("fails closed when the scanner does not return a verdict", async () => {
    const clamd = await startClamd(null);
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: clamd.port,
      verdictTimeoutMs: 25,
    });
    await expect(scanner.scan(content("timeout"))).rejects.toThrow("timed out");
  });

  it("allows a slow stream that continues making progress", async () => {
    const clamd = await startClamd("stream: OK");
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 35,
      port: clamd.port,
      verdictTimeoutMs: 1_000,
    });
    await expect(
      scanner.scan(delayedContent(15, "one", "two", "three", "four")),
    ).resolves.toEqual({ verdict: "clean" });
  });

  it("rejects a partial verdict when ClamAV closes early", async () => {
    const clamd = await startClamd("stream: O", false);
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: clamd.port,
      verdictTimeoutMs: 1_000,
    });
    await expect(scanner.scan(content("data"))).rejects.toThrow(
      "complete verdict",
    );
  });

  it("accepts only ClamAV's exact clean verdict", async () => {
    const clamd = await startClamd("error: OK");
    const scanner = new ClamAvAttachmentScanner({
      host: "127.0.0.1",
      idleTimeoutMs: 1_000,
      port: clamd.port,
      verdictTimeoutMs: 1_000,
    });
    await expect(scanner.scan(content("data"))).rejects.toThrow(
      "clean or infected",
    );
  });

  it("uses binary signatures instead of a conflicting declared type", async () => {
    const detector = new MagicNumberMimeDetector();
    const result = await detector.detect({
      byteLength: 12,
      declaredMimeType: "image/jpeg",
      fileName: "fake.jpg",
      sample: Buffer.from("%PDF-1.7\n%%"),
    });
    expect(result).toEqual({
      mimeType: "application/pdf",
      verdict: "accepted",
    });
  });

  it("downgrades unrecognized binary input to octet-stream", async () => {
    const detector = new MagicNumberMimeDetector();
    const result = await detector.detect({
      byteLength: 5,
      declaredMimeType: "image/png",
      fileName: "fake.png",
      sample: Uint8Array.from([0, 1, 2, 3, 4]),
    });
    expect(result).toEqual({
      mimeType: "application/octet-stream",
      verdict: "accepted",
    });
  });

  it.each([
    ["application/json", "this is not JSON"],
    ["application/xml", "this is not XML"],
    ["text/xml", "this is not XML"],
    ["text/calendar", "this is not an iCalendar object"],
    ["text/csv", "this has no verified CSV structure"],
  ])(
    "downgrades an unverified %s browser claim to plain text",
    async (declaredMimeType, contents) => {
      const detector = new MagicNumberMimeDetector();
      await expect(
        detector.detect({
          byteLength: Buffer.byteLength(contents),
          declaredMimeType,
          fileName: "spoofed.txt",
          sample: Buffer.from(contents),
        }),
      ).resolves.toEqual({
        mimeType: "text/plain",
        verdict: "accepted",
      });
    },
  );
});
