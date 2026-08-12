import { id } from "@/domain/shared/brand";
import {
  MailSearchMailboxError,
  MailSearchUnsupportedError,
} from "@/domain/mail/mail-search";
import {
  hasMailboxSearch,
  resolveMailSearchScope,
} from "@/application/services/mail-search-scope";
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
    await assertRequestRateLimit(request, "mail-read", 20_000, 1_000, 60 * 1000);
    const connection = await getCurrentConnection();
    if (request.headers.has(MAIL_SESSION_SCOPE_HEADER)) {
      assertMailSessionScope(request, connection);
    }
    await assertSubjectRateLimit("mail-read", connection.id, 300, 60 * 1000);
    const query = parseWorkspaceQuery(request);
    const service = await getMailService(connection);
    const mailboxSearch = hasMailboxSearch(query.search);
    const knownMailboxes = mailboxSearch ? await service.listMailboxes() : undefined;
    const resolvedSearch = mailboxSearch && query.search && knownMailboxes
      ? resolveMailSearchScope(knownMailboxes, query.search)
      : null;
    const effectiveMailboxId = resolvedSearch?.mailboxId ??
      (query.mailboxId ? id.mailbox(query.mailboxId) : undefined);
    const providerSearch = resolvedSearch?.providerSearch ??
      (mailboxSearch ? undefined : query.search);
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
    const cursorContext = effectiveMailboxId ? {
      includePreview: preferences.showPreview,
      mailboxId: effectiveMailboxId,
      ...(query.search ? { search: query.search.canonical } : {}),
      sort: preferences.sort,
    } : null;
    const providerCursor = query.cursor && cursorContext
      ? decodeMessageListCursor(query.cursor, cursorContext, cursorSecret)
      : undefined;
    const workspaceQuery = {
      ...(providerCursor ? { cursor: providerCursor } : {}),
      includePreview: preferences.showPreview,
      limit: 50,
      ...(effectiveMailboxId ? { mailboxId: effectiveMailboxId } : {}),
      ...(providerSearch ? { search: providerSearch } : {}),
      sort: preferences.sort,
    } as const;
    const workspace = knownMailboxes
      ? await service.getWorkspace(workspaceQuery, knownMailboxes)
      : await service.getWorkspace(workspaceQuery);
    const selectedMailbox = effectiveMailboxId
      ? effectiveMailboxId
      : (workspace.mailboxes.find(({ role }) => role === "inbox") ??
        workspace.mailboxes[0])?.id;
    if (!selectedMailbox) {
      throw new ApiError("Mailbox not found.", "MAILBOX_NOT_FOUND", 404);
    }
    const nextCursor = workspace.messages.nextCursor
      ? encodeMessageListCursor(workspace.messages.nextCursor, {
          includePreview: preferences.showPreview,
          mailboxId: selectedMailbox,
          ...(query.search ? { search: query.search.canonical } : {}),
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
    if (!(await connectionStore.isActiveAsync(connection))) {
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
      ...(mailboxSearch ? { selectedMailboxId: selectedMailbox } : {}),
      sessionExpiresAt: connectionExpiresAt(connection),
      sessionScope: mailSessionScope(connection),
    });
  } catch (error) {
    if (error instanceof MailSearchMailboxError) {
      return apiFailure(
        new ApiError(error.message, "INVALID_MAIL_SEARCH", 400),
        "Unable to search this mailbox.",
      );
    }
    if (error instanceof MailSearchUnsupportedError) {
      return apiFailure(
        new ApiError(error.message, "MAIL_SEARCH_UNSUPPORTED", 422),
        "Unable to search this mailbox.",
      );
    }
    return apiFailure(error, "Unable to load this mailbox.");
  }
};
