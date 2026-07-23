import "server-only";

import type {
  MailServiceProfile,
  MailServiceProfileInput,
} from "@/domain/provider/provider";
import { installationStore } from "@/server/installation/installation.store";

export const mailServiceProfileStore = {
  async get(): Promise<MailServiceProfile | null> {
    return (await installationStore.get())?.mailProfile ?? null;
  },

  async put(input: MailServiceProfileInput): Promise<MailServiceProfile> {
    return installationStore.updateMailProfile(input);
  },
};
