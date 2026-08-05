"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  newMailNotificationText,
  type NewMailEvent,
} from "@/domain/mail/new-mail-notification";
import type { MailAccount } from "@/domain/mail/mail";
import {
  defaultNotificationPreferences,
  notificationPreferenceOwner,
  readNotificationPreferences,
  writeNotificationPreferences,
  type NewMailNotificationPreferences,
} from "@/presentation/features/mail-workspace/new-mail-notification-preferences";
import type { NewMailNotificationViewModel } from "@/presentation/features/mail-workspace/new-mail-notification.view-model";

const unsupportedPermission = "unsupported" as const;

export const useNewMailNotifications = (account: MailAccount | null) => {
  const owner = account ? notificationPreferenceOwner(
    account.providerId,
    account.id,
  ) : "";
  const [preferences, setPreferences] = useState<NewMailNotificationPreferences>(
    () => defaultNotificationPreferences(owner),
  );
  const preferencesRef = useRef(preferences);
  const [permission, setPermission] = useState<
    NotificationPermission | typeof unsupportedPermission
  >(unsupportedPermission);
  const [isEnabling, setIsEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    NewMailNotificationViewModel["notice"]
  >(null);

  const commit = useCallback((next: NewMailNotificationPreferences) => {
    preferencesRef.current = next;
    setPreferences(next);
    if (!writeNotificationPreferences(window.localStorage, next)) {
      setError("Notification preference could not be saved in this browser.");
      return false;
    }
    setError(null);
    return true;
  }, []);

  useEffect(() => {
    const supported = "Notification" in window;
    setPermission(supported ? Notification.permission : unsupportedPermission);
    const next = owner ? readNotificationPreferences(
      window.localStorage,
      owner,
    ) : defaultNotificationPreferences(owner);
    preferencesRef.current = next;
    setPreferences(next);
    setError(null);
    setNotice(null);
  }, [owner]);

  const enable = useCallback(() => {
    if (!owner || !("Notification" in window)) return;
    setIsEnabling(true);
    setError(null);
    void Notification.requestPermission().then((nextPermission) => {
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        commit({ ...preferencesRef.current, webEnabled: false });
        setError(nextPermission === "denied"
          ? "Browser notifications are blocked. Allow them in site settings to enable this option."
          : "Browser notification permission was not granted.");
        return;
      }
      commit({ ...preferencesRef.current, webEnabled: true });
    }).catch(() => {
      setError("Browser notification permission could not be requested.");
    }).finally(() => setIsEnabling(false));
  }, [commit, owner]);

  const disable = useCallback(() => {
    commit({ ...preferencesRef.current, webEnabled: false });
  }, [commit]);

  const notify = useCallback((event: NewMailEvent) => {
    const text = newMailNotificationText(event, preferencesRef.current.content);
    setNotice(text);
    if (document.visibilityState !== "hidden" ||
        !preferencesRef.current.webEnabled ||
        !("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    try {
      const browserNotice = new Notification(text.title, {
        body: text.body,
        tag: "veda-mail-new-mail",
      });
      browserNotice.onclick = () => {
        window.focus();
        browserNotice.close();
      };
    } catch {
      setError("The browser could not display this notification.");
    }
  }, []);

  const view: NewMailNotificationViewModel = {
    content: preferences.content,
    disable,
    dismissNotice: () => setNotice(null),
    enable,
    error,
    isEnabling,
    isSupported: permission !== unsupportedPermission,
    notice,
    onContentChange: (event) => {
      const content = event.target.value === "details" ? "details" : "private";
      commit({ ...preferencesRef.current, content });
    },
    permission,
    webEnabled: preferences.webEnabled && permission === "granted",
  };
  return {
    listenWhileHidden: view.webEnabled,
    notify,
    view,
  };
};
