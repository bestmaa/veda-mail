import "server-only";

import { headers } from "next/headers";

import { normalizeRequestId } from "@/transport/http/request-id";

export const currentRequestId = async (): Promise<string | undefined> => {
  try {
    return normalizeRequestId((await headers()).get("x-request-id")) ?? undefined;
  } catch {
    // Worker and startup failures do not have a request header context.
    return undefined;
  }
};
