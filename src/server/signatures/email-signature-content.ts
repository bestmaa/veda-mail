import "server-only";

import sanitizeHtml from "sanitize-html";

import {
  type EmailSignatureCanonicalContent,
  type EmailSignatureContentInput,
  MAX_EMAIL_SIGNATURE_COMBINED_CHARACTERS,
  MAX_EMAIL_SIGNATURE_COMBINED_UTF8_BYTES,
  MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS,
  MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES,
  MAX_EMAIL_SIGNATURE_HTML_DEPTH,
  MAX_EMAIL_SIGNATURE_HTML_NODES,
} from "@/domain/member/email-signature";
import { outgoingContentUtf8Bytes } from "@/domain/mail/outgoing-content-policy";
import { canonicalizeOutgoingMailContent } from "@/server/mail/outgoing-mail-content";
import { ApiError } from "@/transport/http/api-error";

const tooLarge = (): never => {
  throw new ApiError(
    "The signature exceeds the safe content limit.",
    "SIGNATURE_CONTENT_TOO_LARGE",
    413,
  );
};

const tooComplex = (): never => {
  throw new ApiError(
    "The rich signature is too complex.",
    "SIGNATURE_CONTENT_TOO_COMPLEX",
    422,
  );
};

const withinFieldLimit = (value: string): boolean =>
  value.length <= MAX_EMAIL_SIGNATURE_CONTENT_CHARACTERS &&
  outgoingContentUtf8Bytes(value) <=
    MAX_EMAIL_SIGNATURE_CONTENT_UTF8_BYTES;

const assertCanonicalLimits = (
  content: EmailSignatureCanonicalContent,
): void => {
  const htmlBody = content.htmlBody ?? "";
  if (!withinFieldLimit(content.body) || !withinFieldLimit(htmlBody)) {
    tooLarge();
  }
  if (
    content.body.length + htmlBody.length >
      MAX_EMAIL_SIGNATURE_COMBINED_CHARACTERS ||
    outgoingContentUtf8Bytes(content.body) +
      outgoingContentUtf8Bytes(htmlBody) >
      MAX_EMAIL_SIGNATURE_COMBINED_UTF8_BYTES
  ) {
    tooLarge();
  }
};

const assertRichComplexity = (htmlBody: string): void => {
  let depth = 0;
  let nodes = 0;
  sanitizeHtml(htmlBody, {
    allowedAttributes: false,
    allowedTags: [],
    onCloseTag: () => {
      depth = Math.max(0, depth - 1);
    },
    onOpenTag: () => {
      nodes += 1;
      depth += 1;
      if (
        nodes > MAX_EMAIL_SIGNATURE_HTML_NODES ||
        depth > MAX_EMAIL_SIGNATURE_HTML_DEPTH
      ) {
        tooComplex();
      }
    },
    parseStyleAttributes: false,
  });
};

export const canonicalizeEmailSignatureContent = (
  input: EmailSignatureContentInput,
): EmailSignatureCanonicalContent => {
  if (input.mode === "plain") {
    if (!withinFieldLimit(input.body)) tooLarge();
    const content = canonicalizeOutgoingMailContent({ body: input.body });
    assertCanonicalLimits(content);
    return content;
  }
  if (!withinFieldLimit(input.htmlBody)) tooLarge();
  assertRichComplexity(input.htmlBody);
  const content = canonicalizeOutgoingMailContent({
    body: "Signature",
    htmlBody: input.htmlBody,
  });
  assertCanonicalLimits(content);
  return content;
};
