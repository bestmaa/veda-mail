import type { FormEventHandler } from "react";

import type {
  MessageListDensity,
  MessageListPreferences,
  MessageListSort,
} from "@/domain/mail/message-list-preferences";

export interface MessageListPreferencesViewModel {
  readonly announcement: string;
  readonly density: MessageListDensity;
  readonly dialog: {
    readonly density: MessageListDensity;
    readonly error: string | null;
    readonly isDirty: boolean;
    readonly isOpen: boolean;
    readonly isSaving: boolean;
    readonly onClose: () => void;
    readonly onDensityChange: (density: MessageListDensity) => void;
    readonly onPreviewChange: (showPreview: boolean) => void;
    readonly onSortChange: (sort: MessageListSort) => void;
    readonly onSubmit: FormEventHandler<HTMLFormElement>;
    readonly showPreview: boolean;
    readonly sort: MessageListSort;
  };
  readonly onOpen: () => void;
  readonly showPreview: boolean;
  readonly sort: MessageListSort;
}

export type SaveMessageListPreferences = (
  preferences: MessageListPreferences,
) => Promise<MessageListPreferences>;
