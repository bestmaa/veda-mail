import "server-only";

import { LabelPolicyError } from "@/domain/mail/label-policy";
import { ApiError } from "@/transport/http/api-error";

const statusFor = (failure: LabelPolicyError["failure"]): number =>
  failure === "missing" ? 404 : failure === "conflict" || failure === "limit" ? 409 : 400;

export const labelHttpError = (error: unknown): unknown =>
  error instanceof LabelPolicyError
    ? new ApiError(
        error.message,
        `LABEL_${error.failure.toUpperCase()}`,
        statusFor(error.failure),
      )
    : error;
