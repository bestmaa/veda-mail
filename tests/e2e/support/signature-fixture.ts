import { expect, test, type Page } from "@playwright/test";

import type {
  EmailSignature,
  EmailSignatureBook,
  EmailSignaturePutOperation,
} from "../../../src/domain/member/email-signature";
import { useInstalledMailbox } from "./mail-fixture";

export const signatureEndpoint = "/api/v1/member/signatures";
export const testSignaturePrefix = "E2E signature workflow";
export const signatureAttribute = "data-veda-signature-id";

export const readSignatureBook = async (
  page: Page,
): Promise<EmailSignatureBook> => {
  const response = await page.request.get(signatureEndpoint);
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: EmailSignatureBook }).data;
};

const putSignatureBook = async (
  page: Page,
  operation: EmailSignaturePutOperation,
): Promise<EmailSignatureBook> => {
  const response = await page.request.put(signatureEndpoint, {
    data: operation,
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { data: EmailSignatureBook }).data;
};

export const createRichSignature = async (
  page: Page,
  name: string,
  text: string,
): Promise<{ book: EmailSignatureBook; signature: EmailSignature }> => {
  const current = await readSignatureBook(page);
  const previousIds = new Set(current.signatures.map(({ id }) => id));
  const book = await putSignatureBook(page, {
    content: { htmlBody: `<p><strong>${text}</strong></p>`, mode: "rich" },
    expectedRevision: current.revision,
    name,
    operation: "create",
  });
  const signature = book.signatures.find(({ id }) => !previousIds.has(id));
  expect(signature).toBeDefined();
  if (!signature) throw new Error("The seeded signature was not returned.");
  return { book, signature };
};

export const saveSignatureDefaults = (
  page: Page,
  book: EmailSignatureBook,
  newMessageId: EmailSignature["id"] | null,
  replyForwardId: EmailSignature["id"] | null,
) =>
  putSignatureBook(page, {
    expectedRevision: book.revision,
    newMessageId,
    operation: "set-defaults",
    replyForwardId,
  });

const removeTestSignatures = async (page: Page): Promise<void> => {
  let book = await readSignatureBook(page);
  for (const signature of book.signatures.filter(({ name }) =>
    name.startsWith(testSignaturePrefix),
  )) {
    book = await putSignatureBook(page, {
      expectedRevision: book.revision,
      operation: "delete",
      signatureId: signature.id,
    });
  }
};

export const reloadMailbox = async (page: Page): Promise<void> => {
  await page.reload();
  await expect(
    page.getByRole("button", { name: "New message" }),
  ).toBeVisible();
};

export const openSignatureSettings = async (page: Page) => {
  await page.getByRole("button", { name: /Open account settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(
    dialog.getByRole("heading", { name: "Email signatures" }),
  ).toBeVisible();
  return dialog;
};

export const occurrences = (value: string, needle: string): number =>
  value.split(needle).length - 1;

export const useIsolatedSignatureMailbox = (): void => {
  useInstalledMailbox();
  test.beforeEach(async ({ page }) => {
    await removeTestSignatures(page);
    await reloadMailbox(page);
  });
  test.afterEach(async ({ page }) => {
    if (!page.isClosed()) await removeTestSignatures(page);
  });
};
