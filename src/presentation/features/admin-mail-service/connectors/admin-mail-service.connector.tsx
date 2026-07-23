"use client";

import { useAdminMailServiceModel } from "@/presentation/features/admin-mail-service/hooks/use-admin-mail-service-model";
import { AdminMailServiceView } from "@/presentation/features/admin-mail-service/ui/admin-mail-service.view";

export const AdminMailServiceConnector = () => {
  const viewProps = useAdminMailServiceModel();
  return <AdminMailServiceView {...viewProps} />;
};
