import "server-only";

import type { ImapFlow } from "imapflow";

import type {
  DelegationCapability,
  DelegationEntry,
  DelegationUpdate,
} from "@/domain/mail/delegation";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { ApiError } from "@/transport/http/api-error";

const MAILBOX = "INBOX" as const;
const READ_RIGHTS = "lr";
const MANAGE_RIGHTS = "lrswite";

interface ImapAttribute { readonly value?: unknown }
interface ImapUntagged { readonly attributes?: readonly ImapAttribute[] }
interface ImapResponse { next(): void }
interface ImapCommandClient {
  exec(
    command: string,
    attributes: readonly { readonly type: "ATOM" | "STRING"; readonly value: string }[],
    options?: { readonly untagged: Readonly<Record<string, (response: ImapUntagged) => void>> },
  ): Promise<ImapResponse>;
}

const unsupportedReason =
  "This provider does not advertise the standard IMAP ACL capability.";

const capability = (client: ImapFlow): DelegationCapability =>
  client.capabilities.has("ACL")
    ? { mailbox: MAILBOX, supported: true }
    : { reason: unsupportedReason, supported: false };

const assertSupported = (client: ImapFlow): void => {
  if (!client.capabilities.has("ACL")) {
    throw new ApiError(unsupportedReason, "DELEGATION_PROVIDER_UNSUPPORTED", 422);
  }
};

const value = (attribute: ImapAttribute | undefined): string | null =>
  typeof attribute?.value === "string" ? attribute.value : null;

const accessFor = (rights: string): DelegationEntry["access"] | null => {
  const normalized = new Set(rights.toLowerCase().replace(/[cd]/gu, ""));
  const exact = (preset: string) => normalized.size === preset.length
    && [...preset].every((right) => normalized.has(right));
  if (exact(MANAGE_RIGHTS)) return "manage";
  return exact(READ_RIGHTS) ? "read" : null;
};

const isVisibleDelegate = (identifier: string, owner: string): boolean => {
  const normalized = identifier.toLowerCase();
  return normalized !== owner.toLowerCase()
    && normalized !== "anyone"
    && normalized !== "anonymous"
    && !identifier.startsWith("-");
};

const assertMutableIdentifier = (identifier: string, owner: string): void => {
  if (!isVisibleDelegate(identifier, owner)) {
    throw new ApiError(
      "The mailbox owner and reserved identities cannot be delegated.",
      "DELEGATION_IDENTIFIER_FORBIDDEN",
      422,
    );
  }
};

const read = async (
  client: ImapFlow,
  owner: string,
): Promise<readonly DelegationEntry[]> => {
  assertSupported(client);
  const entries: DelegationEntry[] = [];
  const response = await (client as unknown as ImapCommandClient).exec(
    "GETACL",
    [{ type: "ATOM", value: MAILBOX }],
    { untagged: { ACL: (untagged) => {
      const attributes = untagged.attributes ?? [];
      for (let index = 1; index + 1 < attributes.length; index += 2) {
        const identifier = value(attributes[index]);
        const rights = value(attributes[index + 1]);
        const access = rights === null ? null : accessFor(rights);
        if (identifier && access && isVisibleDelegate(identifier, owner)) {
          entries.push({ access, identifier });
        }
      }
    } } },
  );
  response.next();
  return entries.sort((left, right) => left.identifier.localeCompare(right.identifier));
};

const mutate = async (
  client: ImapFlow,
  command: "DELETEACL" | "SETACL",
  identifier: string,
  rights?: string,
): Promise<void> => {
  const response = await (client as unknown as ImapCommandClient).exec(command, [
    { type: "ATOM", value: MAILBOX },
    { type: "STRING", value: identifier },
    ...(rights ? [{ type: "ATOM" as const, value: rights }] : []),
  ]);
  response.next();
};

const confirm = async (client: ImapFlow, owner: string) => {
  try {
    return await read(client, owner);
  } catch {
    throw new ApiError(
      "The provider may have applied the delegation, but confirmation was unavailable.",
      "DELEGATION_CONFIRMATION_UNAVAILABLE",
      502,
    );
  }
};

export class ImapDelegationAdapter {
  public constructor(private readonly config: ImapSmtpMemberConfig) {}

  public getCapability(): Promise<DelegationCapability> {
    return withImapClient(this.config, async (client) => capability(client));
  }

  public list(): Promise<readonly DelegationEntry[]> {
    return withImapClient(this.config, (client) => read(client, this.config.username));
  }

  public set(input: DelegationUpdate): Promise<readonly DelegationEntry[]> {
    return withImapClient(this.config, async (client) => {
      assertSupported(client);
      assertMutableIdentifier(input.identifier, this.config.username);
      await mutate(client, "SETACL", input.identifier,
        input.access === "manage" ? MANAGE_RIGHTS : READ_RIGHTS);
      const entries = await confirm(client, this.config.username);
      const applied = entries.find(({ identifier }) =>
        identifier.toLowerCase() === input.identifier.toLowerCase());
      if (!applied || applied.access !== input.access) {
        throw new ApiError(
          "The provider did not confirm the requested mailbox delegation.",
          "DELEGATION_CONFIRMATION_FAILED",
          502,
        );
      }
      return entries;
    });
  }

  public delete(identifier: string): Promise<readonly DelegationEntry[]> {
    return withImapClient(this.config, async (client) => {
      assertSupported(client);
      assertMutableIdentifier(identifier, this.config.username);
      await mutate(client, "DELETEACL", identifier);
      const entries = await confirm(client, this.config.username);
      if (entries.some((entry) =>
        entry.identifier.toLowerCase() === identifier.toLowerCase())) {
        throw new ApiError(
          "The provider did not confirm removal of the mailbox delegation.",
          "DELEGATION_CONFIRMATION_FAILED",
          502,
        );
      }
      return entries;
    });
  }
}
