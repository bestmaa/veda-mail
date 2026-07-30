import type { NextRequest, ProxyConfig } from "next/server";
import { NextResponse } from "next/server";

import {
  buildDocumentSecurityPolicy,
  createCspNonce,
  CSP_REQUEST_NONCE_HEADER,
  DOCUMENT_CACHE_CONTROL,
  DOCUMENT_REFERRER_POLICY,
} from "@/server/http/document-security-policy";

export const proxy = (request: NextRequest): NextResponse => {
  const nonce = createCspNonce();
  const policy = buildDocumentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set(CSP_REQUEST_NONCE_HEADER, nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Cache-Control", DOCUMENT_CACHE_CONTROL);
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", DOCUMENT_REFERRER_POLICY);
  return response;
};

export const config = {
  matcher: [
    {
      missing: [
        { key: "next-router-prefetch", type: "header" },
        { key: "purpose", type: "header", value: "prefetch" },
      ],
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:css|gif|ico|jpe?g|js|map|otf|png|svg|ttf|webp|woff2?)$).*)",
    },
  ],
} satisfies ProxyConfig;
