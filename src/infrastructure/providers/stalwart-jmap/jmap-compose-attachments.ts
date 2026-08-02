import "server-only";

import { createHash } from "node:crypto";

import type { SendMessageInput } from "@/domain/mail/mail";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";

export interface JmapComposeAttachment {
  readonly blobId: string;
  readonly name: string;
  readonly type: string;
}

export const uploadVerifiedJmapAttachments = async (
  client: StalwartJmapClient,
  accountId: string,
  input: SendMessageInput,
): Promise<readonly JmapComposeAttachment[]> => {
  const uploaded: JmapComposeAttachment[] = [];
  for (const attachment of input.attachments ?? []) {
    const content = Buffer.from(attachment.content);
    const digest = createHash("sha256").update(content).digest("hex");
    if (
      content.byteLength !== attachment.size ||
      digest !== attachment.sha256
    ) {
      throw new Error("Outgoing attachment integrity check failed.");
    }
    const provider = await client.uploadAttachment(accountId, attachment);
    uploaded.push({
      blobId: provider.blobId,
      name: attachment.name,
      type: provider.type,
    });
  }
  return uploaded;
};

export const jmapComposeBody = (
  body: string,
  htmlBody: string | undefined,
  attachments: readonly JmapComposeAttachment[],
): Readonly<Record<string, unknown>> => {
  const textPart = {
    partId: htmlBody ? "text" : "body",
    type: "text/plain",
  };
  const bodyValues = htmlBody
    ? { html: { value: htmlBody }, text: { value: body } }
    : { body: { value: body } };
  const messageBody = htmlBody
    ? {
        subParts: [
          textPart,
          { partId: "html", type: "text/html" },
        ],
        type: "multipart/alternative",
      }
    : textPart;
  return {
    bodyValues,
    ...(attachments.length > 0
      ? {
          bodyStructure: {
            subParts: [
              messageBody,
              ...attachments.map((attachment) => ({
                blobId: attachment.blobId,
                disposition: "attachment",
                name: attachment.name,
                type: attachment.type,
              })),
            ],
            type: "multipart/mixed",
          },
        }
      : htmlBody
        ? {
            htmlBody: [{ partId: "html", type: "text/html" }],
            textBody: [textPart],
          }
        : { textBody: [textPart] }),
  };
};
