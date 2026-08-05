"use client";

import { useEffect } from "react";

export const PwaRegistration = () => {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" ||
        !("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }).catch(() => undefined);
    };
    window.addEventListener("load", register, { once: true });
    if (document.readyState === "complete") register();
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
};
