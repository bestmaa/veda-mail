import { expect, test } from "@playwright/test";

import { registerInlineCidImageCases } from "./support/inline-cid-image.cases";
import {
  mailSessionScopeHeaders,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();
registerInlineCidImageCases();

const responseNonce = (policy: string): string | null =>
  /'nonce-([A-Za-z0-9_-]{22})'/u.exec(policy)?.[1] ?? null;

const directiveSources = (policy: string, name: string): string[] =>
  policy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `))
    ?.split(/\s+/u)
    .slice(1) ?? [];

test("enforces a fresh nonce CSP without breaking the mailbox frame", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, "__vedaCspViolations", {
      value: violations,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.effectiveDirective}:${event.blockedURI}`);
    });
  });

  const first = await page.goto("/");
  if (!first) throw new Error("The document navigation returned no response.");
  const firstPolicy = first.headers()["content-security-policy"] ?? "";
  const firstNonce = responseNonce(firstPolicy);
  expect(firstNonce).toMatch(/^[A-Za-z0-9_-]{22}$/u);
  expect(first.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(first.headers()["cache-control"]).toBe("no-cache, must-revalidate");
  expect(first.headers()["strict-transport-security"]).toBeUndefined();

  const serverScriptTags = [
    ...(await first.text()).matchAll(/<script\b[^>]*>/giu),
  ].map(([tag]) => tag);
  expect(serverScriptTags.length).toBeGreaterThan(0);
  for (const tag of serverScriptTags) {
    expect(tag).toContain(`nonce="${firstNonce}"`);
  }

  const second = await page.reload();
  const secondPolicy = second?.headers()["content-security-policy"] ?? "";
  expect(responseNonce(secondPolicy)).not.toBe(firstNonce);

  await page.route(
    "**/api/v1/mail/messages/msg-archive-fixtures",
    async (route) => {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        readonly data: Record<string, unknown>;
      };
      await route.fulfill({
        json: {
          ...payload,
          data: {
            ...payload.data,
            htmlBody:
              "<h2>Security fixture</h2><p>This sanitized HTML proves that the isolated frame style and resize hashes remain compatible with the parent policy.</p><p>Second paragraph for deterministic frame sizing.</p>",
            textBody: null,
          },
        },
        response,
      });
    },
  );
  await page
    .getByRole("button", {
      name: "Open Archive download security fixtures",
    })
    .click();
  const messageFrame = page.getByTitle("Email content");
  await expect(messageFrame).toBeVisible();
  await expect(messageFrame).not.toHaveCSS("height", "160px");
  const sandbox = (await messageFrame.getAttribute("sandbox"))?.split(/\s+/u);
  expect(sandbox).toContain("allow-scripts");
  expect(sandbox).not.toContain("allow-same-origin");
  const frame = messageFrame.contentFrame();
  const framePolicy =
    (await frame
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content")) ?? "";
  const childImageSources = directiveSources(framePolicy, "img-src");
  expect(directiveSources(framePolicy, "connect-src")).toEqual(["'none'"]);
  expect(childImageSources).toEqual(["blob:"]);
  expect(childImageSources).not.toContain("data:");
  expect(childImageSources.some((source) => /^https?:/u.test(source))).toBe(
    false,
  );
  const frameBody = frame.locator("body");
  await expect(frameBody).toHaveCSS("color", "rgb(51, 65, 85)");
  expect(
    await frameBody.evaluate(
      () =>
        (
          window as typeof window & {
            readonly __vedaCspViolations: readonly string[];
          }
        ).__vedaCspViolations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            readonly __vedaCspViolations: readonly string[];
          }
        ).__vedaCspViolations,
    ),
  ).toEqual([]);
});

test("preserves route-owned attachment isolation headers end to end", async ({
  page,
}) => {
  const origin = new URL(page.url()).origin;
  const scopeHeaders = await mailSessionScopeHeaders(page);
  const direct = await page.request.get(
    "/api/v1/mail/messages/msg-archive-fixtures/attachments/attachment-archive-one",
    { headers: { origin, ...scopeHeaders } },
  );
  const archive = await page.request.get(
    "/api/v1/mail/messages/msg-archive-fixtures/attachments/archive",
    { headers: { origin, ...scopeHeaders } },
  );

  for (const response of [direct, archive]) {
    expect(response.status()).toBe(200);
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["content-security-policy"]).toBe(
      "sandbox; default-src 'none'",
    );
    expect(response.headers()["cache-control"]).toBe(
      "private, no-store, no-transform, max-age=0",
    );
  }

  const inline = await page.request.post(
    "/api/v1/mail/messages/msg-archive-fixtures/attachments/attachment-missing/inline-image",
    {
      data: { renderer: "inline-image" },
      headers: { origin, ...scopeHeaders },
    },
  );
  expect(inline.ok()).toBe(false);
  expect(inline.headers()["content-security-policy"]).toBe(
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
  );
  expect(inline.headers()["content-security-policy"]).not.toContain(
    "allow-same-origin",
  );
  expect(inline.headers()["cross-origin-resource-policy"]).toBe("same-origin");
  expect(inline.headers()["x-content-type-options"]).toBe("nosniff");
  expect(inline.headers()["referrer-policy"]).toBe("no-referrer");
});
