"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";

import type { MailForwardingSnapshot } from "@/domain/admin/mail-forwarding";
import type { AdminMailForwardingViewModel } from "@/presentation/features/admin-mail-users/admin-mail-users.view-model";
import { adminMailUsersApi } from "@/transport/client/admin-mail-users-api";

interface SelectedMailbox { readonly domain: string; readonly id: string }

export const useAdminMailForwardingModel = (input: {
  readonly handleFailure: (error: unknown, fallback: string) => void;
  readonly requiresOtp: boolean;
}): AdminMailForwardingViewModel & {
  readonly load: (mailbox: SelectedMailbox, signal?: AbortSignal) => Promise<void>;
  readonly reset: () => void;
} => {
  const { handleFailure, requiresOtp } = input;
  const [selected, setSelected] = useState<SelectedMailbox | null>(null);
  const [snapshot, setSnapshot] = useState<MailForwardingSnapshot | null>(null);
  const [destination, setDestination] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const sequence = useRef(0);

  const resetSecrets = () => {
    setAdminPassword(""); setOtpCode(""); setConfirmation("");
  };
  const reset = useCallback(() => {
    sequence.current += 1; setSelected(null); setSnapshot(null);
    setDestination(""); resetSecrets(); setIsLoading(false); setIsSaving(false);
    setError(null); setSuccess(null);
  }, []);
  const load = useCallback(async (mailbox: SelectedMailbox, signal?: AbortSignal) => {
    const request = ++sequence.current;
    setSelected(mailbox); setSnapshot(null); setDestination("");
    resetSecrets(); setError(null); setSuccess(null); setIsLoading(true);
    try {
      const next = await adminMailUsersApi.getForwarding(mailbox.id, mailbox.domain, signal);
      if (request !== sequence.current) return;
      setSnapshot(next);
      setDestination(next.configuration?.destinationEmail ?? "");
    } catch (caught) {
      if (request === sequence.current && !signal?.aborted) {
        handleFailure(caught, "Unable to load forwarding.");
      }
    } finally {
      if (request === sequence.current) setIsLoading(false);
    }
  }, [handleFailure]);

  const submit = (remove: boolean) => async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !snapshot || isSaving) return;
    setIsSaving(true); setError(null); setSuccess(null);
    try {
      const common = {
        currentAdminPassword: adminPassword,
        expectedRevision: snapshot.revision,
        ...(otpCode ? { otpCode } : {}),
      };
      const next = remove
        ? await adminMailUsersApi.removeForwarding(selected.id, selected.domain, common)
        : await adminMailUsersApi.setForwarding(selected.id, selected.domain, {
            ...common, confirmDestinationEmail: confirmation, destinationEmail: destination,
          });
      setSnapshot(next); setDestination(next.configuration?.destinationEmail ?? "");
      resetSecrets();
      setSuccess(remove ? "Automatic forwarding disabled." : "Automatic forwarding enabled.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message :
        remove ? "Unable to disable forwarding." : "Unable to enable forwarding.";
      setError(message);
      handleFailure(caught, message);
    } finally { setIsSaving(false); }
  };

  return {
    adminPassword,
    adminPasswordInput: (event) => setAdminPassword(event.target.value),
    availability: snapshot?.availability ?? null,
    confirmation,
    confirmationInput: (event) => setConfirmation(event.target.value.slice(0, 320)),
    destination,
    destinationInput: (event) => setDestination(event.target.value.slice(0, 320)),
    error, isEnabled: snapshot?.configuration !== null && snapshot !== null,
    isLoading, isSaving, load, onDisable: submit(true), onEnable: submit(false),
    otpCode, otpCodeInput: (event) => setOtpCode(event.target.value.slice(0, 64)),
    reason: snapshot?.reason ?? null, requiresOtp, reset,
    status: snapshot?.configuration?.status ?? null, success,
  };
};
