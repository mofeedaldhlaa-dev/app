import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt } from "@/lib/utils";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ShoppingCart, Users, CreditCard, FileBarChart, Wallet, Search, Zap, ArrowLeftRight, History, TrendingUp, Receipt, Boxes, Send, Store } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { genUUID } from "@/lib/utils";
import { SubscriberFavorites, ContactPickerButton } from "@/components/PhoneInputExtras";
import { saveOperationImage } from "@/lib/receiptImage";
import { Download } from "lucide-react";
import PeriodFilter from "@/components/PeriodFilter";

function QuickRechargeButton() {
  const [open, setOpen] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastOp, setLastOp] = useState(null);

  // history filters
  const [histPeriod, setHistPeriod] = useState("all");
  const [histStart, setHistStart] = useState("");
  const [histEnd, setHistEnd] = useState("");
  const [histSearch, setHistSearch] = useState("");

  const reset = () => { setRecipientPhone(""); setRecipientName(""); setAmount(""); setPreview(null); setLoading(false); setSubmitting(false); setShowHistory(false); setHistory([]); setLastOp(null); setHistPeriod("all"); setHistStart(""); setHistEnd(""); setHistSearch(""); };
  const onOpenChange = (v) => { if (!v) reset(); setOpen(v); };

  const loadHistory = async (ov) => {
    setHistoryLoading(true);
    try {
      const s = ov?.start ?? histStart;
      const e = ov?.end ?? histEnd;
      const body = {};
      if (s) body.start = s;
      if (e) body.end = e;
      const r = await api.post("/admin/quick-recharge/list", body);
      setHistory(r.data || []);
    } catch (e) { toast.error(e?.response?.data?.detail || "تعذّر التحميل"); }
    setHistoryLoading(false);
  };
  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) await loadHistory();
  };

  // Live results based on selected period (re-fetch from backend with date range).
  const applyPeriod = ({ period, start, end }) => {
    setHistPeriod(period); setHistStart(start); setHistEnd(end);
    loadHistory({ start, end });
  };

  const historyFiltered = useMemo(() => {
    const q = (histSearch || "").trim().toLowerCase();
    if (!q) return history;
    return history.filter((op) => (op.party_name || "").toLowerCase().includes(q) || (op.number || "").toLowerCase().includes(q));
  }, [history, histSearch]);

  const doLookup = async () => {
    if (!recipientPhone.trim()) { toast.error("رقم هاتف المستلم مطلوب"); return; }
    const a = parseFloat(amount);
    if (!a || a <= 0) { toast.error("المبلغ غير صحيح"); return; }
    setLoading(true); setPreview(null);
    try {
      const r = await api.post("/admin/quick-recharge/lookup", { recipient_phone: recipientPhone.trim(), amount: a });
      setPreview(r.data);
    } catch (e) { toast.error(e?.response?.data?.detail || "تعذّر التحقق"); }
    setLoading(false);
  };
  const doConfirm = async () => {
    if (!preview) return;
    setSubmitting(true);
    try {
      const r = await api.post("/admin/quick-recharge/confirm", {
        recipient_phone: recipientPhone.trim(), amount: preview.amount, idempotency_key: genUUID(),
      });
      toast.success(`تم الشحن بنجاح — عملية ${r.data.number}`);
      setLastOp({ ...r.data, recipient_phone: recipientPhone.trim(), recipient_type: preview.recipient_type });
      setPreview(null);
      if (showHistory) loadHistory();
    } catch (e) { toast.error(e?.response?.data?.detail || "فشل التنفيذ"); }
    setSubmitting(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        data-testid="quick-recharge"
        className="flex flex-col items-center justify-center gap-2 p-4 bg-white border-2 border-[#D4AF37] rounded-xl hover:bg-[#D4AF37]/10 hover:shadow-md transition min-h-[80px]"
      >
        <Zap size={22} className="text-[#D4AF37]"/>
        <span className="text-sm font-bold text-[#221340] text-center">شحن سريع</span>
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" data-testid="qr-dialog">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-[#221340]"><Zap size={18} className="text-[#D4AF37]"/> شحن سريع</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>رقم هاتف المستلم</Label>
              <div className="flex items-center gap-1">
                <Input
                  inputMode="tel"
                  value={recipientPhone}
                  onChange={(e) => { setRecipientPhone(e.target.value); setPreview(null); }}
                  placeholder="مثال: 7XXXXXXXX"
                  data-testid="qr-recipient"
                  className="flex-1"
                />
                <SubscriberFavorites
                  currentPhone={recipientPhone}
                  currentName={recipientName}
                  onPick={(f) => { setRecipientPhone(f.phone); setRecipientName(f.name); setPreview(null); }}
                  testidPrefix="qr-fav"
                />
                <ContactPickerButton
                  onPick={(c) => { setRecipientPhone(c.phone); setRecipientName(c.name || ""); setPreview(null); }}
                  testid="qr-contact-pick"
                />
              </div>
            </div>
            <div><Label>المبلغ</Label>
              <Input type="number" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} data-testid="qr-amount"/>
            </div>
            {!preview && (
              <Button onClick={doLookup} disabled={loading} className="w-full bg-[#452480] hover:bg-[#5A2FA0]" data-testid="qr-lookup">
                <Search size={14} className="ml-1"/> {loading ? "جاري..." : "بحث"}
              </Button>
            )}
            {preview && (
              <div className="space-y-1.5 bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 text-sm" data-testid="qr-preview">
                <div className="flex justify-between"><span className="text-slate-600">المرسل:</span><span className="font-bold">{preview.sender_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">اسم المستلم:</span><span className="font-bold">{preview.recipient_name}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">رقم المستلم:</span><span className="font-mono">{preview.recipient_phone}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">نوع المستلم:</span><span>{preview.recipient_type === "pos" ? "نقطة بيع" : "عميل"}</span></div>
                <div className="border-t my-1"></div>
                <div className="flex justify-between font-bold"><span>مبلغ الشحن:</span><span className="num">{fmt(preview.amount)}</span></div>
                <div className="flex justify-between text-emerald-700 font-bold"><span>المبلغ المستلم:</span><span className="num">{fmt(preview.recipient_credit)}</span></div>
                <div className="flex justify-between text-slate-500 text-xs"><span>العمولة:</span><span className="num">0</span></div>
                <div className="flex justify-between font-black text-emerald-700 border-t pt-1"><span>الإضافة إلى الصندوق:</span><span className="num">{fmt(preview.amount)}</span></div>
              </div>
            )}
            <div className="pt-3 border-t">
              <button type="button" onClick={toggleHistory} className="w-full flex items-center justify-between text-sm font-bold text-[#221340]" data-testid="qr-history-toggle">
                <span className="flex items-center gap-2"><History size={14}/> العمليات السابقة</span>
                <span className="text-[#452480]">{showHistory ? "إخفاء" : "عرض"}</span>
              </button>
              {showHistory && (
                <div className="mt-2 space-y-2" data-testid="qr-history">
                  <div className="space-y-2 bg-slate-50 border rounded-lg p-2">
                    <PeriodFilter period={histPeriod} start={histStart} end={histEnd} onChange={applyPeriod} testidPrefix="qr-hist-period" />
                    <div className="relative">
                      <Search size={13} className="absolute right-2 top-3 text-slate-400"/>
                      <Input className="pr-7 h-9" placeholder="بحث بالاسم أو رقم العملية..." value={histSearch} onChange={(e) => setHistSearch(e.target.value)} data-testid="qr-hist-search"/>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-500" data-testid="qr-hist-count">عدد النتائج: <strong>{historyFiltered.length}</strong></div>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {historyLoading && <div className="text-center text-xs text-slate-400 py-3">جاري التحميل...</div>}
                    {!historyLoading && historyFiltered.length === 0 && <div className="text-center text-xs text-slate-400 py-3">لا توجد عمليات ضمن الفترة</div>}
                    {historyFiltered.map((op) => (
                      <div key={op.id} className="border rounded-lg p-2 bg-white text-sm" data-testid={`qr-history-${op.id}`}>
                        <div className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-[#452480]">{op.number}</div>
                            <div className="text-[10px] text-slate-500">{(op.created_at || "").replace("T", " ").slice(0, 16)}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => saveOperationImage({
                              kind: "quick-recharge",
                              number: op.number,
                              createdAt: op.created_at,
                              senderName: "شبكة جواد نت اللاسلكية",
                              recipientName: op.party_name,
                              amount: op.amount,
                              recipientCredit: op.amount,
                              description: op.description,
                            })} className="h-7 px-2 text-xs" data-testid={`qr-history-save-${op.id}`}>
                              <Download size={10} className="ml-1"/> حفظ
                            </Button>
                            <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-800">شحن</span>
                          </div>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                          <div><div className="text-slate-500">المستلم</div><div className="font-bold truncate">{op.party_name}</div></div>
                          <div><div className="text-slate-500">المبلغ</div><div className="num font-bold text-emerald-700">{fmt(op.amount)}</div></div>
                          {op.username && <div className="col-span-2 text-[10px] text-slate-400">بواسطة: {op.username}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          {preview && (
            <DialogFooter className="gap-2 pt-2">
              <Button onClick={() => setPreview(null)} variant="outline" data-testid="qr-back">تعديل</Button>
              <Button onClick={doConfirm} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700" data-testid="qr-confirm">
                <ArrowLeftRight size={14} className="ml-1"/> {submitting ? "جاري..." : "تأكيد الشحن"}
              </Button>
            </DialogFooter>
          )}
          {lastOp && (
            <div className="space-y-2 bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 text-sm" data-testid="qr-success">
              <div className="text-center font-black text-emerald-800">تمت العملية بنجاح</div>
              <div className="flex justify-between text-xs"><span className="text-slate-600">رقم العملية:</span><span className="font-mono font-bold">{lastOp.number}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-600">المستلم:</span><span className="font-bold">{lastOp.party_name}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-600">المبلغ:</span><span className="font-bold num">{fmt(lastOp.amount)}</span></div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button size="sm" onClick={() => saveOperationImage({
                  kind: "quick-recharge",
                  number: lastOp.number,
                  createdAt: lastOp.created_at,
                  senderName: "شبكة جواد نت اللاسلكية",
                  recipientName: lastOp.party_name,
                  recipientPhone: lastOp.recipient_phone,
                  recipientType: lastOp.recipient_type,
                  amount: lastOp.amount,
                  recipientCredit: lastOp.amount,
                  description: lastOp.description,
                })} className="bg-[#452480] hover:bg-[#5A2FA0]" data-testid="qr-save-image">
                  <Download size={12} className="ml-1"/> حفظ الإشعار كصورة
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLastOp(null)} data-testid="qr-new">عملية جديدة</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const Stat = ({ label, value, sub, tone = "light", testid, icon: Icon }) => {
  const styles = {
    purple: "bg-[#221340] text-white",
    gold: "bg-[#D4AF37] text-[#1A0F33]",
    light: "bg-white text-[#221340] border border-slate-200",
  }[tone];
  const iconWrap = {
    purple: "bg-white/10 text-[#D4AF37]",
    gold: "bg-[#1A0F33]/15 text-[#1A0F33]",
    light: "bg-[#452480]/10 text-[#452480]",
  }[tone];
  return (
    <Card className={`${styles} p-4 md:p-5 rounded-2xl shadow-sm transition duration-200 hover:shadow-md hover:-translate-y-0.5`} data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium opacity-80">{label}</div>
          <div className="text-2xl md:text-3xl font-black num mt-1.5 truncate">{value}</div>
          {sub && <div className="text-xs opacity-70 mt-1">{sub}</div>}
        </div>
        {Icon && <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${iconWrap}`}><Icon size={18} /></span>}
      </div>
    </Card>
  );
};

const SectionTitle = ({ children, icon: Icon }) => (
  <div className="flex items-center gap-2 mb-3">
    {Icon && <span className="w-7 h-7 rounded-lg bg-[#452480]/10 text-[#452480] flex items-center justify-center"><Icon size={16} /></span>}
    <h2 className="text-base md:text-lg font-bold text-[#221340]">{children}</h2>
  </div>
);

// Shortcut tile — identical size/shape for every shortcut.
const Quick = ({ to, label, icon: Icon, testid, accent }) => (
  <Link to={to} data-testid={testid}
    className={`flex flex-col items-center justify-center gap-2 p-4 bg-white border-2 rounded-xl hover:shadow-md transition min-h-[80px] ${accent || "border-slate-200 hover:border-[#D4AF37]"}`}>
    <Icon size={22} className="text-[#452480]" />
    <span className="text-sm font-bold text-[#221340] text-center">{label}</span>
  </Link>
);

export default function Dashboard() {
  const [d, setD] = useState(null);
  useEffect(() => {
    api.get("/reports/dashboard").then((r) => setD(r.data));
  }, []);

  return (
    <div className="space-y-6" data-testid="dashboard">
      {/* 1) Overview KPIs — at the TOP, prominent */}
      <section data-testid="dash-overview" className="rounded-2xl bg-gradient-to-l from-[#221340] to-[#452480] p-4 md:p-5 shadow-md">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-lg bg-[#D4AF37] text-[#1A0F33] flex items-center justify-center"><TrendingUp size={18} /></span>
          <h2 className="text-lg md:text-xl font-extrabold text-white">نظرة عامة</h2>
        </div>
        {!d ? (
          <div className="p-6 text-center text-white/70">جاري التحميل...</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <Stat testid="stat-sales-today" label="مبيعات اليوم" value={fmt(d.sales_today)} tone="gold" icon={ShoppingCart} />
            <Stat testid="stat-sales-month" label="مبيعات الشهر" value={fmt(d.sales_month)} tone="light" icon={TrendingUp} />
            <Stat testid="stat-cust-debts" label="ديون العملاء" value={fmt(d.customer_debts)} tone="light" icon={Users} />
            <Stat testid="stat-pos-debts" label="ديون نقاط البيع" value={fmt(d.pos_debts)} tone="light" icon={Store} />
          </div>
        )}
      </section>

      {/* 2) Quick shortcuts */}
      <section data-testid="dash-shortcuts">
        <SectionTitle icon={Zap}>الاختصارات السريعة</SectionTitle>
        <Card className="p-3 sm:p-4 rounded-2xl">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 sm:gap-3">
            <QuickRechargeButton />
            <Quick to="/accounts/cash/cash" label="صندوق النقدية" icon={Wallet} testid="quick-cashbox" accent="border-emerald-400 hover:border-emerald-500 hover:bg-emerald-50" />
            <Quick to="/accounts" label="الحسابات" icon={Users} testid="quick-accounts" accent="border-[#452480]/40 hover:border-[#452480] hover:bg-[#452480]/5" />
            <Quick to="/sales" label="المبيعات" icon={ShoppingCart} testid="quick-sales" />
            <Quick to="/receipts" label="السندات" icon={Receipt} testid="quick-receipts" />
            <Quick to="/stock" label="المخزون" icon={Boxes} testid="quick-stock" />
            <Quick to="/send-notification" label="إرسال إشعار" icon={Send} testid="quick-send-notification" accent="border-[#D4AF37]/50 hover:border-[#D4AF37] hover:bg-[#D4AF37]/10" />
            <Quick to="/reports" label="التقارير" icon={FileBarChart} testid="quick-reports" />
          </div>
        </Card>
      </section>
    </div>
  );
}
