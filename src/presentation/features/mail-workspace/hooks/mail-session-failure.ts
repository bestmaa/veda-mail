import { ApiClientError } from "@/transport/client/api-request";

export type MailSessionFailureHandler = (error: unknown) => boolean;

export const ignoreMailSessionFailure: MailSessionFailureHandler = () => false;

export const isMailSessionFailure = (error: unknown): boolean =>
  error instanceof ApiClientError &&
  (error.status === 401 || error.code === "MAIL_SESSION_CHANGED");
