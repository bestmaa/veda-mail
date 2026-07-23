"use client";

import {
  useCallback,
  useState,
  type ChangeEventHandler,
  type FormEventHandler,
} from "react";

import type { MailAddress, MessageDetail } from "@/domain/mail/mail";
import { mailApi } from "@/transport/client/api-client";

const parseAddresses = (value: string): readonly MailAddress[] =>
  value
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email, name: null }));

export const useComposerModel = (onSent: () => void) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTo("");
    setSubject("");
    setBody("");
    setError(null);
  }, []);

  const open = useCallback(() => {
    reset();
    setIsOpen(true);
  }, [reset]);

  const openReply = useCallback((message: MessageDetail | null) => {
    if (!message) {
      return;
    }
    setTo(message.from.map((address) => address.email).join(", "));
    setSubject(
      message.subject.toLocaleLowerCase().startsWith("re:")
        ? message.subject
        : `Re: ${message.subject}`,
    );
    setBody(`\n\n—\nOn ${message.receivedAt}, ${message.from[0]?.email ?? "sender"} wrote:\n${message.textBody}`);
    setError(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  const onToInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setTo(event.target.value),
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

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const recipients = parseAddresses(to);
      if (recipients.length === 0) {
        setError("Add at least one recipient.");
        return;
      }
      setIsSending(true);
      setError(null);
      try {
        await mailApi.sendMessage({
          bcc: [],
          body,
          cc: [],
          subject,
          to: recipients,
        });
        setIsOpen(false);
        reset();
        onSent();
      } catch (nextError) {
        setError(
          nextError instanceof Error ? nextError.message : "Message not sent.",
        );
      } finally {
        setIsSending(false);
      }
    },
    [body, onSent, reset, subject, to],
  );

  return {
    body,
    close,
    error,
    isOpen,
    isSending,
    onBodyInput,
    onSubjectInput,
    onSubmit,
    onToInput,
    open,
    openReply,
    subject,
    to,
  };
};
