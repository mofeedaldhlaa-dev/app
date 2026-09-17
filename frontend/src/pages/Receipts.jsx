import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmt, fmtDate, genUUID, openWhatsApp, buildReceiptMessage } from "@/lib/utils";
import { printReceipt } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { Plus, Printer, MessageCircle, X, Filter, Trash2 } from "lucide-react";
import { printReport } from "@/lib/print";
import { useMemo } from "react";

const _iso = (d) => d.toISOString().slice(0, 10);
const _startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const _startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const _startOfYear = () => { const d = new Date(); return new Date(d.getFullYear(), 0, 1); };

export default function Receipts() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("receipt");
  const [partyType, setPartyType] = useState("customer");
  const [partyId, setPartyId] = useState("");
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState("");
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [saved, setSaved] = useState(null);
  const [editing, setEditing] = useState(null);
  const [settings, setSettings] = useState({ company_name: "شبكة جواد نت اللاسلكية" });
  const [period, setPeriod] = useState("month");
  const [rstart, setRstart] = useState(_iso(_startOfMonth()));
  const [rend, setRend] = useState(_iso(new Date()));
  const [rkind, setRkind] = useState("all"); // all | receipt | payment

  const applyPeriod = (p) => {
    setPeriod(p); const today = new Date();
    if (p === "day") { const eod = new Date(today); eod.setHours(23,59,59,999); setRstart(_iso(_startOfToday())); setRend(_iso(eod)); }
    else if (p === "month") { setRstart(_iso(_startOfMonth())); setRend(_iso(today)); }
    else if (p === "year") { setRstart(_iso(_startOfYear())); setRend(_iso(today)); }
  };

  const filtered = useMemo(() => {
    const s = rstart ? new Date(rstart + "T00:00:00") : null;
    const e = rend ? new Date(rend + "T23:59:59") : null;
    return items.filter((it) => {
      const dt = new Date(it.created_at);
      if (s && dt < s) return false;
      if (e && dt > e) return false;
      if (rkind !== "all" && it.kind !== rkind) return false;
      return true;
    });
  }, [items, rstart, rend, rkind]);

  const totalReceipts = useMemo(() => filtered.filter((r) => r.kind === "receipt").reduce((s, r) => s + (r.amount || 0), 0), [filtered]);
  const totalPayments = useMemo(() => filtered.filter((r) => r.kind === "payment").reduce((s, r) => s + (r.amount || 0), 0), [filtered]);

  const printReportFiltered = () => {
    if (!filtered.length) { toast.error("لا توجد سندات ضمن الفلترة"); return; }
    const labelP = { day: "يومي", month: "شهري", year: "سنوي", custom: "مخصص" }[period];
    const labelK = { all: "الكل", receipt: "قبض", payment: "صرف" }[rkind];
    printReport({
      title: `تقرير السندات ${labelP} (${labelK}) — من ${rstart || "البداية"} إلى ${rend || "اليوم"}`,
      headers: ["الرقم", "التاريخ", "النوع", "الطرف", "المبلغ", "البيان"],
      rows: filtered.map((r) => [r.number, fmtDate(r.created_at), r.kind === "receipt" ? "قبض" : "صرف", r.party_name || "-", fmt(r.amount), r.description || "-"]),
      totals: [
        { label: "عدد السندات", value: filtered.length },
        { label: "إجمالي القبض", value: fmt(totalReceipts) },
        { label: "إجمالي الصرف", value: fmt(totalPayments) },
        { label: "صافي الحركة", value: fmt(totalReceipts - totalPayments) },
      ],
      username: user?.name || user?.username,
    });
  };

  const load = async () => setItems((await api.get("/receipts")).data);
  useEffect(() => {
    load();
    api.get("/customers").then((r) => setCustomers(r.data));
    api.get("/suppliers").then((r) => setSuppliers(r.data));
    api.get("/settings").then((r) => setSettings(r.data));
    api.get("/bank-accounts").then((r) => setBanks(r.data)).catch(() => {});
  }, []);

  const saveEdit = async () => {
    try {
      await api.put(`/receipts/${editing.id}`, { amount: Number(editing.amount), description: editing.description });
      toast.success("تم التعديل"); setEditing(null); load();
    } catch (e) { toast.error(errText(e)); }
  };

  const removeReceipt = async (r) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/receipts/${r.id}`);
      toast.success(`تم حذف سند رقم ${r.number}`);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const parties = partyType === "customer" ? customers : suppliers;
  const party = parties.find((p) => p.id === partyId);

  const submit = async () => {
    if (!partyId || !amount) { toast.error("أكمل البيانات"); return; }
    try {
      const r = await api.post("/receipts", { kind, party_type: partyType, party_id: partyId, party_name: party?.name || "", amount: Number(amount), description, idempotency_key: genUUID() });
      setSaved({ ...r.data, party_phone: party?.phone });
      toast.success("تم الحفظ");
      setAmount(0); setDescription(""); setPartyId("");
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const sendWA = () => {
    if (!saved?.party_phone) { toast.error("لا يوجد رقم هاتف مسجل لهذا الحساب."); return; }
    const msg = buildReceiptMessage({
      company: settings.company_name, kind: saved.kind, number: saved.number,
      amount: saved.amount, description: saved.description,
      balance_after: saved.balance_after,
    });
    openWhatsApp(saved.party_phone, msg);
  };

  return (
    <div className="space-y-4" data-testid="receipts-page">
      <div className="flex justify-between flex-wrap gap-2 no-print">
        <Button onClick={printReportFiltered} variant="outline" className="border-[#452480] text-[#452480]" data-testid="rec-print-report"><Printer size={14} className="ml-1"/> طباعة التقرير</Button>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); }}>
          <DialogTrigger asChild><Button className="bg-[#221340]" data-testid="new-receipt-btn"><Plus size={16} className="ml-1"/> سند جديد</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>سند جديد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>نوع السند</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger data-testid="rec-kind"><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="receipt">سند قبض</SelectItem><SelectItem value="payment">سند صرف</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>نوع الطرف</Label>
                <Select value={partyType} onValueChange={setPartyType}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="customer">عميل</SelectItem><SelectItem value="supplier">مورد</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <Label>الطرف</Label>
                <Select value={partyId} onValueChange={setPartyId}>
                  <SelectTrigger data-testid="rec-party"><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>{parties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>المبلغ</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="rec-amount"/></div>
              <div><Label>البيان</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)}/></div>
              <Button onClick={submit} className="w-full bg-[#221340]" data-testid="rec-save">حفظ</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3 no-print" data-testid="rec-filters">
        <div className="flex items-center gap-2 mb-3 text-sm text-slate-600"><Filter size={14}/> فلترة</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {[["day","يومي"],["month","شهري"],["year","سنوي"],["custom","مخصص"]].map(([k,l]) => (
            <button key={k} onClick={() => applyPeriod(k)} className={`px-3 py-1.5 rounded-full text-xs border ${period===k?"bg-[#452480] text-white border-[#452480]":"border-slate-300 hover:bg-slate-50"}`} data-testid={`rec-period-${k}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><Label className="text-xs">من</Label><Input type="date" value={rstart} onChange={(e) => { setRstart(e.target.value); setPeriod("custom"); }} data-testid="rec-start"/></div>
          <div><Label className="text-xs">إلى</Label><Input type="date" value={rend} onChange={(e) => { setRend(e.target.value); setPeriod("custom"); }} data-testid="rec-end"/></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[["all","الكل"],["receipt","قبض"],["payment","صرف"]].map(([k,l]) => (
            <button key={k} onClick={() => setRkind(k)} className={`px-3 py-1.5 rounded-full text-xs border ${rkind===k?"bg-[#221340] text-white border-[#221340]":"border-slate-300 hover:bg-slate-50"}`} data-testid={`rec-kind-${k}`}>{l}</button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 no-print" data-testid="rec-summary">
        <Card className="p-3"><div className="text-xs text-slate-500">عدد السندات</div><div className="text-xl font-bold">{filtered.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">إجمالي القبض</div><div className="text-xl font-bold num text-green-700">{fmt(totalReceipts)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">إجمالي الصرف</div><div className="text-xl font-bold num text-blue-700">{fmt(totalPayments)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">صافي الحركة</div><div className={`text-xl font-bold num ${totalReceipts-totalPayments>=0?"text-emerald-700":"text-red-700"}`}>{fmt(totalReceipts-totalPayments)}</div></Card>
      </div>

      {/* Success Dialog */}
      <Dialog open={!!saved} onOpenChange={(o) => { if (!o) { setSaved(null); setOpen(false); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-green-600">✓ تم إنشاء السند</DialogTitle></DialogHeader>
          {saved && (
            <div className="space-y-3">
              <div className="bg-slate-50 p-3 rounded space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">رقم السند</span><span className="font-mono font-bold text-[#452480]">{saved.number}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">الحساب</span><span className="font-bold">{saved.party_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">النوع</span><span>{saved.kind === "receipt" ? "قبض" : "صرف"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">المبلغ</span><span className="num font-bold text-lg">{fmt(saved.amount)}</span></div>
                {saved.description && <div className="text-slate-600 text-xs pt-2 border-t">{saved.description}</div>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => printReceipt({ receipt: saved, party: (saved.party_type==="customer"?customers:suppliers).find((p) => p.id === saved.party_id) || { phone: saved.party_phone }, username: user?.name || user?.username, banks })} className="bg-[#221340] flex-1" data-testid="rec-print"><Printer size={14} className="ml-1"/> طباعة</Button>
                <Button onClick={sendWA} variant="outline" className="border-green-600 text-green-700 flex-1" data-testid="rec-wa"><MessageCircle size={14} className="ml-1"/> واتساب</Button>
                <Button onClick={() => { setSaved(null); setOpen(false); }} variant="outline"><X size={14}/> إغلاق</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>تعديل السند</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label>المبلغ</Label><Input type="number" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} data-testid="edit-rec-amount"/></div>
              <div><Label>البيان</Label><Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })}/></div>
              <Button onClick={saveEdit} className="w-full bg-[#221340]" data-testid="edit-rec-save">حفظ التعديل</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">النوع</th><th className="p-3">الطرف</th><th className="p-3">المبلغ</th><th className="p-3">الرصيد بعد</th><th></th></tr></thead>
          <tbody>
            {filtered.map((r) => {
              const p = (r.party_type === "customer" ? customers : suppliers).find((x) => x.id === r.party_id);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-[#452480] font-bold">{r.number}</td>
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${r.kind==='receipt'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>{r.kind==='receipt'?'قبض':'صرف'}</span></td>
                  <td className="p-3">{r.party_name}</td>
                  <td className="p-3 num">{fmt(r.amount)}</td>
                  <td className="p-3 num">{fmt(r.balance_after)}</td>
                  <td className="p-3 no-print flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setSaved({ ...r, party_phone: p?.phone })}><MessageCircle size={12}/></Button>
                    <Button size="sm" variant="outline" onClick={() => printReceipt({ receipt: r, party: p, username: user?.name || user?.username, banks })} data-testid={`rec-print-${r.id}`}><Printer size={12}/></Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, amount: r.amount, description: r.description || "" })} data-testid={`rec-edit-${r.id}`}>تعديل</Button>
                    <Button size="sm" variant="outline" onClick={() => removeReceipt(r)} data-testid={`rec-delete-${r.id}`} className="border-red-300" title="حذف"><Trash2 size={12} className="text-red-600"/></Button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد سندات ضمن الفلترة</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2 no-print">
        {filtered.map((r) => {
          const p = (r.party_type === "customer" ? customers : suppliers).find((x) => x.id === r.party_id);
          return (
            <Card key={r.id} className="p-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-[#452480] truncate">{r.number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.kind==='receipt'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>{r.kind==='receipt'?'قبض':'صرف'}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{r.party_name} • {fmtDate(r.created_at)}</div>
                </div>
                <div className="text-left text-xs shrink-0">
                  <div>المبلغ: <span className="num font-bold">{fmt(r.amount)}</span></div>
                  <div className="text-slate-500">بعد: <span className="num">{fmt(r.balance_after)}</span></div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <Button size="sm" variant="outline" onClick={() => setSaved({ ...r, party_phone: p?.phone })}><MessageCircle size={12} className="ml-1"/> واتساب</Button>
                <Button size="sm" variant="outline" onClick={() => printReceipt({ receipt: r, party: p, username: user?.name || user?.username, banks })}><Printer size={12} className="ml-1"/> طباعة</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing({ id: r.id, amount: r.amount, description: r.description || "" })}>تعديل</Button>
                <Button size="sm" variant="outline" onClick={() => removeReceipt(r)} data-testid={`rec-delete-m-${r.id}`} className="border-red-300"><Trash2 size={12} className="ml-1 text-red-600"/> حذف</Button>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد سندات ضمن الفلترة</div>}
      </div>
    </div>
  );
}
