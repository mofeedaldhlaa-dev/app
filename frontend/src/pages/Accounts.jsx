import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { printAccountsSummary } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import PeriodFilter, { PERIOD_LABELS } from "@/components/PeriodFilter";
import { ArrowLeftRight, Printer, Filter, FileText, FolderPlus, FolderInput, Trash2, Layers, ChevronLeft } from "lucide-react";

const TYPE_LABELS = { all: "الكل", customer: "عملاء", pos: "نقاط بيع", supplier: "موردون", expense: "حسابات مصروفات" };
const TYPE_SINGULAR = { customer: "عميل", pos: "نقطة بيع", supplier: "مورد", expense: "مصروفات" };
const PRINT_CATEGORIES = {
  all: "جميع الحسابات",
  customer: "كشف مديونية العملاء",
  pos: "كشف مديونية نقاط البيع",
  supplier: "كشف مديونية الموردين",
  expense: "كشف المصروفات",
};
const PRINT_BTN_LABEL = {
  customer: "طباعة كشف مديونية العملاء",
  pos: "طباعة كشف مديونية نقاط البيع",
  supplier: "طباعة كشف مديونية الموردين",
  expense: "طباعة كشف المصروفات",
};
const TYPE_BADGE = {
  customer: "bg-blue-100 text-blue-800 border-blue-300",
  pos: "bg-purple-100 text-purple-800 border-purple-300",
  supplier: "bg-amber-100 text-amber-800 border-amber-300",
  expense: "bg-red-100 text-red-800 border-red-300",
};
const TYPE_BAR = { customer: "bg-blue-500", pos: "bg-purple-500", supplier: "bg-amber-500", expense: "bg-red-500" };

