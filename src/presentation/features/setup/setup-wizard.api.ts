import type {
  SetupFormData,
  SetupSnapshot,
} from "@/presentation/features/setup/setup-wizard.types";

interface ApiEnvelope<T> {
  readonly data?: T;
  readonly error?: { readonly message?: string };
}

const parseData = async <T,>(response: Response): Promise<T> => {
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "The setup request failed.");
  }
  return payload.data;
};

const serializeSetup = (input: SetupFormData): FormData => {
  const body = new FormData();
  body.set("setupToken", input.setupToken.trim());
  body.set("adminUsername", input.adminUsername.trim());
  body.set("adminPassword", input.adminPassword);
  body.set("organizationName", input.organizationName.trim());
  body.set("productName", input.productName.trim());
  body.set("publicRepositoryUrl", input.publicRepositoryUrl.trim());
  body.set("primaryColor", input.primaryColor);
  body.set("accentColor", input.accentColor);
  body.set("providerId", input.providerId);
  body.set("providerDisplayName", input.providerDisplayName.trim());
  body.set("providerConfig", JSON.stringify(input.providerConfig));
  body.set("allowedDomains", input.allowedDomains);
  if (input.logo) {
    body.set("logo", input.logo);
  }
  return body;
};

export const setupWizardApi = {
  async complete(input: SetupFormData): Promise<void> {
    await parseData(
      await fetch("/api/v1/setup", {
        body: serializeSetup(input),
        method: "POST",
      }),
    );
  },

  async load(): Promise<SetupSnapshot> {
    return parseData(await fetch("/api/v1/setup"));
  },
};
