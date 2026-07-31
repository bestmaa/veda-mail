import "server-only";
import { z } from "zod";

import type { AdminMailUserDetailInput, AdminMailUserListInput } from "@/application/ports/mail-user-administration.port";
import {
  MailUserAdministrationError,
  type AdminMailUserDetail,
  type AdminMailUserPage,
  type MailUserCreationAvailability,
} from "@/domain/admin/mail-user";
import {
  StalwartManagementRequestError,
  type StalwartManagementClient,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import {
  stalwartAuthenticationSchema,
  stalwartDomainSchema,
  stalwartGetResultSchema,
  stalwartQueryResultSchema,
  stalwartUserAccountSchema,
  type StalwartUserAccount,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import {
  invalidInput,
  isStalwartUserRecord,
  mapStalwartUserDetail,
  mapStalwartUserSummary,
  normalizeMailDomain,
  SAFE_ACCOUNT_PROPERTIES,
  validStalwartId,
  type ResolvedStalwartDomain,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-mapper";

export class StalwartMailUserDirectory {
  private readonly allowedDomains: ReadonlySet<string>;

  public constructor(
    private readonly client: StalwartManagementClient,
    allowedDomains: readonly string[],
  ) {
    this.allowedDomains = new Set(allowedDomains.map(normalizeMailDomain));
  }

  public async getAvailability(
    domainName: string,
  ): Promise<MailUserCreationAvailability> {
    const domain = await this.resolveDomain(domainName);
    return this.getResolvedAvailability(domain);
  }

  public async getResolvedAvailability(
    domain: ResolvedStalwartDomain,
  ): Promise<MailUserCreationAvailability> {
    if (!domain.isEnabled) {
      return { available: false, reason: "domain-disabled" };
    }
    const authentication = await this.getAuthenticationDirectoryId();
    if (authentication !== null || domain.directoryId !== null) {
      return { available: false, reason: "external-directory" };
    }
    return { available: true };
  }

  public async list(input: AdminMailUserListInput): Promise<AdminMailUserPage> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50 ||
      (input.cursor !== undefined && !validStalwartId(input.cursor)) ||
      (input.query !== undefined && input.query.length > 128)
    ) {
      throw invalidInput();
    }
    const domain = await this.resolveDomain(input.domain);
    const filter = input.query?.trim()
      ? {
          conditions: [
            { domainId: domain.id },
            { text: input.query.trim() },
          ],
          operator: "AND",
        }
      : { domainId: domain.id };
    const queryArguments: Record<string, unknown> = {
      calculateTotal: true,
      filter,
      limit: input.limit,
      sort: [{ isAscending: true, property: "name" }],
    };
    if (input.cursor) {
      queryArguments["anchor"] = input.cursor;
      queryArguments["anchorOffset"] = 1;
    }
    const query = await this.queryAccounts(queryArguments);
    const users = await this.getAccounts(query.ids, domain);
    const finalId = query.ids.at(-1);
    return {
      items: users.map((user) => mapStalwartUserSummary(user, domain)),
      ...(finalId && query.position + query.ids.length < query.total
        ? { nextCursor: finalId }
        : {}),
    };
  }

  public async get(input: AdminMailUserDetailInput): Promise<AdminMailUserDetail> {
    if (!validStalwartId(input.userId)) throw invalidInput();
    const domain = await this.resolveDomain(input.domain);
    const users = await this.getAccounts([input.userId], domain);
    const user = users.find(({ id }) => id === input.userId);
    if (!user) {
      throw new MailUserAdministrationError(
        "not-found",
        "The mailbox user was not found.",
      );
    }
    return mapStalwartUserDetail(user, domain);
  }

  public async findExact(
    domain: ResolvedStalwartDomain,
    email: string,
    localPart: string,
  ): Promise<AdminMailUserDetail | null> {
    const query = await this.queryAccounts({
      filter: { domainId: domain.id, name: localPart },
      limit: 50,
    });
    const matches = (await this.getAccounts(query.ids, domain)).filter(
      (account) => account.emailAddress.toLowerCase() === email.toLowerCase(),
    );
    if (matches.length > 1) {
      throw new StalwartManagementRequestError("invalid-response", false);
    }
    return matches[0] ? mapStalwartUserDetail(matches[0], domain) : null;
  }

  public async resolveDomain(
    domainName: string,
  ): Promise<ResolvedStalwartDomain> {
    const normalized = normalizeMailDomain(domainName);
    if (!this.allowedDomains.has(normalized)) throw invalidInput();
    const response = await this.client.request([
      [
        "x:Domain/query",
        { calculateTotal: true, filter: { name: normalized }, limit: 10 },
        "dq",
      ],
    ]);
    const query = this.client.result(
      response,
      "dq",
      "x:Domain/query",
      stalwartQueryResultSchema,
    );
    const getResponse = await this.client.request([
      [
        "x:Domain/get",
        { ids: query.ids, properties: ["id", "name", "isEnabled", "directoryId"] },
        "dg",
      ],
    ]);
    const result = this.client.result(
      getResponse,
      "dg",
      "x:Domain/get",
      stalwartGetResultSchema(stalwartDomainSchema),
    );
    const matches = result.list.filter(
      (candidate) => normalizeMailDomain(candidate.name) === normalized,
    );
    const domain = matches.length === 1 ? matches[0] : undefined;
    if (!domain) {
      throw new MailUserAdministrationError(
        "domain-not-found",
        "The configured mail domain was not found.",
      );
    }
    return {
      directoryId: domain.directoryId ?? null,
      id: domain.id,
      isEnabled: domain.isEnabled ?? true,
      name: normalized,
    };
  }

  private async getAccounts(
    ids: readonly string[],
    domain: ResolvedStalwartDomain,
  ): Promise<readonly StalwartUserAccount[]> {
    if (ids.length === 0) return [];
    const response = await this.client.request([
      [
        "x:Account/get",
        { ids, properties: SAFE_ACCOUNT_PROPERTIES },
        "ag",
      ],
    ]);
    const result = this.client.result(
      response,
      "ag",
      "x:Account/get",
      stalwartGetResultSchema(z.unknown()),
    );
    return result.list.flatMap((candidate) => {
      const parsed = stalwartUserAccountSchema.safeParse(candidate);
      if (parsed.success) {
        return parsed.data.domainId === domain.id ? [parsed.data] : [];
      }
      if (isStalwartUserRecord(candidate)) {
        throw new StalwartManagementRequestError("invalid-response", false);
      }
      return [];
    });
  }

  private async getAuthenticationDirectoryId(): Promise<string | null> {
    const response = await this.client.request([
      [
        "x:Authentication/get",
        { ids: ["singleton"], properties: ["id", "directoryId"] },
        "auth",
      ],
    ]);
    const result = this.client.result(
      response,
      "auth",
      "x:Authentication/get",
      stalwartGetResultSchema(stalwartAuthenticationSchema),
    );
    if (result.list.length !== 1) {
      throw new StalwartManagementRequestError("invalid-response", false);
    }
    return result.list[0]?.directoryId ?? null;
  }

  private async queryAccounts(arguments_: Readonly<Record<string, unknown>>) {
    const response = await this.client.request([
      ["x:Account/query", { calculateTotal: true, ...arguments_ }, "aq"],
    ]);
    return this.client.result(
      response,
      "aq",
      "x:Account/query",
      stalwartQueryResultSchema,
    );
  }
}
