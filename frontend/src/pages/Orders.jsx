import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { fmt, fmtDate } from "@/lib/utils";

export default function Orders() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get("/orders").then((r) => setItems(r.data)); }, []);
  return (
    <div className="space-y-4" data-testid="orders-page">
      <Card className="p-4">
        <div className="text-sm text-slate-600 mb-2">رابط طلب الكرت للعميل:</div>
        <div className="font-mono text-xs bg-slate-100 p-2 rounded" data-testid="public-order-link">{window.location.origin}/order</div>
      </Card>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">الفئة</th><th className="p-3">الكمية</th><th className="p-3">الإجمالي</th><th className="p-3">الكروت</th></tr></thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-[#452480] font-bold">{o.number}</td>
                <td className="p-3">{fmtDate(o.created_at)}</td>
                <td className="p-3">{o.customer_name}</td>
                <td className="p-3">{o.category_name}</td>
                <td className="p-3 num">{o.quantity}</td>
                <td className="p-3 num">{fmt(o.total)}</td>
                <td className="p-3 font-mono text-xs">{(o.cards || []).join(", ") || `${o.quantity_stock_taken || 0} من المخزون`}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد طلبات</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {items.map((o) => (
          <Card key={o.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-bold text-[#452480] truncate">{o.number}</div>
                <div className="text-xs text-slate-500 truncate">{o.customer_name} • {fmtDate(o.created_at)}</div>
              </div>
              <div className="text-left text-xs shrink-0">
                <div>{o.category_name}</div>
                <div>الكمية: <span className="num font-bold">{o.quantity}</span></div>
                <div>الإجمالي: <span className="num font-bold">{fmt(o.total)}</span></div>
              </div>
            </div>
            {((o.cards || []).length > 0) && <div className="mt-2 font-mono text-xs bg-slate-50 p-2 rounded break-all">{(o.cards || []).join(", ")}</div>}
            {(!o.cards?.length && o.quantity_stock_taken) ? <div className="mt-2 text-xs text-slate-500">{o.quantity_stock_taken} من المخزون</div> : null}
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد طلبات</div>}
      </div>
    </div>
  );
}
