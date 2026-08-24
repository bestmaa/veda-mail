import type {
  AdminMailUserCreateResult,
  AdminMailUserDetail,
  AdminMailUserLifecycleResult,
  AdminMailUserPage,
  MailUserCreationAvailability,
} from "@/domain/admin/mail-user";

export interface AdminMailUserListInput {
  readonly cursor?: string;
  readonly domain: string;
  readonly limit: number;
  readonly query?: string;
}

export interface AdminMailUserDetailInput {
  readonly domain: string;
  readonly userId: string;
}

export interface AdminMailUserCreateInput {
  readonly displayName?: string;
  readonly email: string;
  readonly password: string;
}

export interface AdminMailUserLifecycleInput extends AdminMailUserDetailInput {
  readonly expectedEmail: string;
  readonly operation: "disable" | "delete";
}

export interface MailUserAdministrationPort {
  createUser(input: AdminMailUserCreateInput): Promise<AdminMailUserCreateResult>;
  getCreationAvailability(domain: string): Promise<MailUserCreationAvailability>;
  getUser(input: AdminMailUserDetailInput): Promise<AdminMailUserDetail>;
  mutateUser(input: AdminMailUserLifecycleInput): Promise<AdminMailUserLifecycleResult>;
  listUsers(input: AdminMailUserListInput): Promise<AdminMailUserPage>;
}
