import "server-only";

import type {
  ComposeInput,
  MessageMutation,
  SendReceipt,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  jmapIdentityResultSchema,
  jmapSetResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const addresses = (
  values: ComposeInput["to"],
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
    const accountId = await this.reader.getAccountId();
    const patch: Readonly<Record<string, unknown>> =
      mutation.type === "set-read"
        ? { "keywords/$seen": mutation.value ? true : null }
        : mutation.type === "set-starred"
          ? { "keywords/$flagged": mutation.value ? true : null }
          : {
              mailboxIds: {
                [await this.resolveTargetMailbox(mutation.type, mutation)]: true,
              },
            };
    const response = await this.client.request(
      [
        [
          "Email/set",
          { accountId, update: { [mutation.messageId]: patch } },
          "update",
        ],
      ],
      [JMAP_MAIL],
    );
    const result = this.client.result(
      response,
      "update",
      "Email/set",
      jmapSetResultSchema,
    );
    if (result.notUpdated && Object.keys(result.notUpdated).length > 0) {
      throw new Error("Stalwart rejected the message update.");
    }
  }

  public async sendMessage(input: ComposeInput): Promise<SendReceipt> {
    const accountId = await this.reader.getAccountId();
    const account = await this.reader.getAccount();
    const [identity, draftMailboxId, sentMailboxId] = await Promise.all([
      this.getIdentity(accountId, account.email),
      this.getMailboxId("drafts"),
      this.getMailboxId("sent"),
    ]);
    const createId = `draft-${crypto.randomUUID()}`;
    const response = await this.client.request(
      [
        [
          "Email/set",
          {
            accountId,
            create: {
              [createId]: {
                bodyValues: { body: { value: input.body } },
                cc: addresses(input.cc),
                bcc: addresses(input.bcc),
                from: [
                  {
                    email: identity.email,
                    name: identity.name ?? account.name,
                  },
                ],
                keywords: { $draft: true, $seen: true },
                mailboxIds: { [draftMailboxId]: true },
                subject: input.subject || "(No subject)",
                textBody: [{ partId: "body", type: "text/plain" }],
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
      [JMAP_MAIL, JMAP_SUBMISSION],
    );
    const createResult = this.client.result(
      response,
      "create",
      "Email/set",
      jmapSetResultSchema,
    );
    const submissionResult = this.client.result(
      response,
      "submit",
      "EmailSubmission/set",
      jmapSetResultSchema,
    );
    const created = createResult.created?.[createId];
    const submission = submissionResult.created?.["submit"];
    if (
      !created ||
      !submission ||
      createResult.notCreated?.[createId] ||
      submissionResult.notCreated?.["submit"]
    ) {
      throw new Error("Stalwart did not create the outgoing message.");
    }
    return { id: id.message(created.id), submittedAt: new Date().toISOString() };
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

  private async resolveTargetMailbox(
    type: Exclude<MessageMutation["type"], "set-read" | "set-starred">,
    mutation: MessageMutation,
  ): Promise<string> {
    if (type === "move" && mutation.type === "move") {
      return mutation.mailboxId;
    }
    const role = type === "delete" ? "trash" : type === "restore" ? "inbox" : "archive";
    const mailbox = (await this.reader.listMailboxes()).find(
      (candidate) => candidate.role === role,
    );
    if (!mailbox) {
      throw new Error(`The ${role} mailbox is not configured.`);
    }
    return mailbox.id;
  }
}
