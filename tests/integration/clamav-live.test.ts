import { describe, expect, it } from "vitest";

import {
  ClamAvAttachmentScanner,
  MagicNumberMimeDetector,
} from "@/server/security/attachment-inspection";
import { inspectTextAttachmentPreview } from "@/server/mail/attachment-preview-text";

const port = Number(process.env["VEDA_MAIL_TEST_CLAMAV_PORT"]);
const liveTest = Number.isSafeInteger(port) && port > 0 ? it : it.skip;

const content = async function* (bytes: Uint8Array) {
  yield bytes;
};

describe("live ClamAV integration", () => {
  liveTest(
    "accepts clean bytes and rejects the EICAR test signature",
    async () => {
      const scanner = new ClamAvAttachmentScanner({
        host: "127.0.0.1",
        idleTimeoutMs: 30_000,
        port,
        verdictTimeoutMs: 30_000,
      });
      const clean = await scanner.scan(
        content(Buffer.from("Veda Mail live scanner smoke test.")),
      );
      const eicar = Buffer.from(
        [
          "WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0ND",
          "KTd9JEVJQ0FSLVNUQU5EQVJELUFOVElW",
          "SVJVUy1URVNULUZJTEUhJEgrSCo=",
        ].join(""),
        "base64",
      );
      const infected = await scanner.scan(content(eicar));

      expect(clean).toEqual({ verdict: "clean" });
      expect(infected).toEqual({
        reason: "Malware signature detected.",
        verdict: "infected",
      });

      await expect(
        inspectTextAttachmentPreview(
          {
            bytes: Buffer.from("Veda Mail safe plain text preview."),
            declaredMimeType: "text/plain",
            fileName: "clean.txt",
            signal: new AbortController().signal,
          },
          {
            mimeDetector: new MagicNumberMimeDetector(),
            scanner,
          },
        ),
      ).resolves.toEqual(
        new TextEncoder().encode("Veda Mail safe plain text preview."),
      );
      await expect(
        inspectTextAttachmentPreview(
          {
            bytes: eicar,
            declaredMimeType: "text/plain",
            fileName: "blocked.txt",
            signal: new AbortController().signal,
          },
          {
            mimeDetector: new MagicNumberMimeDetector(),
            scanner,
          },
        ),
      ).rejects.toMatchObject({
        code: "ATTACHMENT_PREVIEW_BLOCKED",
        status: 422,
      });
    },
  );
});
