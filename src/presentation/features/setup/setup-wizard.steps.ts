import type { SetupStep } from "@/presentation/features/setup/setup-wizard.view-model";

export interface SetupStepDefinition {
  readonly id: SetupStep;
  readonly label: string;
}

export const SETUP_STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "admin", label: "Admin" },
  { id: "brand", label: "Brand" },
  { id: "mail", label: "Mail" },
  { id: "review", label: "Review" },
] satisfies readonly SetupStepDefinition[];
