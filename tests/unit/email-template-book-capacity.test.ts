import { describe, expect, it } from "vitest";

import type {
  EmailTemplate,
  EmailTemplateBook,
} from "@/domain/member/email-template";
import { id } from "@/domain/shared/brand";
import { updateEmailTemplateBook } from "@/server/templates/email-template-book";

const timestamp = "2026-08-02T00:00:00.000Z";
const text = "a".repeat(63_000);
const content = {
  body: text,
  htmlBody: `<p>${text}</p>`,
  subject: "Large reusable content",
};

const template = (index: number): EmailTemplate => ({
  ...content,
  createdAt: timestamp,
  id: id.template(crypto.randomUUID()),
  name: `Large template ${index}`,
  updatedAt: timestamp,
  version: 1,
});

describe("email template book capacity", () => {
  it("treats compatibility-equivalent names as the same template name", () => {
    const current: EmailTemplateBook = {
      createdAt: timestamp,
      revision: "11111111-1111-4111-8111-111111111111",
      templates: [{ ...template(1), name: "Ｔｅａｍ" }],
      updatedAt: timestamp,
      version: 1,
    };
    expect(() => updateEmailTemplateBook(current, {
      content: { body: "Hello", mode: "plain", subject: "" },
      expectedRevision: current.revision,
      name: "team",
      operation: "create",
    }, { body: "Hello", subject: "" })).toThrowError(
      expect.objectContaining({ code: "TEMPLATE_NAME_CONFLICT", status: 422 }),
    );
  });

  it("reports owner storage exhaustion as a stable client error", () => {
    const current: EmailTemplateBook = {
      createdAt: timestamp,
      revision: "11111111-1111-4111-8111-111111111111",
      templates: Array.from({ length: 33 }, (_, index) => template(index)),
      updatedAt: timestamp,
      version: 1,
    };

    expect(() =>
      updateEmailTemplateBook(
        current,
        {
          content: {
            htmlBody: content.htmlBody,
            mode: "rich",
            subject: content.subject,
          },
          expectedRevision: current.revision,
          name: "Overflow",
          operation: "create",
        },
        content,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "TEMPLATE_STORAGE_LIMIT_REACHED",
        status: 422,
      }),
    );
  });
});
