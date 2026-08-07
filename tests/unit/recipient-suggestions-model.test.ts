import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useMemo: <T,>(factory: () => T): T => factory(),
  useState: <T,>(initial: T): [T, (next: T) => void] => [initial, vi.fn()],
}));

import { useRecipientSuggestionsModel } from "@/presentation/features/mail-workspace/hooks/use-recipient-suggestions-model";

describe("recipient suggestion keyboard behavior", () => {
  it("keeps Enter inside the recipient field instead of submitting composer", () => {
    const preventDefault = vi.fn();
    const composer = {
      bcc: "", cc: "", setRecipientField: vi.fn(), to: "person@example.com",
    };
    const suggestions = useRecipientSuggestionsModel(null, composer);

    suggestions.to.onKeyDown({ key: "Enter", preventDefault } as never);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(composer.setRecipientField).not.toHaveBeenCalled();
  });
});