// مدين (رصيد موجب) = عليه ، دائن (رصيد سالب) = له — لجميع أنواع الحسابات.
const stateLabel = (b) => (b > 0 ? "عليه" : b < 0 ? "له" : "متعادل");
const stateColor = (b) => (b > 0 ? "text-red-700" : b < 0 ? "text-emerald-700" : "text-slate-500");
const stateBg = (b) => (b > 0 ? "bg-red-50 text-red-700" : b < 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500");

export default function Accounts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [lists, setLists] = useState([]);
  const [type, setType] = useState("all");
  const [listFilter, setListFilter] = useState(null);
  const [q, setQ] = useState("");
  const [openTransfer, setOpenTransfer] = useState(false);

  // Print dialog
  const [openPrint, setOpenPrint] = useState(false);
  const [printCategory, setPrintCategory] = useState("all");
  const [printPeriod, setPrintPeriod] = useState("all");
  const [printStart, setPrintStart] = useState("");
  const [printEnd, setPrintEnd] = useState("");

  // Lists dialogs
  const [openNewList, setOpenNewList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [openMove, setOpenMove] = useState(false);
  const [moveAcc, setMoveAcc] = useState(null);
  const [moveListId, setMoveListId] = useState("none");

  const [form, setForm] = useState({
    source_type: "cash", source_id: "", dest_type: "customer", dest_id: "",
    amount: "", description: "", block_negative: false,
    date: new Date().toISOString().slice(0, 10),
  });

  const load = async () => {
    try {
      const a = await api.get("/accounts");
      setItems((a.data || []).filter((x) => x.type !== "cash"));
      const [t, l] = await Promise.all([api.get("/transfers"), api.get("/account-lists")]);
      setTransfers(t.data);
      setLists(l.data || []);
    } catch (e) { toast.error(errText(e)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter((a) => {
      if (listFilter) { if (a.list_id !== listFilter) return false; }
      else if (type !== "all" && a.type !== type) return false;
      if (ql && !((a.name || "").toLowerCase().includes(ql) || (a.phone || "").includes(ql))) return false;
      return true;
    });
  }, [items, q, type, listFilter]);

  const totalBalance = useMemo(() => filtered.reduce((s, a) => s + (a.balance || 0), 0), [filtered]);
  const counts = useMemo(() => {
    const c = { all: items.length };
    for (const it of items) c[it.type] = (c[it.type] || 0) + 1;
    return c;
  }, [items]);
  const listCounts = useMemo(() => {
    const c = {};
    for (const it of items) if (it.list_id) c[it.list_id] = (c[it.list_id] || 0) + 1;
    return c;
  }, [items]);

  const openPrintDialog = () => {
    setPrintCategory(!listFilter && type !== "all" ? type : "all");
    setOpenPrint(true);
  };

  const runPrint = (category, periodLabel, start, end) => {
    const list = items.filter((a) => category === "all" || a.type === category);
    if (!list.length) { toast.error("لا توجد حسابات ضمن الفئة المحددة"); return; }
    const accounts = list.map((a) => ({
      typeLabel: TYPE_SINGULAR[a.type] || a.type,
      name: a.name, phone: a.phone || "-", balance: a.balance || 0,
    }));
    printAccountsSummary({
      categoryLabel: PRINT_CATEGORIES[category] || "جميع الحسابات",
      accounts,
      periodLabel: periodLabel || "حتى تاريخه",
      start, end,
      username: user?.name || user?.username,
    });
  };

  const doPrint = () => { runPrint(printCategory, PERIOD_LABELS[printPeriod], printStart, printEnd); setOpenPrint(false); };
  const doQuickCategoryPrint = () => { runPrint(type, "حتى تاريخه", "", ""); };

  const createList = async () => {
    if (!newListName.trim()) { toast.error("أدخل اسم القائمة"); return; }
    try {
      await api.post("/account-lists", { name: newListName.trim() });
      toast.success("تم إنشاء القائمة");
      setOpenNewList(false); setNewListName("");
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  const deleteList = async (lid) => {
    if (!window.confirm("حذف القائمة؟ لن يتم حذف أي حساب، سيتم فقط فصل الحسابات عن هذه القائمة.")) return;
    try {
      await api.delete(`/account-lists/${lid}`);
      toast.success("تم حذف القائمة");
      if (listFilter === lid) setListFilter(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  const openMoveDialog = (acc) => { setMoveAcc(acc); setMoveListId(acc.list_id || "none"); setOpenMove(true); };
  const doMove = async () => {
    if (!moveAcc) return;
    try {
      await api.put(`/accounts/${moveAcc.type}/${moveAcc.id}/list`, { list_id: moveListId === "none" ? null : moveListId });
      toast.success("تم نقل الحساب إلى القائمة (بدون أي تكرار أو فقدان بيانات)");
      setOpenMove(false); setMoveAcc(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const selectableParties = useMemo(() => ({
    customer: items.filter((a) => a.type === "customer" || a.type === "pos"),
    supplier: items.filter((a) => a.type === "supplier"),
  }), [items]);

  const submitTransfer = async () => {
    if (!form.amount || Number(form.amount) <= 0) { toast.error("أدخل مبلغاً صحيحاً"); return; }
    if (form.source_type !== "cash" && !form.source_id) { toast.error("اختر الحساب المصدر"); return; }
    if (form.dest_type !== "cash" && !form.dest_id) { toast.error("اختر الحساب المستلم"); return; }
    if (form.source_type === form.dest_type && form.source_id === form.dest_id) { toast.error("لا يمكن التحويل لنفس الحساب"); return; }
    try {
      const payload = {
        source_type: form.source_type,
        source_id: form.source_type === "cash" ? null : form.source_id,
        source_name: form.source_type === "cash" ? "الصندوق" : (items.find((x) => x.id === form.source_id)?.name || ""),
        dest_type: form.dest_type,
        dest_id: form.dest_type === "cash" ? null : form.dest_id,
        dest_name: form.dest_type === "cash" ? "الصندوق" : (items.find((x) => x.id === form.dest_id)?.name || ""),
        amount: Number(form.amount), description: form.description, block_negative: form.block_negative,
        date: form.date, idempotency_key: genUUID(),
      };
      await api.post("/transfers", payload);
      toast.success("تم تنفيذ التحويل");
      setOpenTransfer(false);
      setForm({ ...form, amount: "", description: "" });
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const partyLink = (a) => `/accounts/${a.type}/${a.id}`;

  return (
    <div className="space-y-4" data-testid="accounts-page">
      <div className="flex justify-between flex-wrap gap-2 no-print">
        <Input placeholder="بحث بالاسم أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid="acc-search"/>
        <div className="flex gap-2 flex-wrap">
          {!listFilter && type !== "all" && (
            <Button onClick={doQuickCategoryPrint} variant="outline" className="border-emerald-600 text-emerald-700" data-testid="acc-print-category-btn">
              <Printer size={14} className="ml-1"/> {PRINT_BTN_LABEL[type]}
            </Button>
          )}
          <Button onClick={openPrintDialog} variant="outline" className="border-[#452480] text-[#452480]" data-testid="acc-print"><Printer size={14} className="ml-1"/> طباعة الكشوف</Button>
          <Button onClick={() => setOpenTransfer(true)} className="bg-[#221340]" data-testid="acc-transfer"><ArrowLeftRight size={14} className="ml-1"/> تحويل بين حسابات</Button>
        </div>
      </div>

      {/* Type filter */}
      <Card className="p-3 no-print" data-testid="acc-filters">
        <div className="flex items-center gap-2 mb-2 text-sm text-slate-600"><Filter size={14}/> تصفية حسب النوع</div>
        <div className="flex flex-wrap gap-2">
          {["all", "customer", "pos", "supplier", "expense"].map((k) => (
            <button key={k} onClick={() => { setType(k); setListFilter(null); }}
              className={`px-3 py-1.5 rounded-full text-xs border ${!listFilter && type === k ? "bg-[#452480] text-white border-[#452480]" : "border-slate-300 hover:bg-slate-50"}`}
              data-testid={`acc-type-${k}`}>
              {TYPE_LABELS[k]} <span className="opacity-70">({counts[k] || 0})</span>
            </button>
          ))}
        </div>
      </Card>

      {/* Custom account lists */}
      <Card className="p-3 no-print" data-testid="acc-lists">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 text-sm text-slate-600"><Layers size={14}/> القوائم المخصصة</div>
          <Button size="sm" variant="outline" className="h-8 border-[#452480] text-[#452480]" onClick={() => setOpenNewList(true)} data-testid="acc-new-list"><FolderPlus size={14} className="ml-1"/> قائمة جديدة</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {lists.length === 0 && <div className="text-xs text-slate-400">لا توجد قوائم مخصصة بعد. أنشئ قائمة ثم انقل الحسابات إليها.</div>}
          {lists.map((l) => (
            <div key={l.id} className={`flex items-center rounded-full border text-xs ${listFilter === l.id ? "bg-[#D4AF37] border-[#D4AF37] text-[#1A0F33]" : "border-slate-300"}`}>
              <button onClick={() => { setListFilter(listFilter === l.id ? null : l.id); }} className="px-3 py-1.5" data-testid={`acc-list-${l.id}`}>
                {l.name} <span className="opacity-70">({listCounts[l.id] || 0})</span>
              </button>
              <button onClick={() => deleteList(l.id)} className="px-2 py-1.5 hover:text-red-600" data-testid={`acc-list-del-${l.id}`} title="حذف القائمة"><Trash2 size={12}/></button>
            </div>
          ))}
        </div>
      </Card>

      {/* Summary cards (transfer totals removed per requirement) */}
      <div className="grid grid-cols-2 gap-2 no-print">
        <Card className="p-3"><div className="text-xs text-slate-500">عدد الحسابات</div><div className="text-xl font-bold">{filtered.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">صافي الأرصدة</div><div className={`text-xl font-bold num ${stateColor(totalBalance)}`}>{fmt(Math.abs(totalBalance))} <span className="text-xs">{stateLabel(totalBalance)}</span></div></Card>
      </div>

      {listFilter && (
        <div className="text-sm font-bold text-[#452480] flex items-center gap-2" data-testid="acc-list-heading">
          <Layers size={16}/> القائمة: {lists.find((l) => l.id === listFilter)?.name}
        </div>
      )}

      {/* Account cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="accounts-grid">
        {filtered.map((a) => (
          <div
            key={`${a.type}-${a.id}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate(partyLink(a))}
            onKeyDown={(e) => { if (e.key === "Enter") navigate(partyLink(a)); }}
            data-testid={`acc-card-${a.id}`}
            className="group relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition cursor-pointer"
          >
            <div className={`absolute top-0 bottom-0 right-0 w-1.5 ${TYPE_BAR[a.type] || "bg-slate-400"}`} />
            <div className="p-4 pr-5">
              <div className="flex items-start justify-between gap-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${TYPE_BADGE[a.type] || "bg-slate-100 border-slate-300"}`}>{TYPE_LABELS[a.type] || a.type}</span>
                <ChevronLeft size={16} className="text-slate-300 group-hover:text-[#452480] transition" />
              </div>
              <div className="mt-2 font-bold text-[#221340] text-base leading-snug truncate" title={a.name}>{a.name}</div>
              <div className="text-xs text-slate-400 font-mono">{a.phone || "—"}</div>
              {a.list_name && <div className="mt-1 text-[10px] text-[#452480] flex items-center gap-1"><Layers size={10}/> {a.list_name}</div>}

              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] text-slate-500">الرصيد الحالي</div>
                  <div className={`text-xl font-black num ${stateColor(a.balance || 0)}`} data-testid={`acc-balance-${a.id}`}>{fmt(Math.abs(a.balance || 0))}</div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${stateBg(a.balance || 0)}`} data-testid={`acc-state-${a.id}`}>{stateLabel(a.balance || 0)}</span>
              </div>

              <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-2.5" onClick={(e) => e.stopPropagation()}>
                <Link to={partyLink(a)} className="flex-1" data-testid={`acc-open-${a.id}`}>
                  <Button size="sm" variant="outline" className="w-full h-8 border-[#452480] text-[#452480]"><FileText size={13} className="ml-1" /> كشف الحساب</Button>
                </Link>
                <Button size="sm" variant="outline" className="h-8" onClick={() => openMoveDialog(a)} data-testid={`acc-move-${a.id}`} title="نقل إلى قائمة"><FolderInput size={13}/></Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {filtered.length === 0 && <Card className="p-8 text-center text-slate-400">لا توجد حسابات</Card>}

      {/* Net balance summary */}
      {filtered.length > 0 && (
        <Card className="p-4 flex items-center justify-between bg-slate-50" data-testid="acc-net-summary">
          <div className="text-sm font-bold text-slate-600">صافي أرصدة الحسابات المعروضة ({filtered.length})</div>
          <div className={`text-lg font-black num ${stateColor(totalBalance)}`}>{fmt(Math.abs(totalBalance))} <span className="text-xs font-bold">{stateLabel(totalBalance)}</span></div>
        </Card>
      )}

      {transfers.length > 0 && (
        <Card className="p-3 no-print" data-testid="acc-transfers-list">
          <div className="font-bold text-[#221340] mb-2">آخر التحويلات</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">من</th><th className="p-2">إلى</th><th className="p-2">المبلغ</th><th className="p-2">البيان</th></tr></thead>
              <tbody>
                {transfers.slice(0, 20).map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 font-mono">{t.number}</td>
                    <td className="p-2">{fmtDate(t.created_at)}</td>
                    <td className="p-2">{t.source_name}</td>
                    <td className="p-2">{t.dest_name}</td>
                    <td className="p-2 num font-bold">{fmt(t.amount)}</td>
                    <td className="p-2 text-slate-600">{t.description || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Print Dialog */}
      <Dialog open={openPrint} onOpenChange={setOpenPrint}>
        <DialogContent className="max-w-lg" data-testid="acc-print-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-[#221340]"><Printer size={18} className="text-[#452480]"/> طباعة كشوف الحسابات</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>فئة الطباعة</Label>
              <Select value={printCategory} onValueChange={setPrintCategory}>
                <SelectTrigger data-testid="acc-print-category"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحسابات</SelectItem>
                  <SelectItem value="customer">كشف مديونية العملاء</SelectItem>
                  <SelectItem value="pos">كشف مديونية نقاط البيع</SelectItem>
                  <SelectItem value="supplier">كشف مديونية الموردين</SelectItem>
                  <SelectItem value="expense">كشف المصروفات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">الفترة الزمنية</Label>
              <PeriodFilter period={printPeriod} start={printStart} end={printEnd}
                onChange={({ period, start, end }) => { setPrintPeriod(period); setPrintStart(start); setPrintEnd(end); }}
                testidPrefix="acc-print-period" />
              <div className="text-[11px] text-slate-400 mt-1">التقرير يعرض أرصدة الحسابات الحالية بحالة (عليه / له) والإجماليات.</div>
            </div>
            <Button onClick={doPrint} className="w-full bg-[#221340]" data-testid="acc-print-confirm"><Printer size={14} className="ml-1"/> طباعة</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New list dialog */}
      <Dialog open={openNewList} onOpenChange={setOpenNewList}>
        <DialogContent className="max-w-sm" data-testid="acc-new-list-dialog">
          <DialogHeader><DialogTitle>قائمة حسابات جديدة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم القائمة</Label><Input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="مثال: عملاء المخا" data-testid="new-list-name"/></div>
            <Button onClick={createList} className="w-full bg-[#221340]" data-testid="new-list-save">إنشاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move account to list dialog */}
      <Dialog open={openMove} onOpenChange={setOpenMove}>
        <DialogContent className="max-w-sm" data-testid="acc-move-dialog">
          <DialogHeader><DialogTitle>نقل الحساب إلى قائمة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-slate-600">الحساب: <span className="font-bold text-[#221340]">{moveAcc?.name}</span></div>
            <div>
              <Label>القائمة</Label>
              <Select value={moveListId} onValueChange={setMoveListId}>
                <SelectTrigger data-testid="move-list-select"><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون قائمة (الافتراضي)</SelectItem>
                  {lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-[11px] text-slate-400">النقل يغيّر القائمة فقط ولا ينشئ حساباً مكرراً ولا يفقد أي حركات أو أرصدة.</div>
            <Button onClick={doMove} className="w-full bg-[#221340]" data-testid="move-save">نقل</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={openTransfer} onOpenChange={setOpenTransfer}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>تحويل بين الحسابات</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>نوع المصدر</Label>
                <Select value={form.source_type} onValueChange={(v) => setForm({ ...form, source_type: v, source_id: "" })}>
                  <SelectTrigger data-testid="tr-source-type"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">الصندوق</SelectItem>
                    <SelectItem value="customer">عميل / نقطة بيع</SelectItem>
                    <SelectItem value="supplier">مورد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>نوع المستلم</Label>
                <Select value={form.dest_type} onValueChange={(v) => setForm({ ...form, dest_type: v, dest_id: "" })}>
                  <SelectTrigger data-testid="tr-dest-type"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">الصندوق</SelectItem>
                    <SelectItem value="customer">عميل / نقطة بيع</SelectItem>
                    <SelectItem value="supplier">مورد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.source_type !== "cash" && (
              <div>
                <Label>الحساب المصدر</Label>
                <Select value={form.source_id} onValueChange={(v) => setForm({ ...form, source_id: v })}>
                  <SelectTrigger data-testid="tr-source"><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>
                    {selectableParties[form.source_type].map((p) => (<SelectItem key={p.id} value={p.id}>{p.name} — {fmt(p.balance)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.dest_type !== "cash" && (
              <div>
                <Label>الحساب المستلم</Label>
                <Select value={form.dest_id} onValueChange={(v) => setForm({ ...form, dest_id: v })}>
                  <SelectTrigger data-testid="tr-dest"><SelectValue placeholder="اختر"/></SelectTrigger>
                  <SelectContent>
                    {selectableParties[form.dest_type].map((p) => (<SelectItem key={p.id} value={p.id}>{p.name} — {fmt(p.balance)}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><Label>المبلغ</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="tr-amount"/></div>
              <div><Label>التاريخ</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} data-testid="tr-date"/></div>
            </div>
            <div><Label>البيان</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="tr-desc"/></div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.block_negative} onChange={(e) => setForm({ ...form, block_negative: e.target.checked })} data-testid="tr-block-neg"/>
              منع الرصيد السالب في الحساب المصدر
            </label>
            <Button onClick={submitTransfer} className="w-full bg-[#221340]" data-testid="tr-save">تنفيذ التحويل</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
