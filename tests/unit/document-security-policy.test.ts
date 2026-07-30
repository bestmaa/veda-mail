import { describe, expect, it } from "vitest";

import {
  MESSAGE_FRAME_STYLE_HASH,
  MESSAGE_RESIZE_SCRIPT_HASH,
} from "@/presentation/features/mail-workspace/message-frame";
import {
  buildDocumentSecurityPolicy,
  createCspNonce,
} from "@/server/http/document-security-policy";

const fixedNonce = "AAECAwQFBgcICQoLDA0ODw";

describe("document Content Security Policy", () => {
  it("creates unique CSP-safe 128-bit nonces", () => {
    const nonces = new Set(
      Array.from({ length: 64 }, () => createCspNonce()),
    );

    expect(nonces.size).toBe(64);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    }
  });

  it("builds a production policy without executable inline fallbacks", () => {
    const policy = buildDocumentSecurityPolicy(fixedNonce, "production");

    expect(policy).toContain(`script-src 'self' 'nonce-${fixedNonce}'`);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain(`'sha256-${MESSAGE_RESIZE_SCRIPT_HASH}'`);
    expect(
      policy
        .split("; ")
        .find((directive) => directive.startsWith("style-src ")),
    ).toContain(
      `'sha256-${MESSAGE_FRAME_STYLE_HASH}'`,
    );
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("frame-src blob:");
    expect(policy).toContain("child-src blob:");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
    expect(policy).not.toMatch(/[\r\n]/u);
  });

  it("allows only the development tooling exceptions outside production", () => {
    const policy = buildDocumentSecurityPolicy(fixedNonce, "development");

    expect(policy).toMatch(/script-src[^;]*'unsafe-eval'/u);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/connect-src[^;]*wss?:/u);
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toMatch(/style-src [^;]*nonce-/u);
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it.each([
    "",
    "short",
    "nonce-with-dashes",
    "0123456789abcdef\r\nX-Evil: injected",
    "0123456789abcdef<script>",
  ])("rejects unsafe nonce input %j", (nonce) => {
    expect(() => buildDocumentSecurityPolicy(nonce, "production")).toThrow(
      "Content Security Policy nonce is invalid.",
    );
  });
});
