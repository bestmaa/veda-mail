"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import type { VacationWorkspace } from "@/domain/mail/vacation";
import type { VacationSettingsViewModel } from "@/presentation/features/mail-workspace/vacation-settings.view-model";
import { ignoreMailSessionFailure, type MailSessionFailureHandler } from "@/presentation/features/mail-workspace/hooks/mail-session-failure";
import { memberVacationApi } from "@/transport/client/member-vacation-api";

const localDate = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value); const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const utcDate = (value: string) => value
  ? new Date(value).toISOString().replace(/\.\d{3}Z$/u, "Z") : null;

export const useVacationSettingsModel = (
  sessionScope: string,
  handleSessionFailure: MailSessionFailureHandler = ignoreMailSessionFailure,
): VacationSettingsViewModel => {
  const [snapshot, setSnapshot] = useState<VacationWorkspace | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [subject, setSubject] = useState("");
  const [textBody, setTextBody] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const scopeRef = useRef(sessionScope);

  const apply = useCallback((next: VacationWorkspace) => {
    setSnapshot(next);
    if (!next.response) {
      setEnabled(false); setSubject(""); setTextBody("");
      setFromDate(""); setToDate(""); return;
    }
    setEnabled(next.response.isEnabled);
    setSubject(next.response.subject ?? "");
    setTextBody(next.response.textBody ?? "");
    setFromDate(localDate(next.response.fromDate));
    setToDate(localDate(next.response.toDate));
  }, []);

  useEffect(() => {
    scopeRef.current = sessionScope; setSnapshot(null); setError(null); setSuccess(null);
    setEnabled(false); setSubject(""); setTextBody(""); setFromDate(""); setToDate("");
    if (!sessionScope) return;
    const controller = new AbortController(); setIsLoading(true);
    void memberVacationApi.get(sessionScope, controller.signal).then((next) => {
      if (scopeRef.current === sessionScope) apply(next);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted && scopeRef.current === sessionScope && !handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to load automatic replies.");
      }
    }).finally(() => {
      if (scopeRef.current === sessionScope) setIsLoading(false);
    });
    return () => controller.abort();
  }, [apply, handleSessionFailure, sessionScope]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionScope || !snapshot?.response || !snapshot.capability.supported) return;
    setIsSaving(true); setError(null); setSuccess(null);
    void memberVacationApi.put({
      expectedRevision: snapshot.response.revision,
      fromDate: utcDate(fromDate), htmlBody: null, isEnabled: enabled,
      subject: subject.trim() || null, textBody: textBody.trim() || null,
      toDate: utcDate(toDate),
    }, sessionScope).then((response) => {
      if (scopeRef.current !== sessionScope) return;
      apply({ ...snapshot, response }); setSuccess("Automatic reply settings saved.");
    }).catch((caught: unknown) => {
      if (scopeRef.current === sessionScope && !handleSessionFailure(caught)) {
        setError(caught instanceof Error ? caught.message : "Unable to save automatic replies.");
      }
    }).finally(() => {
      if (scopeRef.current === sessionScope) setIsSaving(false);
    });
  };

  return {
    capabilityReason: snapshot?.capability.supported === false ? snapshot.capability.reason : null,
    delegationReason: snapshot?.delegation.supported === false ? snapshot.delegation.reason : null,
    error, fromDate, fromDateInput: (event) => setFromDate(event.target.value),
    isEnabled: enabled, isLoading, isSaving,
    isSupported: snapshot?.capability.supported === true,
    onEnabledChange: (event) => setEnabled(event.target.checked), onSubmit,
    subject, subjectInput: (event) => setSubject(event.target.value), success,
    textBody, textBodyInput: (event) => setTextBody(event.target.value),
    toDate, toDateInput: (event) => setToDate(event.target.value),
  };
};
