import type {
  ChangeEventHandler,
  FormEventHandler,
} from "react";

import type {
  Contact,
  ContactBook,
  ContactEmail,
  ContactGroup,
} from "@/domain/member/contact";
import type { ContactId } from "@/domain/shared/brand";

export type ContactSection = "contacts" | "groups" | "recents";

export interface ContactEditorViewModel {
  readonly addEmail: () => void;
  readonly emails: readonly ContactEmail[];
  readonly isOpen: boolean;
  readonly name: string;
  readonly onCancel: () => void;
  readonly onNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly removeEmail: (index: number) => void;
  readonly title: string;
  readonly updateEmail: (
    index: number,
    field: "email" | "label",
    value: string,
  ) => void;
}

export interface ContactGroupEditorViewModel {
  readonly contactIds: readonly ContactId[];
  readonly isOpen: boolean;
  readonly name: string;
  readonly onCancel: () => void;
  readonly onNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly title: string;
  readonly toggleContact: (contactId: ContactId) => void;
}

export interface ContactVCardTransferViewModel {
  readonly error: string | null;
  readonly isExporting: boolean;
  readonly isImporting: boolean;
  readonly onExport: () => void;
  readonly onImportFile: ChangeEventHandler<HTMLInputElement>;
}

export interface ContactManagementViewModel {
  readonly book: ContactBook | null;
  readonly close: () => void;
  readonly contactEditor: ContactEditorViewModel;
  readonly deleteConfirmation: {
    readonly description: string;
    readonly isOpen: boolean;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  };
  readonly error: string | null;
  readonly groupEditor: ContactGroupEditorViewModel;
  readonly hasConflict: boolean;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly isSaving: boolean;
  readonly onClearRecents: () => void;
  readonly onCreateContact: () => void;
  readonly onCreateGroup: () => void;
  readonly onDeleteContact: (contact: Contact) => void;
  readonly onDeleteGroup: (group: ContactGroup) => void;
  readonly onEditContact: (contact: Contact) => void;
  readonly onEditGroup: (group: ContactGroup) => void;
  readonly open: () => void;
  readonly retry: () => void;
  readonly section: ContactSection;
  readonly selectSection: (section: ContactSection) => void;
  readonly transfer: ContactVCardTransferViewModel;
}
