"use client";

import { useSetupWizardModel } from "@/presentation/features/setup/hooks/use-setup-wizard-model";
import { SetupAdminView } from "@/presentation/features/setup/ui/setup-admin.view";
import { SetupBrandView } from "@/presentation/features/setup/ui/setup-brand.view";
import { SetupLayoutView } from "@/presentation/features/setup/ui/setup-layout.view";
import { SetupMailView } from "@/presentation/features/setup/ui/setup-mail.view";
import { SetupReviewView } from "@/presentation/features/setup/ui/setup-review.view";
import { SetupSuccessView } from "@/presentation/features/setup/ui/setup-success.view";
import { SetupWelcomeView } from "@/presentation/features/setup/ui/setup-welcome.view";

export const SetupWizardConnector = () => {
  const model = useSetupWizardModel();
  const content = model.success ? (
    <SetupSuccessView />
  ) : model.step === "admin" ? (
    <SetupAdminView model={model} />
  ) : model.step === "brand" ? (
    <SetupBrandView model={model} />
  ) : model.step === "mail" ? (
    <SetupMailView model={model} />
  ) : model.step === "review" ? (
    <SetupReviewView model={model} />
  ) : (
    <SetupWelcomeView model={model} />
  );
  return (
    <SetupLayoutView footer={null} model={model}>
      {content}
    </SetupLayoutView>
  );
};
