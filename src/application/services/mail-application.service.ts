import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  ComposeInput,
  Mailbox,
  MailWorkspace,
  MessageMutation,
} from "@/domain/mail/mail";
import type { MailboxId, MessageId } from "@/domain/shared/brand";

export interface WorkspaceQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly mailboxId?: MailboxId;
  readonly search?: string;
}

export class MailApplicationService {
  public constructor(private readonly gateway: MailGateway) {}

  public async getWorkspace(query: WorkspaceQuery): Promise<MailWorkspace> {
    const mailboxes = await this.gateway.listMailboxes();
    const mailboxId = query.mailboxId ?? this.getDefaultMailbox(mailboxes).id;
    const [account, messages] = await Promise.all([
      this.gateway.getAccount(),
      this.gateway.listMessages({ ...query, mailboxId }),
    ]);

    return { account, mailboxes, messages };
  }

  public getMessage(messageId: MessageId) {
    return this.gateway.getMessage(messageId);
  }

  public mutateMessage(mutation: MessageMutation) {
    return this.gateway.mutateMessage(mutation);
  }

  public sendMessage(input: ComposeInput) {
    return this.gateway.sendMessage(input);
  }

  private getDefaultMailbox(mailboxes: readonly Mailbox[]): Mailbox {
    const mailbox =
      mailboxes.find((candidate) => candidate.role === "inbox") ?? mailboxes[0];
    if (!mailbox) {
      throw new Error("The account does not contain any mailboxes.");
    }
    return mailbox;
  }
}
