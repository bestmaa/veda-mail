import { expect, test } from "@playwright/test";

import {
  expectNoSeriousAccessibilityViolations,
  useInstalledMailbox,
} from "./support/mail-fixture";

useInstalledMailbox();

const temporal = (value: string) => ({
  kind: "date-time",
  value,
  zone: { kind: "utc" },
});

test("displays, responds to, imports, and exports a calendar invitation", async ({
  page,
}) => {
  const responsePayloads: Record<string, unknown>[] = [];
  await page.route("**/api/v1/mail/messages/*/calendar/respond", async (route) => {
    responsePayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      body: JSON.stringify({
        data: {
          partId: "calendar-part",
          receipt: {
            deliveryStatus: "accepted",
            id: "calendar-response",
            rejectedRecipients: [],
            submittedAt: "2026-08-04T08:00:00.000Z",
          },
          response: "ACCEPTED",
          sequence: 2,
          uid: "planning-1",
        },
      }),
      contentType: "application/json",
      status: 201,
    });
  });
  await page.route("**/api/v1/mail/messages/*/calendar", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          invalidPartCount: 0,
          invitations: [{
            canRespond: true,
            canonicalIcs: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n",
            invitation: {
              event: {
                attendees: [{
                  email: "member@example.com",
                  name: "Member",
                  participationStatus: "NEEDS-ACTION",
                  rsvp: true,
                }],
                description: null,
                dtstamp: temporal("2026-08-04T08:00:00"),
                duration: null,
                endsAt: temporal("2026-08-05T10:00:00"),
                location: "Meeting room",
                organizer: { email: "host@example.com", name: "Host" },
                recurrenceId: null,
                recurrenceRule: null,
                sequence: 2,
                startsAt: temporal("2026-08-05T09:00:00"),
                summary: "Calendar planning",
                uid: "planning-1",
              },
              method: "REQUEST",
              productId: null,
            },
            organizerMatchesSender: false,
            part: {
              id: "calendar-part",
              mimeType: "text/calendar",
              name: "invite.ics",
              size: 400,
            },
          }],
        },
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/v1/member/calendar", async (route) => {
    const imported = route.request().method() === "PUT";
    await route.fulfill({
      body: JSON.stringify({
        data: {
          createdAt: imported ? "2026-08-04T08:00:00.000Z" : null,
          events: [],
          revision: imported ? "11111111-1111-4111-8111-111111111111" : null,
          updatedAt: imported ? "2026-08-04T08:00:00.000Z" : null,
          version: 1,
        },
      }),
      contentType: "application/json",
      status: imported ? 201 : 200,
    });
  });
  await page.route("**/api/v1/member/calendar/ics", async (route) => {
    await route.fulfill({
      body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n",
      contentType: "text/calendar; charset=utf-8",
      status: 200,
    });
  });

  await page.getByRole("button", { name: "Open Revised product roadmap · Q3" }).click();
  const calendar = page.getByRole("region", { name: "Calendar invitations" });
  await expect(calendar.getByText("Calendar planning")).toBeVisible();
  await expect(calendar.getByText(/Sender and organizer addresses differ/)).toBeVisible();
  await calendar.getByRole("button", { name: "Accept" }).click();
  await expect(calendar.getByRole("status")).toHaveText(
    "Calendar response sent: accepted.",
  );
  expect(responsePayloads[0]).toMatchObject({
    partId: "calendar-part",
    response: "accepted",
  });
  expect(responsePayloads[0]?.["idempotencyKey"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/u,
  );

  await calendar.getByRole("button", { name: "Add to calendar" }).click();
  await expect(calendar.getByRole("status")).toContainText("Added Calendar planning");
  const downloadEvent = page.waitForEvent("download");
  await calendar.getByRole("button", { name: "Export my calendar (.ics)" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("veda-mail-calendar.ics");
  await expectNoSeriousAccessibilityViolations(page);
});
