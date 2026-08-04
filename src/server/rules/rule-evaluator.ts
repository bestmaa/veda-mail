import {
  mailRuleActionIsTerminal,
  type MailRule,
  type MailRuleAction,
  type MailRuleCondition,
  type MailRuleEvaluation,
  type MailRuleMessageFacts,
} from "@/domain/mail/rule";

const folded = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("en-US");

const textMatches = (
  actual: string,
  expected: string,
  operator: "contains" | "is",
): boolean => operator === "is"
  ? folded(actual) === folded(expected)
  : folded(actual).includes(folded(expected));

const addressDomain = (address: string): string => {
  const bracketed = /<([^<>]+)>\s*$/u.exec(address)?.[1] ?? address;
  const separator = bracketed.lastIndexOf("@");
  return separator < 0 ? "" : folded(bracketed.slice(separator + 1).trim());
};

const headerValues = (
  facts: MailRuleMessageFacts,
  name: string,
): readonly string[] | undefined => {
  const target = name.toLowerCase();
  const entry = Object.entries(facts.headers).find(
    ([candidate]) => candidate.toLowerCase() === target,
  );
  return entry?.[1];
};

export const mailRuleConditionMatches = (
  condition: MailRuleCondition,
  facts: MailRuleMessageFacts,
): boolean => {
  if (condition.kind === "attachment") return facts.hasAttachment;
  if (condition.kind === "size") {
    return condition.operator === "over"
      ? facts.size > condition.bytes
      : facts.size < condition.bytes;
  }
  if (condition.kind === "subject") {
    return textMatches(facts.subject, condition.value, condition.operator);
  }
  if (condition.kind === "header") {
    const values = headerValues(facts, condition.name);
    if (condition.operator === "exists") return values !== undefined;
    return values?.some((value) =>
      textMatches(value, condition.value, condition.operator)) ?? false;
  }
  const values = facts[condition.field];
  if (condition.operator === "domain") {
    const domain = folded(condition.value);
    return values.some((value) => addressDomain(value) === domain);
  }
  return values.some((value) =>
    textMatches(
      value,
      condition.value,
      condition.operator === "is" ? "is" : "contains",
    ));
};

export const mailRuleMatches = (
  rule: MailRule,
  facts: MailRuleMessageFacts,
): boolean => {
  if (!rule.enabled) return false;
  const results = rule.conditions.map((condition) =>
    mailRuleConditionMatches(condition, facts));
  return rule.match === "all" ? results.every(Boolean) : results.some(Boolean);
};

const actionRank = (action: MailRuleAction): number => {
  if (action.kind === "label") return 0;
  if (action.kind === "star") return 1;
  if (action.kind === "mark-read") return 2;
  return 3;
};

const actionKey = (action: MailRuleAction): string =>
  action.kind === "label" ? `label:${action.labelId}`
    : action.kind === "move" ? `move:${action.mailboxId}` : action.kind;

const orderedActions = (actions: readonly MailRuleAction[]) =>
  actions.map((action, index) => ({ action, index }))
    .sort((left, right) =>
      actionRank(left.action) - actionRank(right.action) || left.index - right.index)
    .map(({ action }) => action);

export const evaluateMailRules = (
  rules: readonly MailRule[],
  facts: MailRuleMessageFacts,
): MailRuleEvaluation => {
  const actions: MailRuleEvaluation["actions"][number][] = [];
  const matchedRuleIds: string[] = [];
  const applied = new Set<string>();
  let stoppedByRuleId: string | null = null;

  for (const rule of rules) {
    if (!mailRuleMatches(rule, facts)) continue;
    matchedRuleIds.push(rule.id);
    let terminal = false;
    for (const action of orderedActions(rule.actions)) {
      const key = actionKey(action);
      if (!applied.has(key)) {
        applied.add(key);
        actions.push({ action, ruleId: rule.id });
      }
      terminal ||= mailRuleActionIsTerminal(action);
    }
    if (terminal || rule.stopProcessing) {
      stoppedByRuleId = rule.id;
      break;
    }
  }
  return { actions, matchedRuleIds, stoppedByRuleId };
};
