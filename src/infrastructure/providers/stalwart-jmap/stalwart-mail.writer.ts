import "server-only";

import type {
  MessageMutation,
  SendMessageInput,
  SendReceipt,
} from "@/domain/mail/mail";
import {
  createMessageId,
  safeMessageId,
  safeReplyReferences,
} from "@/infrastructure/providers/message-id";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  jmapComposeBody,
  uploadVerifiedJmapAttachments,
} from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";
import { jmapIdentityResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_SUBMISSION } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { submitStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.store";
import { submitStalwartSavedDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-send";
import { mutateStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-mutation";

const addresses = (
  values: SendMessageInput["to"],
): readonly { readonly email: string; readonly name?: string }[] =>
  values.map((address) =>
    address.name
      ? { email: address.email, name: address.name }
      : { email: address.email },
  );

export class StalwartMailWriter {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly reader: StalwartMailReader,
  ) {}

  public async mutateMessage(mutation: MessageMutation): Promise<void> {
    return mutateStalwartMessage(this.client, this.reader, mutation);
  }

  public async sendMessage(input: SendMessageInput): Promise<SendReceipt> {
    const accountId = await this.reader.getAccountId();
    const account = await this.reader.getAccount();
    const [identity, draftMailboxId, sentMailboxId, replyContext] =
      await Promise.all([
        this.getIdentity(accountId, account.email),
        this.getMailboxId("drafts"),
        this.getMailboxId("sent"),
        input.inReplyTo
          ? this.reader.getReplyContext(input.inReplyTo)
          : Promise.resolve(null),
      ]);
    const replyMessageId = safeMessageId(replyContext?.messageId);
    const references = replyMessageId
      ? safeReplyReferences(replyContext?.references ?? [], replyMessageId)
      : [];
    const uploadedAttachments = await uploadVerifiedJmapAttachments(
      this.client,
      accountId,
      input,
    );
    const createId = `draft-${crypto.randomUUID()}`;
    return submitStalwartMessage(
      this.client,
      [
        [
          "Email/set",
          {
            accountId,
            create: {
              [createId]: {
                ...jmapComposeBody(
                  input.body,
                  input.htmlBody,
                  uploadedAttachments,
                ),
                cc: addresses(input.cc),
                bcc: addresses(input.bcc),
                from: [
                  {
                    email: identity.email,
                    name: identity.name ?? account.name,
                  },
                ],
                "header:Message-ID:asMessageIds": [
                  createMessageId(identity.email),
                ],
                ...(replyMessageId
                  ? {
                      "header:In-Reply-To:asMessageIds": [replyMessageId],
                      "header:References:asMessageIds": references,
                    }
                  : {}),
                keywords: { $draft: true, $seen: true },
                mailboxIds: { [draftMailboxId]: true },
                subject: input.subject || "(No subject)",
                to: addresses(input.to),
              },
            },
          },
          "create",
        ],
        [
          "EmailSubmission/set",
          {
            accountId,
            create: {
              submit: {
                emailId: `#${createId}`,
                identityId: identity.id,
              },
            },
            onSuccessUpdateEmail: {
              "#submit": {
                [`mailboxIds/${draftMailboxId}`]: null,
                [`mailboxIds/${sentMailboxId}`]: true,
                "keywords/$draft": null,
                "keywords/$seen": true,
              },
            },
          },
          "submit",
        ],
      ],
      createId,
      accountId,
      { draftMailboxId, sentMailboxId },
    );
  }

  public async sendSavedDraft(
    input: SendMessageInput,
    load: () => Promise<StalwartDraftSendSource>,
  ): Promise<SendReceipt> {
    const accountId = await this.reader.getAccountId();
    const account = await this.reader.getAccount();
    const [identity, draftMailboxId, sentMailboxId] = await Promise.all([
      this.getIdentity(accountId, account.email),
      this.getMailboxId("drafts"),
      this.getMailboxId("sent"),
    ]);
    const source = await load();
    return submitStalwartSavedDraft(
      this.client,
      input,
      source,
      { accountId, draftMailboxId, identity, sentMailboxId },
      load,
    );
  }

  private async getIdentity(accountId: string, fromEmail: string) {
    const response = await this.client.request(
      [["Identity/get", { accountId, ids: null }, "identities"]],
      [JMAP_SUBMISSION],
    );
    const result = this.client.result(
      response,
      "identities",
      "Identity/get",
      jmapIdentityResultSchema,
    );
    const identity =
      result.list.find(
        (candidate) =>
          candidate.email.toLowerCase() === fromEmail.toLowerCase(),
      ) ?? result.list[0];
    if (!identity) {
      throw new Error("No sending identity is configured in Stalwart.");
    }
    return identity;
  }

  private async getMailboxId(role: "drafts" | "sent"): Promise<string> {
    const mailboxes = await this.reader.listMailboxes();
    const mailboxId = mailboxes.find((mailbox) => mailbox.role === role)?.id;
    if (!mailboxId) {
      throw new Error(`No ${role} mailbox is configured.`);
    }
    return mailboxId;
  }

}
