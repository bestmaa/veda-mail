import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { ApiError } from "@/transport/http/api-error";

const digest = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

export const assertSetupToken = (candidate: string): void => {
  const configured = process.env["VEDA_MAIL_SETUP_TOKEN"] ?? "";
  if (configured.length < 24) {
    throw new ApiError(
      "Configure VEDA_MAIL_SETUP_TOKEN with at least 24 characters.",
      "SETUP_TOKEN_NOT_CONFIGURED",
      503,
    );
  }
  if (!timingSafeEqual(digest(candidate), digest(configured))) {
    throw new ApiError(
      "The one-time setup token is incorrect.",
      "INVALID_SETUP_TOKEN",
      401,
    );
  }
};
