import "server-only";

import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import {
  ruleConflict,
  ruleRejected,
  StalwartRuleError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-rule-errors";
import {
  JMAP_SIEVE,
  sieveGetResultSchema,
  sieveSetResultSchema,
  sieveValidateResultSchema,
  VEDA_RULE_SCRIPT_NAME,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-sieve-schema";

export const getStalwartSieveScripts = async (
  client: StalwartJmapClient,
  accountId: string,
  ids?: readonly string[],
) => client.result(
  await client.request([["SieveScript/get", {
    accountId,
    ...(ids ? { ids } : {}),
    properties: ["id", "name", "blobId", "isActive"],
  }, "rules-get"]], [JMAP_SIEVE]),
  "rules-get",
  "SieveScript/get",
  sieveGetResultSchema,
);

export const validateStalwartSieveScript = async (
  client: StalwartJmapClient,
  accountId: string,
  blobId: string,
): Promise<void> => {
  const response = await client.request([["SieveScript/validate", {
    accountId, blobId,
  }, "rules-validate"]], [JMAP_SIEVE]);
  const result = client.result(
    response, "rules-validate", "SieveScript/validate", sieveValidateResultSchema,
  );
  if (result.accountId !== accountId || result.error !== null) ruleRejected();
};

export const installStalwartSieveScript = async (
  client: StalwartJmapClient,
  input: {
    readonly accountId: string;
    readonly blobId: string;
    readonly ownedId: string | null;
    readonly state: string;
  },
) => {
  try {
    const response = await client.request([["SieveScript/set", {
      accountId: input.accountId,
      ifInState: input.state,
      ...(input.ownedId
        ? { update: { [input.ownedId]: { blobId: input.blobId } } }
        : { create: { veda: {
            blobId: input.blobId,
            name: VEDA_RULE_SCRIPT_NAME,
          } } }),
      onSuccessActivateScript: input.ownedId ?? "#veda",
    }, "rules-set"]], [JMAP_SIEVE]);
    const result = client.result(
      response, "rules-set", "SieveScript/set", sieveSetResultSchema,
    );
    const rejected = input.ownedId
      ? result.notUpdated?.[input.ownedId]
      : result.notCreated?.["veda"];
    if (
      result.accountId !== input.accountId ||
      result.oldState !== input.state ||
      rejected ||
      (input.ownedId && !Object.hasOwn(result.updated ?? {}, input.ownedId))
    ) ruleRejected();
    return result;
  } catch (error) {
    if (error instanceof StalwartJmapMethodError && error.type === "stateMismatch") {
      ruleConflict("Rules changed at the provider. Reload before saving.");
    }
    if (error instanceof StalwartRuleError) throw error;
    return ruleRejected();
  }
};
