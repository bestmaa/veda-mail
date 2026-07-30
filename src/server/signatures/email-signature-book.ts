import "server-only";

import {
  type EmailSignatureBook,
  type EmailSignatureCanonicalContent,
  type EmailSignaturePutOperation,
  MAX_EMAIL_SIGNATURES,
} from "@/domain/member/email-signature";
import type { SignatureId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";
import {
  parseStoredEmailSignatureBook,
  type StoredEmailSignatureBook,
} from "@/server/signatures/email-signature-record";
import { ApiError } from "@/transport/http/api-error";

const notFound = (): never => {
  throw new ApiError(
    "The signature was not found.",
    "SIGNATURE_NOT_FOUND",
    404,
  );
};

const locate = (
  book: EmailSignatureBook,
  signatureId: SignatureId,
): number => {
  const index = book.signatures.findIndex(
    (signature) => signature.id === signatureId,
  );
  return index < 0 ? notFound() : index;
};

const assertUniqueName = (
  book: EmailSignatureBook,
  name: string,
  excluding?: SignatureId,
): void => {
  const normalized = name.toLowerCase();
  if (
    book.signatures.some(
      (signature) =>
        signature.id !== excluding &&
        signature.name.toLowerCase() === normalized,
    )
  ) {
    throw new ApiError(
      "Each signature must have a unique name.",
      "SIGNATURE_NAME_CONFLICT",
      422,
    );
  }
};

const requiredContent = (
  content: EmailSignatureCanonicalContent | null,
): EmailSignatureCanonicalContent => {
  if (!content) throw new Error("Canonical signature content is required.");
  return content;
};

export const updateEmailSignatureBook = (
  current: EmailSignatureBook,
  operation: EmailSignaturePutOperation,
  content: EmailSignatureCanonicalContent | null,
): StoredEmailSignatureBook => {
  const now = new Date().toISOString();
  let signatures = [...current.signatures];
  let defaults = current.defaults;
  if (operation.operation === "create") {
    assertUniqueName(current, operation.name);
    if (signatures.length >= MAX_EMAIL_SIGNATURES) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_EMAIL_SIGNATURES} signatures.`,
        "SIGNATURE_LIMIT_REACHED",
        422,
      );
    }
    signatures.push({
      ...requiredContent(content),
      createdAt: now,
      id: id.signature(crypto.randomUUID()),
      name: operation.name,
      updatedAt: now,
      version: 1,
    });
  } else if (operation.operation === "update") {
    assertUniqueName(current, operation.name, operation.signatureId);
    const index = locate(current, operation.signatureId);
    const existing = signatures[index]!;
    const canonical = requiredContent(content);
    signatures[index] = {
      body: canonical.body,
      createdAt: existing.createdAt,
      ...(canonical.htmlBody ? { htmlBody: canonical.htmlBody } : {}),
      id: existing.id,
      name: operation.name,
      updatedAt: now,
      version: 1,
    };
  } else if (operation.operation === "delete") {
    locate(current, operation.signatureId);
    signatures = signatures.filter(
      ({ id: signatureId }) => signatureId !== operation.signatureId,
    );
    defaults = {
      newMessageId:
        defaults.newMessageId === operation.signatureId
          ? null
          : defaults.newMessageId,
      replyForwardId:
        defaults.replyForwardId === operation.signatureId
          ? null
          : defaults.replyForwardId,
    };
  } else {
    const ids = new Set(signatures.map(({ id: signatureId }) => signatureId));
    if (
      (operation.newMessageId && !ids.has(operation.newMessageId)) ||
      (operation.replyForwardId && !ids.has(operation.replyForwardId))
    ) {
      notFound();
    }
    defaults = {
      newMessageId: operation.newMessageId,
      replyForwardId: operation.replyForwardId,
    };
  }
  return parseStoredEmailSignatureBook({
    createdAt: current.createdAt ?? now,
    defaults,
    revision: crypto.randomUUID(),
    signatures,
    updatedAt: now,
    version: 1,
  });
};
