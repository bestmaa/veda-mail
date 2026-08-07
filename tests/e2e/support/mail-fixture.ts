import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const origin = "http://127.0.0.1:3101";
const setupToken = "playwright-setup-token-1234567890";

export const expectNoSeriousAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = results.violations
    .filter(({ impact }) => impact === "critical" || impact === "serious")
    .map(({ help, id, nodes }) => ({
      help,
      id,
      nodes: nodes.map((node) => ({
        html: node.html,
        target: node.target,
      })),
    }));
  expect(violations).toEqual([]);
};

export const expectNoWcagAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map(({ help, id, impact, nodes }) => ({
    help,
    id,
    impact,
    nodes: nodes.map((node) => ({ html: node.html, target: node.target })),
  }))).toEqual([]);
};

export const installApplication = async (request: APIRequestContext) => {
  const status = await request.get("/api/v1/setup");
  expect(status.ok()).toBe(true);
  const payload = (await status.json()) as {
    readonly data: { readonly installationRequired: boolean };
  };
  if (!payload.data.installationRequired) return;

  const response = await request.post("/api/v1/setup", {
    headers: { origin },
    multipart: {
      accentColor: "#ff785a",
      adminPassword: "Playwright123456",
      adminUsername: "playwright-admin",
      allowedDomains: "example.com",
      organizationName: "Veda Concepts",
      primaryColor: "#292c68",
      productName: "Veda Mail",
      providerConfig: "{}",
      providerDisplayName: "Demo workspace",
      providerId: "mock",
      publicRepositoryUrl: "https://github.com/bestmaa/veda-mail",
      setupToken,
    },
  });
  expect(response.status()).toBe(201);
};

export const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("member@example.com");
  await page.getByLabel("Password").fill("local-test-password");
  await page.getByRole("button", { name: "Open mailbox" }).click();
  await expect(page.getByRole("button", { name: "New message" })).toBeEnabled({
    timeout: 20_000,
  });
};

export const mailSessionScopeHeaders = async (
  page: Page,
): Promise<Readonly<Record<string, string>>> => {
  const response = await page.request.get("/api/v1/mail/workspace");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as {
    readonly data: { readonly sessionScope: string };
  };
  expect(payload.data.sessionScope).toBeTruthy();
  return { "x-veda-mail-session-scope": payload.data.sessionScope };
};

export const disableProviderDrafts = async (page: Page) => {
  await page.route("**/api/v1/mail/workspace*", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      data: { draftCapability: { status: string } };
    };
    payload.data.draftCapability = { status: "unsupported" };
    try {
      await route.fulfill({ json: payload, response });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("Route is already handled")
      ) {
        throw error;
      }
    }
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "New message" })).toBeEnabled();
};

export const useInstalledMailbox = () => {
  let authentication: Awaited<ReturnType<BrowserContext["storageState"]>>;

  test.beforeAll(async ({ baseURL, browser, request }) => {
    await installApplication(request);
    const context = await browser.newContext({
      baseURL: baseURL ?? origin,
    });
    try {
      const page = await context.newPage();
      await signIn(page);
      authentication = await context.storageState();
    } finally {
      await context.close();
    }
  });
  test.beforeEach(async ({ context, page }) => {
    await context.addCookies(authentication.cookies);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "New message" }),
    ).toBeEnabled();
  });
};

export const sendComposer = async (page: Page) => {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      candidate.url().endsWith("/api/v1/mail/send"),
  );
  await page.getByRole("button", { name: /^Send$/ }).click();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByRole("dialog", { name: "Compose message" }),
  ).toBeHidden();
};
