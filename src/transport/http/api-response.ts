import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  API_ERROR_CODE_HEADER,
  ApiError,
} from "@/transport/http/api-error";
import { recordHttpResponse } from "@/server/observability/metrics";
import {
  logError,
  safeErrorType,
} from "@/server/observability/structured-log";

export interface ApiFailure {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ApiSuccess<TData> {
  readonly data: TData;
}

export const apiSuccess = <TData>(
  data: TData,
  init?: ResponseInit,
): NextResponse<ApiSuccess<TData>> => {
  recordHttpResponse(init?.status ?? 200);
  return NextResponse.json(
    { data },
    {
      ...init,
      headers: {
        "Cache-Control": "private, no-store",
        ...init?.headers,
      },
    },
  );
};

export const apiFailure = (
  error: unknown,
  fallback = "The request could not be completed.",
): NextResponse<ApiFailure> => {
  const isValidation = error instanceof ZodError;
  const isApiError = error instanceof ApiError;
  if (!isValidation && !isApiError) {
    logError("http.request_failed", {
      errorType: safeErrorType(error),
      outcome: "error",
      statusCode: 500,
    });
  }
  const message = isValidation
    ? (error.issues[0]?.message ?? "Invalid request.")
    : isApiError
      ? error.message
      : fallback;
  const code = isValidation
    ? "VALIDATION_ERROR"
    : isApiError
      ? error.code
      : "REQUEST_FAILED";
  const status = isValidation ? 400 : isApiError ? error.status : 500;
  recordHttpResponse(status);
  return NextResponse.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
        [API_ERROR_CODE_HEADER]: code,
      },
      status,
    },
  );
};
