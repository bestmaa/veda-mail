import "server-only";

import type { OutgoingAttachment, SendMessageInput } from "@/domain/mail/mail";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getMailService } from "@/server/mail/mail-service";
import {
  asAttachmentMetadata,
  asSavedAttachmentMetadata,
  assertOutgoingMailPolicy,
  getMailContentPolicy,
} from "@/server/organization/mail-content-policy.service";

export const assertSendMailPolicy = async (
  connection: ProviderConnection,
  input: SendMessageInput,
  attachments: readonly OutgoingAttachment[],
): Promise<Awaited<ReturnType<typeof getMailService>>> => {
  const mail = await getMailService(connection);
  const savedAttachments = input.providerDraft
    ? (await mail.getDraft(input.providerDraft.id)).attachments ?? []
    : [];
  assertOutgoingMailPolicy(
    await getMailContentPolicy(),
    {
      bcc: input.bcc,
      body: input.body,
      cc: input.cc,
      ...(input.htmlBody ? { htmlBody: input.htmlBody } : {}),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      subject: input.subject,
      to: input.to,
    },
    [
      ...savedAttachments.map(asSavedAttachmentMetadata),
      ...attachments.map(asAttachmentMetadata),
    ],
  );
  return mail;
};
