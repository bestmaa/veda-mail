import "server-only";

import type { MailGateway } from "@/application/ports/mail-provider.port";
import type { MailRulePutOperation } from "@/domain/mail/rule";
import type { ProviderConnection } from "@/domain/provider/provider";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { ruleOwnerForConnection } from "@/server/rules/rule-owner";
import type {
  MailRuleOwner,
  RuleBookProjection,
} from "@/server/rules/rule-record";
import { ruleStore } from "@/server/rules/rule-store";
import { ApiError } from "@/transport/http/api-error";

interface CodedError {
  readonly code?: unknown;
}

const providerFailure = (error: unknown) => {
  const code = (error as CodedError)?.code;
  if (code === "RULE_PROVIDER_CONFLICT") {
    return {
      api: new ApiError(
        "Another provider rule script is active. It was left unchanged.",
        "MAIL_RULE_PROVIDER_CONFLICT",
        409,
      ),
      result: { errorCode: code, status: "conflict" as const },
    };
  }
  if (code === "RULE_PROVIDER_UNSUPPORTED") {
    return {
      api: new ApiError(
        "This mailbox provider cannot deploy the selected rules.",
        "MAIL_RULE_PROVIDER_UNSUPPORTED",
        422,
      ),
      result: { errorCode: code, status: "failed" as const },
    };
  }
  return {
    api: new ApiError(
      "The mailbox provider could not deploy the rules.",
      "MAIL_RULE_PROVIDER_FAILED",
      502,
    ),
    result: {
      errorCode: code === "RULE_PROVIDER_REJECTED"
        ? code
        : "RULE_PROVIDER_FAILED",
      status: "failed" as const,
    },
  };
};

const deploy = async (
  connection: ProviderConnection,
  gateway: MailGateway,
  owner: MailRuleOwner,
  current: RuleBookProjection,
): Promise<RuleBookProjection> => {
  if (!current.revision) {
    throw new ApiError("No mail rules exist.", "MAIL_RULE_NOT_FOUND", 404);
  }
  const capability = await gateway.getRuleCapability();
  if (!capability.supported) {
    throw new ApiError(
      capability.reason ?? "Mail rules are unavailable for this provider.",
      "MAIL_RULE_PROVIDER_UNSUPPORTED",
      422,
    );
  }
  const work = await ruleStore.persistDeploymentIntent(
    owner,
    current.revision,
    connection,
  );
  const pending = await ruleStore.get(owner);
  let result;
  try {
    result = await gateway.deployRules({
      expectedProviderState: current.deployment.providerState,
      rules: work.rules,
    });
  } catch (error) {
    const failure = providerFailure(error);
    await ruleStore.put(owner, {
      expectedRevision: pending.revision!,
      intentId: work.intentId,
      operation: "finalize-deployment",
      result: failure.result,
    });
    throw failure.api;
  }
  return ruleStore.put(owner, {
    expectedRevision: pending.revision!,
    intentId: work.intentId,
    operation: "finalize-deployment",
    result,
  });
};

export const readRuleWorkspace = async (connection: ProviderConnection) => {
  const gateway = await resolveGateway(connection);
  const owner = await ruleOwnerForConnection(connection, gateway);
  const [book, capability] = await Promise.all([
    ruleStore.get(owner),
    gateway.getRuleCapability(),
  ]);
  return { book, capability };
};

export const mutateAndDeployRules = async (
  connection: ProviderConnection,
  operation: MailRulePutOperation,
) => {
  const gateway = await resolveGateway(connection);
  const owner = await ruleOwnerForConnection(connection, gateway);
  const desired = await ruleStore.put(owner, operation);
  return deploy(connection, gateway, owner, desired);
};

export const reconcileRules = async (
  connection: ProviderConnection,
  expectedRevision: string,
) => {
  const gateway = await resolveGateway(connection);
  const owner = await ruleOwnerForConnection(connection, gateway);
  const current = await ruleStore.get(owner);
  if (current.revision !== expectedRevision) {
    throw new ApiError(
      "Mail rules changed in another session. Reload and try again.",
      "MAIL_RULE_BOOK_CONFLICT",
      409,
    );
  }
  return deploy(connection, gateway, owner, current);
};
