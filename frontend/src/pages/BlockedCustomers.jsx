import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fmtDate } from "@/lib/utils";
import { Ban, Unlock } from "lucide-react";

export default function BlockedCustomers() {
  const [items, setItems] = useState([]);
  const load = async () => {
    try { setItems((await api.get("/customers/blocked/list")).data); }
    catch (e) { toast.error(errText(e)); }
  };
  useEffect(() => { load(); }, []);
  const unblock = async (phone) => {
    try {
      const r = await api.post(`/public-blocks/${phone}/unblock`);
      toast.success("تم رفع الحظر");
      if (r.data?.whatsapp_url) window.open(r.data.whatsapp_url, "_blank");
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="space-y-4" data-testid="blocked-page">
      <div className="flex items-center gap-2">
        <Ban className="text-red-500" size={20}/>
        <div className="text-lg font-bold text-[#221340]">العملاء المحظورون ({items.length})</div>
      </div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">العميل</th><th className="p-3">الهاتف</th><th className="p-3">وقت الحظر</th><th className="p-3">ينتهي في</th><th className="p-3">السبب</th><th className="p-3"></th></tr></thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.phone} className="border-t">
                <td className="p-3 font-medium">{b.customer_name}</td>
                <td className="p-3 font-mono">{b.phone}</td>
                <td className="p-3">{fmtDate(b.blocked_at)}</td>
                <td className="p-3">{fmtDate(b.blocked_until)}</td>
                <td className="p-3 text-xs text-slate-500">تجاوز {b.failed_before_block} محاولات فاشلة</td>
                <td className="p-3"><Button size="sm" onClick={() => unblock(b.phone)} className="bg-green-600 hover:bg-green-700" data-testid={`unblock-${b.phone}`}><Unlock size={12} className="ml-1"/> رفع الحظر</Button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا يوجد عملاء محظورون</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {items.map((b) => (
          <Card key={b.phone} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-bold truncate">{b.customer_name || b.phone}</div>
                <div className="text-xs font-mono text-slate-500 truncate">{b.phone}</div>
              </div>
              <Button size="sm" onClick={() => unblock(b.phone)} className="bg-green-600 hover:bg-green-700 shrink-0" data-testid={`unblock-${b.phone}`}><Unlock size={12} className="ml-1"/> رفع</Button>
            </div>
            <div className="text-xs text-slate-500 mt-2 space-y-1">
              <div>وقت الحظر: {fmtDate(b.blocked_at)}</div>
              <div>ينتهي: {fmtDate(b.blocked_until)}</div>
              <div>{b.failed_before_block} محاولات فاشلة</div>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا يوجد عملاء محظورون</div>}
      </div>
    </div>
  );
}
