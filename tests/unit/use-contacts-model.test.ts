import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContactBook } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

const hooks = vi.hoisted(() => {
  type Effect = { cleanup?: () => void; deps?: readonly unknown[] };
  const initialized = new Set<number>();
  const values: unknown[] = [];
  const effects = new Map<number, Effect>();
  const pending: Array<{ effect: () => void | (() => void); index: number; deps?: readonly unknown[] }> = [];
  let cursor = 0;
  const changed = (left?: readonly unknown[], right?: readonly unknown[]) =>
    !left || !right || left.length !== right.length ||
    left.some((value, index) => !Object.is(value, right[index]));
  return {
    begin: () => { cursor = 0; },
    cleanup: () => {
      for (const effect of effects.values()) effect.cleanup?.();
      effects.clear();
    },
    flushEffects: () => {
      for (const next of pending.splice(0)) {
        effects.get(next.index)?.cleanup?.();
        const cleanup = next.effect();
        effects.set(next.index, {
          ...(typeof cleanup === "function" ? { cleanup } : {}),
          ...(next.deps ? { deps: next.deps } : {}),
        });
      }
    },
    reset: () => {
      cursor = 0; initialized.clear(); values.length = 0;
      pending.length = 0; effects.clear();
    },
    useCallback: <T,>(callback: T, deps: readonly unknown[]) => {
      const index = cursor++;
      const current = values[index] as { deps: readonly unknown[]; value: T } | undefined;
      if (!current || changed(current.deps, deps)) values[index] = { deps, value: callback };
      return (values[index] as { value: T }).value;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = cursor++;
      if (changed(effects.get(index)?.deps, deps)) pending.push({ effect, index, ...(deps ? { deps } : {}) });
    },
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index); values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index); values[index] = initial;
      }
      return [values[index] as T, (next: T | ((current: T) => T)) => {
        values[index] = typeof next === "function"
          ? (next as (current: T) => T)(values[index] as T) : next;
      }] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock("@/transport/client/member-contact-api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  memberContactApi: api,
}));

import {
  optimisticContactBook,
  useContactsModel,
} from "@/presentation/features/mail-workspace/hooks/use-contacts-model";
import { MemberContactApiError } from "@/transport/client/member-contact-api";

