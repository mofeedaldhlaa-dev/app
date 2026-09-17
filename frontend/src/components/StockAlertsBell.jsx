import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Boxes, AlertTriangle, PackageX } from "lucide-react";

const alertKey = (a) => `${a.type}:${a.category_id}`;

// Independent stock notifications bell shown at the top of the dashboard shell.
// - badge = the LIVE number of active low-stock alerts.
// - the badge stays visible as long as the shortage exists; it does NOT clear just
//   because the dialog/stock screen was opened. It only decreases automatically once
//   stock is replenished above the threshold (the backend recomputes each poll).
export default function StockAlertsBell() {
  const [alerts, setAlerts] = useState([]);
  const [open, setOpen] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await api.get("/stock/alerts");
      setAlerts(r.data?.alerts || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 30000);
    const onRefresh = () => fetchAlerts();
    window.addEventListener("stock-refresh", onRefresh);
    return () => { clearInterval(id); window.removeEventListener("stock-refresh", onRefresh); };
  }, [fetchAlerts]);

  const count = alerts.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 hover:bg-amber-50 rounded"
        data-testid="stock-alerts-bell"
        title="تنبيهات المخزون"
        aria-label="تنبيهات المخزون"
      >
        <Boxes size={18} className="text-emerald-600" />
        {count > 0 && (
          <span
            className="absolute -top-0.5 -left-0.5 bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center font-bold"
            data-testid="stock-alerts-badge"
          >
            {count}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="stock-alerts-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#221340]">
              <AlertTriangle size={18} className="text-amber-600" /> تنبيهات المخزون
              <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 num">{count}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {count === 0 && (
              <div className="text-center text-slate-400 py-8 flex flex-col items-center gap-2" data-testid="stock-alerts-empty">
                <PackageX size={32} className="text-slate-300" />
                لا توجد تنبيهات مخزون حالياً
              </div>
            )}
            {alerts.map((a) => (
              <Link
                key={alertKey(a)}
                to={`/stock?category=${a.category_id}&type=${a.type}`}
                onClick={() => setOpen(false)}
                data-testid={`stock-alert-${a.type}-${a.category_id}`}
                className="flex items-center justify-between gap-2 p-3 bg-white border border-amber-200 rounded-lg hover:border-amber-500 hover:shadow transition"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[#221340] truncate">{a.category_name}</div>
                  <div className="text-xs text-slate-500">
                    {a.type === "numbered" ? "كروت مرقمة" : "كروت كمية"} • حد التنبيه: <span className="num">{a.threshold}</span>
                  </div>
                </div>
                <div className="text-left shrink-0">
                  <div className="text-xs text-slate-500">المتبقي</div>
                  <div className={`num font-black text-lg ${a.available === 0 ? "text-red-600" : "text-amber-700"}`}>{a.available}</div>
                </div>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
