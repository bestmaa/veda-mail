import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MailSearchFiltersView } from "@/presentation/features/mail-workspace/ui/mail-search-filters.view";

describe("mail search filters view", () => {
  it("renders removable filters and a safe syntax error", () => {
    const html = renderToStaticMarkup(createElement(MailSearchFiltersView, {
      search: {
        error: "Search dates must use YYYY-MM-DD.",
        filters: [{
          id: "0:from:ada@example.com",
          label: "from:ada@example.com",
          onRemove: vi.fn(),
        }],
        saved: { canSave: false, error: null, isLoading: false,
          isSaving: false, items: [], name: "", onNameChange: vi.fn(),
          onSave: vi.fn() },
        suggestions: [],
      },
    }));

    expect(html).toContain('aria-label="Active search filters"');
    expect(html).toContain('aria-label="Remove search filter from:ada@example.com"');
    expect(html).toContain('id="mail-search-error"');
    expect(html).toContain("Search dates must use YYYY-MM-DD.");
  });
});
