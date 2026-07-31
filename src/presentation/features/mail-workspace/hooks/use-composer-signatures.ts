"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type {
  EmailSignatureBook,
  EmailSignatureDefaults,
} from "@/domain/member/email-signature";
import type { SignatureId } from "@/domain/shared/brand";
import type { ComposerSignatureInitialContentPlacement } from "@/presentation/features/mail-workspace/composer-signature-editor";
import type { ComposerSignatureEditorConfiguration } from "@/presentation/features/mail-workspace/composer-signature-picker.view-model";

type ComposeSignatureContext = "new" | "reply-forward";

const defaultId = (
  book: EmailSignatureBook | null,
  context: ComposeSignatureContext,
): SignatureId | null => {
  const defaults: EmailSignatureDefaults | undefined = book?.defaults;
  return context === "new"
    ? (defaults?.newMessageId ?? null)
    : (defaults?.replyForwardId ?? null);
};

export const useComposerSignatures = (book: EmailSignatureBook | null) => {
  const [options, setOptions] = useState<
    EmailSignatureBook["signatures"]
  >([]);
  const [selectedId, setSelectedId] = useState<SignatureId | null>(null);
  const [placement, setPlacement] =
    useState<ComposerSignatureInitialContentPlacement>("prefix");
  const [isTracking, setIsTracking] = useState(false);
  const [isDetached, setIsDetached] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const selectedIdRef = useRef<SignatureId | null>(null);

  const select = useCallback((nextId: SignatureId | null) => {
    const next =
      nextId &&
      options.some((signature) => signature.id === nextId)
        ? nextId
        : null;
    if (selectedIdRef.current === next) return;
    selectedIdRef.current = next;
    setSelectedId(next);
    const name = options.find(({ id }) => id === next)?.name;
    setAnnouncement(
      name ? `Signature ${name} inserted.` : "Signature removed.",
    );
  }, [options]);

  const prepare = useCallback(
    (context: ComposeSignatureContext) => {
      const nextOptions = (book?.signatures ?? []).map((signature) => ({
        ...signature,
      }));
      const candidate = defaultId(book, context);
      const nextId =
        candidate &&
        nextOptions.some((signature) => signature.id === candidate)
          ? candidate
          : null;
      selectedIdRef.current = nextId;
      setOptions(nextOptions);
      setSelectedId(nextId);
      setPlacement(context === "new" ? "prefix" : "tail");
      setIsTracking(true);
      setIsDetached(false);
      setAnnouncement("");
    },
    [book],
  );

  const reset = useCallback(() => {
    selectedIdRef.current = null;
    setOptions([]);
    setSelectedId(null);
    setPlacement("prefix");
    setIsTracking(false);
    setIsDetached(false);
    setAnnouncement("");
  }, []);

  const restoreRecovery = useCallback((disposition: "detached" | "none") => {
    selectedIdRef.current = null;
    setOptions([]);
    setSelectedId(null);
    setPlacement("prefix");
    setIsTracking(false);
    setIsDetached(disposition === "detached");
    setAnnouncement("");
  }, []);

  const detach = useCallback(() => {
    const hadSignature = selectedIdRef.current !== null;
    selectedIdRef.current = null;
    setSelectedId(null);
    setPlacement("prefix");
    setIsTracking(false);
    setIsDetached(hadSignature);
    setAnnouncement(
      hadSignature ? "Signature converted to editable plain text." : "",
    );
  }, []);

  const configuration = useMemo<ComposerSignatureEditorConfiguration | null>(
    () =>
      isTracking && options.length > 0
        ? {
            clearSelectionOnUnmount: false,
            initialContentPlacement: placement,
            onSelectedIdChange: select,
            options,
            selectedId,
          }
        : null,
    [isTracking, options, placement, select, selectedId],
  );

  return {
    announcement,
    configuration,
    detach,
    isDetached,
    prepare,
    reset,
    restoreRecovery,
  };
};
