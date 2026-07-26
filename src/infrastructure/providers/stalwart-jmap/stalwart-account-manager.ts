import "server-only";

import type {
  MemberPasswordChange,
  MemberProfile,
  MemberProfileUpdate,
} from "@/domain/member/member-settings";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapIdentityResultSchema,
  jmapSetResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_SUBMISSION,
  STALWART_JMAP,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export class StalwartAccountManager {
  public constructor(
    private readonly client: StalwartJmapClient,
    private readonly reader: StalwartMailReader,
  ) {}

  public async getProfile(): Promise<MemberProfile> {
    const account = await this.reader.getAccount();
    const identity = await this.getIdentity(account.email);
    return {
      displayName: identity.name?.trim() || account.name,
      email: identity.email,
    };
  }

  public async updateProfile(
    input: MemberProfileUpdate,
  ): Promise<MemberProfile> {
    const account = await this.reader.getAccount();
    const identity = await this.getIdentity(account.email);
    const response = await this.client.request(
      [
        [
          "Identity/set",
          {
            accountId: await this.reader.getAccountId(),
            update: { [identity.id]: { name: input.displayName } },
          },
          "profile",
        ],
      ],
      [JMAP_SUBMISSION],
    );
    const result = this.client.result(
      response,
      "profile",
      "Identity/set",
      jmapSetResultSchema,
    );
    if (result.notUpdated?.[identity.id]) {
      throw new Error("Stalwart rejected the profile update.");
    }
    return { displayName: input.displayName, email: identity.email };
  }

  public async changePassword(input: MemberPasswordChange): Promise<void> {
    const update = {
      currentSecret: input.currentPassword,
      secret: input.newPassword,
      ...(input.otpCode ? { otpAuth: { otpCode: input.otpCode } } : {}),
    };
    const response = await this.client.request(
      [
        [
          "x:AccountPassword/set",
          { update: { singleton: update } },
          "password",
        ],
      ],
      [STALWART_JMAP],
    );
    const result = this.client.result(
      response,
      "password",
      "x:AccountPassword/set",
      jmapSetResultSchema,
    );
    if (result.notUpdated?.["singleton"]) {
      throw new Error("Stalwart rejected the password update.");
    }
  }

  private async getIdentity(email: string) {
    const response = await this.client.request(
      [
        [
          "Identity/get",
          { accountId: await this.reader.getAccountId(), ids: null },
          "identities",
        ],
      ],
      [JMAP_SUBMISSION],
    );
    const result = this.client.result(
      response,
      "identities",
      "Identity/get",
      jmapIdentityResultSchema,
    );
    const identity =
      result.list.find(
        (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
      ) ?? result.list[0];
    if (!identity) {
      throw new Error("No sending identity is configured in Stalwart.");
    }
    return identity;
  }
}
