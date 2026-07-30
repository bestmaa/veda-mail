import "server-only";

import { randomBytes } from "node:crypto";

import {
  MESSAGE_FRAME_STYLE_HASH,
  MESSAGE_RESIZE_SCRIPT_HASH,
} from "@/presentation/features/mail-workspace/message-frame";

const CSP_NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

export const CSP_REQUEST_NONCE_HEADER = "x-nonce";
export const DOCUMENT_CACHE_CONTROL =
  "private, no-cache, no-store, max-age=0, must-revalidate";
export const DOCUMENT_REFERRER_POLICY = "strict-origin-when-cross-origin";

export const createCspNonce = (): string =>
  randomBytes(16).toString("base64url");

const assertCspNonce = (nonce: string): void => {
  if (!CSP_NONCE_PATTERN.test(nonce)) {
    throw new Error("Content Security Policy nonce is invalid.");
  }
};

export const buildDocumentSecurityPolicy = (
  nonce: string,
  environment = process.env["NODE_ENV"],
): string => {
  assertCspNonce(nonce);
  const development = environment === "development";
  const production = environment === "production";
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    `'sha256-${MESSAGE_RESIZE_SCRIPT_HASH}'`,
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const styleSources = development
    ? ["'self'", "'unsafe-inline'"]
    : [
        "'self'",
        `'nonce-${nonce}'`,
        `'sha256-${MESSAGE_FRAME_STYLE_HASH}'`,
      ];
  return [
    "default-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    `style-src ${styleSources.join(" ")}`,
    `style-src-elem ${styleSources.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src blob:",
    "child-src blob:",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "manifest-src 'none'",
    "worker-src 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
};
