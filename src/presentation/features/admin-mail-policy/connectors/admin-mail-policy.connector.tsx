"use client";

import { useAdminMailPolicyModel } from "@/presentation/features/admin-mail-policy/hooks/use-admin-mail-policy-model";
import { AdminMailPolicyView } from "@/presentation/features/admin-mail-policy/ui/admin-mail-policy.view";

export const AdminMailPolicyConnector = () => (
  <AdminMailPolicyView {...useAdminMailPolicyModel()} />
);
