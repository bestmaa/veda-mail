import type { ContactGroupId, ContactId } from "@/domain/shared/brand";

export const MAX_CONTACTS = 2_000;
export const MAX_CONTACT_GROUPS = 200;
export const MAX_CONTACT_EMAILS = 5;
export const MAX_CONTACTS_PER_GROUP = 500;
export const MAX_CONTACT_IMPORT = 1_000;
export const MAX_RECENT_RECIPIENTS = 500;
export const MAX_RECENT_RECIPIENT_BATCH = 100;
export const MAX_CONTACT_NAME_CHARACTERS = 160;
export const MAX_CONTACT_NAME_UTF8_BYTES = 512;
export const MAX_CONTACT_LABEL_CHARACTERS = 40;
export const MAX_CONTACT_LABEL_UTF8_BYTES = 128;
export const MAX_CONTACT_BOOK_UTF8_BYTES = 8 * 1024 * 1024;
export const MAX_CONTACT_REQUEST_BYTES = 128 * 1024;

export const canonicalContactEmail = (value: string): string => {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf("@");
  if (separator < 1) return trimmed;
  return `${trimmed.slice(0, separator)}@${trimmed
    .slice(separator + 1)
    .toLowerCase()}`;
};

export const contactEmailKey = (value: string): string =>
  canonicalContactEmail(value).toLowerCase();

export const contactNameKey = (value: string): string =>
  value.normalize("NFKC").trim().toLowerCase();

export interface ContactEmail {
  readonly email: string;
  readonly label: string | null;
}

export interface Contact {
  readonly createdAt: string;
  readonly emails: readonly ContactEmail[];
  readonly id: ContactId;
  readonly name: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface ContactGroup {
  readonly contactIds: readonly ContactId[];
  readonly createdAt: string;
  readonly id: ContactGroupId;
  readonly name: string;
  readonly updatedAt: string;
  readonly version: 1;
}

export interface RecentRecipient {
  readonly email: string;
  readonly lastUsedAt: string;
  readonly name: string | null;
  readonly useCount: number;
}

export interface ContactBook {
  readonly contacts: readonly Contact[];
  readonly createdAt: string | null;
  readonly groups: readonly ContactGroup[];
  readonly recents: readonly RecentRecipient[];
  readonly revision: string | null;
  readonly updatedAt: string | null;
  readonly version: 1;
}

export interface ContactOwner {
  readonly email: string;
  readonly providerId: string;
}

export interface ContactInput {
  readonly emails: readonly ContactEmail[];
  readonly name: string;
}

export interface ContactGroupInput {
  readonly contactIds: readonly ContactId[];
  readonly name: string;
}

export interface ContactImportGroupInput {
  readonly contactIndexes: readonly number[];
  readonly name: string;
}

export interface RecentRecipientInput {
  readonly email: string;
  readonly name: string | null;
}

export type ContactPutOperation =
  | {
      readonly contacts: readonly ContactInput[];
      readonly expectedRevision: string | null;
      readonly groups?: readonly ContactImportGroupInput[] | undefined;
      readonly operation: "import-contacts";
    }
  | {
      readonly contact: ContactInput;
      readonly expectedRevision: string | null;
      readonly operation: "create-contact";
    }
  | {
      readonly contact: ContactInput;
      readonly contactId: ContactId;
      readonly expectedRevision: string | null;
      readonly operation: "update-contact";
    }
  | {
      readonly contactId: ContactId;
      readonly expectedRevision: string | null;
      readonly operation: "delete-contact";
    }
  | {
      readonly expectedRevision: string | null;
      readonly group: ContactGroupInput;
      readonly operation: "create-group";
    }
  | {
      readonly expectedRevision: string | null;
      readonly group: ContactGroupInput;
      readonly groupId: ContactGroupId;
      readonly operation: "update-group";
    }
  | {
      readonly expectedRevision: string | null;
      readonly groupId: ContactGroupId;
      readonly operation: "delete-group";
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "clear-recents";
    };
