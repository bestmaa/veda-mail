import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => {
      cursor = 0;
    },
    reset: () => {
      cursor = 0;
      initialized.clear();
      values.length = 0;
    },
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(
      initial: T | (() => T),
    ): readonly [T, (next: T | ((current: T) => T)) => void] => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [
        values[index] as T,
        (next) => {
          values[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(values[index] as T)
              : next;
        },
      ];
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T): T => factory(),
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("window", {
    cancelAnimationFrame: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
  });
});

describe("provider draft HTML preservation", () => {
  it("keeps a loaded plain-looking HTML alternative until plain mode is chosen", () => {
    const render = () => {
      hooks.begin();
      return useComposerBody(false);
    };

    let body = render();
    body.loadSavedDraft({ body: "Saved body", htmlBody: "<p>Saved body</p>" });
    body = render();

    expect(body.payload).toEqual({
      body: "Saved body",
      htmlBody: "<p>Saved body</p>",
    });

    body.onToggleMode();
    body = render();
    expect(body.mode).toBe("plain");
    expect(body.payload).toEqual({ body: "Saved body" });

    body.onToggleMode();
    body = render();
    expect(body.mode).toBe("rich");
    expect(body.payload).toEqual({ body: "Saved body" });
  });
});
