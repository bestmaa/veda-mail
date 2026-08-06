"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEventHandler } from "react";

import {
  DEFAULT_MAIL_CONTENT_POLICY,
  type MailContentPolicy,
} from "@/domain/installation/mail-content-policy";
import type { AdminMailPolicyViewProps } from "@/presentation/features/admin-mail-policy/admin-mail-policy.view-model";
import { adminMailPolicyApi, ApiClientError } from "@/transport/client/api-client";

const MIB = 1024 * 1024;
const join = (values: readonly string[]): string => values.join(", ");
const split = (value: string): string[] => [...new Set(value
  .split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];

export const useAdminMailPolicyModel = (): AdminMailPolicyViewProps => {
  const router = useRouter();
  const [policy, setPolicy] = useState<MailContentPolicy>(DEFAULT_MAIL_CONTENT_POLICY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void adminMailPolicyApi.get().then(({ policy: next }) => {
      if (alive) setPolicy(next);
    }).catch((caught: unknown) => {
      if (!alive) return;
      if (caught instanceof ApiClientError && caught.status === 401) {
        router.replace("/admin/login");
      } else setError(caught instanceof Error ? caught.message : "Unable to load mail policy.");
    }).finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, [router]);

  const setNumber = (key: "maxAttachmentBytes" | "maxMessageBytes", value: string) =>
    setPolicy((current) => ({ ...current, [key]: Math.max(1, Math.round(Number(value) * MIB)) }));
  const setList = (key: "allowedExtensions" | "allowedMimeTypes" | "blockedExtensions" | "blockedMimeTypes", value: string) =>
    setPolicy((current) => ({ ...current, [key]: split(value) }));

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(async (event) => {
    event.preventDefault(); setError(null); setSuccess(null); setIsSaving(true);
    try {
      const next = await adminMailPolicyApi.save(policy);
      setPolicy(next.policy); setSuccess("Mail content policy saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save mail policy.");
    } finally { setIsSaving(false); }
  }, [policy]);

  const fields = useMemo(() => [
    { id: "maxMessageBytes", label: "Maximum message size (MiB)", description: "Body, recipients, and attachment bytes combined.", type: "number" as const, min: 1, value: policy.maxMessageBytes / MIB, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setNumber("maxMessageBytes", event.target.value) },
    { id: "maxAttachmentBytes", label: "Maximum file size (MiB)", description: "The effective limit is the lower of provider and organization limits.", type: "number" as const, min: 1, value: policy.maxAttachmentBytes / MIB, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setNumber("maxAttachmentBytes", event.target.value) },
    { id: "maxAttachmentsPerMessage", label: "Maximum attachments per message", description: "Applies again when a draft is saved or sent.", type: "number" as const, min: 1, value: policy.maxAttachmentsPerMessage, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setPolicy((current) => ({ ...current, maxAttachmentsPerMessage: Math.max(1, Math.round(Number(event.target.value))) })) },
    ...(["allowedExtensions", "blockedExtensions", "allowedMimeTypes", "blockedMimeTypes"] as const).map((key) => ({ id: key, label: ({ allowedExtensions: "Allowed extensions", blockedExtensions: "Blocked extensions", allowedMimeTypes: "Allowed detected MIME types", blockedMimeTypes: "Blocked detected MIME types" })[key], description: key.startsWith("allowed") ? "Comma-separated allowlist; leave empty to allow all not blocked." : "Comma-separated denylist; blocked rules take precedence.", type: "text" as const, value: join(policy[key]), onChange: (event: React.ChangeEvent<HTMLInputElement>) => setList(key, event.target.value) })),
  ], [policy]);

  return { error, fields, isLoading, isSaving, onSubmit, success };
};
