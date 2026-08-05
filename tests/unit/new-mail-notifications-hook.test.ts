import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect: (effect: () => void) => effect(),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T | (() => T)) => [
    typeof initial === "function" ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));

import { id } from "@/domain/shared/brand";
import { useNewMailNotifications } from "@/presentation/features/mail-workspace/hooks/use-new-mail-notifications";

const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
const close = vi.fn();
const created: Array<{ body: string | undefined; instance: FakeNotification;
  title: string }> = [];
class FakeNotification {
  public static permission: NotificationPermission = "granted";
  public static requestPermission = requestPermission;
  public onclick: (() => void) | null = null;
  public close = close;
  public constructor(title: string, options?: NotificationOptions) {
    created.push({ body: options?.body, instance: this, title });
  }
}
const account = { email: "member@example.com", id: id.account("member"),
  name: "Member", providerId: id.provider("provider") };

beforeEach(() => {
  requestPermission.mockReset();
  requestPermission.mockResolvedValue("granted");
  close.mockReset();
  created.length = 0;
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  };
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("window", { focus: vi.fn(), localStorage: storage,
    Notification: FakeNotification });
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => vi.unstubAllGlobals());

describe("new mail notification hook", () => {
  it("requests permission only from the explicit enable action", async () => {
    const notifications = useNewMailNotifications(account);
    expect(requestPermission).not.toHaveBeenCalled();
    notifications.view.enable();
    await Promise.resolve();
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("uses generic text for a private hidden-tab browser notification", () => {
    const owner = "8:providermember";
    const localStorage = {
      getItem: () => JSON.stringify({ content: "private", owner,
        webEnabled: true }),
      setItem: vi.fn(),
    };
    vi.stubGlobal("document", { visibilityState: "hidden" });
    vi.stubGlobal("window", { focus: vi.fn(), localStorage,
      Notification: FakeNotification });
    const notifications = useNewMailNotifications(account);
    notifications.notify({ count: 1, message: null });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ body: "You have a new message.",
      title: "New mail in Veda Mail" });
  });
});
