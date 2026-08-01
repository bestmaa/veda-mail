import { id } from "@/domain/shared/brand";
import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { connectionExpiresAt } from "@/server/connections/connection-lifetime";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import {
  assertMailSessionScope,
  MAIL_SESSION_SCOPE_HEADER,
  mailSessionScope,
} from "@/server/connections/mail-session-scope";
import { getMailService } from "@/server/mail/mail-service";
import {
  decodeMessageListCursor,
  encodeMessageListCursor,
  messageListCursorSecret,
} from "@/server/mail/message-list-cursor";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import { labelDeletionCatalogStore } from "@/server/labels/label-deletion-catalog.store";
import {
  decorateMailboxesSafely,
  mailboxOwner,
} from "@/server/mailboxes/mailbox-http";
import { mailboxEmptyOperationStore } from "@/server/mailboxes/mailbox-empty-operation.store";
import { messageListPreferencesStore } from "@/server/preferences/message-list-preferences.store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { ApiError } from "@/transport/http/api-error";
import { parseWorkspaceQuery } from "@/transport/http/workspace-query";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(request, "mail-read", 20_000, 1_000, 60 * 1000);
    const connection = await getCurrentConnection();
    if (request.headers.has(MAIL_SESSION_SCOPE_HEADER)) {
      assertMailSessionScope(request, connection);
    }
    assertSubjectRateLimit("mail-read", connection.id, 300, 60 * 1000);
    const query = parseWorkspaceQuery(request);
    const service = await getMailService(connection);
    const owner = await mailboxOwner(service);
    const preferences = await messageListPreferencesStore.get(owner).catch(
      () => ({ ...DEFAULT_MESSAGE_LIST_PREFERENCES }),
    );
    if (
      (query.sort && query.sort !== preferences.sort) ||
      (query.showPreview !== undefined &&
        query.showPreview !== preferences.showPreview)
    ) {
      throw new ApiError(
        "Message list preferences changed. Refresh the mailbox and try again.",
        "MESSAGE_LIST_PREFERENCES_CHANGED",
        409,
      );
    }
    if (query.cursor && !query.mailboxId) {
      throw new ApiError(
        "The mailbox cursor is missing its mailbox.",
        "INVALID_MAILBOX_QUERY",
        400,
      );
    }
    const cursorSecret = await messageListCursorSecret(connection.id);
    const cursorContext = query.mailboxId ? {
      includePreview: preferences.showPreview,
      mailboxId: id.mailbox(query.mailboxId),
      ...(query.search ? { search: query.search } : {}),
      sort: preferences.sort,
    } : null;
    const providerCursor = query.cursor && cursorContext
      ? decodeMessageListCursor(query.cursor, cursorContext, cursorSecret)
      : undefined;
    const workspace = await service.getWorkspace({
      ...(providerCursor ? { cursor: providerCursor } : {}),
      includePreview: preferences.showPreview,
      limit: 50,
      ...(query.mailboxId ? { mailboxId: id.mailbox(query.mailboxId) } : {}),
      ...(query.search ? { search: query.search } : {}),
      sort: preferences.sort,
    });
    const selectedMailbox = query.mailboxId
      ? id.mailbox(query.mailboxId)
      : (workspace.mailboxes.find(({ role }) => role === "inbox") ??
        workspace.mailboxes[0])?.id;
    if (!selectedMailbox) {
      throw new ApiError("Mailbox not found.", "MAILBOX_NOT_FOUND", 404);
    }
    const nextCursor = workspace.messages.nextCursor
      ? encodeMessageListCursor(workspace.messages.nextCursor, {
          includePreview: preferences.showPreview,
          mailboxId: selectedMailbox,
          ...(query.search ? { search: query.search } : {}),
          sort: preferences.sort,
        }, cursorSecret)
      : null;
    const [mailboxes, labels, labelDeletions, mailboxEmptyOperations] = await Promise.all([
      decorateMailboxesSafely(
        owner,
        workspace.mailboxes,
      ),
      labelCatalogStore.list(owner).catch(() => []),
      labelDeletionCatalogStore.list(owner).catch(() => []),
      mailboxEmptyOperationStore.list(owner).catch(() => []),
    ]);
    if (!connectionStore.isActive(connection)) {
      throw new ApiError(
        "This mail connection expired. Connect the account again.",
        "MEMBER_SESSION_EXPIRED",
        401,
      );
    }
    return apiSuccess({
      ...workspace,
      labelDeletions,
      labels,
      mailboxEmptyOperations,
      mailboxes,
      messageListPreferences: preferences,
      messages: { ...workspace.messages, nextCursor },
      sessionExpiresAt: connectionExpiresAt(connection),
      sessionScope: mailSessionScope(connection),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox.");
  }
};
