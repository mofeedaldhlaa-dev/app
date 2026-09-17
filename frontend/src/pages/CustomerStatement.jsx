import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmt, fmtDate } from "@/lib/utils";
import { Printer } from "lucide-react";
import { printStatement } from "@/lib/print";
import { useAuth } from "@/lib/auth";

export default function CustomerStatement() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/customers/${id}/statement`).then((r) => setData(r.data)); }, [id]);
  if (!data) return <div>جاري التحميل...</div>;
  const c = data.customer;
  const doPrint = () => printStatement({ customer: c, entries: data.entries, username: user?.name || user?.username });
  return (
    <div className="space-y-4" data-testid="statement-page">
      {c.status === "disabled" && (
        <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4 flex items-center gap-3" data-testid="cust-disabled-banner">
          <div className="bg-red-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-xl shrink-0">⛔</div>
          <div className="flex-1">
            <div className="font-bold text-red-800 text-lg">حساب موقوف</div>
            <div className="text-sm text-red-700">هذا العميل موقوف ولا يمكنه تسجيل الدخول لبوابة طلب الكروت أو الشراء حتى إعادة التفعيل من صفحة العملاء.</div>
          </div>
        </div>
      )}
      <Card className="p-4 md:p-6">
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">{c.name} {c.status === "disabled" && <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">موقوف</span>}</h2>
            <div className="text-slate-500 text-sm">{c.phone}</div>
          </div>
          <Button onClick={doPrint} className="bg-[#221340]" data-testid="print-stmt"><Printer size={16} className="ml-1"/> طباعة كشف الحساب</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">السقف</div><div className="num font-bold">{fmt(c.credit_limit)}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">المديونية</div><div className="num font-bold">{fmt(c.balance)}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">المتاح</div><div className="num font-bold text-green-600">{fmt(Math.max(0, (c.credit_limit || 0) - (c.balance || 0)))}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">الرصيد الافتتاحي</div><div className="num font-bold">{fmt(c.opening_balance)}</div></div>
        </div>
      </Card>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-right">
              <th className="p-3">التاريخ</th><th className="p-3">رقم العملية</th><th className="p-3">البيان</th>
              <th className="p-3">مدين</th><th className="p-3">دائن</th><th className="p-3">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="p-3">{fmtDate(e.created_at)}</td>
                <td className="p-3 font-mono text-[#452480]">{e.op_number || "-"}</td>
                <td className="p-3">{e.description}</td>
                <td className="p-3 num">{fmt(e.debit)}</td>
                <td className="p-3 num">{fmt(e.credit)}</td>
                <td className="p-3 num font-bold">{fmt(e.balance)}</td>
              </tr>
            ))}
            {data.entries.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {data.entries.map((e) => (
          <Card key={e.id} className="p-3 text-sm">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">{fmtDate(e.created_at)}</div>
                <div className="font-mono text-[#452480] text-xs">{e.op_number || "-"}</div>
                <div className="mt-1 break-words">{e.description}</div>
              </div>
              <div className="text-left shrink-0">
                <div className="text-xs">الرصيد</div>
                <div className="num font-bold">{fmt(e.balance)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><div className="text-slate-500">مدين</div><div className="num font-bold">{fmt(e.debit)}</div></div>
              <div><div className="text-slate-500">دائن</div><div className="num font-bold">{fmt(e.credit)}</div></div>
            </div>
          </Card>
        ))}
        {data.entries.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد بيانات لعرضها</div>}
      </div>
    </div>
  );
}
