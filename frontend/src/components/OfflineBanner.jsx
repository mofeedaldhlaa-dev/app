import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";

/**
 * Global offline detector. Shows a red banner at the very top when the browser
 * reports it is offline; briefly flashes a green "reconnected" banner when
 * connectivity is restored.
 * Works on all routes (admin shell + public GAWAD NET) without extra wiring.
 */
export default function OfflineBanner() {
  const initial = typeof navigator !== "undefined" ? navigator.onLine : true;
  const [online, setOnline] = useState(initial);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setRestored(true);
      setTimeout(() => setRestored(false), 2600);
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online && !restored) return null;
  const isOffline = !online;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={isOffline ? "offline-banner" : "online-banner"}
      className={`fixed top-0 inset-x-0 z-[9999] text-center text-sm font-bold py-2 px-3 shadow-md transition ${
        isOffline
          ? "bg-red-600 text-white"
          : "bg-emerald-600 text-white"
      }`}
    >
      <span className="inline-flex items-center gap-2 justify-center">
        {isOffline ? <WifiOff size={16} /> : <Wifi size={16} />}
        {isOffline
          ? "لا يوجد اتصال بالإنترنت — بعض الميزات قد لا تعمل"
          : "استُعيد الاتصال بالإنترنت"}
      </span>
    </div>
  );
}
