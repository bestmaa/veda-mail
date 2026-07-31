import "server-only";

import type { AdminMailUserCreateInput } from "@/application/ports/mail-user-administration.port";
import {
  MailUserAdministrationError,
  type AdminMailUserCreateResult,
  type AdminMailUserDetail,
} from "@/domain/admin/mail-user";
import {
  StalwartManagementRequestError,
  type StalwartManagementClient,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import { stalwartSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import {
  normalizeMailUserCreateInput,
  provisionalMailUser,
  type NormalizedMailUserCreateInput,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-create-input";
import type { StalwartMailUserDirectory } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-directory";
import {
  duplicateMailUserError,
  providerResponseError,
  unknownCreateOutcomeError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-errors";
import type { ResolvedStalwartDomain } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-mapper";

export class StalwartMailUserProvisioner {
  public constructor(
    private readonly client: StalwartManagementClient,
    private readonly directory: StalwartMailUserDirectory,
  ) {}

  public async create(
    rawInput: AdminMailUserCreateInput,
  ): Promise<AdminMailUserCreateResult> {
    const input = normalizeMailUserCreateInput(rawInput);
    const domain = await this.directory.resolveDomain(input.domain);
    await this.assertCreationAvailable(domain);
    if (await this.findExact(domain, input)) throw duplicateMailUserError();

    let createdId: string;
    try {
      createdId = await this.createAccount(domain, input);
    } catch (error) {
      if (
        error instanceof StalwartManagementRequestError &&
        error.ambiguousMutation
      ) {
        return this.reconcileAmbiguousCreation(domain, input);
      }
      if (error instanceof AccountNotCreatedError) {
        if (await this.safeFindExact(domain, input)) {
          throw duplicateMailUserError();
        }
        if (
          error.type === "invalidProperties" ||
          error.type === "invalidArguments"
        ) {
          throw new MailUserAdministrationError(
            "invalid-input",
            "Stalwart rejected the mailbox details.",
          );
        }
        throw providerResponseError();
      }
      throw error;
    }

    const warning = (await this.invalidateNegativeCaches())
      ? undefined
      : "cache-invalidation-failed";
    const user = await this.createdUserDetail(createdId, domain, input);
    return {
      outcome: "created",
      user,
      ...(warning ? { warning } : {}),
    };
  }

  private async assertCreationAvailable(
    domain: ResolvedStalwartDomain,
  ): Promise<void> {
    const availability = await this.directory.getResolvedAvailability(domain);
    if (availability.available) return;
    const message =
      availability.reason === "external-directory"
        ? "Mailbox creation is managed by an external directory."
        : "Mailbox creation is disabled for this domain.";
    throw new MailUserAdministrationError(availability.reason, message);
  }

  private async createAccount(
    domain: ResolvedStalwartDomain,
    input: NormalizedMailUserCreateInput,
  ): Promise<string> {
    const account = {
      "@type": "User",
      aliases: {},
      credentials: { "0": { "@type": "Password", secret: input.password } },
      domainId: domain.id,
      encryptionAtRest: { "@type": "Disabled" },
      memberGroupIds: {},
      name: input.localPart,
      permissions: { "@type": "Inherit" },
      quotas: {},
      roles: { "@type": "User" },
      ...(input.displayName ? { description: input.displayName } : {}),
    };
    const response = await this.client.request(
      [["x:Account/set", { create: { user: account } }, "create-user"]],
      true,
    );
    const result = this.client.result(
      response,
      "create-user",
      "x:Account/set",
      stalwartSetResultSchema,
      true,
    );
    const id = result.created?.["user"]?.id;
    const notCreated = result.notCreated?.["user"];
    if (notCreated && !id) {
      throw new AccountNotCreatedError(notCreated.type);
    }
    if (!id || notCreated) {
      throw new StalwartManagementRequestError("invalid-response", true);
    }
    return id;
  }

  private async reconcileAmbiguousCreation(
    domain: ResolvedStalwartDomain,
    input: NormalizedMailUserCreateInput,
  ): Promise<never> {
    await this.safeFindExact(domain, input);
    throw unknownCreateOutcomeError();
  }

  private findExact(
    domain: ResolvedStalwartDomain,
    input: NormalizedMailUserCreateInput,
  ): Promise<AdminMailUserDetail | null> {
    return this.directory.findExact(domain, input.email, input.localPart);
  }

  private async safeFindExact(
    domain: ResolvedStalwartDomain,
    input: NormalizedMailUserCreateInput,
  ): Promise<AdminMailUserDetail | null> {
    try {
      return await this.findExact(domain, input);
    } catch {
      return null;
    }
  }

  private async invalidateNegativeCaches(): Promise<boolean> {
    try {
      const response = await this.client.request([
        [
          "x:Action/set",
          { create: { cache: { "@type": "InvalidateNegativeCaches" } } },
          "invalidate-cache",
        ],
      ]);
      const result = this.client.result(
        response,
        "invalidate-cache",
        "x:Action/set",
        stalwartSetResultSchema,
      );
      return Boolean(result.created?.["cache"]?.id);
    } catch {
      return false;
    }
  }

  private async createdUserDetail(
    id: string,
    domain: ResolvedStalwartDomain,
    input: NormalizedMailUserCreateInput,
  ): Promise<AdminMailUserDetail> {
    try {
      return await this.directory.get({ domain: domain.name, userId: id });
    } catch {
      return provisionalMailUser(id, input);
    }
  }
}

class AccountNotCreatedError extends Error {
  public constructor(public readonly type: string) {
    super("The account was not created.");
  }
}
