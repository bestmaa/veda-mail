"use client";

import { useCallback, useState, type ChangeEventHandler, type FormEventHandler } from "react";

import type {
  Contact,
  ContactEmail,
  ContactGroup,
} from "@/domain/member/contact";
import type { ContactGroupId, ContactId } from "@/domain/shared/brand";
import type { ContactManagementViewModel, ContactSection } from "@/presentation/features/mail-workspace/contact-management.view-model";
import type { ContactsModel } from "@/presentation/features/mail-workspace/hooks/use-contacts-model";
import { useContactVCardTransfer } from "@/presentation/features/mail-workspace/hooks/use-contact-vcard-transfer";
import type { MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";

type PendingDelete =
  | { readonly id: ContactId; readonly kind: "contact"; readonly name: string }
  | { readonly id: ContactGroupId; readonly kind: "group"; readonly name: string }
  | { readonly kind: "recents" };

const emptyEmail = (): ContactEmail => ({ email: "", label: null });

export const useContactManagement = (
  contacts: ContactsModel,
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler,
): ContactManagementViewModel => {
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSection] = useState<ContactSection>("contacts");
  const [editingContactId, setEditingContactId] = useState<ContactId | null>(null);
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmails, setContactEmails] = useState<readonly ContactEmail[]>([emptyEmail()]);
  const [editingGroupId, setEditingGroupId] = useState<ContactGroupId | null>(null);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupContactIds, setGroupContactIds] = useState<readonly ContactId[]>([]);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const transfer = useContactVCardTransfer(
    contacts.book?.revision ?? null,
    sessionScope,
    contacts.retry,
    handleSessionFailure,
  );

  const closeEditors = useCallback(() => {
    setContactEditorOpen(false);
    setGroupEditorOpen(false);
    setEditingContactId(null);
    setEditingGroupId(null);
  }, []);

  const openContact = useCallback((contact?: Contact) => {
    setEditingContactId(contact?.id ?? null);
    setContactName(contact?.name ?? "");
    setContactEmails(contact?.emails.map((email) => ({ ...email })) ?? [emptyEmail()]);
    setGroupEditorOpen(false);
    setContactEditorOpen(true);
  }, []);

  const openGroup = useCallback((group?: ContactGroup) => {
    setEditingGroupId(group?.id ?? null);
    setGroupName(group?.name ?? "");
    setGroupContactIds(group?.contactIds ?? []);
    setContactEditorOpen(false);
    setGroupEditorOpen(true);
  }, []);

  const onContactSubmit = useCallback<FormEventHandler<HTMLFormElement>>(async (
    event,
  ) => {
    event.preventDefault();
    const input = {
      emails: contactEmails.map(({ email, label }) => ({
        email,
        label: label?.trim() || null,
      })),
      name: contactName,
    };
    const result = editingContactId
      ? await contacts.updateContact(editingContactId, input)
      : await contacts.createContact(input);
    if (result) closeEditors();
  }, [closeEditors, contactEmails, contactName, contacts, editingContactId]);

  const onGroupSubmit = useCallback<FormEventHandler<HTMLFormElement>>(async (
    event,
  ) => {
    event.preventDefault();
    const input = { contactIds: groupContactIds, name: groupName };
    const result = editingGroupId
      ? await contacts.updateGroup(editingGroupId, input)
      : await contacts.createGroup(input);
    if (result) closeEditors();
  }, [closeEditors, contacts, editingGroupId, groupContactIds, groupName]);

  const confirmDelete = useCallback(async () => {
    const pending = pendingDelete;
    if (!pending) return;
    const result = pending.kind === "contact"
      ? await contacts.deleteContact(pending.id)
      : pending.kind === "group"
        ? await contacts.deleteGroup(pending.id)
        : await contacts.clearRecents();
    if (result) setPendingDelete(null);
  }, [contacts, pendingDelete]);

  const updateEmail = useCallback((
    index: number,
    field: "email" | "label",
    value: string,
  ) => {
    setContactEmails((current) => current.map((email, currentIndex) =>
      currentIndex === index
        ? { ...email, [field]: field === "label" ? value || null : value }
        : email));
  }, []);

  const nameInput = (setter: (value: string) => void): ChangeEventHandler<HTMLInputElement> =>
    (event) => setter(event.target.value);

  return {
    book: contacts.book,
    close: () => { setIsOpen(false); closeEditors(); setPendingDelete(null); },
    contactEditor: {
      addEmail: () => setContactEmails((current) => current.length < 5
        ? [...current, emptyEmail()] : current),
      emails: contactEmails,
      isOpen: contactEditorOpen,
      name: contactName,
      onCancel: closeEditors,
      onNameInput: nameInput(setContactName),
      onSubmit: onContactSubmit,
      removeEmail: (index) => setContactEmails((current) => current.length > 1
        ? current.filter((_, currentIndex) => currentIndex !== index) : current),
      title: editingContactId ? "Edit contact" : "New contact",
      updateEmail,
    },
    deleteConfirmation: {
      description: pendingDelete?.kind === "recents"
        ? "Clear all recent recipient suggestions?"
        : pendingDelete ? `Delete ${pendingDelete.name}?` : "",
      isOpen: Boolean(pendingDelete),
      onCancel: () => setPendingDelete(null),
      onConfirm: () => { void confirmDelete(); },
    },
    error: contacts.error,
    groupEditor: {
      contactIds: groupContactIds,
      isOpen: groupEditorOpen,
      name: groupName,
      onCancel: closeEditors,
      onNameInput: nameInput(setGroupName),
      onSubmit: onGroupSubmit,
      title: editingGroupId ? "Edit group" : "New group",
      toggleContact: (contactId) => setGroupContactIds((current) =>
        current.includes(contactId)
          ? current.filter((id) => id !== contactId)
          : [...current, contactId]),
    },
    hasConflict: contacts.hasConflict,
    isLoading: contacts.isLoading,
    isOpen,
    isSaving: contacts.isSaving,
    onClearRecents: () => setPendingDelete({ kind: "recents" }),
    onCreateContact: () => openContact(),
    onCreateGroup: () => openGroup(),
    onDeleteContact: (contact) => setPendingDelete({ id: contact.id, kind: "contact", name: contact.name }),
    onDeleteGroup: (group) => setPendingDelete({ id: group.id, kind: "group", name: group.name }),
    onEditContact: openContact,
    onEditGroup: openGroup,
    open: () => setIsOpen(true),
    retry: contacts.retry,
    section,
    selectSection: setSection,
    transfer,
  };
};
