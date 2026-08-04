import type { MailRule, RulePreviewResult } from "@/domain/mail/rule";
import type {
  MailRuleChoice,
  MailRulePreviewItemViewModel,
} from "@/presentation/features/mail-workspace/mail-rules.view-model";

export const createMailRulePreviewItems = (
  results: readonly RulePreviewResult[],
  rules: readonly MailRule[],
  mailboxes: readonly MailRuleChoice[],
  labels: readonly MailRuleChoice[],
): readonly MailRulePreviewItemViewModel[] => {
  const ruleNames = new Map(rules.map(({ id, name }) => [id, name]));
  const mailboxNames = new Map(mailboxes.map(({ id, label }) => [id, label]));
  const labelNames = new Map(labels.map(({ id, label }) => [id, label]));
  return results.map((result) => ({
    actions: result.evaluation.actions.map(({ action }) => {
      if (action.kind === "move") return `Move to ${mailboxNames.get(action.mailboxId) ?? "mailbox"}`;
      if (action.kind === "label") return `Apply ${labelNames.get(action.labelId) ?? "label"}`;
      if (action.kind === "mark-read") return "Mark as read";
      if (action.kind === "star") return "Star";
      return "Discard";
    }).join(", ") || "No action",
    from: result.from.join(", ") || "Unknown sender",
    matchedRules: result.evaluation.matchedRuleIds.map((ruleId) =>
      ruleNames.get(ruleId) ?? "Unknown rule").join(", ") || "No match",
    messageId: result.messageId,
    receivedAt: result.receivedAt,
    subject: result.subject || "(No subject)",
  }));
};
