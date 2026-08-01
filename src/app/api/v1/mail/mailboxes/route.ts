import type {
  MailboxAppearanceOwner,
  MailboxColor,
} from "@/domain/mail/mailbox";
import { assertMailboxMutation } from "@/domain/mail/mailbox-policy";
import type { MailboxId } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import { mailboxAppearanceStore } from "@/server/mailboxes/mailbox-appearance.store";
import {
  decorateMailboxesSafely,
  mailboxHttpError,
  mailboxOwner,
} from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import {
  createMailboxSchema,
  deleteMailboxSchema,
  updateMailboxSchema,
} from "@/transport/http/mailbox-mutation.schema";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16 * 1_024;

const setAppearanceSafely = async (
  owner: MailboxAppearanceOwner,
  mailboxId: MailboxId,
  color: MailboxColor | undefined,
  previousMailboxId?: MailboxId,
): Promise<boolean> => {
  try {
    await mailboxAppearanceStore.set(owner, mailboxId, color, previousMailboxId);
    return true;
  } catch {
    return false;
  }
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mailbox-mutation", 5_000, 300, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mailbox-mutation", connection.id, 30, 15 * 60 * 1_000);
    const service = await getMailService(connection);
    const owner = await mailboxOwner(service);
    const payload = createMailboxSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    const result = await service.mutateMailbox({
      name: payload.name,
      parentId: payload.parentId,
      type: "create",
    });
    if (!result.mailboxId) throw new Error("Mailbox creation returned no identifier.");
    const appearanceSaved = await setAppearanceSafely(
      owner,
      result.mailboxId,
      payload.color,
    );
    return apiSuccess({
      appearanceSaved,
      mailboxId: result.mailboxId,
      mailboxes: await decorateMailboxesSafely(owner, result.mailboxes),
    }, { status: 201 });
  } catch (error) {
    return apiFailure(mailboxHttpError(error), "Unable to create this mailbox.");
  }
};

export const PATCH = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mailbox-mutation", 5_000, 300, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mailbox-mutation", connection.id, 30, 15 * 60 * 1_000);
    const service = await getMailService(connection);
    const owner = await mailboxOwner(service);
    const payload = updateMailboxSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    const providerChange = payload.name !== undefined || payload.parentId !== undefined;
    let result;
    if (providerChange) {
      result = await service.mutateMailbox({
        mailboxId: payload.mailboxId,
        ...(payload.name === undefined ? {} : { name: payload.name }),
        ...(payload.parentId === undefined ? {} : { parentId: payload.parentId }),
        type: "update",
      });
    } else {
      const mailboxes = await service.listMailboxes();
      assertMailboxMutation(mailboxes, {
        mailboxId: payload.mailboxId,
        type: "update",
      });
      result = { mailboxId: payload.mailboxId, mailboxes };
    }
    if (!result.mailboxId) throw new Error("Mailbox update returned no identifier.");
    const appearanceSaved = providerChange
      ? await setAppearanceSafely(
          owner,
          result.mailboxId,
          payload.color,
          payload.mailboxId,
        )
      : await mailboxAppearanceStore
          .set(owner, result.mailboxId, payload.color)
          .then(() => true);
    return apiSuccess({
      appearanceSaved,
      mailboxId: result.mailboxId,
      mailboxes: await decorateMailboxesSafely(owner, result.mailboxes),
    });
  } catch (error) {
    return apiFailure(mailboxHttpError(error), "Unable to update this mailbox.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mailbox-mutation", 5_000, 300, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mailbox-mutation", connection.id, 30, 15 * 60 * 1_000);
    const service = await getMailService(connection);
    const owner = await mailboxOwner(service);
    const payload = deleteMailboxSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    const result = await service.mutateMailbox({
      mailboxId: payload.mailboxId,
      type: "delete",
    });
    let appearanceSaved = true;
    try {
      await mailboxAppearanceStore.remove(owner, payload.mailboxId);
    } catch {
      appearanceSaved = false;
    }
    return apiSuccess({
      appearanceSaved,
      mailboxId: null,
      mailboxes: await decorateMailboxesSafely(owner, result.mailboxes),
    });
  } catch (error) {
    return apiFailure(mailboxHttpError(error), "Unable to delete this mailbox.");
  }
};
