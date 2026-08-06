"use client";

import { useAdminSecurityAuditModel } from "@/presentation/features/admin-security-audit/hooks/use-admin-security-audit-model";
import { AdminSecurityAuditView } from "@/presentation/features/admin-security-audit/ui/admin-security-audit.view";

export const AdminSecurityAuditConnector = () => (
  <AdminSecurityAuditView {...useAdminSecurityAuditModel()} />
);
