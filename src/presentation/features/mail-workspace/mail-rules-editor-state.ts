import type {
  MailRule,
  MailRuleAction,
  MailRuleDefinition,
} from "@/domain/mail/rule";

const terminal = (action: MailRuleAction): boolean =>
  action.kind === "discard" || action.kind === "move";

const conflicts = (
  actions: readonly MailRuleAction[],
  candidate: MailRuleAction,
): boolean => actions.some((action) =>
  JSON.stringify(action) === JSON.stringify(candidate) ||
  (terminal(action) && terminal(candidate)));

export const definitionFromMailRule = (rule: MailRule): MailRuleDefinition => ({
  actions: rule.actions,
  conditions: rule.conditions,
  enabled: rule.enabled,
  match: rule.match,
  name: rule.name,
  stopProcessing: rule.stopProcessing,
});

export const appendMailRuleAction = (
  definition: MailRuleDefinition,
  action: MailRuleAction,
): MailRuleDefinition => conflicts(definition.actions, action) ? definition : ({
  ...definition,
  actions: [...definition.actions, action],
  stopProcessing: definition.stopProcessing || terminal(action),
});

export const replaceMailRuleAction = (
  definition: MailRuleDefinition,
  index: number,
  action: MailRuleAction,
): MailRuleDefinition => {
  const otherActions = definition.actions.filter((_, itemIndex) => itemIndex !== index);
  if (conflicts(otherActions, action)) return definition;
  return {
    ...definition,
    actions: definition.actions.map((item, itemIndex) => itemIndex === index ? action : item),
    stopProcessing: definition.stopProcessing || terminal(action),
  };
};
