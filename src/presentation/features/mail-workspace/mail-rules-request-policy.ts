export const isCurrentMailRuleRequest = (
  activeSessionScope: string,
  requestSessionScope: string,
): boolean => Boolean(requestSessionScope) && activeSessionScope === requestSessionScope;
