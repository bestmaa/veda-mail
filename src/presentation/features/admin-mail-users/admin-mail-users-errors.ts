import { ApiClientError } from "@/transport/client/api-request";

export const isAdminSessionUnauthorized = (error: unknown): boolean =>
  error instanceof ApiClientError && error.code === "ADMIN_UNAUTHORIZED";
