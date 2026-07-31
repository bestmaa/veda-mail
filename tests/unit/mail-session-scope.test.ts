import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  assertMailSessionScope,
  MAIL_SESSION_SCOPE_HEADER,
  mailSessionScope,
} from "@/server/connections/mail-session-scope";

const connection = (value: string) => ({
  id: id.connection(value),
});

describe("mail session scope", () => {
  it("is stable for one connection and distinct across connections", () => {
    expect(mailSessionScope(connection("account-a"))).toBe(
      mailSessionScope(connection("account-a")),
    );
    expect(mailSessionScope(connection("account-a"))).not.toBe(
      mailSessionScope(connection("account-b")),
    );
  });

  it("rejects missing or stale preconditions", () => {
    const current = connection("account-b");
    for (const supplied of [
      undefined,
      mailSessionScope(connection("account-a")),
    ]) {
      const request = new Request("https://mail.example.com", {
        ...(supplied
          ? { headers: { [MAIL_SESSION_SCOPE_HEADER]: supplied } }
          : {}),
      });
      expect(() => assertMailSessionScope(request, current)).toThrowError(
        expect.objectContaining({
          code: "MAIL_SESSION_CHANGED",
          status: 409,
        }),
      );
    }
  });

  it("accepts only the current connection precondition", () => {
    const current = connection("account-a");
    const request = new Request("https://mail.example.com", {
      headers: {
        [MAIL_SESSION_SCOPE_HEADER]: mailSessionScope(current),
      },
    });

    expect(() => assertMailSessionScope(request, current)).not.toThrow();
  });
});
