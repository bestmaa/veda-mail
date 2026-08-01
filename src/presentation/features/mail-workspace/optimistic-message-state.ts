import type {
  BulkMessageMutation,
  MailWorkspace,
  MessageDetail,
} from "@/domain/mail/mail";
import type { MessageListPreferences } from "@/domain/mail/message-list-preferences";
import type { MailboxId, MessageId } from "@/domain/shared/brand";
import {
  isOptimisticMessageMutation,
  projectOptimisticMessage,
  projectOptimisticWorkspace,
  restrictMessageMutation,
} from "@/presentation/features/mail-workspace/optimistic-message-mutation";

export interface OptimisticMutationToken { readonly id: number }
export interface BeginOptimisticMutationInput {
  readonly activeMailboxId: MailboxId | null;
  readonly mutation: BulkMessageMutation;
  readonly sessionScope: string;
  readonly viewKey: string;
}
interface ScopedMessage {
  readonly message: MessageDetail;
  readonly sessionScope: string;
}
interface OptimisticOperation extends BeginOptimisticMutationInput {
  readonly id: number;
  phase: "pending" | "reconcile";
}
export interface OptimisticMessageStateSnapshot {
  readonly isMessageMutationBusy: boolean;
  readonly pendingMessageIds: ReadonlySet<MessageId>;
  readonly selectedMessage: MessageDetail | null;
  readonly workspace: MailWorkspace | null;
}

export class OptimisticMessageState {
  private workspace: MailWorkspace | null = null;
  private selection: ScopedMessage | null = null;
  private viewKey = "";
  private scope = "";
  private operations: OptimisticOperation[] = [];
  private activeOperationId: number | null = null;
  private nextOperationId = 0;

  public snapshot(): OptimisticMessageStateSnapshot {
    let workspace = this.workspace;
    let selection = this.selection;
    const pendingMessageIds = new Set<MessageId>();
    for (const operation of this.operations) {
      if (!isOptimisticMessageMutation(operation.mutation)) continue;
      if (
        workspace?.sessionScope === operation.sessionScope &&
        this.viewKey === operation.viewKey
      ) {
        workspace = projectOptimisticWorkspace(workspace, {
          activeMailboxId: operation.activeMailboxId,
          mutation: operation.mutation,
        });
        operation.mutation.messageIds.forEach((messageId) =>
          pendingMessageIds.add(messageId));
      }
      if (selection?.sessionScope === operation.sessionScope) {
        const message = projectOptimisticMessage(selection.message, operation.mutation);
        selection = message ? { message, sessionScope: operation.sessionScope } : null;
      }
    }
    const selectedMessage = selection && selection.sessionScope === workspace?.sessionScope
      ? selection.message
      : null;
    return {
      isMessageMutationBusy: this.activeOperationId !== null,
      pendingMessageIds,
      selectedMessage,
      workspace,
    };
  }

  public acceptWorkspace(next: MailWorkspace, nextViewKey: string): boolean {
    const scopeChanged = Boolean(this.scope) && this.scope !== next.sessionScope;
    this.scope = next.sessionScope;
    this.workspace = next;
    this.viewKey = nextViewKey;
    if (scopeChanged) {
      this.selection = null;
      this.operations = [];
      this.activeOperationId = null;
    } else {
      this.operations = this.operations.filter(
        (operation) =>
          operation.phase !== "reconcile" &&
          operation.sessionScope === next.sessionScope,
      );
    }
    return scopeChanged;
  }

  public appendWorkspace(next: MailWorkspace, expectedScope: string): boolean {
    if (!expectedScope || this.scope !== expectedScope || next.sessionScope !== expectedScope) {
      return false;
    }
    if (!this.workspace || this.workspace.sessionScope !== expectedScope) return false;
    const existingIds = new Set(this.workspace.messages.items.map(({ id }) => id));
    this.workspace = {
      ...next,
      messages: {
        ...next.messages,
        items: [
          ...this.workspace.messages.items,
          ...next.messages.items.filter(({ id }) => !existingIds.has(id)),
        ],
      },
    };
    return true;
  }

  public begin(input: BeginOptimisticMutationInput): OptimisticMutationToken | null {
    if (this.activeOperationId !== null || !input.sessionScope || this.scope !== input.sessionScope) {
      return null;
    }
    const operation = { ...input, id: ++this.nextOperationId, phase: "pending" as const };
    const superseded = new Set(input.mutation.messageIds);
    this.operations = this.operations.flatMap((current) => {
      if (current.phase !== "reconcile") return [current];
      const retained = current.mutation.messageIds.filter(
        (messageId) => !superseded.has(messageId),
      );
      return retained.length
        ? [{ ...current, mutation: restrictMessageMutation(current.mutation, retained) }]
        : [];
    });
    if (this.operations.length === 0) this.viewKey = input.viewKey;
    this.operations = [...this.operations, operation];
    this.activeOperationId = operation.id;
    return { id: operation.id };
  }

  public settle(
    token: OptimisticMutationToken,
    succeeded: readonly MessageId[],
    unconfirmed: readonly MessageId[] = [],
  ): boolean {
    const operation = this.operations.find(({ id }) => id === token.id);
    if (!operation) return false;
    const confirmed = restrictMessageMutation(operation.mutation, succeeded);
    if (
      succeeded.length && this.workspace?.sessionScope === operation.sessionScope &&
      this.viewKey === operation.viewKey
    ) {
      this.workspace = projectOptimisticWorkspace(this.workspace, {
        activeMailboxId: operation.activeMailboxId, mutation: confirmed,
      });
    }
    if (succeeded.length && this.selection?.sessionScope === operation.sessionScope) {
      const message = projectOptimisticMessage(this.selection.message, confirmed);
      this.selection = message ? { message, sessionScope: operation.sessionScope } : null;
    }
    this.operations = this.operations.filter(({ id }) => id !== token.id);
    if (unconfirmed.length) {
      this.operations.push({
        ...operation,
        mutation: restrictMessageMutation(operation.mutation, unconfirmed),
        phase: "reconcile",
      });
    }
    if (this.activeOperationId === token.id) this.activeOperationId = null;
    return true;
  }

  public markUnconfirmed(token: OptimisticMutationToken): boolean {
    const operation = this.operations.find(({ id }) => id === token.id);
    if (!operation) return false;
    operation.phase = "reconcile";
    if (this.activeOperationId === token.id) this.activeOperationId = null;
    return true;
  }

  public clear(): void {
    this.workspace = null; this.selection = null; this.viewKey = ""; this.scope = "";
    this.operations = []; this.activeOperationId = null;
  }
  public clearMessage(): void { this.selection = null; }
  public commitMessage(message: MessageDetail, expectedScope: string): boolean {
    if (!expectedScope || this.scope !== expectedScope) return false;
    this.selection = { message, sessionScope: expectedScope };
    return true;
  }
  public commitPreferences(
    preferences: MessageListPreferences,
    expectedScope: string,
  ): boolean {
    if (!expectedScope || this.scope !== expectedScope || !this.workspace) return false;
    this.workspace = { ...this.workspace, messageListPreferences: preferences };
    return true;
  }
  public currentMessageId(): MessageId | null { return this.selection?.message.id ?? null; }
  public currentScope(): string { return this.scope; }
  public isCurrentScope(expectedScope: string): boolean {
    return Boolean(expectedScope) && this.scope === expectedScope;
  }
}
