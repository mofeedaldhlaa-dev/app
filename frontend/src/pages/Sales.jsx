import { useEffect, useMemo, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useLocation, useNavigate } from "react-router-dom";
import InvoiceSuccessDialog from "@/components/InvoiceSuccessDialog";
import { fmt, fmtDate, openWhatsApp, buildInvoiceMessage } from "@/lib/utils";
import { printSaleInvoice, printReport } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { Plus, Search, Printer, MessageCircle, Eye, Edit, Filter, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const SALE_TYPE_LABEL = {
  all: "الكل",
  credit: "آجل",
  cash: "نقدي",
  electronic: "إلكترونية",
};

const iso = (d) => d.toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const startOfYear = () => { const d = new Date(); return new Date(d.getFullYear(), 0, 1); };

export default function Sales() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState(null);
  const [successInvoice, setSuccessInvoice] = useState(location.state?.savedInvoice || null);
  const [settings, setSettings] = useState({ company_name: "شبكة جواد نت اللاسلكية" });

  const [period, setPeriod] = useState("month"); // day | month | year | custom
  const [start, setStart] = useState(iso(startOfMonth()));
  const [end, setEnd] = useState(iso(new Date()));
  const [type, setType] = useState("all"); // all | credit | cash | electronic

  const load = () => api.get("/sales", { params: { q } }).then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get("/customers").then((r) => setCustomers(r.data));
    api.get("/settings").then((r) => setSettings(r.data));
    api.get("/bank-accounts").then((r) => setBanks(r.data)).catch(() => {});
  }, [q]);

  useEffect(() => {
    if (!location.state?.savedInvoice) return;
    setSuccessInvoice(location.state.savedInvoice);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const applyPreset = (p) => {
    setPeriod(p);
    const today = new Date();
    if (p === "day") { const eod = new Date(today); eod.setHours(23,59,59,999); setStart(iso(startOfToday())); setEnd(iso(eod)); }
    else if (p === "month") { setStart(iso(startOfMonth())); setEnd(iso(today)); }
    else if (p === "year") { setStart(iso(startOfYear())); setEnd(iso(today)); }
  };

  const filtered = useMemo(() => {
    const s = start ? new Date(start + "T00:00:00") : null;
    const e = end ? new Date(end + "T23:59:59") : null;
    return items.filter((it) => {
      const dt = new Date(it.created_at);
      if (s && dt < s) return false;
      if (e && dt > e) return false;
      if (type === "credit" && it.sale_type !== "credit") return false;
      if (type === "cash" && it.sale_type !== "cash") return false;
      if (type === "electronic" && it.source !== "public_order") return false;
      return true;
    });
  }, [items, start, end, type]);

  const totals = useMemo(() => {
    const t = filtered.reduce((a, s) => {
      a.count += 1; a.total += (s.total || 0); a.paid += (s.paid || 0); a.remaining += (s.remaining || 0);
      return a;
    }, { count: 0, total: 0, paid: 0, remaining: 0 });
    return t;
  }, [filtered]);

  const doPrint = (s) => {
    const customer = customers.find((c) => c.id === s.customer_id) || { phone: s.account_phone };
    printSaleInvoice({ sale: s, customer, username: user?.name || user?.username, banks });
  };

  const removeSale = async (s) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/sales/${s.id}`);
      toast.success(`تم حذف فاتورة مبيعات ${s.number}`);
      setViewing(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const printFilteredReport = () => {
    if (filtered.length === 0) { toast.error("لا توجد فواتير ضمن الفلترة الحالية"); return; }
    const periodLabel = { day: "يومي", month: "شهري", year: "سنوي", custom: "مخصص" }[period];
    const title = `تقرير المبيعات ${periodLabel} (${SALE_TYPE_LABEL[type]}) — من ${start || "البداية"} إلى ${end || "اليوم"}`;
    const rows = filtered.map((s) => [
      s.number,
      fmtDate(s.created_at),
      s.customer_name || "نقدي",
      s.source === "public_order" ? "إلكترونية" : (s.sale_type === "cash" ? "نقدي" : "آجل"),
      fmt(s.total),
      fmt(s.paid),
      fmt(s.remaining),
    ]);
    printReport({
      title,
      headers: ["الرقم", "التاريخ", "العميل", "النوع", "الإجمالي", "المدفوع", "المتبقي"],
      rows,
      totals: [
        { label: "عدد الفواتير", value: totals.count },
        { label: "إجمالي المبيعات", value: fmt(totals.total) },
        { label: "إجمالي المدفوع", value: fmt(totals.paid) },
        { label: "إجمالي المتبقي", value: fmt(totals.remaining) },
      ],
      username: user?.name || user?.username,
    });
  };

  const sendWA = (s) => {
    const cust = customers.find((c) => c.id === s.customer_id);
    const phone = cust?.phone || s.account_phone;
    if (!phone) { toast.error("لا يوجد رقم هاتف مسجل لهذا الحساب."); return; }
    const details = (s.items || []).map((i) => `${i.category_name} × ${i.quantity} = ${fmt(i.total)}`).join("\n");
    const msg = buildInvoiceMessage({
      company: settings.company_name, number: s.number, kind: "مبيعات",
      details, amount: s.subtotal, discount: s.discount, total: s.total,
      paid: s.paid, remaining: s.remaining, balance_after: s.balance_after ?? cust?.balance,
    });
    openWhatsApp(phone, msg);
  };

  const saleTypeLabelOf = (s) => s.source === "public_order" ? "إلكترونية" : (s.sale_type === "cash" ? "نقدي" : "آجل");
  const saleTypeClass = (s) => {
    if (s.source === "public_order") return "bg-purple-100 text-purple-700";
    if (s.sale_type === "cash") return "bg-emerald-100 text-emerald-700";
    return "bg-amber-100 text-amber-700";
  };

  return (
    <div className="space-y-4" data-testid="sales-page">
      <div className="flex justify-between flex-wrap gap-2 no-print">
        <div className="relative w-full sm:max-w-xs flex-1"><Search className="absolute right-3 top-2.5 text-slate-400" size={18}/><Input placeholder="بحث برقم GWD..." value={q} onChange={(e) => setQ(e.target.value)} className="pr-10" /></div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={printFilteredReport} variant="outline" className="border-[#452480] text-[#452480]" data-testid="sales-print-report"><Printer size={16} className="ml-1"/> طباعة التقرير</Button>
          <Link to="/sales/new"><Button className="bg-[#221340]" data-testid="new-sale-btn"><Plus size={16} className="ml-1"/> فاتورة جديدة</Button></Link>
        </div>
      </div>

      <Card className="p-3 no-print" data-testid="sales-filters">
        <div className="flex items-center gap-2 mb-3 text-sm text-slate-600"><Filter size={14}/> فلترة</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {[["day","يومي"],["month","شهري"],["year","سنوي"],["custom","مخصص"]].map(([k,l]) => (
            <button key={k} type="button" onClick={() => applyPreset(k)} className={`px-3 py-1.5 rounded-full text-xs border transition ${period===k ? "bg-[#452480] text-white border-[#452480]" : "border-slate-300 hover:bg-slate-50"}`} data-testid={`sales-period-${k}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div><label className="text-xs text-slate-500">من تاريخ</label><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPeriod("custom"); }} data-testid="sales-start"/></div>
          <div><label className="text-xs text-slate-500">إلى تاريخ</label><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPeriod("custom"); }} data-testid="sales-end"/></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["all","credit","cash","electronic"].map((k) => (
            <button key={k} type="button" onClick={() => setType(k)} className={`px-3 py-1.5 rounded-full text-xs border transition ${type===k ? "bg-[#221340] text-white border-[#221340]" : "border-slate-300 hover:bg-slate-50"}`} data-testid={`sales-type-${k}`}>{SALE_TYPE_LABEL[k]}</button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 no-print" data-testid="sales-summary">
        <Card className="p-3"><div className="text-xs text-slate-500">عدد الفواتير</div><div className="text-xl font-bold">{totals.count}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">الإجمالي</div><div className="text-xl font-bold num text-[#452480]">{fmt(totals.total)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">المدفوع</div><div className="text-xl font-bold num text-emerald-700">{fmt(totals.paid)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">المتبقي</div><div className="text-xl font-bold num text-amber-700">{fmt(totals.remaining)}</div></Card>
      </div>

      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">العميل</th><th className="p-3">النوع</th><th className="p-3">الإجمالي</th><th className="p-3">المدفوع</th><th className="p-3">المتبقي</th><th className="p-3 no-print"></th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-[#452480] font-bold">{s.number}</td>
                <td className="p-3">{fmtDate(s.created_at)}</td>
                <td className="p-3">{s.customer_name || "نقدي"}</td>
                <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${saleTypeClass(s)}`} data-testid={`sale-type-${s.id}`}>{saleTypeLabelOf(s)}</span></td>
                <td className="p-3 num">{fmt(s.total)}</td>
                <td className="p-3 num">{fmt(s.paid)}</td>
                <td className="p-3 num font-bold text-amber-700">{fmt(s.remaining)}</td>
                <td className="p-3 no-print flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setViewing(s)} data-testid={`sale-view-${s.id}`}><Eye size={12}/></Button>
                  <Link to={`/sales/${s.id}/edit`}><Button size="sm" variant="outline" data-testid={`sale-edit-${s.id}`}><Edit size={12}/></Button></Link>
                  <Button size="sm" variant="outline" onClick={() => doPrint(s)} data-testid={`sale-print-${s.id}`}><Printer size={12}/></Button>
                  <Button size="sm" variant="outline" onClick={() => sendWA(s)} data-testid={`sale-wa-${s.id}`}><MessageCircle size={12} className="text-green-600"/></Button>
                  <Button size="sm" variant="outline" onClick={() => removeSale(s)} data-testid={`sale-delete-${s.id}`} className="border-red-300" title="حذف"><Trash2 size={12} className="text-red-600"/></Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">لا توجد فواتير ضمن الفلترة الحالية</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="md:hidden space-y-2 no-print">
        {filtered.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-bold text-[#452480] truncate">{s.number}</div>
                <div className="text-xs text-slate-500 truncate">{s.customer_name || "نقدي"} • {fmtDate(s.created_at)}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full mt-1 inline-block ${saleTypeClass(s)}`}>{saleTypeLabelOf(s)}</span>
              </div>
              <div className="text-left text-xs shrink-0">
                <div>الإجمالي: <span className="num font-bold">{fmt(s.total)}</span></div>
                <div className="text-amber-700">المتبقي: <span className="num font-bold">{fmt(s.remaining)}</span></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Button size="sm" variant="outline" onClick={() => setViewing(s)}><Eye size={12} className="ml-1"/> عرض</Button>
              <Link to={`/sales/${s.id}/edit`}><Button size="sm" variant="outline"><Edit size={12} className="ml-1"/> تعديل</Button></Link>
              <Button size="sm" variant="outline" onClick={() => doPrint(s)}><Printer size={12} className="ml-1"/> طباعة</Button>
              <Button size="sm" variant="outline" onClick={() => sendWA(s)}><MessageCircle size={12} className="ml-1 text-green-600"/> واتساب</Button>
              <Button size="sm" variant="outline" onClick={() => removeSale(s)} data-testid={`sale-delete-m-${s.id}`} className="border-red-300"><Trash2 size={12} className="ml-1 text-red-600"/> حذف</Button>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد فواتير ضمن الفلترة الحالية</div>}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>فاتورة {viewing?.number}</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>التاريخ</span><span>{fmtDate(viewing.created_at)}</span></div>
              <div className="flex justify-between"><span>العميل</span><span>{viewing.customer_name || "نقدي"}</span></div>
              <div className="flex justify-between"><span>النوع</span><span className={`text-xs px-2 py-0.5 rounded-full ${saleTypeClass(viewing)}`}>{saleTypeLabelOf(viewing)}</span></div>
              {viewing.recipient_phone && (
                <div className="flex justify-between bg-amber-50 border border-amber-200 rounded px-2 py-1" data-testid="sale-view-recipient">
                  <span className="text-amber-800">📤 المرسل إلى</span>
                  <span className="font-mono font-bold text-amber-900">{viewing.recipient_phone}</span>
                </div>
              )}
              <div className="border-t pt-2">
                {(viewing.items || []).map((it, i) => (
                  <div key={i} className="flex justify-between py-1"><span>{it.category_name} × {it.quantity}</span><span className="num">{fmt(it.total)}</span></div>
                ))}
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>الإجمالي</span><span className="num font-bold">{fmt(viewing.total)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between"><span>الخصم</span><span className="num">{fmt(viewing.discount)}</span></div>}
                <div className="flex justify-between"><span>المدفوع</span><span className="num">{fmt(viewing.paid)}</span></div>
                <div className="flex justify-between"><span>المتبقي</span><span className="num font-bold text-amber-700">{fmt(viewing.remaining)}</span></div>
              </div>
              <div className="flex gap-2 pt-2 flex-wrap">
                <Button onClick={() => doPrint(viewing)} className="bg-[#221340] flex-1 min-w-[120px]"><Printer size={14} className="ml-1"/> طباعة</Button>
                <Button onClick={() => sendWA(viewing)} variant="outline" className="border-green-600 text-green-700 flex-1 min-w-[120px]"><MessageCircle size={14} className="ml-1"/> واتساب</Button>
                <Link to={`/sales/${viewing.id}/edit`} className="flex-1 min-w-[120px]"><Button variant="outline" className="w-full"><Edit size={14} className="ml-1"/> تعديل الفاتورة</Button></Link>
                <Button onClick={() => removeSale(viewing)} variant="outline" className="border-red-500 text-red-700 flex-1 min-w-[120px]" data-testid="sale-delete-view"><Trash2 size={14} className="ml-1"/> حذف الفاتورة</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InvoiceSuccessDialog
        open={!!successInvoice}
        onOpenChange={(open) => !open && setSuccessInvoice(null)}
        invoice={successInvoice}
        accountName={successInvoice?.customer_name}
        paymentType={successInvoice?.sale_type === "cash" ? "نقد" : "آجل"}
        onWhatsApp={() => successInvoice && sendWA(successInvoice)}
        onPrint={() => successInvoice && doPrint(successInvoice)}
      />
    </div>
  );
}
