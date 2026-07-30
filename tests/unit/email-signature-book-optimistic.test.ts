import { describe, expect, it } from "vitest";

import type {
  EmailSignature,
  EmailSignatureBook,
} from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import { optimisticEmailSignatureBook } from "@/presentation/features/mail-workspace/email-signature-book-optimistic";

const firstId = id.signature("11111111-1111-4111-8111-111111111111");
const secondId = id.signature("22222222-2222-4222-8222-222222222222");
const signature = (
  signatureId = firstId,
  name = "Work",
): EmailSignature => ({
  body: "Ada",
  createdAt: "2026-07-31T00:00:00.000Z",
  htmlBody: "<p><strong>Ada</strong></p>",
  id: signatureId,
  name,
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: 1,
});
const book = (): EmailSignatureBook => ({
  createdAt: "2026-07-31T00:00:00.000Z",
  defaults: { newMessageId: firstId, replyForwardId: firstId },
  revision: "revision-00000001",
  signatures: [signature(), signature(secondId, "Short")],
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: 1,
});

describe("optimistic email signature book", () => {
  it("refuses to project a stale revision", () => {
    const current = book();
    expect(
      optimisticEmailSignatureBook(current, {
        expectedRevision: "revision-stale00",
        newMessageId: null,
        operation: "set-defaults",
        replyForwardId: null,
      }),
    ).toBe(current);
  });

  it("updates known content while preserving the server revision", () => {
    const projected = optimisticEmailSignatureBook(book(), {
      content: { body: "Plain Ada", mode: "plain" },
      expectedRevision: "revision-00000001",
      name: "Plain",
      operation: "update",
      signatureId: firstId,
    });

    expect(projected.revision).toBe("revision-00000001");
    expect(projected.signatures[0]).toMatchObject({
      body: "Plain Ada",
      name: "Plain",
    });
    expect(projected.signatures[0]).not.toHaveProperty("htmlBody");
  });

  it("clears both defaults when their signature is optimistically deleted", () => {
    const projected = optimisticEmailSignatureBook(book(), {
      expectedRevision: "revision-00000001",
      operation: "delete",
      signatureId: firstId,
    });

    expect(projected.signatures.map(({ id: value }) => value)).toEqual([
      secondId,
    ]);
    expect(projected.defaults).toEqual({
      newMessageId: null,
      replyForwardId: null,
    });
  });
});
