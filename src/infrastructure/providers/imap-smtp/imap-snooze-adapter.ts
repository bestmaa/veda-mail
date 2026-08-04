import "server-only";
import { randomBytes } from "node:crypto";
import type { FetchQueryObject, ImapFlow } from "imapflow";
import type {
  SnoozeCapability,
  SnoozeOwnedMailbox,
  SnoozePreflightInput,
  SnoozePreflightResult,
  SnoozeProviderInspection,
  SnoozeProviderOperationResult,
} from "@/domain/mail/snooze";
import {
  decodeMailboxId,
  decodeScopedImapMessageId,
  imapMessageAccountScope,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import {
  ensureImapSnoozedMailbox,
  IMAP_SNOOZED_MAILBOX_PREFIX,
  resolveImapRestoreMailbox,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-mailbox";
import {
  addAndVerifyMarker,
  assertImapSnoozeSupport,
  hasMarker,
  imapSnoozeMarker,
  markerUids,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-marker";
import {
  assertImapSnoozeScope,
  classifyImapSnoozeState,
  imapSnoozeOwnedMailbox,
  imapSnoozeSourceExists,
  type ImapSnoozePlan as ImapPlan,
  resolveImapSnoozedPath,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { restoreImapSnooze } from "@/infrastructure/providers/imap-smtp/imap-snooze-restore";

const MAX_MESSAGES = 100 as const;
const identityQuery = {
  emailId: true, envelope: true, flags: true, uid: true,
} as FetchQueryObject;
const addresses = (values?: readonly { readonly address?: string }[]) =>
  (values ?? []).flatMap(({ address }) => address ? [address] : []);
const unsupported = (reason: string): SnoozeCapability => ({
  maxMessages: 0, reason, snoozedMailboxId: null, supported: false,
});

export class ImapSnoozeAdapter {
  private readonly accountScope: string;
  public constructor(private readonly config: ImapSmtpMemberConfig) {
    this.accountScope = imapMessageAccountScope(config); }
  public mailboxIntent(): Promise<SnoozeOwnedMailbox> {
    return Promise.resolve({
      accountScope: this.accountScope,
      id: null,
      kind: "imap",
      name: `${IMAP_SNOOZED_MAILBOX_PREFIX}${randomBytes(8).toString("hex")}`,
      objectId: null,
    });
  }
  public getAccountScope(): Promise<string> { return Promise.resolve(this.accountScope); }

  public async getCapability(): Promise<SnoozeCapability> {
    try {
      return await withImapClient(this.config, async (client) => {
        const mailboxes = await client.list();
        const inbox = mailboxes.find(({ path }) => path.toUpperCase() === "INBOX");
        if (!inbox) return unsupported("Inbox is unavailable for snooze recovery.");
        assertImapSnoozeSupport(client, await client.mailboxOpen(inbox.path));
        return {
          maxMessages: MAX_MESSAGES,
          snoozedMailboxId: null,
          supported: true,
        };
      });
    } catch {
      return unsupported("This IMAP account lacks safe MOVE/UID recovery support.");
    }
  }

  public preflight(input: SnoozePreflightInput): Promise<SnoozePreflightResult> {
    const ownedMailbox = input.ownedMailbox;
    if (ownedMailbox.kind !== "imap" ||
      ownedMailbox.accountScope !== this.accountScope ||
      !ownedMailbox.name.startsWith(IMAP_SNOOZED_MAILBOX_PREFIX)) {
      throw new Error("The Snoozed mailbox belongs to another account.");
    }
    const reference = decodeScopedImapMessageId(this.config, input.messageId);
    if (decodeMailboxId(input.sourceMailboxId) !== reference.mailbox) {
      throw new Error("The message is outside its source mailbox.");
    }
    return withImapClient(this.config, async (client) => {
      const opened = await client.mailboxOpen(reference.mailbox);
      assertImapSnoozeSupport(client, opened);
      if (!imapUidValidityMatches(reference, opened.uidValidity)) {
        throw new Error("The source message identity is stale.");
      }
      const message = await client.fetchOne(reference.uid, identityQuery, { uid: true });
      if (!message || message.uid !== reference.uid) throw new Error("Message not found.");
      return {
        from: addresses(message.envelope?.from),
        plan: {
          accountScope: this.accountScope,
          destinationMailbox: reference.mailbox,
          emailObjectId: message.emailId ?? null,
          kind: "imap",
          marker: imapSnoozeMarker(input.operationId, this.accountScope),
          snoozedMailbox: ownedMailbox.name,
          snoozedMailboxObjectId: ownedMailbox.objectId,
          snoozedUid: null,
          snoozedUidValidity: null,
          sourceMailbox: reference.mailbox,
          sourceMailboxObjectId: opened.mailboxId ?? null,
          sourceUid: reference.uid,
          sourceUidValidity: reference.uidValidity,
        },
        subject: message.envelope?.subject?.slice(0, 998) || "(No subject)",
      };
    });
  }

  public inspect(plan: ImapPlan): Promise<SnoozeProviderInspection> {
    assertImapSnoozeScope(plan, this.accountScope);
    return withImapClient(this.config, async (client) => {
      const mailboxes = await client.list();
      const snoozedPath = await resolveImapSnoozedPath(client, plan, mailboxes);
      if (snoozedPath) {
        const opened = await client.mailboxOpen(snoozedPath);
        const located = await markerUids(client, plan.marker);
        const updated: ImapPlan = {
          ...plan,
          snoozedMailbox: snoozedPath,
          snoozedMailboxObjectId: opened.mailboxId ?? plan.snoozedMailboxObjectId,
          snoozedUid: located.length === 1 ? located[0]! : plan.snoozedUid,
          snoozedUidValidity: located.length === 1
            ? opened.uidValidity.toString() : plan.snoozedUidValidity,
        };
        const sourceExists = await imapSnoozeSourceExists(client, plan);
        const state = classifyImapSnoozeState(sourceExists, located.length === 1);
        if (state === "snoozed") return {
          ownedMailbox: imapSnoozeOwnedMailbox(updated),
          plan: updated,
          state: "snoozed",
        };
      }
      const source = await imapSnoozeSourceExists(client, plan);
      const destination = await resolveImapRestoreMailbox(
        client, mailboxes, plan.destinationMailbox, plan.sourceMailboxObjectId,
      );
      const restored = await this.markerIn(client, destination.path, plan.marker);
      return {
        ownedMailbox: imapSnoozeOwnedMailbox(plan),
        plan,
        state: restored ? "visible" : classifyImapSnoozeState(source, false),
      };
    });
  }

  public hide(plan: ImapPlan): Promise<SnoozeProviderOperationResult> {
    assertImapSnoozeScope(plan, this.accountScope);
    return withImapClient(this.config, async (client) => {
      const snoozedPath = await ensureImapSnoozedMailbox(client, plan.snoozedMailbox);
      const target = await client.mailboxOpen(snoozedPath);
      if (plan.snoozedMailboxObjectId && client.capabilities.has("OBJECTID") &&
        target.mailboxId !== plan.snoozedMailboxObjectId) {
        throw new Error("The owned Snoozed mailbox identity changed.");
      }
      assertImapSnoozeSupport(client, target);
      const recovered = await this.markerIn(client, snoozedPath, plan.marker);
      if (recovered && await imapSnoozeSourceExists(client, plan)) {
        throw new Error("The snoozed message exists in both source and target.");
      }
      const located = recovered ?? await this.moveToSnoozed(client, plan, snoozedPath);
      const updated: ImapPlan = {
        ...plan,
        snoozedMailbox: snoozedPath,
        snoozedMailboxObjectId: target.mailboxId ?? null,
        snoozedUid: located.uid,
        snoozedUidValidity: located.uidValidity,
      };
      return { ownedMailbox: imapSnoozeOwnedMailbox(updated), plan: updated };
    });
  }

  public restore(plan: ImapPlan): Promise<SnoozeProviderOperationResult> {
    assertImapSnoozeScope(plan, this.accountScope);
    return restoreImapSnooze(this.config, plan);
  }

  private async moveToSnoozed(
    client: ImapFlow, plan: ImapPlan, snoozedPath: string,
  ): Promise<{ readonly uid: number; readonly uidValidity: string }> {
    const opened = await client.mailboxOpen(plan.sourceMailbox);
    assertImapSnoozeSupport(client, opened);
    if (opened.uidValidity.toString() !== plan.sourceUidValidity) {
      throw new Error("The source UIDVALIDITY changed.");
    }
    const message = await client.fetchOne(plan.sourceUid, identityQuery, { uid: true });
    if (!message || message.uid !== plan.sourceUid) {
      const recovered = await this.markerIn(client, snoozedPath, plan.marker);
      if (recovered) return recovered;
      throw new Error("The snooze move outcome is ambiguous.");
    }
    if (plan.emailObjectId && message.emailId !== plan.emailObjectId) {
      throw new Error("The source message object identity changed.");
    }
    if (!hasMarker(message.flags, plan.marker)) {
      await addAndVerifyMarker(client, plan.sourceUid, plan.marker);
    }
    let moved;
    try { moved = await client.messageMove(plan.sourceUid, snoozedPath, { uid: true }); }
    catch {
      const recovered = await this.markerIn(client, snoozedPath, plan.marker);
      if (recovered) return recovered;
      throw new Error("The snooze move outcome is ambiguous.");
    }
    if (!moved) throw new Error("The provider did not move the snoozed message.");
    const recovered = await this.markerIn(client, snoozedPath, plan.marker);
    if (!recovered) throw new Error("The provider lost the snooze recovery marker.");
    const mappedUid = moved.uidMap?.get(plan.sourceUid);
    if (mappedUid !== undefined && mappedUid !== recovered.uid) {
      throw new Error("The snooze COPYUID does not match the recovery marker.");
    }
    return recovered;
  }

  private async markerIn(client: ImapFlow, path: string, marker: string) {
    const opened = await client.mailboxOpen(path);
    const matches = await markerUids(client, marker);
    return matches.length === 1
      ? { uid: matches[0]!, uidValidity: opened.uidValidity.toString() } : null;
  }
}
