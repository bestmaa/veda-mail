"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
} from "react";

import type { EmailTemplate } from "@/domain/member/email-template";
import {
  combinedOutgoingContentWithinLimit,
  outgoingContentWithinLimit,
} from "@/domain/mail/outgoing-content-policy";
import { plainTextToComposerHtml } from "@/presentation/features/mail-workspace/composer-body-content";
import type { ComposerTemplateApplication } from "@/presentation/features/mail-workspace/composer-template-editor";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import type { EmailTemplatesModel } from "@/presentation/features/mail-workspace/hooks/use-email-templates-model";

export type ComposerTemplateDialog = "delete" | "replace" | "save" | null;

interface PendingTemplateApplication extends ComposerTemplateApplication {
  readonly name: string;
  readonly subject: string;
}

const insertWithinOutgoingLimit = (
  body: ReturnType<typeof useComposerBody>,
  template: EmailTemplate,
): boolean => {
  const text = `${body.text}${template.body}`;
  if (!outgoingContentWithinLimit(text)) return false;
  if (body.mode === "plain") return true;
  const html = `${body.html}${
    template.htmlBody ?? plainTextToComposerHtml(template.body)
  }`;
  return combinedOutgoingContentWithinLimit(text, html);
};

const templateContent = (
  subject: string,
  body: ReturnType<typeof useComposerBody>,
) => body.mode === "rich"
  ? { htmlBody: body.templateHtml, mode: "rich" as const, subject }
  : { body: body.text, mode: "plain" as const, subject };

export const useComposerTemplates = ({
  body,
  disabled,
  fields,
  templates,
}: {
  readonly body: ReturnType<typeof useComposerBody>;
  readonly disabled: boolean;
  readonly fields: ReturnType<typeof useComposerFields>;
  readonly templates: EmailTemplatesModel;
}) => {
  const [selectedId, setSelectedId] = useState("");
  const [application, setApplication] =
    useState<PendingTemplateApplication | null>(null);
  const [dialog, setDialog] = useState<ComposerTemplateDialog>(null);
  const [name, setName] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saveMode, setSaveMode] = useState<"create" | "update">("create");
  const nonceRef = useRef(0);
  const applicationRef = useRef<PendingTemplateApplication | null>(null);
  const applyTemplateSubject = fields.applyTemplateSubject;
  const selected = useMemo(
    () => templates.book?.templates.find(({ id }) => id === selectedId) ?? null,
    [selectedId, templates.book],
  );

  useEffect(() => {
    const available = templates.book?.templates ?? [];
    if (available.some(({ id }) => id === selectedId)) return;
    setSelectedId(available[0]?.id ?? "");
  }, [selectedId, templates.book]);
  useEffect(() => {
    if (!dialog) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(
        dialog === "save" ? "composer-template-name" :
          `composer-template-${dialog}-cancel`,
      )?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setLocalError(null);
    templates.clearError();
    window.requestAnimationFrame(() => {
      document.getElementById("composer-template-select")?.focus();
    });
  }, [templates]);
  const reset = useCallback(() => {
    applicationRef.current = null;
    setApplication(null);
    setAnnouncement("");
    setDialog(null);
    setLocalError(null);
    setName("");
  }, []);
  const apply = useCallback((action: "insert" | "replace") => {
    if (!selected || disabled || application) return;
    if (action === "insert" && !insertWithinOutgoingLimit(body, selected)) {
      setLocalError(
        "This template would make the message too large. Shorten the message before inserting it.",
      );
      return;
    }
    const pending: PendingTemplateApplication = {
      action,
      body: selected.body,
      ...(selected.htmlBody === undefined ? {} : { htmlBody: selected.htmlBody }),
      name: selected.name,
      nonce: ++nonceRef.current,
      subject: selected.subject,
    };
    applicationRef.current = pending;
    setApplication(pending);
    setAnnouncement("");
    setLocalError(null);
    setDialog(null);
  }, [application, body, disabled, selected]);
  const requestReplace = useCallback(() => {
    if (!selected || disabled) return;
    if (fields.subject.trim() || body.text.trim()) {
      setDialog("replace");
    } else {
      apply("replace");
    }
  }, [apply, body.text, disabled, fields.subject, selected]);
  const onApplied = useCallback((nonce: number) => {
    const pending = applicationRef.current;
    if (!pending || pending.nonce !== nonce) return;
    applicationRef.current = null;
    if (pending.action === "replace") {
      applyTemplateSubject(pending.subject);
    }
    setApplication(null);
    setAnnouncement(
      `${pending.name} ${pending.action === "replace" ? "replaced the message" : "inserted"}.`,
    );
  }, [applyTemplateSubject]);

  const openSave = useCallback((mode: "create" | "update") => {
    if (disabled || (mode === "update" && !selected)) return;
    setSaveMode(mode);
    setName(mode === "update" ? selected?.name ?? "" : "");
    setLocalError(null);
    setDialog("save");
  }, [disabled, selected]);
  const save = useCallback(async () => {
    const nextName = name.trim();
    if (!nextName) {
      setLocalError("Enter a template name.");
      return;
    }
    if (!(body.mode === "rich" ? body.templateText : body.text).trim()) {
      setLocalError("Write a message body before saving a template.");
      return;
    }
    const content = templateContent(fields.subject, body);
    const previousIds = new Set(
      templates.book?.templates.map(({ id: templateId }) => templateId) ?? [],
    );
    const updatedId = saveMode === "update" ? selected?.id : undefined;
    const next = saveMode === "create"
      ? await templates.mutate({ content, name: nextName, operation: "create" })
      : selected && await templates.mutate({
          content,
          name: nextName,
          operation: "update",
          templateId: selected.id,
        });
    if (!next) return;
    const savedId = updatedId ?? next.templates.find(
      ({ id: templateId }) => !previousIds.has(templateId),
    )?.id;
    if (savedId && next.templates.some(({ id }) => id === savedId)) {
      setSelectedId(savedId);
    }
    setAnnouncement(`Template ${saveMode === "create" ? "saved" : "updated"}.`);
    closeDialog();
  }, [body, closeDialog, fields.subject, name, saveMode, selected, templates]);
  const remove = useCallback(async () => {
    if (!selected) return;
    const next = await templates.mutate({
      operation: "delete",
      templateId: selected.id,
    });
    if (!next) return;
    setAnnouncement("Template deleted.");
    closeDialog();
  }, [closeDialog, selected, templates]);

  return {
    announcement,
    application,
    applyPlainTemplate: body.applyPlainTemplate,
    canManage: Boolean(templates.book) && !disabled && !templates.isSaving,
    closeDialog,
    confirmDelete: remove,
    confirmReplace: () => apply("replace"),
    confirmSave: save,
    dialog,
    error: localError ?? templates.error,
    isApplying: application !== null,
    isLoading: templates.isLoading,
    isSaving: templates.isSaving,
    name,
    nameInput: ((event) => setName(event.target.value)) as ChangeEventHandler<HTMLInputElement>,
    onApplied,
    onInsert: () => apply("insert"),
    onRequestDelete: () => { if (selected && !disabled) setDialog("delete"); },
    onRequestReplace: requestReplace,
    onSaveNew: () => openSave("create"),
    onSelect: ((event) => setSelectedId(event.target.value)) as ChangeEventHandler<HTMLSelectElement>,
    onUpdate: () => openSave("update"),
    options: templates.book?.templates.map(({ id, name }) => ({ id, name })) ?? [],
    retry: templates.retry,
    reset,
    selectedId,
  };
};