const contactId = id.contact("11111111-1111-4111-8111-111111111111");
const groupId = id.contactGroup("22222222-2222-4222-8222-222222222222");
const revision = "33333333-3333-4333-8333-333333333333";
const book = (name = "Ada"): ContactBook => ({
  contacts: [{
    createdAt: "2026-08-04T00:00:00.000Z",
    emails: [{ email: "ada@example.com", label: null }],
    id: contactId,
    name,
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  createdAt: "2026-08-04T00:00:00.000Z",
  groups: [{
    contactIds: [contactId],
    createdAt: "2026-08-04T00:00:00.000Z",
    id: groupId,
    name: "Team",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  recents: [{
    email: "recent@example.com",
    lastUsedAt: "2026-08-04T00:00:00.000Z",
    name: null,
    useCount: 1,
  }],
  revision,
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 1,
});
const render = (scope: string) => {
  hooks.begin();
  return useContactsModel(scope);
};
const settle = async () => {
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
};

beforeEach(() => {
  hooks.cleanup(); hooks.reset(); api.get.mockReset(); api.put.mockReset();
});

describe("contacts model", () => {
  it("mirrors safe update, delete, group cleanup, and recent clearing", () => {
    const updated = optimisticContactBook(book(), {
      contact: { emails: [{ email: "ada@example.com", label: "Work" }], name: "Ada L" },
      contactId, expectedRevision: revision, operation: "update-contact",
    });
    expect(updated.contacts[0]).toMatchObject({ name: "Ada L" });

    const cleared = optimisticContactBook(updated, {
      expectedRevision: revision, operation: "clear-recents",
    });
    expect(cleared.recents).toEqual([]);
    const removed = optimisticContactBook(cleared, {
      contactId, expectedRevision: revision, operation: "delete-contact",
    });
    expect(removed.contacts).toEqual([]);
    expect(removed.groups).toEqual([]);
  });

  it("aborts and ignores an old account load after a scope switch", async () => {
    let resolveA!: (value: ContactBook) => void;
    let resolveB!: (value: ContactBook) => void;
    api.get
      .mockImplementationOnce(() =>
        new Promise<ContactBook>((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() =>
        new Promise<ContactBook>((resolve) => { resolveB = resolve; }));

    render("scope-a"); hooks.flushEffects();
    const firstSignal = api.get.mock.calls[0]![1] as AbortSignal;
    render("scope-b"); hooks.flushEffects();
    expect(firstSignal.aborted).toBe(true);
    resolveA(book("Wrong account"));
    resolveB(book("Current account"));
    await settle();

    const current = render("scope-b");
    expect(current.book?.contacts[0]?.name).toBe("Current account");
    expect(current.phase).toBe("ready");
  });

  it("adds the current revision, exposes optimistic state, and commits success", async () => {
    api.get.mockResolvedValue(book());
    let resolvePut!: (value: ContactBook) => void;
    api.put.mockImplementation(() =>
      new Promise<ContactBook>((resolve) => { resolvePut = resolve; }));
    render("scope-a"); hooks.flushEffects(); await settle();
    let model = render("scope-a");

    const result = model.updateContact(contactId, {
      emails: [{ email: "ada@example.com", label: null }], name: "Optimistic",
    });
    model = render("scope-a");
    expect(model.book?.contacts[0]?.name).toBe("Optimistic");
    expect(model.phase).toBe("saving");
    expect(api.put.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: revision });
    resolvePut(book("Confirmed"));
    await expect(result).resolves.toMatchObject({ contacts: [{ name: "Confirmed" }] });
    expect(render("scope-a").book?.contacts[0]?.name).toBe("Confirmed");
  });

  it("exposes contact, group, import, and recent-recipient mutations", async () => {
    api.get.mockResolvedValue(book());
    api.put.mockResolvedValue(book());
    render("scope-a"); hooks.flushEffects(); await settle();
    const model = render("scope-a");
    const contact = {
      emails: [{ email: "grace@example.com", label: null }],
      name: "Grace",
    };
    const group = { contactIds: [contactId], name: "Team" };

    await model.createContact(contact);
    await model.updateContact(contactId, contact);
    await model.deleteContact(contactId);
    await model.createGroup(group);
    await model.updateGroup(groupId, group);
    await model.deleteGroup(groupId);
    await model.importContacts([contact], [{ contactIndexes: [0], name: "Imported" }]);
    await model.clearRecents();

    expect(api.put.mock.calls.map(([operation]) => operation.operation)).toEqual([
      "create-contact", "update-contact", "delete-contact", "create-group",
      "update-group", "delete-group", "import-contacts", "clear-recents",
    ]);
    expect(api.put.mock.calls[6]?.[0]).toMatchObject({
      expectedRevision: revision,
      groups: [{ contactIndexes: [0], name: "Imported" }],
    });
  });

  it("reloads a 409 and reports one predictable conflict", async () => {
    api.get.mockResolvedValueOnce(book()).mockResolvedValueOnce(book("Fresh"));
    api.put.mockRejectedValue(new MemberContactApiError(
      "Contacts changed in another session. Reload and try again.",
      409,
      "CONTACT_BOOK_CONFLICT",
    ));
    render("scope-a"); hooks.flushEffects(); await settle();
    const model = render("scope-a");

    await model.deleteGroup(groupId);
    const refreshed = render("scope-a");
    expect(refreshed.book?.contacts[0]?.name).toBe("Fresh");
    expect(refreshed.hasConflict).toBe(true);
    expect(refreshed.error).toContain("another tab");
    expect(refreshed.phase).toBe("ready");
  });
});
