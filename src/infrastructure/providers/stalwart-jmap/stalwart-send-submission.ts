import "server-only";

import type { z } from "zod";

import type { SendReceipt } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
  type JmapMethodCall,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const uncertainReceipt = (): SendReceipt => ({
  deliveryStatus: "uncertain",
  id: id.message(`uncertain-${crypto.randomUUID()}`),
  rejectedRecipients: [],
  submittedAt: new Date().toISOString(),
});

type JmapSetResult = z.infer<typeof jmapSetResultSchema>;

type SetOutcome =
  | { readonly id: string; readonly kind: "created" }
  | { readonly kind: "not-created" }
  | { readonly kind: "uncertain" };

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isValidSetError = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string" &&
  value.type.length > 0 &&
  value.type.length <= 128 &&
  value.type.trim() === value.type;

const setOutcome = (result: JmapSetResult, key: string): SetOutcome => {
  const created = result.created?.[key];
  const hasNotCreated =
    result.notCreated !== undefined && hasOwn(result.notCreated, key);
  const validNotCreated =
    hasNotCreated && isValidSetError(result.notCreated?.[key]);
  if ((created && hasNotCreated) || (hasNotCreated && !validNotCreated)) {
    return { kind: "uncertain" };
  }
  if (validNotCreated) return { kind: "not-created" };
  return created
    ? { id: created.id, kind: "created" }
    : { kind: "uncertain" };
};

const readSetOutcome = (
  client: StalwartJmapClient,
  response: Awaited<ReturnType<StalwartJmapClient["request"]>>,
  callId: string,
  expectedMethod: string,
  key: string,
  allowedImplicitMethods: readonly string[] = [],
): SetOutcome => {
  try {
    const raw = client.result(
      response,
      callId,
      expectedMethod,
      jmapSetResultSchema,
      allowedImplicitMethods,
    );
    const parsed = jmapSetResultSchema.safeParse(raw);
    return parsed.success
      ? setOutcome(parsed.data, key)
      : { kind: "uncertain" };
  } catch (error) {
    if (
      error instanceof StalwartJmapMethodError &&
      error.kind === "definitive"
    ) {
      return { kind: "not-created" };
    }
    return { kind: "uncertain" };
  }
};

export const submitStalwartMessage = async (
  client: StalwartJmapClient,
  calls: readonly JmapMethodCall[],
  createId: string,
): Promise<SendReceipt> => {
  const boundary: StalwartJmapRequestBoundary = { issued: false };
  let response: Awaited<ReturnType<StalwartJmapClient["request"]>>;
  try {
    response = await client.request(
      calls,
      [JMAP_MAIL, JMAP_SUBMISSION],
      undefined,
      boundary,
    );
  } catch (error) {
    if (
      !boundary.issued ||
      (error instanceof StalwartJmapHttpError &&
        error.methodsWereNotExecuted)
    ) {
      throw error;
    }
    return uncertainReceipt();
  }

  const submission = readSetOutcome(
    client,
    response,
    "submit",
    "EmailSubmission/set",
    "submit",
    ["Email/set"],
  );
  if (submission.kind === "not-created") {
    throw new Error("Stalwart did not create the outgoing message.");
  }
  if (submission.kind === "uncertain") return uncertainReceipt();
  const create = readSetOutcome(
    client,
    response,
    "create",
    "Email/set",
    createId,
  );
  if (create.kind !== "created") return uncertainReceipt();

  return {
    deliveryStatus: "accepted",
    id: id.message(create.id),
    rejectedRecipients: [],
    submittedAt: new Date().toISOString(),
  };
};
