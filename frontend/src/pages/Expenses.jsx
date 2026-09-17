import { useEffect, useMemo, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmt, fmtDate, genUUID } from "@/lib/utils";
import { printReport } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { Plus, Printer, Trash2, Filter, Wallet } from "lucide-react";

const iso = (d) => d.toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const startOfYear = () => { const d = new Date(); return new Date(d.getFullYear(), 0, 1); };

export default function Expenses() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [q, setQ] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ account_id: "", amount: "", description: "", date: iso(new Date()) });

  const [accOpen, setAccOpen] = useState(false);
  const [accForm, setAccForm] = useState({ name: "", notes: "" });

  const [period, setPeriod] = useState("month");
  const [start, setStart] = useState(iso(startOfMonth()));
  const [end, setEnd] = useState(iso(new Date()));

  const load = async () => {
    setItems((await api.get("/expenses")).data);
    setAccounts((await api.get("/expense-accounts")).data);
  };
  useEffect(() => { load(); }, []);

  const applyPeriod = (p) => {
    setPeriod(p);
    const today = new Date();
    if (p === "day") { setStart(iso(startOfToday())); setEnd(iso(today)); }
    else if (p === "month") { setStart(iso(startOfMonth())); setEnd(iso(today)); }
    else if (p === "year") { setStart(iso(startOfYear())); setEnd(iso(today)); }
  };

  const filtered = useMemo(() => {
    const s = start ? new Date(start + "T00:00:00") : null;
    const e = end ? new Date(end + "T23:59:59") : null;
    const ql = q.trim().toLowerCase();
    return items.filter((it) => {
      if (it.status === "deleted") return false;
      const dt = new Date(it.created_at);
      if (s && dt < s) return false;
      if (e && dt > e) return false;
      if (ql) {
        const hay = `${it.account_name || ""} ${it.description || ""} ${it.number || ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [items, start, end, q]);

  const totalAmt = useMemo(() => filtered.reduce((s, x) => s + (x.amount || 0), 0), [filtered]);

  const saveExpense = async () => {
    if (!form.account_id || !form.amount) { toast.error("اختر الحساب والمبلغ"); return; }
    try {
      await api.post("/expenses", { ...form, amount: Number(form.amount), idempotency_key: genUUID() });
      toast.success("تم حفظ المصروف");
      setForm({ account_id: "", amount: "", description: "", date: iso(new Date()) });
      setAddOpen(false);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const saveAccount = async () => {
    if (!accForm.name.trim()) { toast.error("أدخل اسم الحساب"); return; }
    try {
      await api.post("/expense-accounts", accForm);
      toast.success("تم إنشاء حساب المصروف");
      setAccForm({ name: "", notes: "" });
      setAccOpen(false);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const deleteAccount = async (id) => {
    if (!window.confirm("حذف هذا الحساب؟")) return;
    try {
      await api.delete(`/expense-accounts/${id}`);
      toast.success("تم الحذف"); load();
    } catch (e) { toast.error(errText(e)); }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/expenses/${id}`);
      toast.success("تم الحذف"); load();
    } catch (e) { toast.error(errText(e)); }
  };

  const printFiltered = () => {
    if (!filtered.length) { toast.error("لا توجد مصروفات ضمن الفلترة"); return; }
    const labelP = { day: "يومي", month: "شهري", year: "سنوي", custom: "مخصص" }[period];
    printReport({
      title: `تقرير المصروفات ${labelP} — من ${start || "البداية"} إلى ${end || "اليوم"}`,
      headers: ["الرقم", "التاريخ", "الحساب", "المبلغ", "البيان"],
      rows: filtered.map((x) => [x.number, fmtDate(x.created_at), x.account_name, fmt(x.amount), x.description || "-"]),
      totals: [
        { label: "عدد المصروفات", value: filtered.length },
        { label: "إجمالي المصروفات", value: fmt(totalAmt) },
      ],
      username: user?.name || user?.username,
    });
  };

  return (
    <div className="space-y-4" data-testid="expenses-page">
      <div className="flex justify-between flex-wrap gap-2 no-print">
        <div className="relative w-full sm:max-w-xs flex-1"><Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} data-testid="exp-search"/></div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => setAccOpen(true)} variant="outline" data-testid="exp-manage-accounts"><Wallet size={14} className="ml-1"/> حسابات المصروفات</Button>
          <Button onClick={printFiltered} variant="outline" className="border-[#452480] text-[#452480]" data-testid="exp-print"><Printer size={14} className="ml-1"/> طباعة</Button>
          <Button onClick={() => setAddOpen(true)} className="bg-[#221340]" data-testid="exp-new"><Plus size={14} className="ml-1"/> مصروف جديد</Button>
        </div>
      </div>

      <Card className="p-3 no-print" data-testid="exp-filters">
        <div className="flex items-center gap-2 mb-3 text-sm text-slate-600"><Filter size={14}/> فلترة</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {[["day","يومي"],["month","شهري"],["year","سنوي"],["custom","مخصص"]].map(([k,l]) => (
            <button key={k} onClick={() => applyPeriod(k)} className={`px-3 py-1.5 rounded-full text-xs border ${period===k?"bg-[#452480] text-white border-[#452480]":"border-slate-300 hover:bg-slate-50"}`} data-testid={`exp-period-${k}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-xs">من</Label><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPeriod("custom"); }} data-testid="exp-start"/></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPeriod("custom"); }} data-testid="exp-end"/></div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2 no-print">
        <Card className="p-3"><div className="text-xs text-slate-500">عدد المصروفات</div><div className="text-xl font-bold">{filtered.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">إجمالي المصروفات</div><div className="text-xl font-bold num text-red-700">{fmt(totalAmt)}</div></Card>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">الحساب</th><th className="p-3">المبلغ</th><th className="p-3">البيان</th><th className="no-print"></th></tr></thead>
          <tbody>
            {filtered.map((x) => (
              <tr key={x.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-[#452480] font-bold">{x.number}</td>
                <td className="p-3">{fmtDate(x.created_at)}</td>
                <td className="p-3">{x.account_name}</td>
                <td className="p-3 num font-bold text-red-700">{fmt(x.amount)}</td>
                <td className="p-3 text-slate-600 text-xs">{x.description || "-"}</td>
                <td className="p-3 no-print"><Button size="sm" variant="outline" onClick={() => deleteExpense(x.id)} className="border-red-300" data-testid={`exp-del-${x.id}`}><Trash2 size={12} className="text-red-600"/></Button></td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد مصروفات</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* New Expense Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>مصروف جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1"><Label>حساب المصروف</Label><button type="button" onClick={() => setAccOpen(true)} className="text-xs text-[#452480] hover:underline" data-testid="exp-add-account-inline">+ إضافة حساب</button></div>
              <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                <SelectTrigger data-testid="exp-form-account"><SelectValue placeholder="اختر"/></SelectTrigger>
                <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>المبلغ</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="exp-form-amount"/></div>
            <div><Label>التاريخ</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="exp-form-date"/></div>
            <div><Label>البيان والملاحظات</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="exp-form-desc"/></div>
            <Button onClick={saveExpense} className="w-full bg-[#221340]" data-testid="exp-form-save">حفظ</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Accounts Dialog */}
      <Dialog open={accOpen} onOpenChange={setAccOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>حسابات المصروفات</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Input placeholder="اسم الحساب" value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} data-testid="exp-acc-name"/>
              <Input placeholder="ملاحظات (اختياري)" value={accForm.notes} onChange={(e) => setAccForm({ ...accForm, notes: e.target.value })} className="col-span-1"/>
              <Button onClick={saveAccount} className="bg-[#221340]" data-testid="exp-acc-save">إضافة</Button>
            </div>
            <div className="border-t pt-2 max-h-64 overflow-auto">
              {accounts.map((a) => (
                <div key={a.id} className="flex justify-between items-center py-1 border-b border-slate-100">
                  <div><div className="font-medium">{a.name}</div>{a.notes && <div className="text-xs text-slate-500">{a.notes}</div>}</div>
                  <Button size="sm" variant="outline" onClick={() => deleteAccount(a.id)} className="border-red-300"><Trash2 size={12} className="text-red-600"/></Button>
                </div>
              ))}
              {accounts.length === 0 && <div className="text-slate-400 text-center py-4 text-sm">لا توجد حسابات — أضف واحداً أعلاه</div>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
