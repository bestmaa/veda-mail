import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type {
  ComposeInput,
  MessageListQuery,
  MessageMutation,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { StalwartMailWriter } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.writer";
import type { StalwartConfig } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export class StalwartMailGateway implements MailGateway {
  private readonly reader: StalwartMailReader;
  private readonly writer: StalwartMailWriter;

  public constructor(config: StalwartConfig) {
    const client = new StalwartJmapClient(config);
    this.reader = new StalwartMailReader(client, config);
    this.writer = new StalwartMailWriter(client, this.reader);
  }

  public getAccount() {
    return this.reader.getAccount();
  }

  public getMessage(messageId: MessageId) {
    return this.reader.getMessage(messageId);
  }

  public listMailboxes() {
    return this.reader.listMailboxes();
  }

  public listMessages(query: MessageListQuery) {
    return this.reader.listMessages(query);
  }

  public mutateMessage(mutation: MessageMutation) {
    return this.writer.mutateMessage(mutation);
  }

  public sendMessage(input: ComposeInput) {
    return this.writer.sendMessage(input);
  }

  public async testConnection(): Promise<void> {
    await this.reader.listMailboxes();
  }
}
