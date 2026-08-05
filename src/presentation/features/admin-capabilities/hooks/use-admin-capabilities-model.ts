"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEventHandler,
} from "react";

import { DEFAULT_ORGANIZATION_FEATURE_POLICY } from "@/domain/installation/organization-policy";
import type { AdminCapabilitiesViewProps } from "@/presentation/features/admin-capabilities/admin-capabilities.view-model";
import {
  adminCapabilitiesApi,
  ApiClientError,
  type AdminCapabilitySnapshot,
} from "@/transport/client/api-client";

type Policy = AdminCapabilitySnapshot["policy"];

const controls = [
  {
    description: "Allow members to update the display name used on outgoing mail.",
    key: "memberProfileEditing",
    label: "Member profile editing",
  },
  {
    description: "Allow members to change their mailbox password from webmail.",
    key: "memberPasswordChange",
    label: "Member password changes",
  },
  {
    description: "Allow accounts without webmail 2FA to start a new TOTP enrollment.",
    key: "memberTwoFactorEnrollment",
    label: "New 2FA enrollment",
  },
] as const;

const status = (value: boolean): string => (value ? "Available" : "Unavailable");

export const useAdminCapabilitiesModel = (): AdminCapabilitiesViewProps => {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AdminCapabilitySnapshot | null>(null);
  const [policy, setPolicy] = useState<Policy>(
    DEFAULT_ORGANIZATION_FEATURE_POLICY,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void adminCapabilitiesApi
      .get()
      .then((next) => {
        if (!alive) return;
        setSnapshot(next);
        setPolicy(next.policy);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        if (caught instanceof ApiClientError && caught.status === 401) {
          router.replace("/admin/login");
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load organization capabilities.",
        );
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      setError(null);
      setSuccess(null);
      setIsSaving(true);
      try {
        const next = await adminCapabilitiesApi.save(policy);
        setSnapshot(next);
        setPolicy(next.policy);
        setSuccess("Organization feature policy saved.");
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to save organization feature policy.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [policy],
  );

  const policyControls = useMemo(
    () =>
      controls.map((control) => ({
        checked: policy[control.key],
        description: control.description,
        id: control.key,
        label: control.label,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setPolicy((current) => ({
            ...current,
            [control.key]: event.target.checked,
          })),
      })),
    [policy],
  );

  return {
    capabilities: (snapshot?.capabilities ?? []).map((capability) => ({
      effective: capability.effective,
      effectiveLabel: status(capability.effective),
      id: capability.id,
      label: capability.label,
      organizationLabel:
        capability.organizationEnabled === null
          ? "Not controlled"
          : capability.organizationEnabled
            ? "Enabled"
            : "Disabled",
      providerLabel: status(capability.providerSupported),
    })),
    error,
    isLoading,
    isSaving,
    onSubmit,
    policyControls,
    providerName: snapshot?.provider.name ?? "Configured provider",
    success,
  };
};
