import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmt, fmtDate, genUUID, openWhatsApp, buildReceiptMessage } from "@/lib/utils";
import { printStatement } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { ArrowRight, Printer, Receipt, FilePlus, Send, MessageCircle, Wallet } from "lucide-react";

const TYPE_LABELS = { cash: "الصندوق", customer: "عميل", pos: "نقطة بيع", supplier: "مورد", expense: "حساب مصروفات" };
const _iso = (d) => d.toISOString().slice(0, 10);
const _sof = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };

export default function AccountDetail() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [period, setPeriod] = useState("all");
  const [openVoucher, setOpenVoucher] = useState(false);
  const [voucher, setVoucher] = useState({ kind: "receipt", amount: "", description: "", date: _iso(new Date()) });
  const [openReq, setOpenReq] = useState(false);
  const [req, setReq] = useState({ amount: "", message: "", method: "sms" });
  const [payReqs, setPayReqs] = useState([]);

  const load = async () => {
    try {
      const params = {};
      if (start) params.start = start;
      if (end) params.end = end;
      const r = await api.get(`/accounts/${type}/${id}/statement`, { params });
      setData(r.data);
    } catch (e) { toast.error(errText(e)); }
    if (type !== "cash" && type !== "expense") {
      try {
        const r = await api.get("/payment-requests", { params: { party_type: type, party_id: id } });
        setPayReqs(r.data);
      } catch (e) {}
    }
  };
  useEffect(() => { load(); }, [type, id, start, end]);

  const applyPeriod = (p) => {
    setPeriod(p);
    const today = new Date();
    if (p === "all") { setStart(""); setEnd(""); return; }
    if (p === "day") { setStart(_iso(_sof(today))); setEnd(_iso(today)); }
    else if (p === "month") { setStart(_iso(new Date(today.getFullYear(), today.getMonth(), 1))); setEnd(_iso(today)); }
    else if (p === "year") { setStart(_iso(new Date(today.getFullYear(), 0, 1))); setEnd(_iso(today)); }
  };

  const stateLabel = (b) => b > 0 ? "عليه" : b < 0 ? "له" : "متعادل";
  const stateColor = (b) => b > 0 ? "text-red-700" : b < 0 ? "text-emerald-700" : "text-slate-500";

  const acc = data?.account || {};
  const entries = data?.entries || [];

  const [openLastOp, setOpenLastOp] = useState(false);
  const [lastOp, setLastOp] = useState(null);
  // lastOp shape: { kind: "receipt"|"expense"|"sale", data: {...} }

  const saveVoucher = async () => {
    if (!voucher.amount || Number(voucher.amount) <= 0) { toast.error("أدخل مبلغاً صحيحاً"); return; }
    if (type === "cash") { toast.error("لا يمكن إنشاء سند مباشرة للصندوق"); return; }
    try {
      let r;
      if (type === "expense") {
        r = await api.post("/expenses", {
          account_id: id,
          amount: Number(voucher.amount),
          description: voucher.description,
          date: voucher.date,
          idempotency_key: genUUID(),
        });
        setLastOp({ kind: "expense", data: r.data });
      } else {
        r = await api.post("/receipts", {
          kind: voucher.kind,
          party_type: type === "pos" ? "customer" : type,
          party_id: id,
          party_name: acc.name || "",
          amount: Number(voucher.amount),
          description: voucher.description,
          date: voucher.date,
          idempotency_key: genUUID(),
        });
        setLastOp({ kind: "receipt", data: r.data });
      }
      toast.success("تم الحفظ وتحديث الأرصدة");
      setOpenVoucher(false);
      setVoucher({ ...voucher, amount: "", description: "" });
      setOpenLastOp(true);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const printLastOp = async () => {
    if (!lastOp) return;
    try {
      const banks = (await api.get("/bank-accounts").catch(() => ({ data: [] }))).data || [];
      if (lastOp.kind === "receipt") {
        const { printReceipt } = await import("@/lib/print");
        printReceipt({ receipt: lastOp.data, party: acc, username: acc.name || "", banks });
      } else {
        window.print();
      }
    } catch (e) { toast.error(errText(e)); }
  };

  const whatsappLastOp = async () => {
    if (!lastOp) return;
    const phone = acc.phone || "";
    if (!phone) { toast.error("لا يوجد رقم هاتف مسجّل لهذا العميل"); return; }
    const d = lastOp.data || {};
    let body;
    if (lastOp.kind === "receipt") {
      let company = "شبكة جواد نت اللاسلكية";
      try { const s = await api.get("/settings"); company = s.data?.company_name || company; } catch {}
      body = buildReceiptMessage({
        company,
        kind: d.kind,
        number: d.number,
        amount: d.amount,
        description: d.description,
        balance_after: d.balance_after,
      });
    } else {
      body = `تم تسجيل عملية بمبلغ ${fmt(d.amount || 0)}\n${d.description || ""}\n\nشبكة جواد نت اللاسلكية`;
    }
    openWhatsApp(phone, body);
  };

  const sendRequest = async () => {
    if (!req.amount || Number(req.amount) <= 0) { toast.error("أدخل المبلغ المطلوب"); return; }
    try {
      const r = await api.post("/payment-requests", {
        party_type: type === "pos" ? "customer" : type,
        party_id: id, amount: Number(req.amount),
        method: req.method, message: req.message,
        idempotency_key: genUUID(),
      });
      const p = r.data;
      const phone = acc.phone || "";
      // Use server-provided message (auto-includes bank accounts flagged for payment_requests)
      const body = p.message || req.message?.trim() || `طلب تسديد بمبلغ ${p.amount} — شبكة جواد نت اللاسلكية`;
      if (req.method === "whatsapp" && phone) {
        const wa = `https://wa.me/${phone.replace(/^0/, "967")}?text=${encodeURIComponent(body)}`;
        window.open(wa, "_blank");
      } else if (req.method === "sms" && phone) {
        window.location.href = `sms:${phone}?body=${encodeURIComponent(body)}`;
      }
      toast.success("تم إرسال طلب التسديد");
      setOpenReq(false);
      setReq({ amount: "", message: "", method: "sms" });
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const setReqStatus = async (rid, newStatus) => {
    try {
      await api.post(`/payment-requests/${rid}/status`, null, { params: { new_status: newStatus } });
      toast.success("تم التحديث"); load();
    } catch (e) { toast.error(errText(e)); }
  };

  const doPrint = () => {
    if (!data) return;
    const labelP = { all: "شامل", day: "يومي", month: "شهري", year: "سنوي", custom: "مخصص" }[period];
    const rangeTxt = start && end ? ` — من ${start} إلى ${end}` : "";
    // Same statement template/system as the customers screens (lib/print.js → printStatement):
    // identical header, info order, column titles, debit/credit/balance rendering, totals and footer.
    printStatement({
      customer: { name: acc.name || "", phone: acc.phone || "", balance: acc.balance || 0 },
      typeLabel: TYPE_LABELS[type] || type,
      entries: entries.map((e) => ({
        created_at: e.created_at,
        op_number: e.number || "-",
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        balance: e.balance,
      })),
      closingBalance: data.balance_after,
      extraInfo: [{ lbl: "الرصيد قبل الفترة", val: fmt(data.balance_before) }],
      rangeTitle: `كشف حساب ${acc.name || ""} (${TYPE_LABELS[type] || type}) — ${labelP}${rangeTxt}`,
      username: user?.name || user?.username,
    });
  };

  if (!data) return <div className="p-8 text-center text-slate-500">جاري التحميل...</div>;

  const canAddVoucher = type !== "cash";  // customers, POS, suppliers, and expense accounts
  const canAddInvoice = type === "customer" || type === "pos" || type === "supplier";
  const canRequestPayment = type === "customer" || type === "pos" || type === "supplier";

  return (
    <div className="space-y-4" data-testid="account-detail">
      <div className="flex items-center gap-2 no-print">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} data-testid="acc-back"><ArrowRight size={14}/></Button>
        <div className="text-lg font-bold text-[#221340]">تفاصيل الحساب</div>
      </div>

      <Card className="p-4 md:p-6">
        <div className="flex justify-between items-start flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-[#221340]">
              {acc.name}
              <span className="text-xs bg-[#452480]/10 text-[#452480] px-2 py-0.5 rounded-full">{TYPE_LABELS[type] || type}</span>
            </h2>
            <div className="text-slate-500 text-sm mt-0.5">{acc.phone || "—"}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-slate-500">الرصيد الحالي</div>
            <div className={`text-2xl font-black num ${stateColor(acc.balance || 0)}`}>{fmt(acc.balance || 0)}</div>
            <div className={`text-xs font-bold ${stateColor(acc.balance || 0)}`}>{stateLabel(acc.balance || 0)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">إجمالي المدين</div><div className="num font-bold text-emerald-700">{fmt(data.total_debit)}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">إجمالي الدائن</div><div className="num font-bold text-red-700">{fmt(data.total_credit)}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">الرصيد قبل الفترة</div><div className="num font-bold">{fmt(data.balance_before)}</div></div>
          <div className="bg-slate-50 p-3 rounded-lg"><div className="text-xs text-slate-500">الرصيد النهائي</div><div className="num font-bold">{fmt(data.balance_after)}</div></div>
        </div>
      </Card>

      {/* Action buttons */}
      <Card className="p-3 flex flex-wrap gap-2 no-print" data-testid="acc-actions">
        {canAddVoucher && (
          <Button onClick={() => setOpenVoucher(true)} className="bg-[#221340]" data-testid="btn-add-voucher"><Receipt size={14} className="ml-1"/> {type === "expense" ? "إضافة مصروف" : "إضافة سند"}</Button>
        )}
        {canAddInvoice && (
          <Link to={type === "supplier" ? "/purchases/new" : `/sales/new?customer=${id}`}>
            <Button variant="outline" className="border-[#452480] text-[#452480]" data-testid="btn-add-invoice"><FilePlus size={14} className="ml-1"/> إضافة فاتورة</Button>
          </Link>
        )}
        {canRequestPayment && (
          <Button onClick={() => { setReq({ ...req, amount: Math.max(0, acc.balance || 0) || "" }); setOpenReq(true); }} variant="outline" className="border-amber-500 text-amber-700" data-testid="btn-request-payment"><Send size={14} className="ml-1"/> طلب تسديد</Button>
        )}
        <Button onClick={doPrint} variant="outline" data-testid="btn-print"><Printer size={14} className="ml-1"/> طباعة الحساب</Button>
      </Card>

      {/* Period filter */}
      <Card className="p-3 flex flex-col sm:flex-row gap-2 sm:items-end flex-wrap no-print">
        <div className="flex gap-1 flex-wrap">
          {[["all","الكل"],["day","اليوم"],["month","الشهر"],["year","السنة"]].map(([k,l]) => (
            <button key={k} onClick={() => applyPeriod(k)} className={`px-3 py-1.5 rounded-full text-xs border ${period===k?"bg-[#452480] text-white border-[#452480]":"border-slate-300"}`} data-testid={`acc-period-${k}`}>{l}</button>
          ))}
        </div>
        <div><label className="text-xs">من</label><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPeriod("custom"); }} data-testid="acc-start"/></div>
        <div><label className="text-xs">إلى</label><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPeriod("custom"); }} data-testid="acc-end"/></div>
      </Card>

      {/* Statement — table on desktop, cards on mobile (same style as customers screen) */}
      <Card className="overflow-x-auto hidden md:block" data-testid="acc-statement">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-right"><th className="p-3">التاريخ</th><th className="p-3">رقم العملية</th><th className="p-3">البيان</th><th className="p-3">مدين</th><th className="p-3">دائن</th><th className="p-3">الرصيد</th></tr>
          </thead>
          <tbody>
            <tr className="bg-slate-50 border-t font-bold">
              <td className="p-3" colSpan={5}>الرصيد قبل الفترة</td>
              <td className="p-3 num">{fmt(data.balance_before)}</td>
            </tr>
            {entries.map((e, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="p-3">{fmtDate(e.created_at)}</td>
                <td className="p-3 font-mono text-[#452480] text-xs">{e.number || "-"}</td>
                <td className="p-3">{e.description}</td>
                <td className="p-3 num text-emerald-700">{fmt(e.debit)}</td>
                <td className="p-3 num text-red-700">{fmt(e.credit)}</td>
                <td className="p-3 num font-bold">{fmt(e.balance)}</td>
              </tr>
            ))}
            {entries.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">لا توجد حركات في هذه الفترة</td></tr>}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold border-t"><td className="p-3" colSpan={3}>الإجمالي</td><td className="p-3 num text-emerald-700">{fmt(data.total_debit)}</td><td className="p-3 num text-red-700">{fmt(data.total_credit)}</td><td className="p-3 num">{fmt(data.balance_after)}</td></tr>
          </tfoot>
        </table>
      </Card>
      <div className="md:hidden space-y-2" data-testid="acc-statement-mobile">
        <Card className="p-3 flex justify-between items-center text-sm bg-slate-50">
          <span className="font-bold text-slate-600">الرصيد قبل الفترة</span>
          <span className="num font-bold">{fmt(data.balance_before)}</span>
        </Card>
        {entries.map((e, i) => (
          <Card key={i} className="p-3 text-sm">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="text-xs text-slate-500">{fmtDate(e.created_at)}</div>
                <div className="font-mono text-[#452480] text-xs">{e.number || "-"}</div>
                <div className="mt-1 break-words">{e.description}</div>
              </div>
              <div className="text-left shrink-0">
                <div className="text-xs">الرصيد</div>
                <div className="num font-bold">{fmt(e.balance)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><div className="text-slate-500">مدين</div><div className="num font-bold text-emerald-700">{fmt(e.debit)}</div></div>
              <div><div className="text-slate-500">دائن</div><div className="num font-bold text-red-700">{fmt(e.credit)}</div></div>
            </div>
          </Card>
        ))}
        {entries.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد حركات في هذه الفترة</div>}
        <Card className="p-3 flex justify-between items-center text-sm bg-slate-100 font-bold">
          <span>الرصيد النهائي</span>
          <span className="num">{fmt(data.balance_after)}</span>
        </Card>
      </div>

      {/* Payment requests list */}
      {payReqs.length > 0 && (
        <Card className="p-3 no-print" data-testid="acc-payreqs">
          <div className="font-bold text-[#221340] mb-2">طلبات التسديد</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">المبلغ</th><th className="p-2">الرسالة</th><th className="p-2">الحالة</th><th className="p-2">إجراء</th></tr></thead>
              <tbody>
                {payReqs.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-mono">{p.number}</td>
                    <td className="p-2">{fmtDate(p.created_at)}</td>
                    <td className="p-2 num font-bold">{fmt(p.amount)}</td>
                    <td className="p-2 text-slate-600">{p.message || "-"}</td>
                    <td className="p-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status==="paid"?"bg-emerald-100 text-emerald-700":p.status==="cancelled"?"bg-red-100 text-red-700":"bg-blue-100 text-blue-700"}`}>
                        {p.status === "new" ? "جديد" : p.status === "sent" ? "تم الإرسال" : p.status === "paid" ? "تم التسديد" : "ملغي"}
                      </span>
                    </td>
                    <td className="p-2 flex gap-1">
                      {p.status !== "paid" && <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setReqStatus(p.id, "paid")} data-testid={`pr-paid-${p.id}`}>تم التسديد</Button>}
                      {p.status !== "cancelled" && <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setReqStatus(p.id, "cancelled")} data-testid={`pr-cancel-${p.id}`}>إلغاء</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Post-save actions Dialog */}
      <Dialog open={openLastOp} onOpenChange={setOpenLastOp}>
        <DialogContent className="max-w-sm" data-testid="last-op-dialog">
          <DialogHeader><DialogTitle>تمت العملية بنجاح</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-center">
              <div className="font-bold text-emerald-800">
                {lastOp?.kind === "receipt" ? `سند ${lastOp?.data?.kind === "receipt" ? "قبض" : "صرف"} رقم ${lastOp?.data?.number || "-"}` : "تم تسجيل المصروف"}
              </div>
              <div className="text-lg font-black num mt-1">{fmt(lastOp?.data?.amount || 0)}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={printLastOp} variant="outline" data-testid="last-op-print"><Printer size={14} className="ml-1"/> طباعة</Button>
              <Button onClick={whatsappLastOp} className="bg-green-600 hover:bg-green-700 text-white" data-testid="last-op-wa"><MessageCircle size={14} className="ml-1"/> إرسال واتساب</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Voucher Dialog */}
      <Dialog open={openVoucher} onOpenChange={setOpenVoucher}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{type === "expense" ? "إضافة مصروف" : "إضافة سند"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {type === "expense" ? (
              <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">
                سيتم خصم المبلغ من الصندوق وإضافته إلى حساب المصروف: <span className="font-bold">{acc.name}</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>نوع السند</Label>
                  <Select value={voucher.kind} onValueChange={(v) => setVoucher({ ...voucher, kind: v })}>
                    <SelectTrigger data-testid="voucher-kind"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receipt">قبض</SelectItem>
                      <SelectItem value="payment">صرف</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>المبلغ</Label><Input type="number" value={voucher.amount} onChange={(e) => setVoucher({ ...voucher, amount: e.target.value })} data-testid="voucher-amount"/></div>
              </div>
            )}
            {type === "expense" && (
              <div><Label>المبلغ</Label><Input type="number" value={voucher.amount} onChange={(e) => setVoucher({ ...voucher, amount: e.target.value })} data-testid="voucher-amount"/></div>
            )}
            <div><Label>التاريخ</Label><Input type="date" value={voucher.date} onChange={(e) => setVoucher({ ...voucher, date: e.target.value })} data-testid="voucher-date"/></div>
            <div><Label>البيان</Label><Textarea value={voucher.description} onChange={(e) => setVoucher({ ...voucher, description: e.target.value })} data-testid="voucher-desc"/></div>
            <Button onClick={saveVoucher} className="w-full bg-[#221340]" data-testid="voucher-save">{type === "expense" ? "حفظ المصروف" : "حفظ السند"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Request Dialog */}
      <Dialog open={openReq} onOpenChange={setOpenReq}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>طلب تسديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900">
              الرصيد المستحق: <span className="font-bold num">{fmt(Math.abs(acc.balance || 0))}</span> ({stateLabel(acc.balance || 0)})
              <div className="text-[10px] mt-1">إرسال الطلب لا يعدل الرصيد. يُعدَّل الرصيد فقط عند تسجيل سند التسديد.</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>المبلغ المطلوب</Label><Input type="number" value={req.amount} onChange={(e) => setReq({ ...req, amount: e.target.value })} data-testid="req-amount"/></div>
              <div>
                <Label>الوسيلة</Label>
                <Select value={req.method} onValueChange={(v) => setReq({ ...req, method: v })}>
                  <SelectTrigger data-testid="req-method"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sms">رسالة SMS</SelectItem>
                    <SelectItem value="whatsapp">واتساب</SelectItem>
                    <SelectItem value="manual">حفظ فقط</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>ملاحظة/رسالة (اختياري)</Label><Textarea value={req.message} onChange={(e) => setReq({ ...req, message: e.target.value })} placeholder={`طلب تسديد بمبلغ ...`} data-testid="req-message"/></div>
            <Button onClick={sendRequest} className="w-full bg-amber-600 hover:bg-amber-700" data-testid="req-send"><Send size={14} className="ml-1"/> إرسال الطلب</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
