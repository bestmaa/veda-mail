"use client";

import type { ComposerSignatureEditorConfiguration } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";
import { ComposerSignatureConnector } from "@/presentation/features/mail-workspace/connectors/composer-signature.connector";
import { useComposerSignaturePicker } from "@/presentation/features/mail-workspace/hooks/use-composer-signature-picker";
import { ComposerSignaturePickerView } from "@/presentation/features/mail-workspace/ui/composer-signature-picker.view";

export const ComposerSignatureControlsConnector = ({
  configuration,
  disabled,
}: {
  readonly configuration: ComposerSignatureEditorConfiguration;
  readonly disabled: boolean;
}) => {
  const picker = useComposerSignaturePicker(
    configuration.options,
    configuration.selectedId,
    configuration.onSelectedIdChange,
    disabled,
  );
  const selected =
    configuration.options.find(
      (signature) => signature.id === picker.selectedId,
    ) ?? null;

  return (
    <>
      <div className="flex min-h-10 items-center border-b border-slate-100 px-2">
        <ComposerSignaturePickerView picker={picker} />
      </div>
      <ComposerSignatureConnector
        clearSelectionOnUnmount={
          configuration.clearSelectionOnUnmount ?? true
        }
        onSelectedIdChange={configuration.onSelectedIdChange}
        selected={selected}
      />
    </>
  );
};
