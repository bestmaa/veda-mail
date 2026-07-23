"use client";

import { useCallback, useMemo, useState } from "react";

import { SETUP_STEPS } from "@/presentation/features/setup/setup-wizard.steps";
import type {
  SetupStep,
  SetupStepViewModel,
} from "@/presentation/features/setup/setup-wizard.view-model";

export const useSetupNavigationModel = () => {
  const [stepIndex, setStepIndex] = useState(0);
  const step: SetupStep = SETUP_STEPS[stepIndex]?.id ?? "welcome";
  const back = useCallback(() => {
    setStepIndex((current) => Math.max(current - 1, 0));
  }, []);
  const next = useCallback(() => {
    setStepIndex((current) =>
      Math.min(current + 1, SETUP_STEPS.length - 1),
    );
  }, []);
  const steps = useMemo<readonly SetupStepViewModel[]>(
    () =>
      SETUP_STEPS.map((definition, index) => ({
        id: definition.id,
        isActive: index === stepIndex,
        label: definition.label,
        number: index + 1,
      })),
    [stepIndex],
  );
  return {
    back,
    canGoBack: stepIndex > 0,
    next,
    step,
    steps,
  };
};
