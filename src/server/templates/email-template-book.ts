import "server-only";

import {
  type EmailTemplateBook,
  type EmailTemplateCanonicalContent,
  type EmailTemplatePutOperation,
  emailTemplateNameKey,
  MAX_EMAIL_TEMPLATE_BOOK_UTF8_BYTES,
  MAX_EMAIL_TEMPLATES,
} from "@/domain/member/email-template";
import { outgoingContentUtf8Bytes } from "@/domain/mail/outgoing-content-policy";
import { id, type TemplateId } from "@/domain/shared/brand";
import {
  parseStoredEmailTemplateBook,
  type StoredEmailTemplateBook,
} from "@/server/templates/email-template-record";
import { ApiError } from "@/transport/http/api-error";

const notFound = (): never => {
  throw new ApiError("The template was not found.", "TEMPLATE_NOT_FOUND", 404);
};

const locate = (book: EmailTemplateBook, templateId: TemplateId): number => {
  const index = book.templates.findIndex(
    (template) => template.id === templateId,
  );
  return index < 0 ? notFound() : index;
};

const assertUniqueName = (
  book: EmailTemplateBook,
  name: string,
  excluding?: TemplateId,
): void => {
  const normalized = emailTemplateNameKey(name);
  if (
    book.templates.some(
      (template) =>
        template.id !== excluding &&
        emailTemplateNameKey(template.name) === normalized,
    )
  ) {
    throw new ApiError(
      "Each template must have a unique name.",
      "TEMPLATE_NAME_CONFLICT",
      422,
    );
  }
};

const requiredContent = (
  content: EmailTemplateCanonicalContent | null,
): EmailTemplateCanonicalContent => {
  if (!content) throw new Error("Canonical template content is required.");
  return content;
};

export const updateEmailTemplateBook = (
  current: EmailTemplateBook,
  operation: EmailTemplatePutOperation,
  content: EmailTemplateCanonicalContent | null,
): StoredEmailTemplateBook => {
  const now = new Date().toISOString();
  let templates = [...current.templates];
  if (operation.operation === "create") {
    assertUniqueName(current, operation.name);
    if (templates.length >= MAX_EMAIL_TEMPLATES) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_EMAIL_TEMPLATES} templates.`,
        "TEMPLATE_LIMIT_REACHED",
        422,
      );
    }
    templates.push({
      ...requiredContent(content),
      createdAt: now,
      id: id.template(crypto.randomUUID()),
      name: operation.name,
      updatedAt: now,
      version: 1,
    });
  } else if (operation.operation === "update") {
    assertUniqueName(current, operation.name, operation.templateId);
    const index = locate(current, operation.templateId);
    const existing = templates[index]!;
    templates[index] = {
      ...requiredContent(content),
      createdAt: existing.createdAt,
      id: existing.id,
      name: operation.name,
      updatedAt: now,
      version: 1,
    };
  } else {
    locate(current, operation.templateId);
    templates = templates.filter(({ id: value }) => value !== operation.templateId);
  }
  const next = {
    createdAt: current.createdAt ?? now,
    revision: crypto.randomUUID(),
    templates,
    updatedAt: now,
    version: 1 as const,
  };
  if (
    outgoingContentUtf8Bytes(JSON.stringify(next)) >
    MAX_EMAIL_TEMPLATE_BOOK_UTF8_BYTES
  ) {
    throw new ApiError(
      "The template collection exceeds its safe storage limit.",
      "TEMPLATE_STORAGE_LIMIT_REACHED",
      422,
    );
  }
  return parseStoredEmailTemplateBook(next);
};
