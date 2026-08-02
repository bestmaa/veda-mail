import { describe, expect, it, vi } from "vitest";

import {
  adjacentMessageIndex,
  isEditableShortcutTarget,
  mailboxShortcutKey,
} from "@/presentation/features/mail-workspace/keyboard-shortcut-policy";

const keyboardEvent = (
  key: string,
  options: Partial<KeyboardEvent> = {},
): KeyboardEvent => ({
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  key,
  metaKey: false,
  repeat: false,
  shiftKey: false,
  target: null,
  ...options,
}) as KeyboardEvent;

describe("mailbox keyboard shortcut policy", () => {
  it("normalizes allowed single keys and Escape", () => {
    expect(mailboxShortcutKey(keyboardEvent("C"))).toBe("c");
    expect(mailboxShortcutKey(keyboardEvent("Escape"))).toBe("escape");
    expect(mailboxShortcutKey(keyboardEvent("?", { shiftKey: true }))).toBe("?");
  });

  it("rejects repeat, modified, prevented, and non-guide shifted keys", () => {
    expect(mailboxShortcutKey(keyboardEvent("c", { repeat: true }))).toBeNull();
    expect(mailboxShortcutKey(keyboardEvent("c", { ctrlKey: true }))).toBeNull();
    expect(mailboxShortcutKey(keyboardEvent("c", { altKey: true }))).toBeNull();
    expect(mailboxShortcutKey(keyboardEvent("c", { metaKey: true }))).toBeNull();
    expect(mailboxShortcutKey(keyboardEvent("C", { shiftKey: true }))).toBeNull();
    expect(mailboxShortcutKey(keyboardEvent("c", { defaultPrevented: true })))
      .toBeNull();
  });

  it("rejects targets inside every editable surface", () => {
    const editable = { closest: vi.fn(() => ({ tagName: "INPUT" })) };
    const inert = { closest: vi.fn(() => null) };
    expect(isEditableShortcutTarget(editable as never)).toBe(true);
    expect(isEditableShortcutTarget(inert as never)).toBe(false);
    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(mailboxShortcutKey(keyboardEvent("c", { target: editable as never })))
      .toBeNull();
    expect(editable.closest).toHaveBeenCalledWith(expect.stringContaining("input"));
  });

  it("traverses loaded messages without wrapping or repeating boundaries", () => {
    const ids = ["first", "middle", "last"];
    expect(adjacentMessageIndex(ids, null, "next")).toBe(0);
    expect(adjacentMessageIndex(ids, null, "previous")).toBe(2);
    expect(adjacentMessageIndex(ids, "middle", "next")).toBe(2);
    expect(adjacentMessageIndex(ids, "middle", "previous")).toBe(0);
    expect(adjacentMessageIndex(ids, "last", "next")).toBeNull();
    expect(adjacentMessageIndex(ids, "first", "previous")).toBeNull();
    expect(adjacentMessageIndex([], null, "next")).toBeNull();
  });
});
