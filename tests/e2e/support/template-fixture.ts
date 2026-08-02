import { expect, test, type Page } from "@playwright/test";

import type {
  EmailTemplate,
  EmailTemplateBook,
  EmailTemplateContentInput,
  EmailTemplatePutOperation,
} from "../../../src/domain/member/email-template";
import { mailSessionScopeHeaders, useInstalledMailbox } from "./mail-fixture";

export const templateEndpoint = "/api/v1/member/templates";
export const testTemplatePrefix = "E2E template workflow";

const readTemplateBook = async (page: Page): Promise<EmailTemplateBook> => {
  const response = await page.request.get(templateEndpoint, {
    headers: await mailSessionScopeHeaders(page),
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: EmailTemplateBook }).data;
};

const putTemplateBook = async (
  page: Page,
  operation: EmailTemplatePutOperation,
): Promise<EmailTemplateBook> => {
  const response = await page.request.put(templateEndpoint, {
    data: operation,
    headers: {
      origin: new URL(page.url()).origin,
      ...await mailSessionScopeHeaders(page),
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: EmailTemplateBook }).data;
};

export const createTemplate = async (
  page: Page,
  name: string,
  content: EmailTemplateContentInput,
): Promise<EmailTemplate> => {
  const current = await readTemplateBook(page);
  const previousIds = new Set(current.templates.map(({ id }) => id));
  const book = await putTemplateBook(page, {
    content,
    expectedRevision: current.revision,
    name,
    operation: "create",
  });
  const template = book.templates.find(({ id }) => !previousIds.has(id));
  expect(template).toBeDefined();
  if (!template) throw new Error("The seeded template was not returned.");
  return template;
};

const removeTestTemplates = async (page: Page): Promise<void> => {
  let book = await readTemplateBook(page);
  for (const template of book.templates.filter(({ name }) =>
    name.startsWith(testTemplatePrefix),
  )) {
    book = await putTemplateBook(page, {
      expectedRevision: book.revision,
      operation: "delete",
      templateId: template.id,
    });
  }
};

export const useIsolatedTemplateMailbox = (): void => {
  useInstalledMailbox();
  test.beforeEach(async ({ page }) => {
    await removeTestTemplates(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "New message" })).toBeEnabled();
  });
  test.afterEach(async ({ page }) => {
    if (!page.isClosed()) await removeTestTemplates(page);
  });
};
