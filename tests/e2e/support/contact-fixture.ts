import { expect, test, type Page } from "@playwright/test";

import type {
  ContactBook,
  ContactPutOperation,
} from "../../../src/domain/member/contact";
import { mailSessionScopeHeaders, useInstalledMailbox } from "./mail-fixture";

export const contactEndpoint = "/api/v1/member/contacts";
export const testContactPrefix = "E2E contact workflow";

const readContactBook = async (page: Page): Promise<ContactBook> => {
  const response = await page.request.get(contactEndpoint, {
    headers: await mailSessionScopeHeaders(page),
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: ContactBook }).data;
};

const putContactBook = async (
  page: Page,
  operation: ContactPutOperation,
): Promise<ContactBook> => {
  const response = await page.request.put(contactEndpoint, {
    data: operation,
    headers: {
      origin: new URL(page.url()).origin,
      ...await mailSessionScopeHeaders(page),
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: ContactBook }).data;
};

const removeTestContacts = async (page: Page): Promise<void> => {
  let book = await readContactBook(page);
  for (const group of book.groups.filter(({ name }) =>
    name.startsWith(testContactPrefix),
  )) {
    book = await putContactBook(page, {
      expectedRevision: book.revision,
      groupId: group.id,
      operation: "delete-group",
    });
  }
  for (const contact of book.contacts.filter(({ name }) =>
    name.startsWith(testContactPrefix),
  )) {
    book = await putContactBook(page, {
      contactId: contact.id,
      expectedRevision: book.revision,
      operation: "delete-contact",
    });
  }
};

export const useIsolatedContactMailbox = (): void => {
  useInstalledMailbox();
  test.beforeEach(async ({ page }) => {
    await removeTestContacts(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Contacts" })).toBeEnabled();
  });
  test.afterEach(async ({ page }) => {
    if (!page.isClosed()) await removeTestContacts(page);
  });
};
