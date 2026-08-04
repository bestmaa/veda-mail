import { describe, expect, it, vi } from "vitest";

import {
  exportVCards,
  importVCards,
  VCARD_LIMITS,
  VCardError,
} from "@/server/contacts/contact-vcard";

const card = (body: string, version = "4.0") =>
  `BEGIN:VCARD\r\nVERSION:${version}\r\n${body}\r\nEND:VCARD\r\n`;

describe("vCard import", () => {
  it("imports bounded vCard 3.0 and 4.0 text with folding and escaping", () => {
    const imported = importVCards(
      card(
        "FN:Dr. Jane\\, Doe\r\n" +
          "N:Doe;Jane;Quinn;Dr.;III\r\n" +
          "ORG:Veda \r\n Concepts\r\n" +
          "EMAIL;TYPE=WORK,PREF:jane@example.com\r\n" +
          "EMAIL;TYPE=home:jane@example.com\r\n" +
          "EMAIL;TYPE=HOME:other@example.com\r\n" +
          "CATEGORIES:Team\\, East,Friends\r\n" +
          "UID:contact-123",
        "3.0",
      ),
    );

    expect(imported).toEqual([
      {
        categories: ["Friends", "Team, East"],
        displayName: "Dr. Jane, Doe",
        emails: [
          {
            address: "jane@example.com",
            preferred: true,
            types: ["home", "work"],
          },
          {
            address: "other@example.com",
            preferred: false,
            types: ["home"],
          },
        ],
        organization: "Veda Concepts",
        structuredName: {
          additional: "Quinn",
          family: "Doe",
          given: "Jane",
          prefix: "Dr.",
          suffix: "III",
        },
        uid: "contact-123",
      },
    ]);
  });

  it("ignores active, binary, and URI properties without fetching them", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const imported = importVCards(
      card(
        "FN:Safe Contact\r\n" +
          "EMAIL:safe@example.com\r\n" +
          "PHOTO;VALUE=uri:https://attacker.invalid/photo\r\n" +
          "LOGO:data:image/png;base64,AAAA\r\n" +
          "KEY;ENCODING=b:AAAA\r\n" +
          "AGENT:https://attacker.invalid/card.vcf\r\n" +
          "URL:https://attacker.invalid/",
      ),
    );

    expect(imported[0]?.displayName).toBe("Safe Contact");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ["malformed Unicode", card("FN:Bad\ud800\r\nEMAIL:a@example.com"), "valid UTF-8"],
    ["bare carriage return", "BEGIN:VCARD\rVERSION:4.0", "Bare carriage"],
    ["header injection", card("FN:Bad\\nInjected\r\nEMAIL:a@example.com"), "unsafe"],
    ["control byte", card("FN:Safe\r\nEMAIL:a@example.com\r\nX-UNKNOWN:\u0001"), "unsafe"],
    ["URI email", card("FN:Safe\r\nEMAIL;VALUE=uri:mailto:a@example.com"), "URI email"],
    ["encoded email", card("FN:Safe\r\nEMAIL;ENCODING=b:YUBleGFtcGxlLmNvbQ=="), "Encoded"],
    ["missing FN", card("EMAIL:a@example.com"), "incomplete"],
    ["missing email", card("FN:No address"), "no email"],
    ["invalid email", card("FN:Bad\r\nEMAIL:not-an-address"), "Invalid email"],
    ["duplicate FN", card("FN:One\r\nFN:Two\r\nEMAIL:a@example.com"), "Duplicate FN"],
    ["unterminated", "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEMAIL:a@example.com", "missing END"],
  ])("rejects %s with a useful error", (_name, input, message) => {
    expect(() => importVCards(input)).toThrow(message);
  });

  it("enforces byte, unfolded-line, property, email, and category limits", () => {
    expect(() => importVCards("x".repeat(VCARD_LIMITS.inputBytes + 1))).toThrow("too large");
    expect(() =>
      importVCards(card(`FN:${"x".repeat(VCARD_LIMITS.unfoldedLineBytes)}\r\nEMAIL:a@example.com`)),
    ).toThrow("Unfolded property");

    const properties = Array.from({ length: 253 }, (_, index) => `X-${index}:x`).join("\r\n");
    expect(() => importVCards(card(`FN:A\r\nEMAIL:a@example.com\r\n${properties}`))).toThrow("Too many properties");

    const emails = Array.from(
      { length: VCARD_LIMITS.emails + 1 },
      (_, index) => `EMAIL:a${index}@example.com`,
    ).join("\r\n");
    expect(() => importVCards(card(`FN:A\r\n${emails}`))).toThrow("Too many email");

    const categories = Array.from(
      { length: VCARD_LIMITS.categories + 1 },
      (_, index) => `c${index}`,
    ).join(",");
    expect(() => importVCards(card(`FN:A\r\nEMAIL:a@example.com\r\nCATEGORIES:${categories}`))).toThrow("Too many categories");
  });

  it("reports the original physical line for malformed content", () => {
    expect(() => importVCards(card("FN:Safe\r\nBROKEN\r\nEMAIL:a@example.com"))).toThrow(
      new VCardError("Malformed content line.", 4),
    );
  });
});

describe("vCard export", () => {
  const contact = {
    categories: ["Partners", "North, East", "Partners"],
    displayName: `Jane \\ Doe, ${"é".repeat(50)}`,
    emails: [
      { address: "z@example.com", preferred: false, types: ["home"] },
      { address: "A@example.com", preferred: true, types: ["work"] },
      { address: "a@example.com", preferred: false, types: ["other"] },
    ],
    organization: "Veda; Concepts",
    structuredName: {
      additional: "Q",
      family: "Doe",
      given: "Jane",
      prefix: "Dr.",
      suffix: "III",
    },
    uid: "uid-1",
  } as const;

  it("exports deterministic CRLF vCard 4.0 with UTF-8-safe 75-octet folding", () => {
    const first = exportVCards([contact]);
    const second = exportVCards([contact]);

    expect(first).toBe(second);
    expect(first).toContain("VERSION:4.0\r\n");
    expect(first).toContain("ORG:Veda\\; Concepts\r\n");
    expect(first.match(/^EMAIL/gmu)).toHaveLength(2);
    expect(first).toContain("EMAIL;TYPE=OTHER;TYPE=WORK;PREF=1:A@example.com");
    expect(first).toContain("CATEGORIES:North\\, East,Partners");
    expect(first.split("\r\n").every((line) => new TextEncoder().encode(line).byteLength <= 75)).toBe(true);
    expect(first.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("round-trips supported fields and canonicalizes duplicates", () => {
    const imported = importVCards(exportVCards([contact]))[0]!;

    expect(imported.displayName).toBe(contact.displayName);
    expect(imported.organization).toBe(contact.organization);
    expect(imported.categories).toEqual(["North, East", "Partners"]);
    expect(imported.emails.map((email) => email.address)).toEqual([
      "A@example.com",
      "z@example.com",
    ]);
  });

  it.each([
    [{ ...contact, displayName: "Injected\r\nEMAIL:attacker@example.com" }, "unsafe"],
    [{ ...contact, emails: [] }, "email list"],
    [{ ...contact, emails: [{ address: "mailto:a@example.com", preferred: false, types: [] }] }, "Invalid email"],
    [{ ...contact, categories: Array.from({ length: VCARD_LIMITS.categories + 1 }, (_, index) => `c${index}`) }, "Too many categories"],
  ])("rejects unsafe export data", (value, message) => {
    expect(() => exportVCards([value])).toThrow(message);
  });
});
