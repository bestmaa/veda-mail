import "server-only";

import {
  MailUserAdministrationError,
  type AdminMailUserLifecycleResult,
} from "@/domain/admin/mail-user";
import {
  mapMailUserAdministrationError,
  requireAdminMailUserAdministrator,
} from "@/server/mail-users/mail-user-administration";
import { protectMailUserLifecycle } from "@/server/mail-users/mail-user-lifecycle-protection";
import { ApiError } from "@/transport/http/api-error";

export const preflightAdminMailUserLifecycle = async (
  input: {
    readonly domain: string;
    readonly email: string;
    readonly operation: "disable" | "delete";
    readonly userId: string;
  },
  expectedProfileRevision: string,
) => {
  try {
    const administrator = await requireAdminMailUserAdministrator(
      input.domain,
      expectedProfileRevision,
    );
    const user = protectMailUserLifecycle(await administrator.getUser(input));
    if (user.email !== input.email) {
      throw new ApiError(
        "Type the complete mailbox email address exactly to confirm.",
        "MAIL_USER_CONFIRMATION_MISMATCH",
        400,
      );
    }
    if (user.lifecycle?.protected) {
      throw new ApiError(
        "This operational or automation mailbox is protected.",
        "MAIL_USER_PROTECTED",
        409,
      );
    }
    return user;
  } catch (error) {
    return mapMailUserAdministrationError(error);
  }
};

export const mutateAdminMailUser = async (
  input: {
    readonly domain: string;
    readonly email: string;
    readonly operation: "disable" | "delete";
    readonly userId: string;
  },
  expectedProfileRevision: string,
): Promise<AdminMailUserLifecycleResult> => {
  try {
    const administrator = await requireAdminMailUserAdministrator(
      input.domain,
      expectedProfileRevision,
    );
    const user = protectMailUserLifecycle(await administrator.getUser(input));
    if (user.email !== input.email) {
      throw new ApiError(
        "Type the complete mailbox email address exactly to confirm.",
        "MAIL_USER_CONFIRMATION_MISMATCH",
        400,
      );
    }
    if (user.lifecycle?.protected) {
      throw new MailUserAdministrationError(
        "protected-account",
        "This mailbox is protected from lifecycle actions.",
      );
    }
    return await administrator.mutateUser({
      ...input,
      expectedEmail: input.email,
    });
  } catch (error) {
    return mapMailUserAdministrationError(error);
  }
};
