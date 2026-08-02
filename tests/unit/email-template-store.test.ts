import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type EmailTemplateOwner,
  MAX_EMAIL_TEMPLATES,
} from "@/domain/member/email-template";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { emailTemplateFilePath } from "@/server/templates/email-template-file";
import { emailTemplateStore } from "@/server/templates/email-template.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let temporaryDirectory = "";

const owner: EmailTemplateOwner = {
  email: "Member@Example.com",
  providerId: "mock",
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

const create = (
  expectedRevision: string | null,
  name: string,
  currentOwner = owner,
) =>
  emailTemplateStore.put(currentOwner, {
    content: {
      htmlBody: "<p><b>Hello</b> team</p>",
      mode: "rich",
      subject: "Welcome",
    },
    expectedRevision,
    name,
    operation: "create",
  });

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "veda-templates-"));
  process.env["VEDA_MAIL_DATA_DIR"] = temporaryDirectory;
  await installationStore.complete(installationDraft);
});

afterEach(async () => {
  if (originalDirectory === undefined) {
    delete process.env["VEDA_MAIL_DATA_DIR"];
  } else {
    process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  }
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe("encrypted email template store", () => {
  it("persists an isolated encrypted create, update, and delete lifecycle", async () => {
    let book = await create(null, "Welcome note");
    const templateId = book.templates[0]!.id;
    const other = await emailTemplateStore.get({
      email: "other@example.com",
      providerId: "mock",
    });
    const [contents, fileStats] = await Promise.all([
      readFile(emailTemplateFilePath(), "utf8"),
      stat(emailTemplateFilePath()),
    ]);

    expect(other.templates).toEqual([]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toMatch(
      /(?:Member@Example\.com|Welcome note|Hello|Welcome)/u,
    );
    book = await emailTemplateStore.put(owner, {
      content: {
        body: "Updated body",
        mode: "plain",
        subject: "Updated subject",
      },
      expectedRevision: book.revision,
      name: "Updated note",
      operation: "update",
      templateId,
    });
    expect(book.templates[0]).toMatchObject({
      body: "Updated body",
      name: "Updated note",
      subject: "Updated subject",
    });
    expect(book.templates[0]).not.toHaveProperty("htmlBody");
    book = await emailTemplateStore.put(owner, {
      expectedRevision: book.revision,
      operation: "delete",
      templateId,
    });
    expect(book.templates).toEqual([]);
  });

  it("rejects duplicate names and permits only one stale-revision writer", async () => {
    let book = await create(null, "Welcome");
    await expect(create(book.revision, "welcome")).rejects.toMatchObject({
      code: "TEMPLATE_NAME_CONFLICT",
      status: 422,
    });
    book = await create(book.revision, "Follow up");
    const expectedRevision = book.revision;
    const templateId = book.templates[0]!.id;
    const attempts = await Promise.allSettled([
      emailTemplateStore.put(owner, {
        content: { body: "First", mode: "plain", subject: "One" },
        expectedRevision,
        name: "First",
        operation: "update",
        templateId,
      }),
      emailTemplateStore.put(owner, {
        content: { body: "Second", mode: "plain", subject: "Two" },
        expectedRevision,
        name: "Second",
        operation: "update",
        templateId,
      }),
    ]);

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "TEMPLATE_BOOK_CONFLICT", status: 409 },
    });
  });

  it("serializes different-owner writes without dropping either bucket", async () => {
    const otherOwner: EmailTemplateOwner = {
      email: "other@example.com",
      providerId: "mock",
    };
    await Promise.all([
      create(null, "Member template"),
      create(null, "Other template", otherOwner),
    ]);

    await expect(emailTemplateStore.get(owner)).resolves.toMatchObject({
      templates: [{ name: "Member template" }],
    });
    await expect(emailTemplateStore.get(otherOwner)).resolves.toMatchObject({
      templates: [{ name: "Other template" }],
    });
  });

  it("reclaims an empty owner bucket and resets its revision", async () => {
    const created = await create(null, "Temporary template");
    const staleRevision = created.revision;
    const deleted = await emailTemplateStore.put(owner, {
      expectedRevision: staleRevision,
      operation: "delete",
      templateId: created.templates[0]!.id,
    });
    const stored = JSON.parse(
      await readFile(emailTemplateFilePath(), "utf8"),
    ) as { owners: Record<string, unknown> };

    expect(deleted).toEqual({
      createdAt: null,
      revision: null,
      templates: [],
      updatedAt: null,
      version: 1,
    });
    expect(Object.keys(stored.owners)).toHaveLength(0);
    await expect(
      emailTemplateStore.put(owner, {
        expectedRevision: staleRevision,
        operation: "delete",
        templateId: created.templates[0]!.id,
      }),
    ).rejects.toMatchObject({
      code: "TEMPLATE_BOOK_CONFLICT",
      status: 409,
    });
    await expect(create(null, "Recreated template")).resolves.toMatchObject({
      templates: [{ name: "Recreated template" }],
    });
  });

  it("enforces the per-identity template capacity", async () => {
    let revision: string | null = null;
    for (let index = 0; index < MAX_EMAIL_TEMPLATES; index += 1) {
      revision = (await create(revision, `Template ${index}`)).revision;
    }
    await expect(create(revision, "Overflow")).rejects.toMatchObject({
      code: "TEMPLATE_LIMIT_REACHED",
      status: 422,
    });
  });
});
