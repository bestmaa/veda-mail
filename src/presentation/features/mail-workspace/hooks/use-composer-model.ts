"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import {
  createForwardDraft,
  createReplyAllDraft,
  createReplyDraft,
  formatAddressInput,
  parseRecipientInputs,
} from "@/domain/mail/compose";
import type { ComposeInput, MessageDetail } from "@/domain/mail/mail";
import { mailApi } from "@/transport/client/api-client";

type ComposerTitle = "Forward message" | "New message" | "Reply all" | "Reply";

export const useComposerModel = (onSent: () => void) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [inReplyTo, setInReplyTo] = useState<ComposeInput["inReplyTo"]>();
  const [title, setTitle] = useState<ComposerTitle>("New message");
  const [error, setError] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const rememberFocus = useCallback(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);

  const restoreFocus = useCallback(() => {
    window.requestAnimationFrame(() => returnFocus.current?.focus());
  }, []);

  const reset = useCallback(() => {
    setTo("");
    setCc("");
    setBcc("");
    setShowCc(false);
    setShowBcc(false);
    setSubject("");
    setBody("");
    setInReplyTo(undefined);
    setTitle("New message");
    setError(null);
  }, []);

  const open = useCallback(() => {
    rememberFocus();
    reset();
    setIsOpen(true);
  }, [rememberFocus, reset]);

  const openDraft = useCallback((
    draft: ComposeInput,
    nextTitle: ComposerTitle,
  ) => {
    rememberFocus();
    setTo(formatAddressInput(draft.to));
    setCc(formatAddressInput(draft.cc));
    setBcc(formatAddressInput(draft.bcc));
    setShowCc(draft.cc.length > 0);
    setShowBcc(draft.bcc.length > 0);
    setSubject(draft.subject);
    setBody(draft.body);
    setInReplyTo(draft.inReplyTo);
    setTitle(nextTitle);
    setError(null);
    setIsOpen(true);
  }, [rememberFocus]);

  const openReply = useCallback(
    (message: MessageDetail | null) => {
      if (message) openDraft(createReplyDraft(message), "Reply");
    },
    [openDraft],
  );

  const openReplyAll = useCallback(
    (message: MessageDetail | null, signedInEmail: string) => {
      if (message) {
        openDraft(
          createReplyAllDraft(message, signedInEmail),
          "Reply all",
        );
      }
    },
    [openDraft],
  );

  const openForward = useCallback(
    (message: MessageDetail | null) => {
      if (message) openDraft(createForwardDraft(message), "Forward message");
    },
    [openDraft],
  );

  const close = useCallback(() => {
    if (isSending) return;
    setIsOpen(false);
    setError(null);
    restoreFocus();
  }, [isSending, restoreFocus]);

  useEffect(() => {
    if (!isOpen) return;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][aria-label="Compose message"]',
      );
      const focusable = [
        ...(dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)',
        ) ?? []),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleDialogKeys);
    return () => window.removeEventListener("keydown", handleDialogKeys);
  }, [close, isOpen]);

  const onToInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setTo(event.target.value),
    [],
  );
  const onCcInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setCc(event.target.value),
    [],
  );
  const onBccInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setBcc(event.target.value),
    [],
  );
  const onSubjectInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setSubject(event.target.value),
    [],
  );
  const onBodyInput: ChangeEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => setBody(event.target.value),
    [],
  );
  const onToggleBcc = useCallback(
    () => setShowBcc((isVisible) => (bcc.trim() ? true : !isVisible)),
    [bcc],
  );
  const onToggleCc = useCallback(
    () => setShowCc((isVisible) => (cc.trim() ? true : !isVisible)),
    [cc],
  );

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const recipients = parseRecipientInputs({ bcc, cc, to });
      if (
        recipients.to.length +
          recipients.cc.length +
          recipients.bcc.length ===
        0
      ) {
        setError("Add at least one recipient.");
        return;
      }
      setIsSending(true);
      setError(null);
      try {
        await mailApi.sendMessage({
          bcc: recipients.bcc,
          body,
          cc: recipients.cc,
          ...(inReplyTo ? { inReplyTo } : {}),
          subject,
          to: recipients.to,
        });
        setIsOpen(false);
        reset();
        restoreFocus();
        onSent();
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Message not sent.",
        );
      } finally {
        setIsSending(false);
      }
    },
    [bcc, body, cc, inReplyTo, onSent, reset, restoreFocus, subject, to],
  );

  return {
    bcc,
    body,
    cc,
    close,
    error,
    isOpen,
    isSending,
    onBccInput,
    onBodyInput,
    onCcInput,
    onToggleBcc,
    onToggleCc,
    onSubjectInput,
    onSubmit,
    onToInput,
    open,
    openForward,
    openReply,
    openReplyAll,
    showBcc,
    showCc,
    subject,
    title,
    to,
  };
};
