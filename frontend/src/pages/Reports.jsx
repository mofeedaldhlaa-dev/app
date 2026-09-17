import { useEffect, useState, useMemo } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { fmt, fmtDate } from "@/lib/utils";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { printReport } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import PeriodFilter, { PERIOD_LABELS } from "@/components/PeriodFilter";

const TAB_TITLES = {
  sales: "تقرير المبيعات", purchases: "تقرير المشتريات",
  electronic: "تقرير المبيعات الإلكترونية", card_order_log: "سجل طلبات الرابط",
  customer_debts: "تقرير مديونية العملاء", supplier_debts: "تقرير مديونية الموردين",
  stock: "تقرير المخزون", opening: "تقرير الأرصدة الافتتاحية", movement: "تقرير حركة صنف بالمخزون",
  incentives: "تقرير الحوافز",
};

const _iso = (d) => d.toISOString().slice(0, 10);
const _startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

// Tabs that use the unified period filter.
const DATE_TABS = ["sales", "purchases", "electronic", "card_order_log", "stock"];
// Tabs whose backend query accepts start/end (re-fetch on period change).
const SERVER_DATE_TABS = ["sales", "purchases", "stock"];

export default function Reports() {
  const { user } = useAuth();
  const [tab, setTab] = useState("sales");

  // Unified period model (shared by all date-based tabs).
  const [period, setPeriod] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const [data, setData] = useState([]);
  const [q, setQ] = useState("");
  const [olStatus, setOlStatus] = useState("all");

  // item movement
  const [categories, setCategories] = useState([]);
  const [mvCategory, setMvCategory] = useState("");
  const [mvStart, setMvStart] = useState(_iso(_startOfMonth()));
  const [mvEnd, setMvEnd] = useState(_iso(new Date()));
  const [mvData, setMvData] = useState(null);

  // incentives report
  const [incPeriod, setIncPeriod] = useState("month");
  const [incStart, setIncStart] = useState(_iso(_startOfMonth()));
  const [incEnd, setIncEnd] = useState(_iso(new Date()));
  const [incData, setIncData] = useState({ items: [], count: 0, total_qty: 0, total_value: 0, kind: "redeemed" });
  const [incKind, setIncKind] = useState("redeemed");

  useEffect(() => { api.get("/categories").then((r) => setCategories(r.data)).catch(() => {}); }, []);

  const load = async (ov) => {
    const endpoints = {
      sales: "/reports/sales", purchases: "/reports/purchases",
      customer_debts: "/reports/customer-debts", supplier_debts: "/reports/supplier-debts",
      stock: "/stock", electronic: "/reports/electronic-sales",
      card_order_log: "/reports/card-order-log",
      opening: "/reports/opening-balances",
    };
    if (tab === "movement" || tab === "incentives") return;
    if (!endpoints[tab]) return;
    const s = ov?.start ?? start; const e = ov?.end ?? end;
    let params = {};
    if (["sales", "purchases"].includes(tab) && s && e) params = { start: s, end: e };
    if (tab === "stock" && (s || e)) params = { start: s || undefined, end: e || undefined };
    try {
      const r = await api.get(endpoints[tab], { params });
      setData(r.data);
    } catch (e2) { toast.error(errText(e2)); setData([]); }
  };

  // Reset the period to "all" when switching tabs, then load.
  useEffect(() => {
    setPeriod("all"); setStart(""); setEnd(""); setQ("");
    // load with cleared range
    load({ start: "", end: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onPeriodChange = ({ period: p, start: s, end: e }) => {
    setPeriod(p); setStart(s); setEnd(e);
    if (SERVER_DATE_TABS.includes(tab)) load({ start: s, end: e });
  };

  const loadMovement = async () => {
    if (!mvCategory) { toast.error("اختر الفئة"); return; }
    try {
      const r = await api.get("/reports/item-movement", { params: { category_id: mvCategory, start: mvStart, end: mvEnd } });
      setMvData(r.data);
    } catch (e) { toast.error(errText(e)); setMvData(null); }
  };

  const applyIncentivePeriod = ({ period: p, start: s, end: e }) => {
    setIncPeriod(p);
    if (p === "custom") { setIncStart(s || incStart); setIncEnd(e || incEnd); }
    else { setIncStart(s); setIncEnd(e); }
  };
  const loadIncentives = async () => {
    try {
      const params = incKind === "pending" ? { kind: "pending" } : { start: incStart, end: incEnd, kind: "redeemed" };
      const r = await api.get("/reports/incentives", { params });
      setIncData(r.data);
    } catch (e) { toast.error(errText(e)); setIncData({ items: [], count: 0, total_qty: 0, total_value: 0, kind: incKind }); }
  };
  useEffect(() => { if (tab === "incentives") loadIncentives(); /* eslint-disable-next-line */ }, [tab, incKind]);

  // Client-side date filter for tabs whose data is fetched in full (electronic, order log).
  const inRange = (ca) => {
    const day = (ca || "").slice(0, 10);
    if (start && day < start) return false;
    if (end && day > end) return false;
    return true;
  };

  const orderLogFiltered = useMemo(() => {
    if (tab !== "card_order_log") return [];
    return data.filter((a) => {
      if (!inRange(a.created_at)) return false;
      if (olStatus !== "all" && a.status !== olStatus) return false;
      if (q && !JSON.stringify(a).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, olStatus, q, tab, start, end]);

  const orderLogSummary = useMemo(() => {
    const total = orderLogFiltered.length;
    const success = orderLogFiltered.filter((a) => a.status === "success").length;
    const rejected = total - success;
    const value = orderLogFiltered.reduce((s, a) => s + (a.total || 0), 0);
    return { total, success, rejected, value };
  }, [orderLogFiltered]);

  const filtered = useMemo(() => {
    if (tab === "card_order_log") return orderLogFiltered;
    let base = data;
    if (tab === "electronic") base = data.filter((a) => inRange(a.created_at));
    return base.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q.toLowerCase()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, q, tab, orderLogFiltered, start, end]);

  const periodActive = !!(start || end);
  const username = user?.name || user?.username;
  const periodLabelTxt = () => {
    const base = PERIOD_LABELS[period] || "الكل";
    return periodActive ? `${base} (${start || "…"} → ${end || "…"})` : base;
  };

  const printCurrent = () => {
    const title = TAB_TITLES[tab] || "تقرير";
    const periodSuffix = DATE_TABS.includes(tab) ? ` — الفترة: ${periodLabelTxt()}` : "";
    if (tab === "sales" || tab === "purchases") {
      const total = filtered.reduce((s, x) => s + (x.total || 0), 0);
      printReport({
        title: title + periodSuffix, headers: ["الرقم","التاريخ",tab==="sales"?"العميل":"المورد","الإجمالي","المدفوع","المتبقي"],
        rows: filtered.map((s) => [s.number, fmtDate(s.created_at), s.customer_name || s.supplier_name || "-", fmt(s.total), fmt(s.paid), fmt(s.remaining)]),
        totals: [{ label: "عدد النتائج", value: filtered.length }, { label: "الإجمالي", value: fmt(total) }], username,
      });
    } else if (tab === "electronic") {
      const total = filtered.reduce((s, x) => s + (x.total || 0), 0);
      printReport({
        title: title + periodSuffix, headers: ["الرقم","التاريخ","العميل","الفئة","الكمية","الإجمالي","الكروت"],
        rows: filtered.map((s) => { const it = s.items?.[0] || {}; return [s.number, fmtDate(s.created_at), s.customer_name, it.category_name, it.quantity, fmt(s.total), (it.card_numbers||[]).join(", ")]; }),
        totals: [{ label: "عدد النتائج", value: filtered.length }, { label: "الإجمالي", value: fmt(total) }], username,
      });
    } else if (tab === "card_order_log") {
      const labelS = { all: "الكل", success: "ناجح", rejected_over_limit: "الفاشلة - تجاوز السقف", rejected_no_stock: "الفاشلة - عدم توفر", rejected_not_found: "الفاشلة - دخول مرفوض" }[olStatus] || "الكل";
      printReport({
        title: `${title}${periodSuffix} — الحالة: ${labelS}`,
        headers: ["التاريخ","العميل","الهاتف","الفئة","الكمية","القيمة","الحالة","السبب"],
        rows: filtered.map((a) => [fmtDate(a.created_at), a.customer_name || "-", a.phone, a.category_name || "-", a.quantity || 0, fmt(a.total || 0), a.status==="success"?"ناجح":a.status==="rejected_over_limit"?"الفاشلة - تجاوز السقف":a.status==="rejected_no_stock"?"الفاشلة - عدم توفر":a.status==="rejected_not_found"?"الفاشلة - دخول مرفوض":"الفاشلة", a.reason || "-"]),
        totals: [
          { label: "عدد الطلبات", value: orderLogSummary.total },
          { label: "الناجحة", value: orderLogSummary.success },
          { label: "المرفوضة", value: orderLogSummary.rejected },
          { label: "القيمة الإجمالية للناجحة", value: fmt(orderLogSummary.value) },
        ],
        username,
      });
    } else if (tab === "customer_debts" || tab === "supplier_debts") {
      const total = filtered.reduce((s, x) => s + (x.balance || 0), 0);
      const label = tab === "customer_debts" ? "العميل" : "المورد";
      printReport({
        title, headers: [label, "الهاتف", "السقف", "المديونية", "المتاح"],
        rows: filtered.map((c) => [c.name, c.phone, fmt(c.credit_limit), fmt(c.balance), fmt(Math.max(0,(c.credit_limit||0)-(c.balance||0)))]),
        totals: [{ label: "عدد النتائج", value: filtered.length }, { label: "إجمالي المديونية", value: fmt(total) }], username,
      });
    } else if (tab === "stock") {
      const headers = periodActive
        ? ["الفئة","أُضيف بالفترة","بيع بالفترة","مرقم متاح","كمية متاح","المتاح الكلي"]
        : ["الفئة","مرقم إجمالي","مرقم متاح","مرقم مباع","كمية إجمالي","كمية متاح","المتاح الكلي"];
      const rows = periodActive
        ? filtered.map((s) => [s.category_name, s.period?.added || 0, s.period?.sold || 0, s.numbered?.available || 0, s.quantity?.available || 0, s.available_total || 0])
        : filtered.map((s) => [s.category_name, s.numbered?.total || 0, s.numbered?.available || 0, s.numbered?.sold || 0, s.quantity?.total || 0, s.quantity?.available || 0, s.available_total || 0]);
      printReport({ title: title + periodSuffix, headers, rows, username });
    } else if (tab === "opening") {
      const total = filtered.reduce((s, x) => s + (x.opening_balance || 0), 0);
      printReport({
        title, headers: ["النوع", "الاسم", "الهاتف", "الرصيد الافتتاحي", "الرصيد الحالي"],
        rows: filtered.map((c) => [c.type==="supplier"?"مورد":c.type==="pos"?"نقطة بيع":"عميل", c.name, c.phone || "-", fmt(c.opening_balance), fmt(c.current_balance)]),
        totals: [{ label: "عدد النتائج", value: filtered.length }, { label: "إجمالي الأرصدة الافتتاحية", value: fmt(total) }], username,
      });
    } else if (tab === "movement" && mvData) {
      printReport({
        title: `${title} — ${mvData.category?.name} — من ${mvStart} إلى ${mvEnd}`,
        headers: ["التاريخ", "الرقم", "البيان", "وارد", "صادر", "الرصيد"],
        rows: mvData.entries.map((e) => [fmtDate(e.created_at), e.number || "-", e.description, e.in || "-", e.out || "-", e.balance]),
        totals: [
          { label: "الرصيد قبل الفترة", value: mvData.balance_before },
          { label: "إجمالي الوارد", value: mvData.total_in },
          { label: "إجمالي الصادر", value: mvData.total_out },
          { label: "الرصيد بعد الفترة", value: mvData.balance_after },
        ],
        username,
      });
    } else if (tab === "incentives") {
      printReport({
        title: `${title} — من ${incStart} إلى ${incEnd}`,
        headers: ["التاريخ", "العميل", "النوع", "الفئة", "الكمية", "طريقة الاستفادة", "المبلغ", "المستخدم"],
        rows: incData.items.map((r) => [
          fmtDate(r.redeemed_at || r.created_at),
          r.customer_name || "-",
          r.customer_type === "pos" ? "نقطة بيع" : "عميل",
          r.category_name || "-",
          r.qty,
          r.status === "redeemed_credit" ? "تقييد المبلغ في الحساب" : "استلام كرت",
          fmt(r.redeemed_value || (r.unit_value || 0) * (r.qty || 0)),
          r.redeemed_by || "-",
        ]),
        totals: [
          { label: "عدد العمليات", value: incData.count },
          { label: "إجمالي الكمية", value: incData.total_qty },
          { label: "إجمالي القيمة", value: fmt(incData.total_value) },
        ],
        username,
      });
    }
  };

  return (
    <div className="space-y-4" data-testid="reports-page">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="sales" data-testid="rep-sales">المبيعات</TabsTrigger>
          <TabsTrigger value="purchases" data-testid="rep-purchases">المشتريات</TabsTrigger>
          <TabsTrigger value="electronic" data-testid="rep-electronic">المبيعات الإلكترونية</TabsTrigger>
          <TabsTrigger value="card_order_log" data-testid="rep-order-log">سجل طلبات الرابط</TabsTrigger>
          <TabsTrigger value="customer_debts" data-testid="rep-cdebts">مديونية العملاء</TabsTrigger>
          <TabsTrigger value="supplier_debts" data-testid="rep-sdebts">مديونية الموردين</TabsTrigger>
          <TabsTrigger value="stock" data-testid="rep-stock">المخزون</TabsTrigger>
          <TabsTrigger value="opening" data-testid="rep-opening">الأرصدة الافتتاحية</TabsTrigger>
          <TabsTrigger value="movement" data-testid="rep-movement">حركة صنف</TabsTrigger>
          <TabsTrigger value="incentives" data-testid="rep-incentives">الحوافز</TabsTrigger>
        </TabsList>

        <Card className="p-3 flex flex-col gap-3 mt-3 no-print">
          {/* Unified period filter for all date-based reports */}
          {DATE_TABS.includes(tab) && (
            <div>
              <label className="text-xs text-slate-500 block mb-1">الفترة الزمنية</label>
              <PeriodFilter includeAll period={period} start={start} end={end} onChange={onPeriodChange} testidPrefix="rep-period" />
            </div>
          )}

          {tab === "card_order_log" && (
            <div>
              <label className="text-xs text-slate-500 block mb-1">الحالة</label>
              <div className="flex flex-wrap gap-1">
                {[["all","الكل"],["success","ناجح"],["rejected_over_limit","الفاشلة - تجاوز السقف"],["rejected_no_stock","الفاشلة - لا يوجد مخزون"],["rejected_not_found","الفاشلة - دخول مرفوض"]].map(([k,l]) => (
                  <button key={k} onClick={() => setOlStatus(k)} className={`px-2 py-1 rounded-full text-xs border ${olStatus===k?"bg-[#221340] text-white border-[#221340]":"border-slate-300"}`} data-testid={`ol-status-${k}`}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {tab === "movement" && (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end flex-wrap">
              <div className="w-full sm:w-64">
                <label className="text-xs">الفئة</label>
                <select value={mvCategory} onChange={(e) => setMvCategory(e.target.value)} className="w-full border rounded p-2 text-sm" data-testid="mv-category">
                  <option value="">اختر</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="text-xs">من</label><Input type="date" value={mvStart} onChange={(e) => setMvStart(e.target.value)} data-testid="mv-start"/></div>
              <div><label className="text-xs">إلى</label><Input type="date" value={mvEnd} onChange={(e) => setMvEnd(e.target.value)} data-testid="mv-end"/></div>
              <Button onClick={loadMovement} className="bg-[#221340] w-full sm:w-auto" data-testid="mv-load">عرض الحركة</Button>
            </div>
          )}

          {tab === "incentives" && (
            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs">النوع</label>
                <div className="flex gap-1 mt-1">
                  <button onClick={() => setIncKind("redeemed")} className={`px-3 py-1 rounded-full text-xs border ${incKind==="redeemed"?"bg-[#452480] text-white border-[#452480]":"border-slate-300"}`} data-testid="inc-kind-redeemed">الحوافز المصروفة</button>
                  <button onClick={() => setIncKind("pending")} className={`px-3 py-1 rounded-full text-xs border ${incKind==="pending"?"bg-amber-500 text-white border-amber-500":"border-slate-300"}`} data-testid="inc-kind-pending">الحوافز غير المصروفة</button>
                </div>
              </div>
              {incKind === "redeemed" && (
                <div>
                  <label className="text-xs text-slate-500 block mb-1">الفترة الزمنية</label>
                  <PeriodFilter period={incPeriod} start={incStart} end={incEnd} onChange={applyIncentivePeriod} testidPrefix="inc-period" />
                </div>
              )}
              <Button onClick={loadIncentives} className="bg-[#221340] w-full sm:w-auto" data-testid="inc-load">عرض</Button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center flex-wrap">
            {tab !== "movement" && <Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs"/>}
            <Button onClick={printCurrent} variant="outline" data-testid="print-report" className="w-full sm:w-auto"><Printer size={14} className="ml-1"/> طباعة / PDF</Button>
          </div>
        </Card>

        {tab === "card_order_log" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 no-print mt-3" data-testid="ol-summary">
            <Card className="p-3"><div className="text-xs text-slate-500">إجمالي الطلبات</div><div className="text-xl font-bold">{orderLogSummary.total}</div></Card>
            <Card className="p-3"><div className="text-xs text-slate-500">ناجحة</div><div className="text-xl font-bold text-green-700">{orderLogSummary.success}</div></Card>
            <Card className="p-3"><div className="text-xs text-slate-500">مرفوضة</div><div className="text-xl font-bold text-red-700">{orderLogSummary.rejected}</div></Card>
            <Card className="p-3"><div className="text-xs text-slate-500">القيمة الناجحة</div><div className="text-xl font-bold num">{fmt(orderLogSummary.value)}</div></Card>
          </div>
        )}

        <TabsContent value="sales"><ReportTable data={filtered} kind="sales"/></TabsContent>
        <TabsContent value="purchases"><ReportTable data={filtered} kind="purchases"/></TabsContent>
        <TabsContent value="electronic"><ElectronicTable data={filtered}/></TabsContent>
        <TabsContent value="card_order_log"><OrderLogTable data={filtered}/></TabsContent>
        <TabsContent value="customer_debts"><DebtTable data={filtered} label="العميل"/></TabsContent>
        <TabsContent value="supplier_debts"><DebtTable data={filtered} label="المورد"/></TabsContent>
        <TabsContent value="stock"><StockTable data={filtered} showPeriod={periodActive}/></TabsContent>
        <TabsContent value="opening"><OpeningTable data={filtered}/></TabsContent>
        <TabsContent value="movement"><MovementTable data={mvData}/></TabsContent>
        <TabsContent value="incentives"><IncentivesTable data={incData} query={q}/></TabsContent>
      </Tabs>
    </div>
  );
}

const IncentivesTable = ({ data, query }) => {
  const kind = data?.kind || "redeemed";
  const items = (data?.items || []).filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
  return (
    <Card className="mt-3 overflow-x-auto" data-testid="inc-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50">
          {kind === "pending" ? (
            <tr className="text-right"><th className="p-2">العميل</th><th className="p-2">النوع</th><th className="p-2">الفئة</th><th className="p-2">المشتراة</th><th className="p-2">القاعدة</th><th className="p-2">المستحق</th><th className="p-2">القيمة</th><th className="p-2">الحالة</th></tr>
          ) : (
            <tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">النوع</th><th className="p-2">الفئة</th><th className="p-2">الكمية</th><th className="p-2">طريقة الاستفادة</th><th className="p-2">المبلغ</th><th className="p-2">المستخدم</th></tr>
          )}
        </thead>
        <tbody>
          {items.map((r) => kind === "pending" ? (
            <tr key={r.id} className="border-t bg-amber-50/40">
              <td className="p-2">{r.customer_name || "-"}</td>
              <td className="p-2">{r.customer_type === "pos" ? "نقطة بيع" : "عميل"}</td>
              <td className="p-2">{r.category_name || "-"}</td>
              <td className="p-2 num">{r.bought}</td>
              <td className="p-2 text-xs">{r.buy_qty}/{r.reward_qty}</td>
              <td className="p-2 num font-bold text-amber-700">{r.qty}</td>
              <td className="p-2 num">{fmt(r.redeemed_value || 0)}</td>
              <td className="p-2 text-xs text-slate-600">{r.status_text || "مستحق"}</td>
            </tr>
          ) : (
            <tr key={r.id} className="border-t">
              <td className="p-2">{fmtDate(r.redeemed_at || r.created_at)}</td>
              <td className="p-2">{r.customer_name || "-"}</td>
              <td className="p-2">{r.customer_type === "pos" ? "نقطة بيع" : "عميل"}</td>
              <td className="p-2">{r.category_name || "-"}</td>
              <td className="p-2 num">{r.qty}</td>
              <td className="p-2 text-xs">{r.status === "redeemed_credit" ? "تقييد في الحساب" : "استلام كرت"}</td>
              <td className="p-2 num">{fmt(r.redeemed_value || (r.unit_value || 0) * (r.qty || 0))}</td>
              <td className="p-2 text-xs">{r.redeemed_by || "-"}</td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">{kind === "pending" ? "لا توجد حوافز غير مصروفة" : "لا توجد حوافز مصروفة في الفترة المحددة"}</td></tr>}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-bold">
            <td colSpan={kind === "pending" ? 5 : 4} className="p-2">الإجمالي: {items.length} {kind === "pending" ? "سطر" : "عملية"}</td>
            <td className="p-2 num">{(data?.total_qty) || 0}</td>
            {kind === "pending" ? null : <td></td>}
            <td className="p-2 num">{fmt(data?.total_value || 0)}</td>
            {kind === "pending" ? null : <td></td>}
          </tr>
        </tfoot>
      </table>
    </Card>
  );
};

const ReportTable = ({ data, kind }) => {
  const total = data.reduce((s, x) => s + (x.total || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">{kind==='sales'?'العميل':'المورد'}</th><th className="p-2">الإجمالي</th><th className="p-2">المدفوع</th><th className="p-2">المتبقي</th></tr></thead>
        <tbody>
          {data.map((s) => <tr key={s.id} className="border-t"><td className="p-2 font-mono">{s.number}</td><td className="p-2">{fmtDate(s.created_at)}</td><td className="p-2">{s.customer_name || s.supplier_name}</td><td className="p-2 num">{fmt(s.total)}</td><td className="p-2 num">{fmt(s.paid)}</td><td className="p-2 num">{fmt(s.remaining)}</td></tr>)}
          {data.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={2} className="p-2">عدد النتائج: {data.length}</td><td className="p-2">الإجمالي</td><td className="p-2 num">{fmt(total)}</td><td colSpan={2}></td></tr></tfoot>
      </table>
    </Card>
  );
};
const ElectronicTable = ({ data }) => {
  const total = data.reduce((s, x) => s + (x.total || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">الفئة</th><th className="p-2">الكمية</th><th className="p-2">الإجمالي</th><th className="p-2">الكروت</th></tr></thead>
        <tbody>
          {data.map((s) => { const it = s.items?.[0] || {}; return <tr key={s.id} className="border-t"><td className="p-2 font-mono">{s.number}</td><td className="p-2">{fmtDate(s.created_at)}</td><td className="p-2">{s.customer_name}</td><td className="p-2">{it.category_name}</td><td className="p-2 num">{it.quantity}</td><td className="p-2 num">{fmt(s.total)}</td><td className="p-2 text-xs font-mono">{(it.card_numbers||[]).join(", ")}</td></tr>; })}
          {data.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={4} className="p-2">عدد النتائج: {data.length}</td><td className="p-2">الإجمالي</td><td className="p-2 num">{fmt(total)}</td><td></td></tr></tfoot>
      </table>
    </Card>
  );
};
const OrderLogTable = ({ data }) => (
  <Card className="mt-3 overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">العميل</th><th className="p-2">الهاتف</th><th className="p-2">الفئة</th><th className="p-2">الكمية</th><th className="p-2">القيمة</th><th className="p-2">الحالة</th><th className="p-2">السبب</th></tr></thead>
      <tbody>
        {data.map((a) => (
          <tr key={a.id} className="border-t">
            <td className="p-2">{fmtDate(a.created_at)}</td><td className="p-2">{a.customer_name || "-"}</td><td className="p-2">{a.phone}</td><td className="p-2">{a.category_name || "-"}</td><td className="p-2 num">{a.quantity || 0}</td><td className="p-2 num">{fmt(a.total || 0)}</td>
            <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${a.status==='success'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{a.status==='success'?'ناجح':a.status==='rejected_over_limit'?'الفاشلة - تجاوز السقف':a.status==='rejected_no_stock'?'الفاشلة - عدم توفر':a.status==='rejected_not_found'?'الفاشلة - دخول مرفوض':'الفاشلة'}</span></td>
            <td className="p-2 text-xs">{a.reason}</td>
          </tr>
        ))}
        {data.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
      </tbody>
    </table>
  </Card>
);
const DebtTable = ({ data, label }) => {
  const total = data.reduce((s, x) => s + (x.balance || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">{label}</th><th className="p-2">الهاتف</th><th className="p-2">السقف</th><th className="p-2">المديونية</th><th className="p-2">المتاح</th></tr></thead>
        <tbody>{data.map((c) => <tr key={c.id} className="border-t"><td className="p-2">{c.name}</td><td className="p-2">{c.phone}</td><td className="p-2 num">{fmt(c.credit_limit)}</td><td className="p-2 num font-bold">{fmt(c.balance)}</td><td className="p-2 num text-green-600">{fmt(Math.max(0, (c.credit_limit||0) - (c.balance||0)))}</td></tr>)}
          {data.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد بيانات لعرضها</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={2} className="p-2">عدد النتائج: {data.length}</td><td className="p-2">إجمالي المديونية</td><td className="p-2 num">{fmt(total)}</td><td></td></tr></tfoot>
      </table>
    </Card>
  );
};
const StockTable = ({ data, showPeriod }) => {
  if (!data || data.length === 0) return <Card className="mt-3 p-6 text-center text-slate-400">لا توجد بيانات لعرضها</Card>;
  if (showPeriod) {
    const totAdded = data.reduce((s, x) => s + (x.period?.added || 0), 0);
    const totSold = data.reduce((s, x) => s + (x.period?.sold || 0), 0);
    return (
      <Card className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الفئة</th><th className="p-2">أُضيف بالفترة</th><th className="p-2">بيع بالفترة</th><th className="p-2">مرقم متاح</th><th className="p-2">كمية متاح</th><th className="p-2">المتاح الكلي</th></tr></thead>
          <tbody>{data.map((s) => <tr key={s.category_id} className={`border-t ${s.low_stock?'bg-amber-50':''}`}><td className="p-2">{s.category_name}</td><td className="p-2 num text-green-700 font-bold">{s.period?.added || 0}</td><td className="p-2 num text-red-700 font-bold">{s.period?.sold || 0}</td><td className="p-2 num text-green-600">{s.numbered?.available || 0}</td><td className="p-2 num text-green-600">{s.quantity?.available || 0}</td><td className="p-2 num font-bold">{s.available_total || 0}</td></tr>)}</tbody>
          <tfoot><tr className="bg-slate-100 font-bold"><td className="p-2">الإجمالي</td><td className="p-2 num text-green-700">{totAdded}</td><td className="p-2 num text-red-700">{totSold}</td><td colSpan={3}></td></tr></tfoot>
        </table>
      </Card>
    );
  }
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الفئة</th><th className="p-2">مرقم إجمالي</th><th className="p-2">مرقم متاح</th><th className="p-2">مرقم مباع</th><th className="p-2">كمية إجمالي</th><th className="p-2">كمية متاح</th><th className="p-2">المتاح الكلي</th></tr></thead>
        <tbody>{data.map((s) => <tr key={s.category_id} className={`border-t ${s.low_stock?'bg-amber-50':''}`}><td className="p-2">{s.category_name}</td><td className="p-2 num">{s.numbered?.total || 0}</td><td className="p-2 num text-green-600">{s.numbered?.available || 0}</td><td className="p-2 num">{s.numbered?.sold || 0}</td><td className="p-2 num">{s.quantity?.total || 0}</td><td className="p-2 num text-green-600">{s.quantity?.available || 0}</td><td className="p-2 num font-bold">{s.available_total || 0}</td></tr>)}</tbody>
      </table>
    </Card>
  );
};
const OpeningTable = ({ data }) => {
  const total = (data || []).reduce((s, x) => s + (x.opening_balance || 0), 0);
  return (
    <Card className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">النوع</th><th className="p-2">الاسم</th><th className="p-2">الهاتف</th><th className="p-2">الرصيد الافتتاحي</th><th className="p-2">الرصيد الحالي</th></tr></thead>
        <tbody>
          {(data || []).map((c) => (
            <tr key={`${c.type}-${c.id}`} className="border-t">
              <td className="p-2">{c.type === "supplier" ? "مورد" : c.type === "pos" ? "نقطة بيع" : "عميل"}</td>
              <td className="p-2">{c.name}</td>
              <td className="p-2 font-mono text-xs">{c.phone || "-"}</td>
              <td className="p-2 num font-bold">{fmt(c.opening_balance)}</td>
              <td className="p-2 num">{fmt(c.current_balance)}</td>
            </tr>
          ))}
          {(!data || data.length === 0) && <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد أرصدة افتتاحية</td></tr>}
        </tbody>
        <tfoot><tr className="bg-slate-100 font-bold"><td colSpan={3} className="p-2">الإجمالي</td><td className="p-2 num">{fmt(total)}</td><td></td></tr></tfoot>
      </table>
    </Card>
  );
};

const MovementTable = ({ data }) => {
  if (!data) return <Card className="mt-3 p-6 text-center text-slate-400">اختر فئة واضغط "عرض الحركة"</Card>;
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-3"><div className="text-xs text-slate-500">رصيد قبل الفترة</div><div className="text-xl font-bold num">{fmt(data.balance_before)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">وارد</div><div className="text-xl font-bold text-green-700 num">{fmt(data.total_in)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">صادر</div><div className="text-xl font-bold text-red-700 num">{fmt(data.total_out)}</div></Card>
        <Card className="p-3"><div className="text-xs text-slate-500">رصيد بعد الفترة</div><div className="text-xl font-bold text-[#452480] num">{fmt(data.balance_after)}</div></Card>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">التاريخ</th><th className="p-2">الرقم</th><th className="p-2">البيان</th><th className="p-2">وارد</th><th className="p-2">صادر</th><th className="p-2">الرصيد</th></tr></thead>
          <tbody>
            {data.entries.map((e, i) => (
              <tr key={i} className="border-t">
                <td className="p-2">{fmtDate(e.created_at)}</td>
                <td className="p-2 font-mono">{e.number || "-"}</td>
                <td className="p-2">{e.description}</td>
                <td className="p-2 num text-green-700">{e.in || "-"}</td>
                <td className="p-2 num text-red-700">{e.out || "-"}</td>
                <td className="p-2 num font-bold">{e.balance}</td>
              </tr>
            ))}
            {data.entries.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">لا توجد حركات ضمن الفترة</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
