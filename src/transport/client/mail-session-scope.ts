export const MAIL_SESSION_SCOPE_HEADER = "x-veda-mail-session-scope";

export const mailSessionScopeHeaders = (
  sessionScope: string,
): Readonly<Record<string, string>> => ({
  [MAIL_SESSION_SCOPE_HEADER]: sessionScope,
});
