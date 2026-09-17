import { useEffect, useMemo, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Bell, Send, CheckCircle2, Search, History } from "lucide-react";
import PeriodFilter from "@/components/PeriodFilter";

// Standalone "Send Notification" screen (moved out of Settings).
// Includes: send form + previous notifications log with period search/filter.
export default function SendNotification() {
  const [customers, setCustomers] = useState([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("all"); // all | selected
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);

  // Previous notifications log + filters
  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const loadCustomers = async () => {
    try { const r = await api.get("/customers"); setCustomers(r.data || []); } catch {}
  };
  const loadLog = async () => {
    setLoadingLog(true);
    try { const r = await api.get("/notifications/broadcast-log"); setLog(r.data || []); }
    catch { /* silent */ }
    setLoadingLog(false);
  };
  useEffect(() => { loadCustomers(); loadLog(); }, []);

  const filtered = customers.filter((c) => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return true;
    return (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q);
  });

  const toggle = (id) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const send = async () => {
    if (!title.trim() || !message.trim()) { toast.error("العنوان والنص إلزاميان"); return; }
    if (mode === "selected" && selected.length === 0) { toast.error("اختر مستلماً واحداً على الأقل"); return; }
    setSending(true);
    try {
      const body = { title: title.trim(), message: message.trim() };
      if (mode === "selected") body.recipients = selected;
      const r = await api.post("/notifications/broadcast", body);
      toast.success(`تم إرسال الإشعار إلى ${r.data.count} حساب`);
      setTitle(""); setMessage(""); setSelected([]); setMode("all");
      loadLog();
    } catch (e) { toast.error(errText(e)); }
    setSending(false);
  };

  // Real filtering of the sent-notifications log by period + text search (uses created_at from DB).
  const logFiltered = useMemo(() => {
    const q = (logSearch || "").trim().toLowerCase();
    return (log || []).filter((row) => {
      const day = (row.created_at || "").slice(0, 10);
      if (start && day < start) return false;
      if (end && day > end) return false;
      if (q && !((row.title || "").toLowerCase().includes(q) || (row.message || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [log, logSearch, start, end]);

  const totalRecipients = useMemo(() => logFiltered.reduce((s, r) => s + (r.count || 0), 0), [logFiltered]);

  return (
    <div className="space-y-6 max-w-3xl" data-testid="send-notification-page">
      {/* Send form */}
      <Card className="p-6 space-y-4" data-testid="send-notif-card">
        <div className="text-lg font-bold text-[#221340] flex items-center gap-2"><Send size={20} className="text-[#452480]"/> إرسال إشعار</div>
        <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2">
          يظهر الإشعار داخل حساب المشترك في أيقونة الجرس 🔔، وتُحسب حالة القراءة لكل حساب باستقلال. لن يتكرر الإشعار عند إعادة التحميل أو تسجيل الدخول.
        </div>
        <div><Label>عنوان الإشعار</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: تنبيه من الإدارة" data-testid="bc-title"/></div>
        <div><Label>نص الإشعار</Label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className="w-full border rounded-md p-2 text-sm" placeholder="اكتب نص الإشعار هنا..." data-testid="bc-message"/>
        </div>
        <div>
          <Label>المستلمون</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <button type="button" onClick={() => setMode("all")} className={`py-2 rounded-lg border text-xs font-bold ${mode==="all"?"bg-[#452480] text-white border-[#452480]":"border-slate-300 hover:bg-slate-100"}`} data-testid="bc-mode-all">جميع الحسابات</button>
            <button type="button" onClick={() => setMode("selected")} className={`py-2 rounded-lg border text-xs font-bold ${mode==="selected"?"bg-[#452480] text-white border-[#452480]":"border-slate-300 hover:bg-slate-100"}`} data-testid="bc-mode-selected">حساب/حسابات محددة</button>
          </div>
        </div>
        {mode === "selected" && (
          <div className="space-y-2 border rounded p-2 bg-white" data-testid="bc-customers">
            <Input placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} data-testid="bc-search"/>
            <div className="text-xs text-slate-500 flex justify-between">
              <span>عدد المحددين: <strong>{selected.length}</strong></span>
              {selected.length > 0 && <button onClick={() => setSelected([])} className="text-red-600 hover:underline">مسح التحديد</button>}
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filtered.slice(0, 200).map((c) => (
                <label key={c.id} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer text-sm" data-testid={`bc-cust-${c.id}`}>
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)}/>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{c.phone || "-"}</div>
                  </div>
                </label>
              ))}
              {filtered.length === 0 && <div className="text-center text-slate-400 text-xs p-2">لا نتائج</div>}
            </div>
          </div>
        )}
        <Button onClick={send} disabled={sending} className="w-full bg-[#452480] hover:bg-[#5A2FA0]" data-testid="bc-send">
          <Send size={14} className="ml-1"/> {sending ? "جاري الإرسال..." : "إرسال الإشعار"}
        </Button>
      </Card>

      {/* Previous notifications log */}
      <Card className="p-6 space-y-4" data-testid="notif-log-card">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-lg font-bold text-[#221340] flex items-center gap-2"><History size={20} className="text-[#452480]"/> سجل الإشعارات السابقة</div>
          <button onClick={loadLog} className="text-xs text-[#452480] hover:underline" data-testid="bc-log-refresh">{loadingLog ? "جاري..." : "تحديث"}</button>
        </div>

        <div className="space-y-2 bg-slate-50 border rounded-lg p-3">
          <Label className="text-xs">تصفية حسب الفترة</Label>
          <PeriodFilter period={period} start={start} end={end}
            onChange={({ period: p, start: s, end: e }) => { setPeriod(p); setStart(s); setEnd(e); }}
            testidPrefix="notif-log-period" />
          <div className="relative pt-1">
            <Search size={14} className="absolute right-2 top-3.5 text-slate-400"/>
            <Input className="pr-8" placeholder="بحث في العنوان أو النص..." value={logSearch} onChange={(e) => setLogSearch(e.target.value)} data-testid="notif-log-search"/>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm bg-[#452480]/5 rounded-lg px-3 py-2" data-testid="notif-log-summary">
          <span className="text-slate-600">عدد الإشعارات: <strong className="text-[#221340]">{logFiltered.length}</strong></span>
          <span className="text-slate-600">إجمالي المستلمين: <strong className="text-[#221340]">{totalRecipients}</strong></span>
        </div>

        <div className="space-y-2 max-h-[28rem] overflow-y-auto" data-testid="notif-log-list">
          {logFiltered.length === 0 && <div className="text-center text-slate-400 text-sm p-4">لا توجد إشعارات ضمن الفترة المحددة</div>}
          {logFiltered.map((row) => (
            <div key={row._id} className="border rounded p-3 bg-white text-sm" data-testid={`bc-log-${row._id}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold text-[#221340] flex items-center gap-2"><Bell size={14} className="text-[#D4AF37]"/> {row.title}</div>
                <div className="text-[10px] text-slate-500 shrink-0">{(row.created_at || "").replace("T"," ").slice(0,16)}</div>
              </div>
              <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">{row.message}</div>
              <div className="mt-2 flex items-center gap-3 text-[11px] flex-wrap">
                <span className="text-slate-500">المستلمون: <strong className="text-[#221340]">{row.count}</strong></span>
                <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11}/> قراءة: <strong>{row.read_count}</strong></span>
                <span className="text-amber-700">غير مقروء: <strong>{Math.max(0, (row.count||0) - (row.read_count||0))}</strong></span>
                {row.sender_username && <span className="text-slate-400">— أرسل بواسطة: {row.sender_username}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
