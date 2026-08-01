"use client";

import { useEffect, useState } from "react";

import { ComposerAutosaveCoordinator } from "@/presentation/features/mail-workspace/composer-autosave-coordinator";
import type {
  ComposerAutosaveInput,
  ComposerAutosaveStatus,
} from "@/presentation/features/mail-workspace/composer-autosave.types";

const initialStatus: ComposerAutosaveStatus = {
  isOnline: true,
  nextAttemptAt: null,
  phase: "idle",
  retryAttempt: 0,
};

const sameStatus = (
  left: ComposerAutosaveStatus,
  right: ComposerAutosaveStatus,
): boolean => left.isOnline === right.isOnline &&
  left.nextAttemptAt === right.nextAttemptAt && left.phase === right.phase &&
  left.retryAttempt === right.retryAttempt;

export const useComposerDraftAutosave = (
  {
    autosave, contentGeneration, enabled, hasLocalAttachments, hasUserEdits,
    paused, reconcile, retryKind,
  }: ComposerAutosaveInput,
): ComposerAutosaveStatus => {
  const [status, setStatus] = useState(initialStatus);
  const [coordinator] = useState(
    () => new ComposerAutosaveCoordinator((next) => {
      setStatus((current) => sameStatus(current, next) ? current : next);
    }),
  );

  useEffect(() => {
    coordinator.update({
      autosave, contentGeneration, enabled, hasLocalAttachments, hasUserEdits,
      paused, reconcile, retryKind,
    });
  });

  useEffect(() => {
    const updateNetworkState = () => coordinator.setOnline(navigator.onLine);
    updateNetworkState();
    globalThis.addEventListener("online", updateNetworkState);
    globalThis.addEventListener("offline", updateNetworkState);
    return () => {
      globalThis.removeEventListener("online", updateNetworkState);
      globalThis.removeEventListener("offline", updateNetworkState);
    };
  }, [coordinator]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  return status;
};
