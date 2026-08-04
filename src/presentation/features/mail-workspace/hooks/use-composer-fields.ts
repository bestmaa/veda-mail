"use client";

import {
  useCallback,
  useState,
  type ChangeEventHandler,
} from "react";

import type { DraftContent } from "@/domain/mail/draft";
import type { ComposeInput } from "@/domain/mail/mail";
import { formatAddressInput } from "@/domain/mail/compose";
import type {
  ComposerRecoverySnapshot,
  ComposerTitle,
} from "@/presentation/features/mail-workspace/composer-recovery.types";

export type { ComposerTitle } from "@/presentation/features/mail-workspace/composer-recovery.types";

export const useComposerFields = (onChange: () => void) => {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [inReplyTo, setInReplyTo] = useState<ComposeInput["inReplyTo"]>();
  const [title, setTitle] = useState<ComposerTitle>("New message");
  const [focusBody, setFocusBody] = useState(false);

  const reset = useCallback(() => {
    setTo("");
    setCc("");
    setBcc("");
    setShowCc(false);
    setShowBcc(false);
    setSubject("");
    setInReplyTo(undefined);
    setTitle("New message");
    setFocusBody(false);
  }, []);

  const hydrate = useCallback(
    (draft: DraftContent | ComposeInput, nextTitle: ComposerTitle) => {
      const nextTo = formatAddressInput(draft.to);
      setTo(nextTo);
      setCc(formatAddressInput(draft.cc));
      setBcc(formatAddressInput(draft.bcc));
      setShowCc(draft.cc.length > 0);
      setShowBcc(draft.bcc.length > 0);
      setSubject(draft.subject);
      setInReplyTo(draft.inReplyTo);
      setTitle(nextTitle);
      setFocusBody(Boolean(nextTo));
    },
    [],
  );

  const restoreRecovery = useCallback((snapshot: ComposerRecoverySnapshot) => {
    setTo(snapshot.to);
    setCc(snapshot.cc);
    setBcc(snapshot.bcc);
    setShowCc(Boolean(snapshot.cc.trim()));
    setShowBcc(Boolean(snapshot.bcc.trim()));
    setSubject(snapshot.subject);
    setInReplyTo(snapshot.inReplyTo);
    setTitle(snapshot.title);
    setFocusBody(Boolean(snapshot.to.trim()));
  }, []);

  const input = useCallback(
    (setter: (value: string) => void): ChangeEventHandler<HTMLInputElement> =>
      (event) => {
        setter(event.target.value);
        onChange();
      },
    [onChange],
  );

  const setRecipientField = useCallback((
    field: "bcc" | "cc" | "to",
    value: string,
  ) => {
    ({ bcc: setBcc, cc: setCc, to: setTo })[field](value);
    onChange();
  }, [onChange]);

  return {
    applyTemplateSubject: useCallback((value: string) => {
      setSubject(value);
    }, []),
    bcc,
    cc,
    focusBody,
    hydrate,
    inReplyTo,
    onBccInput: input(setBcc),
    onCcInput: input(setCc),
    onSubjectInput: input(setSubject),
    onToInput: input(setTo),
    onToggleBcc: useCallback(() => {
      setShowBcc((visible) => (bcc.trim() ? true : !visible));
    }, [bcc]),
    onToggleCc: useCallback(() => {
      setShowCc((visible) => (cc.trim() ? true : !visible));
    }, [cc]),
    reset,
    restoreRecovery,
    setRecipientField,
    setTitle,
    showBcc,
    showCc,
    subject,
    title,
    to,
  };
};
