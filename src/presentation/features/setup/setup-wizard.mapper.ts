import type { ProviderManifest } from "@/domain/provider/provider";
import type {
  SetupFieldViewModel,
  SetupProviderViewModel,
} from "@/presentation/features/setup/setup-wizard.view-model";

type FieldInput = SetupFieldViewModel["onChange"];

export const serviceDefaultsFor = (
  provider?: ProviderManifest,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (provider?.fields ?? [])
      .filter((field) => field.scope === "service")
      .map((field) => [field.name, field.defaultValue ?? ""]),
  );

export const createSetupFieldViewModels = (
  provider: ProviderManifest | undefined,
  values: Readonly<Record<string, string>>,
  onInput: (name: string) => FieldInput,
): readonly SetupFieldViewModel[] =>
  (provider?.fields ?? [])
    .filter((field) => field.scope === "service")
    .map((field) => ({
      ...(field.help ? { help: field.help } : {}),
      kind: field.kind,
      label: field.label,
      name: field.name,
      onChange: onInput(field.name),
      options: field.options ?? [],
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      required: field.required,
      value: values[field.name] ?? "",
    }));

export const createSetupProviderViewModels = (
  providers: readonly ProviderManifest[],
  selectedId: string,
  onSelect: (provider: ProviderManifest) => void,
): readonly SetupProviderViewModel[] =>
  providers.map((provider) => ({
    description: provider.description,
    id: provider.id,
    isSelected: provider.id === selectedId,
    name: provider.name,
    onSelect: () => onSelect(provider),
  }));
