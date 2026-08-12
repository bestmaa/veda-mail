import "server-only";

import { createHash } from "node:crypto";

import type {
  VacationCapability,
  VacationResponse,
  VacationResponseUpdate,
} from "@/domain/mail/vacation";
import { VEDA_MANAGE_SIEVE_SCRIPT } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import type { ManageSieveClient } from "@/infrastructure/providers/imap-smtp/manage-sieve-client";
import type { ManageSieveCompiler } from "@/infrastructure/providers/imap-smtp/manage-sieve-compiler";
import type { ManageSieveSession } from "@/infrastructure/providers/imap-smtp/manage-sieve-transport";
import { ApiError } from "@/transport/http/api-error";

const MAX_SCRIPT_BYTES = 256 * 1024;
const REQUIRED_EXTENSIONS = ["date", "relational", "vacation"] as const;

const unsupported = (reason: string): VacationCapability => ({ reason, supported: false });
const conflict = (message: string): never => {
  throw new ApiError(message, "VACATION_RESPONSE_CONFLICT", 409);
};
const failed = (message = "The provider could not update the vacation response."): never => {
  throw new ApiError(message, "VACATION_PROVIDER_FAILED", 502);
};
const hash = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("base64url");

const exactText = (bytes: Uint8Array): string => {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SCRIPT_BYTES) {
    return conflict("The existing Veda script could not be verified safely.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return conflict("The existing Veda script is not valid UTF-8.");
  }
};

interface Snapshot {
  readonly content: string | null;
  readonly fullState: string;
}

export class ManageSieveVacationAdapter {
  public constructor(
    private readonly client: ManageSieveClient,
    private readonly compiler: ManageSieveCompiler,
  ) {}

  public async getCapability(): Promise<VacationCapability> {
    try {
      return await this.client.use(async (_session, discovered) => {
        const missing = REQUIRED_EXTENSIONS.find(
          (item) => !discovered.extensions.has(item),
        );
        return missing ? unsupported(
          `ManageSieve does not advertise the required ${missing} extension.`,
        ) : { supported: true };
      });
    } catch {
      return unsupported("ManageSieve discovery or authentication failed.");
    }
  }

  public async get(): Promise<VacationResponse> {
    return this.client.use(async (session, discovered) => {
      this.assertExtensions(discovered.extensions);
      const snapshot = await this.snapshot(session);
      try {
        return this.compiler.readVacation(snapshot.content);
      } catch {
        return conflict("The existing Veda vacation response could not be verified safely.");
      }
    });
  }

  public async set(input: VacationResponseUpdate): Promise<VacationResponse> {
    try {
      return await this.client.use(async (session, discovered) => {
        this.assertExtensions(discovered.extensions);
        const initial = await this.snapshot(session);
        const current = this.compiler.readVacation(initial.content);
        if (current.revision !== input.expectedRevision) {
          conflict("Vacation settings changed at the provider. Reload and try again.");
        }
        const compiled = this.compiler.compileVacation(initial.content, input);
        const missing = compiled.requiredExtensions.find(
          (item) => !discovered.extensions.has(item.toLowerCase()),
        );
        if (missing) {
          throw new ApiError(
            `ManageSieve does not advertise the required ${missing} extension.`,
            "VACATION_PROVIDER_UNSUPPORTED",
            422,
          );
        }
        const bytes = new TextEncoder().encode(compiled.content);
        if (bytes.byteLength < 1 || bytes.byteLength > MAX_SCRIPT_BYTES) {
          throw new ApiError(
            "The composed rules and vacation script exceeds the provider limit.",
            "VACATION_PROVIDER_UNSUPPORTED",
            422,
          );
        }
        if (initial.content === compiled.content) return current;
        await this.client.check(session, bytes);
        const preflight = await this.snapshot(session);
        if (preflight.fullState !== initial.fullState) {
          conflict("Provider rules or vacation settings changed during the update.");
        }
        await this.client.put(session, VEDA_MANAGE_SIEVE_SCRIPT, bytes);
        const beforeActivation = await this.client.list(session);
        if (beforeActivation.some(({ active, name }) =>
          active && name !== VEDA_MANAGE_SIEVE_SCRIPT)) {
          conflict("Another provider script became active. Veda Mail left it active.");
        }
        await this.client.activate(session, VEDA_MANAGE_SIEVE_SCRIPT);
        const confirmed = await this.snapshot(session);
        if (confirmed.content !== compiled.content) failed();
        return this.compiler.readVacation(confirmed.content);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return failed();
    }
  }

  private assertExtensions(extensions: ReadonlySet<string>): void {
    const missing = REQUIRED_EXTENSIONS.find((item) => !extensions.has(item));
    if (missing) {
      throw new ApiError(
        `ManageSieve does not advertise the required ${missing} extension.`,
        "VACATION_PROVIDER_UNSUPPORTED",
        422,
      );
    }
  }

  private async snapshot(session: ManageSieveSession): Promise<Snapshot> {
    const scripts = await this.client.list(session);
    const active = scripts.filter((item) => item.active);
    const named = scripts.filter((item) => item.name === VEDA_MANAGE_SIEVE_SCRIPT);
    if (active.length > 1 || named.length > 1) {
      conflict("The provider has ambiguous active Sieve scripts.");
    }
    if (active[0] && active[0].name !== VEDA_MANAGE_SIEVE_SCRIPT) {
      conflict("Another provider script is active. Veda Mail left it unchanged.");
    }
    if (!named[0]) return { content: null, fullState: hash(new Uint8Array()) };
    let bytes = await this.client.get(session, VEDA_MANAGE_SIEVE_SCRIPT);
    let content = exactText(bytes);
    if (!this.compiler.verifyOwnership(content) && content.endsWith("\r\n")) {
      const canonical = content.slice(0, -2);
      if (this.compiler.verifyOwnership(canonical)) {
        content = canonical;
        bytes = new TextEncoder().encode(canonical);
      }
    }
    if (!this.compiler.verifyOwnership(content)) {
      conflict("The provider script named for Veda Mail is not owned by this installation.");
    }
    return { content, fullState: hash(bytes) };
  }
}
