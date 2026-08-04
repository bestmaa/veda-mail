import "server-only";

import { randomBytes } from "node:crypto";

import type {
  SnoozeCapability,
  SnoozeOwnedMailbox,
  SnoozePreflightInput,
  SnoozeProviderInspection,
  SnoozeProviderOperationResult,
} from "@/domain/mail/snooze";
import { id, type MessageId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  ensureStalwartSnoozedMailbox,
  findStalwartSnoozedMailbox,
  readStalwartSnoozeMailboxes,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-mailbox";
import {
  STALWART_SNOOZED_MAILBOX_PREFIX,
  classifyStalwartSnoozeState,
  stalwartSnoozeEmailResultSchema,
  type StalwartSnoozePlan,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const MAX_MESSAGES = 100 as const;
const patchSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

export interface StalwartSnoozePreflight {
  readonly from: readonly string[];
  readonly plan: StalwartSnoozePlan;
  readonly subject: string;
}

const unsupported = (reason: string): SnoozeCapability => ({
  maxMessages: 0,
  reason,
  snoozedMailboxId: null,
  supported: false,
});

export class StalwartSnoozeAdapter {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly reader: StalwartMailReader,
  ) {}

  public async getCapability(): Promise<SnoozeCapability> {
    try {
      const accountId = await this.reader.getAccountId();
      const snapshot = await readStalwartSnoozeMailboxes(this.client, accountId);
      const inbox = snapshot.list.find(({ role }) => role === "inbox");
      if (!inbox || inbox.myRights?.mayAddItems !== true) {
        return unsupported("The primary Inbox cannot restore snoozed messages.");
      }
      return {
        maxMessages: MAX_MESSAGES,
        snoozedMailboxId: null,
        supported: true,
      };
    } catch {
      return unsupported("Snooze mailbox discovery failed.");
    }
  }

  public async mailboxIntent(): Promise<SnoozeOwnedMailbox> {
    return {
      id: null,
      kind: "jmap",
      name: `${STALWART_SNOOZED_MAILBOX_PREFIX}${randomBytes(8).toString("hex")}`,
    };
  }

  public async preflight(input: SnoozePreflightInput): Promise<StalwartSnoozePreflight> {
    if (input.ownedMailbox.kind !== "jmap" ||
      !input.ownedMailbox.name.startsWith(STALWART_SNOOZED_MAILBOX_PREFIX)) {
      throw new Error("The Snoozed mailbox belongs to another provider.");
    }
    const accountId = await this.reader.getAccountId();
    const [email, mailboxes] = await Promise.all([
      this.readEmail(accountId, input.messageId),
      readStalwartSnoozeMailboxes(this.client, accountId),
    ]);
    if (!email || email.mailboxIds[input.sourceMailboxId] !== true) {
      throw new Error("The message is no longer in its source mailbox.");
    }
    const originalMailboxIds = Object.entries(email.mailboxIds)
      .filter(([, present]) => present).map(([mailboxId]) => mailboxId);
    if (originalMailboxIds.length < 1 || originalMailboxIds.length > 32) {
      throw new Error("The message has an unsupported mailbox membership set.");
    }
    const source = mailboxes.list.find(({ id: mailboxId }) =>
      mailboxId === input.sourceMailboxId);
    const inbox = mailboxes.list.find(({ role }) => role === "inbox");
    const snoozed = findStalwartSnoozedMailbox(
      mailboxes, input.ownedMailbox.id, input.ownedMailbox.name,
    );
    if (!source || source.myRights?.mayRemoveItems !== true || !inbox ||
      inbox.myRights?.mayAddItems !== true) {
      throw new Error("The provider does not allow this message to be snoozed.");
    }
    return {
      from: (email.from ?? []).map(({ email: address }) => address),
      plan: {
        emailId: email.id,
        expectedState: email.state,
        inboxMailboxId: inbox.id,
        kind: "jmap",
        originalMailboxIds,
        snoozedMailboxId: input.ownedMailbox.id ?? snoozed?.id ?? null,
        snoozedMailboxName: input.ownedMailbox.name,
        sourceMailboxId: input.sourceMailboxId,
      },
      subject: email.subject ?? "(No subject)",
    };
  }

  public async inspect(plan: StalwartSnoozePlan): Promise<SnoozeProviderInspection> {
    const accountId = await this.reader.getAccountId();
    const mailboxes = await readStalwartSnoozeMailboxes(this.client, accountId);
    const resolved = findStalwartSnoozedMailbox(
      mailboxes, plan.snoozedMailboxId, plan.snoozedMailboxName,
    );
    const resolvedPlan = { ...plan, snoozedMailboxId: resolved?.id ?? plan.snoozedMailboxId };
    const email = await this.readEmail(accountId, id.message(plan.emailId));
    const inSource = email?.mailboxIds[plan.sourceMailboxId] === true;
    const inSnoozed = resolved ? email?.mailboxIds[resolved.id] === true : false;
    return {
      ownedMailbox: this.owned(resolvedPlan),
      plan: email ? { ...resolvedPlan, expectedState: email.state } : resolvedPlan,
      state: email ? classifyStalwartSnoozeState(inSource, inSnoozed) : "deleted",
    };
  }

  public async hide(plan: StalwartSnoozePlan): Promise<SnoozeProviderOperationResult> {
    const accountId = await this.reader.getAccountId();
    const snoozedMailboxId = await ensureStalwartSnoozedMailbox(
      this.client, accountId, plan.snoozedMailboxId, plan.snoozedMailboxName,
    );
    const updated = await this.update(plan, accountId, snoozedMailboxId, "hide", 0);
    return { ownedMailbox: this.owned(updated), plan: updated };
  }

  public async restore(plan: StalwartSnoozePlan): Promise<SnoozeProviderOperationResult> {
    if (!plan.snoozedMailboxId) return { ownedMailbox: this.owned(plan), plan };
    const updated = await this.update(
      plan, await this.reader.getAccountId(), plan.snoozedMailboxId, "restore", 0,
    );
    return { ownedMailbox: this.owned(updated), plan: updated };
  }

  private async update(
    plan: StalwartSnoozePlan,
    accountId: string,
    snoozedMailboxId: string,
    operation: "hide" | "restore",
    attempt: number,
  ): Promise<StalwartSnoozePlan> {
    const [email, mailboxSnapshot] = await Promise.all([
      this.readEmail(accountId, id.message(plan.emailId)),
      readStalwartSnoozeMailboxes(this.client, accountId),
    ]);
    if (!email) throw new Error("The snoozed message was deleted.");
    const hasSnoozed = email.mailboxIds[snoozedMailboxId] === true;
    const hasSource = email.mailboxIds[plan.sourceMailboxId] === true;
    if (operation === "hide" && hasSnoozed && !hasSource) {
      return { ...plan, expectedState: email.state, snoozedMailboxId };
    }
    if (operation === "hide" && !hasSource) {
      throw new Error("The message was moved before snooze completed.");
    }
    if (operation === "restore" && !hasSnoozed) {
      return { ...plan, expectedState: email.state };
    }
    const original = mailboxSnapshot.list.find(({ id: mailboxId, myRights }) =>
      mailboxId === plan.sourceMailboxId && myRights?.mayAddItems === true);
    const inbox = mailboxSnapshot.list.find(({ role, myRights }) =>
      role === "inbox" && myRights?.mayAddItems === true);
    const target = operation === "restore"
      ? original?.id ?? inbox?.id : snoozedMailboxId;
    if (!target) throw new Error("No writable mailbox is available for restore.");
    const patch = operation === "hide"
      ? {
          [`mailboxIds/${patchSegment(plan.sourceMailboxId)}`]: null,
          [`mailboxIds/${patchSegment(snoozedMailboxId)}`]: true,
        }
      : {
          [`mailboxIds/${patchSegment(snoozedMailboxId)}`]: null,
          [`mailboxIds/${patchSegment(target)}`]: true,
        };
    try {
      const response = await this.client.request([["Email/set", {
        accountId, ifInState: email.state,
        update: { [plan.emailId]: patch },
      }, "snooze-email"]], [JMAP_MAIL]);
      const result = this.client.result(
        response, "snooze-email", "Email/set", jmapSetResultSchema,
      );
      if (result.accountId && result.accountId !== accountId ||
        !Object.hasOwn(result.updated ?? {}, plan.emailId)) {
        throw new Error("The provider did not confirm the snooze update.");
      }
      const updated = {
        ...plan,
        expectedState: result.newState ?? email.state,
        snoozedMailboxId,
      };
      return updated;
    } catch (error) {
      if (attempt === 0 && error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch") {
        return this.update(plan, accountId, snoozedMailboxId, operation, 1);
      }
      throw error;
    }
  }

  private owned(plan: StalwartSnoozePlan): SnoozeOwnedMailbox {
    return {
      id: plan.snoozedMailboxId,
      kind: "jmap",
      name: plan.snoozedMailboxName,
    };
  }

  private async readEmail(accountId: string, messageId: MessageId) {
    const response = await this.client.request([["Email/get", {
      accountId, ids: [messageId],
      properties: ["id", "from", "subject", "keywords", "mailboxIds"],
    }, "snooze-email-get"]], [JMAP_MAIL]);
    const result = this.client.result(
      response, "snooze-email-get", "Email/get", stalwartSnoozeEmailResultSchema,
    );
    if (result.accountId !== accountId) throw new Error("Snooze account mismatch.");
    const email = result.list[0];
    if (!email && !result.notFound.includes(messageId)) {
      throw new Error("The provider returned invalid snooze message data.");
    }
    return email ? { ...email, state: result.state } : null;
  }
}
