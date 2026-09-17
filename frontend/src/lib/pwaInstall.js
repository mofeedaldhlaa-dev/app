import { useEffect, useState, useCallback } from "react";

/**
 * usePWAInstall — hook that captures the browser's `beforeinstallprompt` event
 * and exposes:
 *   - canInstall: boolean — true when the browser has offered an install prompt
 *   - installed: boolean — true if the app is already running as a PWA
 *   - promptInstall(): async — triggers the native install dialog (returns "accepted" | "dismissed" | "unsupported")
 */
export function usePWAInstall() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const inStandalone =
      window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    const iosStandalone = window.navigator.standalone === true;
    if (inStandalone || iosStandalone) setInstalled(true);

    const onBIP = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return "unsupported";
    try {
      deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome || "dismissed";
    } catch { return "dismissed"; }
  }, [deferred]);

  return { canInstall: !!deferred, installed, promptInstall };
}

/** Swap the active <link rel="manifest"> to a specific href. */
export function setActiveManifest(href) {
  try {
    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "manifest";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  } catch {}
}
