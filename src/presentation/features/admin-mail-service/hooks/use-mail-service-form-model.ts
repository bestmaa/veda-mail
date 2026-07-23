"use client";

import {
  useCallback,
  useMemo,
  useState,
  type ChangeEventHandler,
} from "react";

import type { ProviderManifest } from "@/domain/provider/provider";
import type { AdminMailServiceSnapshot } from "@/transport/client/api-client";

const isServiceField = (
  field: ProviderManifest["fields"][number],
): boolean => "scope" in field && field.scope === "service";

const defaultsFor = (
  provider: ProviderManifest | undefined,
): Record<string, string> =>
  Object.fromEntries(
    (provider?.fields ?? [])
      .filter(isServiceField)
      .map((field) => [field.name, field.defaultValue ?? ""]),
  );

export const useMailServiceFormModel = () => {
  const [providers, setProviders] = useState<readonly ProviderManifest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});

  const hydrate = useCallback((snapshot: AdminMailServiceSnapshot) => {
    setProviders(snapshot.providers);
    const configured = snapshot.configuration;
    const provider =
      snapshot.providers.find(
        (candidate) => candidate.id === configured?.providerId,
      ) ?? snapshot.providers[0];
    setSelectedId(provider?.id ?? "");
    setDisplayName(configured?.displayName ?? provider?.name ?? "");
    setAllowedDomains(configured?.allowedDomains.join("\n") ?? "");
    setValues({
      ...defaultsFor(provider),
      ...(configured?.config ?? {}),
    });
  }, []);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedId),
    [providers, selectedId],
  );

  const selectProvider = useCallback(
    (providerId: string) => {
      const provider = providers.find((candidate) => candidate.id === providerId);
      setSelectedId(providerId);
      setDisplayName(provider?.name ?? "");
      setValues(defaultsFor(provider));
    },
    [providers],
  );

  const displayNameInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => setDisplayName(event.target.value),
    [],
  );
  const allowedDomainsInput: ChangeEventHandler<HTMLTextAreaElement> =
    useCallback((event) => setAllowedDomains(event.target.value), []);
  const fieldInput = useCallback(
    (name: string): ChangeEventHandler<HTMLInputElement | HTMLSelectElement> =>
      (event) => {
        setValues((current) => ({
          ...current,
          [name]: event.target.value,
        }));
      },
    [],
  );

  return {
    allowedDomains,
    allowedDomainsInput,
    displayName,
    displayNameInput,
    fieldInput,
    hydrate,
    providers,
    selectProvider,
    selectedId,
    selectedProvider,
    values,
  };
};
