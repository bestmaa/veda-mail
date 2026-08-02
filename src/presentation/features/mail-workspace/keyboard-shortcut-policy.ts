const editableSelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='textbox']",
  "[role='combobox']",
].join(",");

export const isEditableShortcutTarget = (target: EventTarget | null): boolean => {
  const candidate = target as { closest?: (selector: string) => Element | null } | null;
  return typeof candidate?.closest === "function" &&
    Boolean(candidate.closest(editableSelector));
};

export const hasOpenModalDialog = (): boolean =>
  Boolean(document.querySelector(
    '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
  ));

export const adjacentMessageIndex = (
  messageIds: readonly string[],
  currentId: string | null,
  direction: "next" | "previous",
): number | null => {
  if (messageIds.length === 0) return null;
  const current = messageIds.indexOf(currentId ?? "");
  const adjacent = direction === "next"
    ? Math.min(current < 0 ? 0 : current + 1, messageIds.length - 1)
    : Math.max(current < 0 ? messageIds.length - 1 : current - 1, 0);
  return adjacent === current ? null : adjacent;
};

export const mailboxShortcutKey = (event: KeyboardEvent): string | null => {
  if (
    event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey ||
    event.metaKey || isEditableShortcutTarget(event.target)
  ) return null;
  if (event.shiftKey && event.key !== "?") return null;
  return event.key.toLowerCase();
};
