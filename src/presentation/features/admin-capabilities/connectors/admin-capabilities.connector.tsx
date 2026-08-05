"use client";

import { useAdminCapabilitiesModel } from "@/presentation/features/admin-capabilities/hooks/use-admin-capabilities-model";
import { AdminCapabilitiesView } from "@/presentation/features/admin-capabilities/ui/admin-capabilities.view";

export const AdminCapabilitiesConnector = () => (
  <AdminCapabilitiesView {...useAdminCapabilitiesModel()} />
);
