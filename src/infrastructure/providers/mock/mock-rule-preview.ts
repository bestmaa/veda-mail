import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import type { RuleDeploymentInput, RulePreviewInput } from "@/domain/mail/rule";
import { evaluateMailRules } from "@/server/rules/rule-evaluator";

export const mockRuleCapability = () => ({
  maxRules: 0, maxScriptBytes: null,
  reason: "Rules are unavailable for the sample mailbox.",
  supported: false, supportedActions: [], supportedConditions: [],
} as const);

export const deployMockRules = async (
  input: RuleDeploymentInput,
): Promise<never> => {
  void input;
  throw new Error("Rules are unavailable for the sample mailbox.");
};

export const previewMockRules = (
  messages: readonly MessageDetail[],
  input: RulePreviewInput,
) => messages.slice().sort((left, right) =>
  right.receivedAt.localeCompare(left.receivedAt)).slice(0, input.limit)
  .map((message) => {
    const facts = {
      cc: message.cc.map(({ email }) => email),
      from: message.from.map(({ email }) => email),
      hasAttachment: message.hasAttachment, headers: {}, id: message.id,
      recipient: [], receivedAt: message.receivedAt, size: message.size,
      subject: message.subject, to: message.to.map(({ email }) => email),
    };
    return {
      evaluation: evaluateMailRules(input.rules, facts), from: facts.from,
      messageId: message.id, receivedAt: message.receivedAt,
      subject: message.subject,
    };
  });
