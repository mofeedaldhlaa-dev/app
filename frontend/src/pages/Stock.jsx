import { useEffect, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

export default function Stock() {
  const [data, setData] = useState([]);
  useEffect(() => { api.get("/stock").then((r) => setData(r.data)); }, []);
  return (
    <div className="space-y-4" data-testid="stock-page">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.map((s) => (
          <Card key={s.category_id} className={`p-4 ${s.low_stock ? 'border-amber-400 bg-amber-50' : ''}`} data-testid={`stock-${s.category_id}`}>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-lg text-[#221340]">{s.category_name}</div>
                <div className="text-xs text-slate-500">سعر البيع: <span className="num">{fmt(s.sale_price)}</span></div>
              </div>
              {s.low_stock && <div className="flex items-center gap-1 text-amber-700 text-xs"><AlertTriangle size={14} /> مخزون منخفض</div>}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="bg-white p-2 rounded">
                <div className="text-xs text-slate-500 mb-1">كروت بأرقام</div>
                <div className="text-xs">إجمالي: <span className="num font-bold">{s.numbered.total}</span></div>
                <div className="text-xs">متاح: <span className="num font-bold text-green-600">{s.numbered.available}</span></div>
                <div className="text-xs">مباع: <span className="num">{s.numbered.sold}</span></div>
              </div>
              <div className="bg-white p-2 rounded">
                <div className="text-xs text-slate-500 mb-1">كروت كمية</div>
                <div className="text-xs">إجمالي: <span className="num font-bold">{s.quantity.total}</span></div>
                <div className="text-xs">متاح: <span className="num font-bold text-green-600">{s.quantity.available}</span></div>
                <div className="text-xs">مباع: <span className="num">{s.quantity.sold}</span></div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t text-center">
              <span className="text-xs text-slate-500">المتاح الكلي: </span>
              <span className="text-xl font-bold num text-[#452480]">{fmt(s.available_total)}</span>
            </div>
          </Card>
        ))}
        {data.length === 0 && <div className="col-span-2 text-center text-slate-400 p-8">لا توجد بيانات مخزون</div>}
      </div>
    </div>
  );
}
