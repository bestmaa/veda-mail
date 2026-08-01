import "server-only";

import { createHash } from "node:crypto";
import type { ListResponse } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer";
import nodemailer from "nodemailer";
import type {
  MessageMutation,
  ReplyContext,
  SendMessageInput,
  SendReceipt,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  decodeMailboxId,
  decodeScopedImapMessageId,
  encodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { mutateImapLabel } from "@/infrastructure/providers/imap-smtp/imap-label-mutation";
import {
  normalizeAttachmentFilename,
  normalizeAttachmentMimeType,
} from "@/infrastructure/providers/imap-smtp/mime-attachment-headers";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { smtpDeliveryReceipt } from "@/infrastructure/providers/imap-smtp/smtp-delivery-receipt";
import {
  SmtpAttachmentCapability,
  type SmtpAttachmentCapabilityPort,
} from "@/infrastructure/providers/imap-smtp/smtp-attachment-capability";
import {
  createMessageId,
  safeMessageId,
  safeMessageIds,
  safeReplyReferences,
} from "@/infrastructure/providers/message-id";
import { assertSafeProviderHost } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";
const address = (
  value: SendMessageInput["to"][number],
): { address: string; name: string } => ({
  address: value.email,
  name: value.name ?? "",
});
const referencesFrom = (headers?: Buffer): readonly string[] => {
  const values = headers?.toString("utf8").match(/<[^<>\r\n]{1,996}>/g) ?? [];
  return safeMessageIds(values);
};
const outgoingAttachments = (
  input: SendMessageInput,
): {
  readonly content: Buffer;
  readonly contentType: string;
  readonly filename: string;
}[] =>
  (input.attachments ?? []).map((attachment) => {
    const content = Buffer.from(attachment.content);
    const digest = createHash("sha256").update(content).digest("hex");
    if (
      content.byteLength !== attachment.size ||
      digest !== attachment.sha256
    ) {
      throw new Error("Outgoing attachment integrity check failed.");
    }
    return {
      content,
      contentType: normalizeAttachmentMimeType(attachment.mimeType),
      filename: normalizeAttachmentFilename(attachment.name),
    };
  });

const rolePath = (
  mailboxes: readonly ListResponse[],
  role: "archive" | "inbox" | "sent" | "trash",
): string => {
  const special = role === "inbox" ? "\\Inbox" : `\\${role}`;
  const mailbox = mailboxes.find(
    (candidate) =>
      candidate.specialUse?.toLowerCase() === special.toLowerCase() ||
      (role === "inbox" && candidate.path.toUpperCase() === "INBOX"),
  );
  if (!mailbox) throw new Error(`No ${role} mailbox is configured.`);
  return mailbox.path;
};

const messageReference = (
  config: ImapSmtpMemberConfig,
  messageId: string,
  notFoundMessage: string,
) => {
  try {
    return decodeScopedImapMessageId(config, messageId);
  } catch {
    throw new Error(notFoundMessage);
  }
};

export class ImapMailWriter {
  public constructor(
    private readonly config: ImapSmtpMemberConfig,
    private readonly attachmentCapability: SmtpAttachmentCapabilityPort = new SmtpAttachmentCapability(
      config,
    ),
  ) {}

  public async mutateMessage(mutation: MessageMutation): Promise<void> {
    const reference = messageReference(
      this.config,
      mutation.messageId,
      "Message not found.",
    );
    return withImapClient(this.config, async (client) => {
      const opened = await client.mailboxOpen(reference.mailbox);
      if (!imapUidValidityMatches(reference, opened.uidValidity)) {
        throw new Error("Message not found.");
      }
      if (mutation.type === "destroy") {
        const deleted = await client.messageDelete(reference.uid, { uid: true });
        if (!deleted) throw new Error("Message not found.");
        return;
      }
      if (mutation.type === "set-label") {
        await mutateImapLabel(client, opened, reference.uid, mutation);
        return;
      }
      if (mutation.type === "set-read" || mutation.type === "set-starred") {
        const flag = mutation.type === "set-read" ? "\\Seen" : "\\Flagged";
        const update = mutation.value
          ? client.messageFlagsAdd.bind(client)
          : client.messageFlagsRemove.bind(client);
        await update(reference.uid, [flag], { uid: true });
        return;
      }
      const target =
        mutation.type === "move"
          ? decodeMailboxId(mutation.mailboxId)
          : rolePath(
              await client.list(),
              mutation.type === "delete"
                ? "trash"
                : mutation.type === "restore"
                  ? "inbox"
                  : "archive",
            );
      await client.messageMove(reference.uid, target, { uid: true });
    });
  }

  public async sendMessage(input: SendMessageInput): Promise<SendReceipt> {
    await assertSafeProviderHost(this.config.smtpHost);
    const replyContext = input.inReplyTo
      ? await this.getReplyContext(input.inReplyTo)
      : null;
    const replyMessageId = safeMessageId(replyContext?.messageId);
    const references = replyMessageId
      ? safeReplyReferences(replyContext?.references ?? [], replyMessageId)
      : [];
    const mail = {
      attachments: outgoingAttachments(input),
      bcc: input.bcc.map(address),
      cc: input.cc.map(address),
      from: address({ email: this.config.username, name: null }),
      ...(replyMessageId
        ? { inReplyTo: replyMessageId, references: [...references] }
        : {}),
      html: input.htmlBody,
      messageId: `<${createMessageId(this.config.username)}>`,
      subject: input.subject || "(No subject)",
      text: input.body,
      to: input.to.map(address),
    };
    const raw = await new MailComposer(mail).compile().build();
    if ((input.attachments?.length ?? 0) > 0) {
      await this.attachmentCapability.assertMessageBytes(raw.byteLength);
    }
    const transport = nodemailer.createTransport({
      auth: { pass: this.config.secret, user: this.config.username },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      host: this.config.smtpHost,
      port: Number(this.config.smtpPort),
      requireTLS: this.config.smtpSecurity === "starttls",
      secure: this.config.smtpSecurity === "tls",
      socketTimeout: 60_000,
    });
    let receipt: Awaited<ReturnType<typeof transport.sendMail>>;
    try {
      receipt = await transport.sendMail({
        envelope: {
          from: this.config.username,
          to: [...input.to, ...input.cc, ...input.bcc].map((item) => item.email),
        },
        raw,
      });
    } catch (error) {
      smtpDeliveryReceipt(input, error);
      return {
        deliveryStatus: "uncertain",
        id: id.message(mail.messageId),
        rejectedRecipients: [],
        submittedAt: new Date().toISOString(),
      };
    }
    const delivery = smtpDeliveryReceipt(input, receipt);
    let sentReference = String(receipt.messageId ?? mail.messageId);
    await withImapClient(this.config, async (client) => {
      const sent = rolePath(await client.list(), "sent");
      const opened = await client.mailboxOpen(sent);
      const appended = await client.append(sent, raw, ["\\Seen"], new Date());
      if (appended && appended.uid) {
        sentReference = encodeScopedImapMessageId(this.config, {
          mailbox: sent,
          uid: appended.uid,
          uidValidity: appended.uidValidity ?? opened.uidValidity,
        });
      }
    }).catch(() => undefined);
    return {
      ...delivery,
      id: id.message(sentReference || String(receipt.messageId)),
      submittedAt: new Date().toISOString(),
    };
  }

  private getReplyContext(messageId: string): Promise<ReplyContext> {
    const notFound = "The message being replied to was not found.";
    const reference = messageReference(this.config, id.message(messageId), notFound);
    return withImapClient(this.config, async (client) => {
      const opened = await client.mailboxOpen(reference.mailbox, {
        readOnly: true,
      });
      if (!imapUidValidityMatches(reference, opened.uidValidity)) {
        throw new Error(notFound);
      }
      const source = await client.fetchOne(
        reference.uid,
        { envelope: true, headers: ["references"], uid: true },
        { uid: true },
      );
      if (!source || source.uid !== reference.uid) {
        throw new Error(notFound);
      }
      return {
        messageId: safeMessageId(source.envelope?.messageId),
        references: referencesFrom(source.headers),
      };
    });
  }
}
