import type { ChangeEventHandler } from "react";

import type { SignatureId } from "@/domain/shared/brand";
import type {
  ComposerSignatureInitialContentPlacement,
  ComposerSignatureOption,
} from "@/presentation/features/mail-workspace/composer-signature-editor";

export interface ComposerSignaturePickerViewModel {
  readonly disabled: boolean;
  readonly onChange: ChangeEventHandler<HTMLSelectElement>;
  readonly options: readonly ComposerSignatureOption[];
  readonly selectedId: SignatureId | null;
}

export interface ComposerSignatureEditorConfiguration {
  readonly clearSelectionOnUnmount?: boolean;
  readonly initialContentPlacement: ComposerSignatureInitialContentPlacement;
  readonly onSelectedIdChange: (signatureId: SignatureId | null) => void;
  readonly options: readonly ComposerSignatureOption[];
  readonly selectedId: SignatureId | null;
}
