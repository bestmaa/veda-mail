import type { SetupStep } from "@/presentation/features/setup/setup-wizard.view-model";
import type { SetupFormData } from "@/presentation/features/setup/setup-wizard.types";

export const validateSetupStep = (
  step: SetupStep,
  form: SetupFormData,
  setupTokenConfigured: boolean,
): string | null => {
  if (step === "welcome" && !setupTokenConfigured) {
    return "Configure VEDA_MAIL_SETUP_TOKEN on the server, then restart this application.";
  }
  if (step === "welcome" && !form.setupToken.trim()) {
    return "Enter the setup token.";
  }
  if (step === "admin" && !form.adminUsername.trim()) {
    return "Choose an admin username.";
  }
  if (step === "admin" && form.adminPassword.length < 12) {
    return "Use at least 12 characters.";
  }
  if (
    step === "admin" &&
    (!/[a-z]/i.test(form.adminPassword) || !/\d/.test(form.adminPassword))
  ) {
    return "The admin password must contain a letter and a number.";
  }
  if (
    step === "admin" &&
    form.adminPassword !== form.adminPasswordConfirmation
  ) {
    return "Passwords do not match.";
  }
  if (
    step === "brand" &&
    (!form.organizationName.trim() || !form.productName.trim())
  ) {
    return "Organization and product names are required.";
  }
  if (
    step === "mail" &&
    (!form.providerId || !form.allowedDomains.trim())
  ) {
    return "Select a provider and add at least one email domain.";
  }
  return null;
};
