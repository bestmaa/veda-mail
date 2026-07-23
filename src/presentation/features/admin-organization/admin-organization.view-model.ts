import type {
  ChangeEventHandler,
  CSSProperties,
  FormEventHandler,
} from "react";

export interface AdminOrganizationViewProps {
  readonly accentColor: string;
  readonly accentColorInput: ChangeEventHandler<HTMLInputElement>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly logoFileName: string | null;
  readonly logoInput: ChangeEventHandler<HTMLInputElement>;
  readonly logoUrl: string | null;
  readonly onRemoveLogo: () => void;
  readonly onSubmit: FormEventHandler<HTMLFormElement>;
  readonly organizationName: string;
  readonly organizationNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly primaryColor: string;
  readonly primaryColorInput: ChangeEventHandler<HTMLInputElement>;
  readonly productName: string;
  readonly productNameInput: ChangeEventHandler<HTMLInputElement>;
  readonly publicRepositoryUrl: string;
  readonly publicRepositoryUrlInput: ChangeEventHandler<HTMLInputElement>;
  readonly removeLogo: boolean;
  readonly style: CSSProperties;
  readonly success: string | null;
}
