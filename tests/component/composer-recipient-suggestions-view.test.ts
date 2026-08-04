import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_RECIPIENT_SUGGESTIONS } from "@/presentation/features/mail-workspace/recipient-suggestions.view-model";
import { ComposerRecipientFieldView } from "@/presentation/features/mail-workspace/ui/composer-recipient-field.view";

describe("composer recipient suggestions", () => {
  it("distinguishes contacts and groups without auto-selecting", () => {
    const suggestions = {
      ...EMPTY_RECIPIENT_SUGGESTIONS.to,
      isOpen: true,
      suggestions: [
        {
          description: "ada@example.com",
          id: "contact:ada",
          kind: "contact" as const,
          label: "Ada Lovelace",
          replacement: '"Ada Lovelace" <ada@example.com>',
        },
        {
          description: "3 members",
          id: "group:engineering",
          kind: "group" as const,
          label: "Engineering",
          replacement: "ada@example.com, grace@example.com",
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(ComposerRecipientFieldView, {
      disabled: false,
      id: "composer-to",
      label: "To",
      onChange: vi.fn(),
      placeholder: "name@example.com",
      readOnly: false,
      suggestions,
      value: "ada",
    }));
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain("ada@example.com");
    expect(html).toContain("3 members");
    expect(html).not.toContain('aria-activedescendant="composer-to-suggestions-0"');
  });
});
