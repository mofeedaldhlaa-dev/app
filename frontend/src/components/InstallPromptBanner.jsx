import { useEffect, useState } from "react";
import { Download, X, Smartphone } from "lucide-react";
import { usePWAInstall } from "@/lib/pwaInstall";

const DISMISS_KEY = "gwd_install_dismissed_at";
const HIDE_HOURS = 24;

/**
 * Dismissible install banner shown on GAWAD NET home when the browser
 * has offered a native install prompt. Auto-hides after user dismisses
 * (for 24h) or after successful installation.
 */
export default function InstallPromptBanner() {
  const { canInstall, installed, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (at && Date.now() - at < HIDE_HOURS * 3600 * 1000) setDismissed(true);
    } catch {}
  }, []);

  if (installed || dismissed || !canInstall) return null;

  const onInstall = async () => {
    const outcome = await promptInstall();
    if (outcome !== "accepted") {
      // Treat dismissal as a soft-hide so we don't nag on every visit.
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setDismissed(true);
    }
  };
  const onClose = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded-2xl border-2 border-[#D4AF37] bg-gradient-to-l from-[#452480]/10 via-white to-[#D4AF37]/10 p-3 shadow-sm" data-testid="install-banner">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-full bg-[#452480] text-white flex items-center justify-center">
          <Smartphone size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-black text-[#221340] text-sm">تثبيت تطبيق GAWAD NET</div>
          <div className="text-xs text-slate-600 mt-1 leading-relaxed">
            أضف التطبيق إلى شاشتك الرئيسية لفتحه بضغطة واحدة، بدون متصفح.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onInstall}
              data-testid="install-banner-install"
              className="bg-[#452480] hover:bg-[#5A2FA0] text-white text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1"
            >
              <Download size={12} /> تثبيت الآن
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="install-banner-close"
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              لاحقاً
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="text-slate-400 hover:text-slate-700 p-1 -mt-1 -mr-1"
          data-testid="install-banner-x"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
