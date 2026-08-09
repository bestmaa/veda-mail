import "server-only";

import { z } from "zod";

import {
  JMAP_VACATION_RESPONSE,
  MAX_VACATION_BODY_CHARACTERS,
  MAX_VACATION_SUBJECT_CHARACTERS,
  isCanonicalVacationUtcDate,
  type VacationCapability,
  type VacationResponse,
  type VacationResponseUpdate,
} from "@/domain/mail/vacation";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { ApiError } from "@/transport/http/api-error";

const nullableBounded = (maximum: number) => z.string().max(maximum).nullable();
const nullableUtcDate = z.string().refine(isCanonicalVacationUtcDate).nullable();
const vacationSchema = z.object({
  fromDate: nullableUtcDate.optional(),
  htmlBody: nullableBounded(MAX_VACATION_BODY_CHARACTERS).optional(),
  id: z.literal("singleton"),
  isEnabled: z.boolean(),
  subject: nullableBounded(MAX_VACATION_SUBJECT_CHARACTERS).optional(),
  textBody: nullableBounded(MAX_VACATION_BODY_CHARACTERS).optional(),
  toDate: nullableUtcDate.optional(),
}).passthrough();
const getResultSchema = z.object({
  accountId: z.string().min(1),
  list: z.array(vacationSchema).max(1),
  notFound: z.array(z.string()).max(1).optional(),
  state: z.string().min(1).max(1_024),
}).passthrough();
const setResultSchema = z.object({
  accountId: z.string().min(1),
  newState: z.string().min(1).max(1_024),
  notUpdated: z.record(z.string(), z.unknown()).nullish(),
  oldState: z.string().min(1).max(1_024),
  updated: z.record(z.string(), z.unknown()).nullish(),
}).passthrough();
const accountSchema = z.object({
  accountCapabilities: z.record(z.string(), z.unknown()),
  isReadOnly: z.boolean(),
}).passthrough();

const UNSUPPORTED_REASON =
  "This provider does not advertise the standard JMAP vacation-response capability.";
const unsupported = (): VacationCapability => ({
  reason: UNSUPPORTED_REASON,
  supported: false,
});

export class StalwartVacationAdapter {
  public constructor(private readonly client: StalwartJmapClient) {}

  public async getCapability(): Promise<VacationCapability> {
    return await this.supportedAccountId() ? { supported: true } : unsupported();
  }

  private async supportedAccountId(): Promise<string | null> {
    const session = await this.client.getSession();
    const accountId = session.primaryAccounts[JMAP_VACATION_RESPONSE];
    const account = accountId ? accountSchema.safeParse(session.accounts[accountId]) : null;
    return session.capabilities[JMAP_VACATION_RESPONSE] && accountId &&
      accountId === session.primaryAccounts[JMAP_MAIL] && account?.success &&
      !account.data.isReadOnly && account.data.accountCapabilities[JMAP_VACATION_RESPONSE]
        ? accountId : null;
  }

  public async get(): Promise<VacationResponse> {
    const accountId = await this.accountId();
    const response = await this.client.request(
      [["VacationResponse/get", { accountId, ids: ["singleton"] }, "vacation-get"]],
      [JMAP_VACATION_RESPONSE],
    );
    const result = this.client.result(
      response, "vacation-get", "VacationResponse/get", getResultSchema,
    );
    if (result.accountId !== accountId || result.notFound?.length || result.list.length !== 1) {
      throw new ApiError("The provider returned an invalid vacation response.", "VACATION_PROVIDER_FAILED", 502);
    }
    const item = result.list[0]!;
    if (item.fromDate && item.toDate && item.fromDate >= item.toDate) {
      throw new ApiError("The provider returned an invalid vacation response.", "VACATION_PROVIDER_FAILED", 502);
    }
    return {
      fromDate: item.fromDate ?? null,
      htmlBody: item.htmlBody ?? null,
      isEnabled: item.isEnabled,
      revision: result.state,
      subject: item.subject ?? null,
      textBody: item.textBody ?? null,
      toDate: item.toDate ?? null,
    };
  }

  public async set(input: VacationResponseUpdate): Promise<VacationResponse> {
    const accountId = await this.accountId();
    const update = {
      fromDate: input.fromDate,
      htmlBody: input.htmlBody,
      isEnabled: input.isEnabled,
      subject: input.subject,
      textBody: input.textBody,
      toDate: input.toDate,
    };
    const response = await this.client.request(
      [["VacationResponse/set", {
        accountId,
        ifInState: input.expectedRevision,
        update: { singleton: update },
      }, "vacation-set"]],
      [JMAP_VACATION_RESPONSE],
    );
    const result = this.client.result(
      response, "vacation-set", "VacationResponse/set", setResultSchema,
    );
    if (result.accountId !== accountId || result.oldState !== input.expectedRevision ||
        Object.hasOwn(result.notUpdated ?? {}, "singleton") ||
        !Object.hasOwn(result.updated ?? {}, "singleton")) {
      throw new ApiError(
        "Vacation settings changed in another session. Reload and try again.",
        "VACATION_RESPONSE_CONFLICT",
        409,
      );
    }
    return { ...update, revision: result.newState };
  }

  private async accountId(): Promise<string> {
    const accountId = await this.supportedAccountId();
    if (!accountId) {
      throw new ApiError(UNSUPPORTED_REASON, "VACATION_PROVIDER_UNSUPPORTED", 422);
    }
    return accountId;
  }
}
