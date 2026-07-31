import "server-only";

import { createHash } from "node:crypto";

import type { MailAddress } from "@/domain/mail/mail";

export interface CanonicalSendIntent {
  readonly attachmentIds: readonly string[];
  readonly bcc: readonly MailAddress[];
  readonly body: string;
  readonly cc: readonly MailAddress[];
  readonly htmlBody: string | null;
  readonly inReplyTo?: string;
  readonly providerDraft?: {
    readonly id: string;
    readonly expectedRevision: string;
  };
  readonly subject: string;
  readonly to: readonly MailAddress[];
}

const addresses = (values: readonly MailAddress[]) =>
  values.map(({ email, name }) => ({ email, name }));

export const sendIntentFingerprint = (
  input: CanonicalSendIntent,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        attachmentIds: input.attachmentIds.map(String),
        bcc: addresses(input.bcc),
        body: input.body,
        cc: addresses(input.cc),
        htmlBody: input.htmlBody,
        inReplyTo: input.inReplyTo ?? null,
        providerDraft: input.providerDraft ?? null,
        subject: input.subject,
        to: addresses(input.to),
      }),
      "utf8",
    )
    .digest("hex");
