"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { id } from "@/domain/shared/brand";
import type { EmailSignatureDefaultsViewModel } from "@/presentation/features/mail-workspace/email-signature-settings.view-model";
import type { EmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";

export const useEmailSignatureDefaultsModel = (
  signatures: EmailSignaturesModel,
  onStatus: (message: string) => void,
): EmailSignatureDefaultsViewModel & { readonly isDirty: boolean } => {
  const [newMessageId, setNewMessageId] = useState("");
  const [replyForwardId, setReplyForwardId] = useState("");
  const [baseline, setBaseline] = useState({
    newMessageId: "",
    replyForwardId: "",
  });
  const isDirty =
    newMessageId !== baseline.newMessageId ||
    replyForwardId !== baseline.replyForwardId;

  useEffect(() => {
    const book = signatures.book;
    if (!book) {
      setNewMessageId("");
      setReplyForwardId("");
      setBaseline({ newMessageId: "", replyForwardId: "" });
      return;
    }
    if (isDirty) return;
    const next = {
      newMessageId: book.defaults.newMessageId ?? "",
      replyForwardId: book.defaults.replyForwardId ?? "",
    };
    setNewMessageId(next.newMessageId);
    setReplyForwardId(next.replyForwardId);
    setBaseline(next);
  }, [signatures.book?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const result = await signatures.mutate({
        newMessageId: newMessageId ? id.signature(newMessageId) : null,
        operation: "set-defaults",
        replyForwardId: replyForwardId
          ? id.signature(replyForwardId)
          : null,
      });
      if (!result) return;
      const next = {
        newMessageId: result.defaults.newMessageId ?? "",
        replyForwardId: result.defaults.replyForwardId ?? "",
      };
      setNewMessageId(next.newMessageId);
      setReplyForwardId(next.replyForwardId);
      setBaseline(next);
      onStatus("Signature defaults saved.");
    },
    [newMessageId, onStatus, replyForwardId, signatures],
  );

  const busy = signatures.isLoading || signatures.isSaving;
  return {
    canDiscard: isDirty && !busy,
    canSave: isDirty && !busy,
    isDirty,
    newMessageId,
    newMessageInput: (event) => setNewMessageId(event.target.value),
    onDiscard: () => {
      const current = {
        newMessageId: signatures.book?.defaults.newMessageId ?? "",
        replyForwardId: signatures.book?.defaults.replyForwardId ?? "",
      };
      setNewMessageId(current.newMessageId);
      setReplyForwardId(current.replyForwardId);
      setBaseline(current);
    },
    onSubmit,
    replyForwardId,
    replyForwardInput: (event) => setReplyForwardId(event.target.value),
  };
};
