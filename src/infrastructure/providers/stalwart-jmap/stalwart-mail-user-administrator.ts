import "server-only";

import type {
  AdminMailUserCreateInput,
  AdminMailUserDetailInput,
  AdminMailUserListInput,
  MailUserAdministrationPort,
} from "@/application/ports/mail-user-administration.port";
import type {
  AdminMailUserCreateResult,
  AdminMailUserDetail,
  AdminMailUserPage,
  MailUserCreationAvailability,
} from "@/domain/admin/mail-user";
import { StalwartManagementClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import { StalwartMailUserDirectory } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-directory";
import { translateMailUserError } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-errors";
import { StalwartMailUserProvisioner } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-provisioner";

export interface StalwartMailUserAdministratorConfig {
  readonly allowedDomains: readonly string[];
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly expectedOrigin: string;
}

export class StalwartMailUserAdministrator
  implements MailUserAdministrationPort
{
  private readonly directory: StalwartMailUserDirectory;
  private readonly provisioner: StalwartMailUserProvisioner;

  public constructor(config: StalwartMailUserAdministratorConfig) {
    const client = new StalwartManagementClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      expectedOrigin: config.expectedOrigin,
    });
    this.directory = new StalwartMailUserDirectory(
      client,
      config.allowedDomains,
    );
    this.provisioner = new StalwartMailUserProvisioner(client, this.directory);
  }

  public async getCreationAvailability(
    domain: string,
  ): Promise<MailUserCreationAvailability> {
    try {
      return await this.directory.getAvailability(domain);
    } catch (error) {
      throw translateMailUserError(error);
    }
  }

  public async listUsers(
    input: AdminMailUserListInput,
  ): Promise<AdminMailUserPage> {
    try {
      return await this.directory.list(input);
    } catch (error) {
      throw translateMailUserError(error);
    }
  }

  public async getUser(
    input: AdminMailUserDetailInput,
  ): Promise<AdminMailUserDetail> {
    try {
      return await this.directory.get(input);
    } catch (error) {
      throw translateMailUserError(error);
    }
  }

  public async createUser(
    input: AdminMailUserCreateInput,
  ): Promise<AdminMailUserCreateResult> {
    try {
      return await this.provisioner.create(input);
    } catch (error) {
      throw translateMailUserError(error);
    }
  }
}

export const createStalwartMailUserAdministrator = (
  config: StalwartMailUserAdministratorConfig,
): MailUserAdministrationPort => new StalwartMailUserAdministrator(config);
