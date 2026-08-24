import "server-only";

import type { AdminMailUserLifecycleInput } from "@/application/ports/mail-user-administration.port";
import {
  MailUserAdministrationError,
  type AdminMailUserLifecycleResult,
} from "@/domain/admin/mail-user";
import {
  StalwartManagementRequestError,
  type StalwartManagementClient,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import { stalwartSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import type { StalwartMailUserDirectory } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-directory";

const rejected = (type: string): never => {
  if (type === "forbidden") {
    throw new MailUserAdministrationError(
      "provider-auth",
      "Stalwart denied the mailbox lifecycle operation.",
    );
  }
  throw new MailUserAdministrationError(
    "provider-response",
    "Stalwart rejected the mailbox lifecycle operation.",
  );
};

export class StalwartMailUserLifecycle {
  public constructor(
    private readonly client: StalwartManagementClient,
    private readonly directory: StalwartMailUserDirectory,
  ) {}

  public async mutate(
    input: AdminMailUserLifecycleInput,
  ): Promise<AdminMailUserLifecycleResult> {
    const user = await this.directory.get(input);
    if (user.email !== input.expectedEmail) {
      throw new MailUserAdministrationError(
        "invalid-input",
        "The mailbox email confirmation does not match the provider account.",
      );
    }
    try {
      const response = await this.client.request([
        [
          "x:Account/set",
          input.operation === "delete"
            ? { destroy: [user.id] }
            : { update: { [user.id]: { credentials: {} } } },
          "mailbox-lifecycle",
        ],
      ], true);
      const result = this.client.result(
        response,
        "mailbox-lifecycle",
        "x:Account/set",
        stalwartSetResultSchema,
        true,
      );
      const failure = input.operation === "delete"
        ? result.notDestroyed?.[user.id]
        : result.notUpdated?.[user.id];
      if (failure) rejected(failure.type);
      const applied = input.operation === "delete"
        ? result.destroyed?.includes(user.id)
        : Object.hasOwn(result.updated ?? {}, user.id);
      if (!applied) {
        throw new StalwartManagementRequestError("invalid-response", true);
      }
      return {
        email: user.email,
        forwardingRemoved: false,
        outcome: input.operation === "delete" ? "deleted" : "disabled",
        sessionsRevoked: 0,
        userId: user.id,
      };
    } catch (error) {
      if (
        error instanceof StalwartManagementRequestError &&
        error.ambiguousMutation
      ) {
        if (input.operation === "delete") {
          try {
            await this.directory.get(input);
          } catch (lookupError) {
            if (
              lookupError instanceof MailUserAdministrationError &&
              lookupError.code === "not-found"
            ) {
              return {
                email: user.email,
                forwardingRemoved: false,
                outcome: "deleted",
                sessionsRevoked: 0,
                userId: user.id,
              };
            }
          }
        }
        throw new MailUserAdministrationError(
          "lifecycle-outcome-unknown",
          "The mailbox lifecycle outcome could not be confirmed.",
        );
      }
      throw error;
    }
  }
}
