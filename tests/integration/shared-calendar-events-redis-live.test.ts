import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import { updateCalendarEventBook } from "@/server/calendar/event-book";
import {
  calendarEventOwnerKey,
  encryptCalendarEventBook,
} from "@/server/calendar/event-crypto";
import { calendarEventFilePath } from "@/server/calendar/event-file";
import type { CalendarEventOwner } from "@/server/calendar/event-owner";
import { parseStoredCalendarEventBook } from
  "@/server/calendar/event-record";
import { calendarEventStore } from "@/server/calendar/event-store";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:calendar:${crypto.randomUUID()}`;
const owner: CalendarEventOwner = {
  email: "private@example.com", providerId: "mock",
};
const instant = (value: string) => ({
  kind: "date-time" as const, value, zone: { kind: "utc" as const },
});
const event: CalendarEvent = {
  attendees: [], description: "Private description",
  dtstamp: instant("2026-08-04T08:00:00"), duration: "PT1H", endsAt: null,
  location: "Private room", organizer: null, recurrenceId: null,
  recurrenceRule: null, sequence: 1,
  startsAt: instant("2026-08-05T08:00:00"), summary: "Private planning",
  uid: "private-event@example.com",
};
const installation = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"], config: {}, displayName: "Mail",
    providerId: id.provider("mock"),
  },
  organization: {
    accentColor: "#ff6b57", logoFileName: null, organizationName: "Example",
    primaryColor: "#27276f", productName: "Mail", publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"), username: "owner",
  },
});

describe.skipIf(!redisUrl)("live shared calendar events", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-calendar-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await calendarEventStore.put(owner, {
      event, expectedRevision: null, operation: "import-event",
    });
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    delete process.env["VEDA_MAIL_DATA_DIR"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates ciphertext and preserves revisioned empty books", async () => {
    const migrated = await calendarEventStore.get(owner);
    expect(migrated.events[0]?.summary).toBe("Private planning");
    const archived = `${calendarEventFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain("Private planning");
    await expect(stat(calendarEventFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const secret = installed.sessionSecret;
    const ownerKey = calendarEventOwnerKey(owner, secret);
    const expected = await sharedOwnerRepository.get("calendar-events", ownerKey);
    const candidates = ["Replica A", "Replica B"].map((summary) =>
      updateCalendarEventBook(migrated, {
        event: { ...event, sequence: 2, summary },
        expectedRevision: migrated.revision, operation: "import-event",
      }));
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "calendar-events", ownerKey, expected,
        JSON.stringify(encryptCalendarEventBook(
          parseStoredCalendarEventBook(book), ownerKey, secret,
        )),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const winner = await calendarEventStore.get(owner);
    expect(["Replica A", "Replica B"]).toContain(winner.events[0]?.summary);
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const value of [
      "private@example.com", "Private planning", "Private description",
      "Replica A", "Replica B",
    ]) expect(surface).not.toContain(value);

    const removed = await calendarEventStore.put(owner, {
      expectedRevision: winner.revision, operation: "remove-event",
      recurrenceId: null, uid: event.uid,
    });
    expect(removed).toMatchObject({ events: [] });
    expect(removed.revision).not.toBeNull();
    resetSharedStateRedisClientForTests();
    await expect(calendarEventStore.get(owner)).resolves.toMatchObject({
      events: [], revision: removed.revision,
    });

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:calendar-events:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(calendarEventStore.get(owner)).rejects.toMatchObject({
      code: "CALENDAR_EVENT_STORE_UNAVAILABLE", status: 500,
    });
  });
});
