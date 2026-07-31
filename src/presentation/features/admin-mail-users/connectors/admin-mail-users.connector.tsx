"use client";

import { useAdminMailUsersModel } from "@/presentation/features/admin-mail-users/hooks/use-admin-mail-users-model";
import { AdminMailUsersView } from "@/presentation/features/admin-mail-users/ui/admin-mail-users.view";

export const AdminMailUsersConnector = () => (
  <AdminMailUsersView {...useAdminMailUsersModel()} />
);
