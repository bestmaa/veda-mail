import "server-only";

import type { DraftCapability, DraftDetail } from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftNotFoundError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import type { DraftId, ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  isStalwartDraftPresent,
  loadStalwartDraftRecord,
  stalwartDraftGetResultSchema,
  type StalwartDraftContext,
  type StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { jmapDraftQueryResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import { jmapDraftComposeKeyword } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export type {
  StalwartDraftContext,
  StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";

export class StalwartDraftReader {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly mail: StalwartMailReader,
  ) {}

  public async capability(): Promise<DraftCapability> {
    try {
      const resolved = await this.resolveContext();
      return resolved.status === "supported"
        ? { status: "supported" }
        : { status: resolved.status };
    } catch {
      return { status: "unavailable" };
    }
  }

  public async context(): Promise<StalwartDraftContext> {
    const resolved = await this.resolveContext();
    if (resolved.status !== "supported") throw new DraftUnavailableError();
    return resolved.context;
  }

  public async get(providerDraftId: ProviderDraftId): Promise<DraftDetail> {
    return (await this.load(await this.context(), providerDraftId)).detail;
  }

  public load(
    context: StalwartDraftContext,
    providerDraftId: ProviderDraftId,
  ): Promise<StalwartDraftRecord> {
    return loadStalwartDraftRecord(this.client, context, providerDraftId);
  }

  public async findByComposeId(
    context: StalwartDraftContext,
    composeId: DraftId,
  ): Promise<StalwartDraftRecord | null> {
    const response = await this.client.request(
      [
        [
          "Email/query",
          {
            accountId: context.accountId,
            calculateTotal: true,
            filter: {
              hasKeyword: jmapDraftComposeKeyword(composeId),
            },
            limit: 2,
          },
          "draft-query",
        ],
      ],
      [JMAP_MAIL],
    );
    const result = this.client.result(
      response,
      "draft-query",
      "Email/query",
      jmapDraftQueryResultSchema,
    );
    if (result.accountId !== context.accountId || result.position !== 0) {
      throw new DraftConflictError();
    }
    if (result.total === 0 && result.ids.length === 0) return null;
    if (result.total !== 1 || result.ids.length !== 1) {
      throw new DraftConflictError();
    }
    let record: StalwartDraftRecord;
    try {
      record = await this.load(context, result.ids[0] as ProviderDraftId);
    } catch (error) {
      if (error instanceof DraftNotFoundError) throw new DraftConflictError();
      throw error;
    }
    if (record.detail.composeId !== composeId) throw new DraftConflictError();
    return record;
  }

  public isPresent(
    context: StalwartDraftContext,
    providerDraftId: ProviderDraftId,
  ): Promise<boolean> {
    return isStalwartDraftPresent(this.client, context, providerDraftId);
  }

  public async state(context: StalwartDraftContext): Promise<string> {
    const response = await this.client.request(
      [["Email/get", { accountId: context.accountId, ids: [] }, "state"]],
      [JMAP_MAIL],
    );
    const result = this.client.result(
      response,
      "state",
      "Email/get",
      stalwartDraftGetResultSchema,
    );
    if (
      result.accountId !== context.accountId ||
      result.list.length !== 0 ||
      result.notFound.length !== 0
    ) {
      throw new DraftConflictError();
    }
    return result.state;
  }

  private async resolveContext(): Promise<
    | { readonly status: "read-only" | "unavailable" }
    | {
        readonly context: StalwartDraftContext;
        readonly status: "supported";
      }
  > {
    const session = await this.client.getSession();
    const accountId = session.primaryAccounts[JMAP_MAIL];
    if (!accountId || !session.capabilities[JMAP_MAIL]) {
      return { status: "unavailable" };
    }
    if (session.accounts[accountId]?.isReadOnly !== false) {
      return { status: "read-only" };
    }
    const [mailboxes, account] = await Promise.all([
      this.mail.listMailboxes(),
      this.mail.getAccount(),
    ]);
    const draftsMailboxId = mailboxes.find(
      (mailbox) => mailbox.role === "drafts",
    )?.id;
    return draftsMailboxId
      ? {
          context: { accountEmail: account.email, accountId, draftsMailboxId },
          status: "supported",
        }
      : { status: "unavailable" };
  }
}
