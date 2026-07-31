import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { ComposerSignaturePickerView } from "@/presentation/features/mail-workspace/ui/composer-signature-picker.view";

describe("composer signature picker", () => {
  it("offers None and escaped named signatures with the exact selection", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerSignaturePickerView, {
        picker: {
          disabled: false,
          onChange: vi.fn(),
          options: [
            {
              body: "Ada",
              id: id.signature("work"),
              name: "Work & Support",
            },
            {
              body: "A. Lovelace",
              id: id.signature("personal"),
              name: "Personal",
            },
          ],
          selectedId: id.signature("work"),
        },
      }),
    );

    expect(html).toContain('aria-label="Email signature"');
    expect(html).toContain('<option value="">None</option>');
    expect(html).toContain(
      '<option value="work" selected="">Work &amp; Support</option>',
    );
    expect(html).toContain('<option value="personal">Personal</option>');
  });

  it("locks the picker with the rest of the sending composer", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerSignaturePickerView, {
        picker: {
          disabled: true,
          onChange: vi.fn(),
          options: [],
          selectedId: null,
        },
      }),
    );

    expect(html).toContain("disabled");
  });
});
