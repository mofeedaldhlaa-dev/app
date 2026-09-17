import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate } from "@/lib/utils";
import { Search, X } from "lucide-react";

// Map audit action codes to human-readable Arabic labels
const ACTION_AR = {
  create: "إضافة",
  update: "تعديل",
  edit: "تعديل",
  delete: "حذف",
  hard_delete: "حذف نهائي",
  cancel: "إلغاء",
  disable: "تعطيل",
  approve: "موافقة",
  reject: "رفض",
  approve_register_request: "موافقة على طلب إنشاء حساب",
  reset_password: "تعديل كلمة المرور",
  reset_customer_password: "تعديل كلمة مرور العميل",
  unbind_device: "فك ربط الجهاز",
  unbind_customer_device: "فك ربط هاتف العميل",
  unlock: "فك حظر",
  reset_attempts: "إعادة ضبط المحاولات الفاشلة",
  add_cards: "إضافة كروت",
  restore: "استرجاع نسخة احتياطية",
};

const ENTITY_AR = {
  user: "مستخدم",
  customer: "عميل",
  supplier: "مورد",
  sale: "فاتورة مبيعات",
  purchase: "فاتورة مشتريات",
  receipt: "سند",
  expense: "مصروف",
  expense_account: "حساب مصروفات",
  card: "كرت",
  cards: "كروت",
  category: "فئة كروت",
  transfer: "تحويل",
  payment_request: "طلب تسديد",
  register_request: "طلب إنشاء حساب",
};

const humanize = (action, entity, entityId, valuePreview) => {
  const act = action || "";
  const actLabel = ACTION_AR[act] || act;
  const entLabel = ENTITY_AR[entity] || entity || "";
  // Special-case things like "set_status:active" or "edit"
  if (act.startsWith("set_status:")) {
    const s = act.split(":")[1];
    return `${s === "active" ? "تفعيل" : "تعطيل"} ${entLabel}`;
  }
  // Try to pull a "number" out of value to reference the invoice/voucher
  let ref = "";
  if (valuePreview && typeof valuePreview === "object") {
    const num = valuePreview.number || valuePreview.new_number;
    if (num) ref = ` رقم ${num}`;
    else if (valuePreview.name) ref = ` — ${valuePreview.name}`;
    else if (valuePreview.username) ref = ` — ${valuePreview.username}`;
  }
  return `${actLabel} ${entLabel}${ref}`;
};

export default function AuditLog() {
  const [items, setItems] = useState([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (start) params.start = start;
      if (end) params.end = end;
      if (q.trim()) params.q = q.trim();
      const r = await api.get("/audit", { params });
      setItems(r.data);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const applyToday = () => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    setStart(iso); setEnd(iso);
    setTimeout(load, 0);
  };
  const clearFilters = () => {
    setStart(""); setEnd(""); setQ("");
    setTimeout(load, 0);
  };

  const displayItems = useMemo(() => items.map((a) => {
    const preview = a.new_value || a.old_value || {};
    return { ...a, label: humanize(a.action, a.entity, a.entity_id, preview) };
  }), [items]);

  return (
    <div className="space-y-4" data-testid="audit-page">
      <Card className="p-3 flex flex-col sm:flex-row gap-2 sm:items-end flex-wrap no-print">
        <div><label className="text-xs">من تاريخ</label><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="audit-start"/></div>
        <div><label className="text-xs">إلى تاريخ</label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="audit-end"/></div>
        <div className="flex-1 min-w-[180px]"><label className="text-xs">بحث</label><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اسم المستخدم أو نوع العملية" data-testid="audit-q"/></div>
        <Button onClick={load} disabled={loading} className="bg-[#221340]" data-testid="audit-search"><Search size={14} className="ml-1"/> {loading ? "جاري..." : "بحث"}</Button>
        <Button onClick={applyToday} variant="outline" data-testid="audit-today">اليوم</Button>
        <Button onClick={clearFilters} variant="outline" data-testid="audit-clear"><X size={14} className="ml-1"/> مسح</Button>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50">
            <tr className="text-right">
              <th className="p-3">التاريخ والوقت</th>
              <th className="p-3">المستخدم</th>
              <th className="p-3">العملية</th>
              <th className="p-3">التفاصيل الفنية</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-3 whitespace-nowrap">{fmtDate(a.created_at)}</td>
                <td className="p-3 font-medium">{a.username || "-"}</td>
                <td className="p-3">{a.label}</td>
                <td className="p-3 text-[11px] font-mono break-all max-w-xs text-slate-500">
                  {JSON.stringify(a.new_value || a.old_value || {}, null, 0)}
                </td>
              </tr>
            ))}
            {displayItems.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-slate-400">لا توجد عمليات في هذه الفترة</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
