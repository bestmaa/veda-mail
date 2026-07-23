import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ApiError } from "@/transport/http/api-error";

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
): NextResponse<ApiSuccess<TData>> =>
  NextResponse.json(
    { data },
    {
      ...init,
      headers: {
        "Cache-Control": "private, no-store",
        ...init?.headers,
      },
    },
  );

export const apiFailure = (
  error: unknown,
  fallback = "The request could not be completed.",
): NextResponse<ApiFailure> => {
  const isValidation = error instanceof ZodError;
  const isApiError = error instanceof ApiError;
  if (!isValidation && !isApiError) {
    console.error("[veda-mail] Unexpected request failure.", error);
  }
  const message = isValidation
    ? (error.issues[0]?.message ?? "Invalid request.")
    : isApiError
      ? error.message
      : fallback;
  return NextResponse.json(
    {
      error: {
        code: isValidation
          ? "VALIDATION_ERROR"
          : isApiError
            ? error.code
            : "REQUEST_FAILED",
        message,
      },
    },
    {
      headers: { "Cache-Control": "private, no-store" },
      status: isValidation ? 400 : isApiError ? error.status : 500,
    },
  );
};
