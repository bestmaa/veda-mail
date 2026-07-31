import type { SignatureId } from "@/domain/shared/brand";

export const clearAttachedComposerSignatureSelection = (
  attachedId: SignatureId | string | null | undefined,
  onSelectedIdChange: (signatureId: SignatureId | null) => void,
): void => {
  if (attachedId !== null && attachedId !== undefined) {
    onSelectedIdChange(null);
  }
};
