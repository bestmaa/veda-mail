import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  imapLabelCapability,
  mutateImapLabel,
} from "@/infrastructure/providers/imap-smtp/imap-label-mutation";
import { ProviderMessageMutationRejectedError } from "@/infrastructure/providers/provider-message-mutation-error";

const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
const mutation = (value: boolean) => ({
  labelId,
  messageId: id.message("message-a"),
  type: "set-label" as const,
  value,
});
const client = (flags: readonly string[]) => ({
  fetchOne: vi.fn().mockResolvedValue({ flags: new Set(flags), uid: 42 }),
  messageFlagsAdd: vi.fn().mockResolvedValue(true),
  messageFlagsRemove: vi.fn().mockResolvedValue(true),
});

describe("IMAP label mutation", () => {
  it("keeps removal visible when a mailbox preserves an existing Veda label", () => {
    expect(imapLabelCapability(undefined)).toBe("supported");
    expect(imapLabelCapability(new Set(["\\Seen", "\\*"]))).toBe("supported");
    expect(imapLabelCapability(new Set(["\\Seen", labelId.toUpperCase()]))).toBe("supported");
    expect(imapLabelCapability(new Set(["\\Seen", "\\Flagged"]))).toBe("unsupported");
  });

  it("adds a keyword when PERMANENTFLAGS permits arbitrary keywords", async () => {
    const fixture = client([labelId]);
    await mutateImapLabel(
      fixture as never,
      { permanentFlags: new Set(["\\Seen", "\\*"]) } as never,
      42,
      mutation(true),
    );
    expect(fixture.messageFlagsAdd).toHaveBeenCalledWith(
      42, [labelId], { uid: true },
    );
  });

  it("rejects an unsupported new keyword before issuing STORE", async () => {
    const fixture = client([]);
    await expect(mutateImapLabel(
      fixture as never,
      { permanentFlags: new Set(["\\Seen", "\\Flagged"]) } as never,
      42,
      mutation(true),
    )).rejects.toThrow(/does not support custom labels/u);
    expect(fixture.messageFlagsAdd).not.toHaveBeenCalled();
  });

  it("classifies a persisted-state mismatch as a definite rejection", async () => {
    const fixture = client([]);

    await expect(mutateImapLabel(
      fixture as never,
      { permanentFlags: new Set(["\\*"]) } as never,
      42,
      mutation(true),
    )).rejects.toBeInstanceOf(ProviderMessageMutationRejectedError);
  });

  it("keeps a missing verification UID unconfirmed", async () => {
    const fixture = client([]);
    fixture.fetchOne.mockResolvedValue(false as never);

    const update = mutateImapLabel(
      fixture as never,
      { permanentFlags: new Set(["\\*"]) } as never,
      42,
      mutation(true),
    );
    await expect(update).rejects.toThrow(/did not confirm/u);
    await expect(update).rejects.not.toBeInstanceOf(
      ProviderMessageMutationRejectedError,
    );
  });

  it("allows removal but fails if the server does not confirm it", async () => {
    const fixture = client([labelId]);
    await expect(mutateImapLabel(
      fixture as never,
      { permanentFlags: new Set(["\\Seen"]) } as never,
      42,
      mutation(false),
    )).rejects.toThrow(/did not persist/u);
    expect(fixture.messageFlagsRemove).toHaveBeenCalled();
  });
});
