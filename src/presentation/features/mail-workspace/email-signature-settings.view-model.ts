import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";

import type { SignatureId } from "@/domain/shared/brand";
import type { RichComposerSnapshot } from "@/presentation/features/mail-workspace/hooks/use-composer-body";

export interface EmailSignatureSettingsListItem {
  readonly id: SignatureId;
  readonly isSelected: boolean;
  readonly name: string;
  readonly onSelect: () => void;
}

export interface EmailSignatureEditorViewModel {
  readonly body: string;
  readonly bodyInput: ChangeEventHandler<HTMLTextAreaElement>;
  readonly canDelete: boolean;
  readonly canDiscard: boolean;
  readonly canSave: boolean;
  readonly editorVersion: number;
  readonly htmlBody: string;
  readonly isNew: boolean;
  readonly mode: "plain" | "rich";
  readonly name: string;
  readonly nameInput: ChangeEventHandler<HTMLInputElement>;
  readonly onDelete: () => void;
  readonly onDiscard: () => void;
  readonly onRichChange: (snapshot: RichComposerSnapshot) => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly selectPlainMode: () => void;
  readonly selectRichMode: () => void;
}

export interface EmailSignatureDefaultsViewModel {
  readonly canDiscard: boolean;
  readonly canSave: boolean;
  readonly newMessageId: string;
  readonly newMessageInput: ChangeEventHandler<HTMLSelectElement>;
  readonly onDiscard: () => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly replyForwardId: string;
  readonly replyForwardInput: ChangeEventHandler<HTMLSelectElement>;
}

export interface EmailSignatureConfirmationViewModel {
  readonly description: string;
  readonly isOpen: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}

export interface EmailSignatureSettingsViewModel {
  readonly accountEmail: string;
  readonly canCreate: boolean;
  readonly create: () => void;
  readonly defaults: EmailSignatureDefaultsViewModel;
  readonly deleteConfirmation: EmailSignatureConfirmationViewModel;
  readonly discardAll: () => void;
  readonly editor: EmailSignatureEditorViewModel | null;
  readonly error: string | null;
  readonly hasUnsavedChanges: boolean;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly items: readonly EmailSignatureSettingsListItem[];
  readonly maximumSignatures: number;
  readonly modeConfirmation: EmailSignatureConfirmationViewModel;
  readonly retry: () => void;
  readonly status: string | null;
}
