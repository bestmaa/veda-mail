import { describe, expect, it, vi } from "vitest";

import { attachmentScanner } from "@/server/mail/attachment-service";

describe("attachment service scanner", () => {
  it("returns one scheduled test scanner and fully consumes its input", async () => {
    const scanner = attachmentScanner();
    const again = attachmentScanner();
    let consumed = 0;
    const content = async function* () {
      consumed += 1;
      yield Buffer.from("one");
      consumed += 1;
      yield Buffer.from("two");
    };

    expect(again).toBe(scanner);
    await expect(
      scanner.scan(content(), {
        abortUpload: vi.fn(),
        attachmentId: "singleton-test",
        expectedBytes: 6,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ verdict: "clean" });
    expect(consumed).toBe(2);
  });
});
