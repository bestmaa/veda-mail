"use client";

import {
  useCallback,
  useState,
  type ChangeEventHandler,
} from "react";

import type { ProviderManifest } from "@/domain/provider/provider";
import { serviceDefaultsFor } from "@/presentation/features/setup/setup-wizard.mapper";
import type {
  SetupFormData,
  SetupTextField,
} from "@/presentation/features/setup/setup-wizard.types";

const INITIAL_FORM: SetupFormData = {
  accentColor: "#ff785a",
  adminPassword: "",
  adminPasswordConfirmation: "",
  adminUsername: "",
  allowedDomains: "",
  logo: null,
  organizationName: "",
  primaryColor: "#2f3274",
  productName: "Veda Mail",
  providerConfig: {},
  providerDisplayName: "",
  providerId: "",
  publicRepositoryUrl: "https://github.com/bestmaa/veda-mail",
  setupToken: "",
};

export const useSetupFormModel = () => {
  const [data, setData] = useState<SetupFormData>(INITIAL_FORM);
  const update = useCallback(
    <K extends keyof SetupFormData>(key: K, value: SetupFormData[K]) => {
      setData((current) => ({ ...current, [key]: value }));
    },
    [],
  );
  const input = useCallback(
    (field: SetupTextField): ChangeEventHandler<HTMLInputElement> =>
      (event) => update(field, event.target.value),
    [update],
  );
  const allowedDomainsInput: ChangeEventHandler<HTMLTextAreaElement> =
    useCallback(
      (event) => update("allowedDomains", event.target.value),
      [update],
    );
  const logoInput: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => update("logo", event.target.files?.[0] ?? null),
    [update],
  );
  const providerFieldInput = useCallback(
    (
      name: string,
    ): ChangeEventHandler<HTMLInputElement | HTMLSelectElement> =>
      (event) =>
        setData((current) => ({
          ...current,
          providerConfig: {
            ...current.providerConfig,
            [name]: event.target.value,
          },
        })),
    [],
  );
  const selectProvider = useCallback((provider?: ProviderManifest) => {
    setData((current) => ({
      ...current,
      providerConfig: serviceDefaultsFor(provider),
      providerDisplayName: provider?.name ?? "",
      providerId: provider?.id ?? "",
    }));
  }, []);
  return {
    allowedDomainsInput,
    data,
    input,
    logoInput,
    providerFieldInput,
    selectProvider,
  };
};
