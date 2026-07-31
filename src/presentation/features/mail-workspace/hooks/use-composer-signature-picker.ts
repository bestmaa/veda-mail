"use client";

import { useCallback, type ChangeEventHandler } from "react";

import type { SignatureId } from "@/domain/shared/brand";
import type { ComposerSignatureOption } from "@/presentation/features/mail-workspace/composer-signature-editor";
import type { ComposerSignaturePickerViewModel } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";

export const useComposerSignaturePicker = (
  options: readonly ComposerSignatureOption[],
  selectedId: SignatureId | null,
  onSelect: (signatureId: SignatureId | null) => void,
  disabled = false,
): ComposerSignaturePickerViewModel => {
  const onChange: ChangeEventHandler<HTMLSelectElement> = useCallback(
    (event) => {
      const value = event.target.value;
      if (!value) {
        onSelect(null);
        return;
      }
      const selected = options.find((signature) => signature.id === value);
      onSelect(selected?.id ?? null);
    },
    [onSelect, options],
  );

  const normalizedId =
    options.find((signature) => signature.id === selectedId)?.id ?? null;
  return { disabled, onChange, options, selectedId: normalizedId };
};
