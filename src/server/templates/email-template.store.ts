import "server-only";

import {
  type EmailTemplateBook,
  type EmailTemplateCanonicalContent,
  type EmailTemplateOwner,
  type EmailTemplatePutOperation,
} from "@/domain/member/email-template";
import { installationStore } from "@/server/installation/installation.store";
import { updateEmailTemplateBook } from "@/server/templates/email-template-book";
import { canonicalizeEmailTemplateContent } from "@/server/templates/email-template-content";
import {
  decryptEmailTemplateBook,
  emailTemplateOwnerKey,
  encryptEmailTemplateBook,
} from "@/server/templates/email-template-crypto";
import {
  readEmailTemplateFile,
  writeEmailTemplateFile,
} from "@/server/templates/email-template-file";
import {
  emptyEmailTemplateBook,
  MAX_EMAIL_TEMPLATE_OWNERS,
  type StoredEmailTemplateBook,
} from "@/server/templates/email-template-record";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailEmailTemplateQueue?: Promise<void>;
};
globalState.__vedaMailEmailTemplateQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailEmailTemplateQueue!.then(task, task);
  globalState.__vedaMailEmailTemplateQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const storeUnavailable = (): never => {
  throw new ApiError(
    "Email templates are temporarily unavailable.",
    "TEMPLATE_STORE_UNAVAILABLE",
    500,
  );
};

const secret = async (): Promise<string> => {
  let installation;
  try {
    installation = await installationStore.get();
  } catch {
    return storeUnavailable();
  }
  if (!installation) {
    throw new ApiError(
      "Complete setup before managing templates.",
      "SETUP_REQUIRED",
      503,
    );
  }
  return installation.sessionSecret;
};

const conflict = (): never => {
  throw new ApiError(
    "Templates changed in another session. Reload and try again.",
    "TEMPLATE_BOOK_CONFLICT",
    409,
  );
};

const currentBook = async (owner: EmailTemplateOwner, sessionSecret: string) => {
  try {
    const file = await readEmailTemplateFile();
    const ownerKey = emailTemplateOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return {
      book: encrypted
        ? decryptEmailTemplateBook(encrypted, ownerKey, sessionSecret)
        : emptyEmailTemplateBook(),
      file,
      ownerKey,
    };
  } catch {
    return storeUnavailable();
  }
};

const assertRevision = (
  book: EmailTemplateBook,
  expected: string | null,
): void => {
  if (book.revision !== expected) conflict();
};

const canonicalContent = (
  operation: EmailTemplatePutOperation,
): EmailTemplateCanonicalContent | null =>
  operation.operation === "create" || operation.operation === "update"
    ? canonicalizeEmailTemplateContent(operation.content)
    : null;

const assertOwnerCapacity = (
  owners: Readonly<Record<string, unknown>>,
  ownerKey: string,
): void => {
  if (
    owners[ownerKey] === undefined &&
    Object.keys(owners).length >= MAX_EMAIL_TEMPLATE_OWNERS
  ) {
    throw new ApiError(
      "The installation cannot store another template owner.",
      "TEMPLATE_OWNER_LIMIT_REACHED",
      507,
    );
  }
};

export const emailTemplateStore = {
  async get(owner: EmailTemplateOwner): Promise<EmailTemplateBook> {
    const sessionSecret = await secret();
    return (await currentBook(owner, sessionSecret)).book;
  },

  async put(
    owner: EmailTemplateOwner,
    operation: EmailTemplatePutOperation,
  ): Promise<EmailTemplateBook> {
    const content = canonicalContent(operation);
    return serialized(async () => {
      const sessionSecret = await secret();
      const current = await currentBook(owner, sessionSecret);
      assertRevision(current.book, operation.expectedRevision);
      assertOwnerCapacity(current.file.owners, current.ownerKey);
      let updated: StoredEmailTemplateBook;
      try {
        updated = updateEmailTemplateBook(current.book, operation, content);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        return storeUnavailable();
      }
      try {
        const owners = { ...current.file.owners };
        if (updated.templates.length === 0) {
          delete owners[current.ownerKey];
        } else {
          owners[current.ownerKey] = encryptEmailTemplateBook(
            updated,
            current.ownerKey,
            sessionSecret,
          );
        }
        await writeEmailTemplateFile({
          ...current.file,
          owners,
          updatedAt: updated.updatedAt,
        });
      } catch {
        return storeUnavailable();
      }
      return updated.templates.length === 0
        ? emptyEmailTemplateBook()
        : updated;
    });
  },
};
