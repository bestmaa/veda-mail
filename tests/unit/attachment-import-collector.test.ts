import { describe, expect, it } from "vitest";

import { collectAttachmentBody } from "@/server/mail/attachment-import-operation";

const stream = (
  chunks: readonly Uint8Array[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> => {
  let index = 0;
  return new ReadableStream<Uint8Array>(
    {
      ...(onCancel ? { cancel: onCancel } : {}),
      pull(controller: ReadableStreamDefaultController<Uint8Array>) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(Uint8Array.from(chunk));
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
};

const read = async (
  body: AsyncIterable<Uint8Array>,
): Promise<readonly Uint8Array[]> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return chunks;
};

describe("attachment import bounded collector", () => {
  it("coalesces tiny provider chunks into a fixed bounded output shape", async () => {
    const tinyChunks = Array.from(
      { length: 10_000 },
      (_, index) => new Uint8Array([index % 251]),
    );

    const collected = await collectAttachmentBody(
      stream(tinyChunks),
      null,
      10_000,
      new AbortController().signal,
    );
    const output = await read(collected.body);

    expect(collected.size).toBe(10_000);
    expect(output).toHaveLength(1);
    expect(output[0]?.byteLength).toBe(10_000);
    expect(output[0]?.[9_999]).toBe(9_999 % 251);

    collected.dispose();
    expect(output[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it("emits at most 64 KiB views without another full plaintext copy", async () => {
    const maximum = 64 * 1_024 + 3;
    const collected = await collectAttachmentBody(
      stream([new Uint8Array(maximum).fill(7)]),
      maximum,
      maximum,
      new AbortController().signal,
    );

    const output = await read(collected.body);
    expect(output.map((chunk) => chunk.byteLength)).toEqual([64 * 1_024, 3]);
    collected.dispose();
  });

  it("rejects and cancels a single chunk over the decoded-byte cap", async () => {
    let cancelled = false;

    await expect(
      collectAttachmentBody(
        stream([new Uint8Array(5)], () => {
          cancelled = true;
        }),
        null,
        4,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
    expect(cancelled).toBe(true);
  });

  it("caps source pulls even when a provider emits empty chunks", async () => {
    let cancelled = false;
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;
      },
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array());
      },
    });

    await expect(
      collectAttachmentBody(
        source,
        null,
        1,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
    expect(pulls).toBeGreaterThanOrEqual(65_537);
    expect(pulls).toBeLessThanOrEqual(65_539);
    expect(cancelled).toBe(true);
  });

  it.each([
    ["empty", [], null],
    ["truncated", [new Uint8Array(2)], 3],
  ] as const)("rejects %s provider content", async (_case, chunks, expected) => {
    await expect(
      collectAttachmentBody(
        stream(chunks),
        expected,
        4,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });
});
