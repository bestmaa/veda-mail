import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import {
  calendarEventOwnerKey,
} from "@/server/calendar/event-crypto";
import { calendarEventFilePath } from "@/server/calendar/event-file";
import type { CalendarEventOwner } from "@/server/calendar/event-owner";
import { calendarEventFileSchema } from "@/server/calendar/event-record";
import { calendarEventStore } from "@/server/calendar/event-store";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let directory = "";
const owner: CalendarEventOwner = {
  email: "member@example.com",
  providerId: "mock",
};
const instant = (value: string) => ({
  kind: "date-time" as const,
  value,
  zone: { kind: "utc" as const },
});
const privateEvent: CalendarEvent = {
  attendees: [{
    email: "guest@example.com",
    name: "Private guest",
    participationStatus: "NEEDS-ACTION",
    rsvp: true,
  }],
  description: "Private description",
  dtstamp: instant("2026-08-04T08:00:00"),
  duration: "PT1H",
  endsAt: null,
  location: "Private room",
  organizer: { email: "owner@example.com", name: "Owner" },
  recurrenceId: null,
  recurrenceRule: null,
  sequence: 1,
  startsAt: instant("2026-08-05T08:00:00"),
  summary: "Private planning",
  uid: "private-event@example.com",
};

const installationDraft = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"],
    config: {},
    displayName: "Test mail",
    providerId: id.provider("mock"),
  },
  organization: {
    accentColor: "#ff6b57",
    logoFileName: null,
    organizationName: "Example",
    primaryColor: "#27276f",
    productName: "Mail",
    publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"),
    username: "owner",
  },
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-calendar-events-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  await installationStore.complete(installationDraft);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

const create = () => calendarEventStore.put(owner, {
  event: privateEvent,
  expectedRevision: null,
  operation: "import-event",
});

describe("calendar event store security", () => {
  it("encrypts canonical fields, uses mode 0600, and isolates owners", async () => {
    const book = await create();
    const [raw, metadata] = await Promise.all([
      readFile(calendarEventFilePath(), "utf8"),
      stat(calendarEventFilePath()),
    ]);
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(raw).not.toMatch(
      /private-event|Private planning|Private description|guest@example/u,
    );
    await expect(calendarEventStore.get({
      email: "member@EXAMPLE.COM",
      providerId: "MOCK",
    })).resolves.toMatchObject({ revision: book.revision });
    await expect(calendarEventStore.get({
      email: "Member@example.com",
      providerId: "mock",
    })).resolves.toMatchObject({ events: [], revision: null });
  });

  it("enforces revision and fails closed on authentication-tag tampering", async () => {
    await create();
    await expect(create()).rejects.toMatchObject({
      code: "CALENDAR_EVENT_BOOK_CONFLICT",
      status: 409,
    });
    const installation = await installationStore.get();
    if (!installation) throw new Error("Installation missing.");
    const key = calendarEventOwnerKey(owner, installation.sessionSecret);
    const file = calendarEventFileSchema.parse(
      JSON.parse(await readFile(calendarEventFilePath(), "utf8")),
    );
    const encrypted = file.owners[key]!;
    const tag = `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`;
    await writeFile(calendarEventFilePath(), JSON.stringify({
      ...file,
      owners: { ...file.owners, [key]: { ...encrypted, tag } },
    }), { mode: 0o600 });
    await expect(calendarEventStore.get(owner)).rejects.toMatchObject({
      code: "CALENDAR_EVENT_STORE_UNAVAILABLE",
      status: 500,
    });
  });

  it("preserves an encrypted revision after removing the final event", async () => {
    const created = await create();
    const removed = await calendarEventStore.put(owner, {
      expectedRevision: created.revision,
      operation: "remove-event",
      recurrenceId: null,
      uid: privateEvent.uid,
    });
    expect(removed).toMatchObject({ events: [] });
    expect(removed.revision).not.toBeNull();
    await expect(create()).rejects.toMatchObject({
      code: "CALENDAR_EVENT_BOOK_CONFLICT",
      status: 409,
    });
    await expect(calendarEventStore.get(owner)).resolves.toMatchObject({
      events: [],
      revision: removed.revision,
    });
  });
});
