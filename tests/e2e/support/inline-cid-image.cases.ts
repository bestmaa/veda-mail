import { expect, test } from "@playwright/test";

const inlineImagePath =
  "/api/v1/mail/messages/msg-inline-image/attachments/attachment-inline-logo/inline-image";

export const registerInlineCidImageCases = (): void => {
test("renders a verified CID image through the isolated WebP pipeline", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(`**${inlineImagePath}`, async (route) => {
    attempts += 1;
    if (attempts <= 2) {
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code:
              attempts === 1
                ? "INLINE_IMAGE_BUSY"
                : "INLINE_IMAGE_SCANNER_UNAVAILABLE",
            message:
              attempts === 1
                ? "Inline image capacity is busy."
                : "Inline image processing is unavailable.",
          },
        }),
        contentType: "application/json",
        headers: { "retry-after": "0" },
        status: attempts === 1 ? 429 : 503,
      });
      return;
    }
    await route.fallback();
  });
  const inlineResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.status() === 200 &&
      response.url().endsWith(inlineImagePath),
  );

  await page
    .getByRole("button", { name: "Open Secure embedded image example" })
    .click();

  const response = await inlineResponse;
  expect(attempts).toBe(3);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["cross-origin-resource-policy"]).toBe(
    "same-origin",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  const messageFrame = page.getByTitle("Email content");
  await expect(messageFrame).toHaveAttribute(
    "sandbox",
    "allow-popups allow-popups-to-escape-sandbox allow-scripts",
  );
  const image = messageFrame
    .contentFrame()
    .getByRole("img", { name: "Embedded Veda logo" });
  await expect(image).toHaveAttribute("src", /^blob:/u);
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          element instanceof HTMLImageElement
            ? [element.complete, element.naturalWidth, element.naturalHeight]
            : [],
      ),
    )
    .toEqual([true, 1, 1]);
  await expect(page.getByText("inline-logo.png", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Download all attachments" }),
  ).toHaveCount(0);
});

test("offers a failed-image-only manual retry after transient exhaustion", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(`**${inlineImagePath}`, async (route) => {
    attempts += 1;
    if (attempts <= 3) {
      await route.fulfill({
        body: JSON.stringify({
          error: {
            code: "INLINE_IMAGE_SCANNER_UNAVAILABLE",
            message: "Inline image processing is unavailable.",
          },
        }),
        contentType: "application/json",
        headers: { "retry-after": "0" },
        status: 503,
      });
      return;
    }
    await route.fallback();
  });

  await page
    .getByRole("button", { name: "Open Secure embedded image example" })
    .click();

  await expect.poll(() => attempts).toBe(3);
  const image = page
    .getByTitle("Email content")
    .contentFrame()
    .getByRole("img", { name: "Embedded Veda logo" });
  await expect(image).toHaveAttribute("alt", "Embedded Veda logo");
  expect(await image.getAttribute("src")).toBeNull();

  const retry = page.getByRole("button", {
    name: "Retry embedded images",
  });
  await expect(retry).toBeVisible();
  const inlineResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.status() === 200 &&
      response.url().endsWith(inlineImagePath),
  );

  await retry.click();

  expect((await inlineResponse).status()).toBe(200);
  await expect.poll(() => attempts).toBe(4);
  await expect(image).toHaveAttribute("src", /^blob:/u);
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          element instanceof HTMLImageElement
            ? [element.complete, element.naturalWidth, element.naturalHeight]
            : [],
      ),
    )
    .toEqual([true, 1, 1]);
  await expect(retry).toHaveCount(0);
});
};
