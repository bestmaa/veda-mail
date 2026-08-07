import "server-only";

import { ApiError } from "@/transport/http/api-error";

const firstHeaderValue = (
  request: Request,
  name: string,
): string | undefined => request.headers.get(name)?.split(",")[0]?.trim();

const expectedOrigin = (request: Request): string => {
  const requestUrl = new URL(request.url);
  const trustProxy =
    process.env["VEDA_MAIL_TRUST_PROXY_HEADERS"] === "true";
  const host =
    (trustProxy ? firstHeaderValue(request, "x-forwarded-host") : undefined) ??
    request.headers.get("host")?.trim() ??
    requestUrl.host;
  const forwardedProtocol = trustProxy
    ? firstHeaderValue(request, "x-forwarded-proto")
    : undefined;
  const protocol = forwardedProtocol ?? requestUrl.protocol.replace(/:$/, "");
  if (!["http", "https"].includes(protocol.toLowerCase())) {
    throw new ApiError(
      "Invalid forwarded request protocol.",
      "INVALID_REQUEST_ORIGIN",
      403,
    );
  }
  try {
    return new URL(`${protocol.toLowerCase()}://${host}`).origin;
  } catch {
    throw new ApiError(
      "Invalid request host.",
      "INVALID_REQUEST_ORIGIN",
      403,
    );
  }
};

export const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin");
  if (!origin) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (!fetchSite || !["none", "same-origin"].includes(fetchSite)) {
      throw new ApiError(
        "A verifiable same-origin request is required.",
        "INVALID_REQUEST_ORIGIN",
        403,
      );
    }
    return;
  }
  let suppliedOrigin: string;
  try {
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new ApiError(
      "Invalid request origin.",
      "INVALID_REQUEST_ORIGIN",
      403,
    );
  }
  if (suppliedOrigin !== expectedOrigin(request)) {
    throw new ApiError(
      "Cross-origin request rejected.",
      "INVALID_REQUEST_ORIGIN",
      403,
    );
  }
};
