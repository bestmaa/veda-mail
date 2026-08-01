import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  reconcilePendingSelection,
  retainAvailableSelection,
  retainFailedSelection,
  selectLoadedMessages,
  toggleBulkSelection,
} from "@/presentation/features/mail-workspace/mail-bulk-selection";

const first = id.message("message-first");
const second = id.message("message-second");
const third = id.message("message-third");

describe("mail bulk selection", () => {
  it("toggles one message without mutating the previous selection", () => {
    const original = new Set([first]);
    const added = toggleBulkSelection(original, second);
    const removed = toggleBulkSelection(added, first);

    expect([...original]).toEqual([first]);
    expect([...added]).toEqual([first, second]);
    expect([...removed]).toEqual([second]);
  });

  it("selects only loaded messages and prunes messages no longer visible", () => {
    const selected = selectLoadedMessages([first, second, third]);
    const retained = retainAvailableSelection(
      selected,
      new Set([second, third]),
    );

    expect([...retained]).toEqual([second, third]);
  });

  it("preserves selection identity when every selected message is available", () => {
    const selected = selectLoadedMessages([first, second]);

    expect(retainAvailableSelection(selected, new Set([first, second, third])))
      .toBe(selected);
  });

  it("reconciles one operation without dropping older pending selections", () => {
    const pending = reconcilePendingSelection(
      new Set([first, second]),
      [second, third],
      [third],
    );

    expect([...pending]).toEqual([first, third]);
  });

  it("keeps only failed messages selected for an explicit retry", () => {
    const selected = new Set([first, second, third]);
    const retained = retainFailedSelection(selected, [second]);

    expect([...retained]).toEqual([second]);
  });
});
