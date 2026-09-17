import { useState, useEffect } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Database, RotateCcw, Trash2, Download, Upload, Send, CloudDownload, Plus, Coins, Bell, X, CheckCircle2, Smartphone } from "lucide-react";
import IncentivesManager from "@/pages/IncentivesManager";
import { useAuth } from "@/lib/auth";
import { usePWAInstall } from "@/lib/pwaInstall";

function BroadcastPanel() {
  const [customers, setCustomers] = useState([]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("all"); // all | selected
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const loadCustomers = async () => {
    try { const r = await api.get("/customers"); setCustomers(r.data || []); } catch {}
  };
  const loadLog = async () => {
    setLoadingLog(true);
    try { const r = await api.get("/notifications/broadcast-log"); setLog(r.data || []); }
    catch (e) { /* silent */ }
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

  return (
    <div className="space-y-4" data-testid="broadcast-panel">
      <div className="space-y-3 border rounded-lg p-3 bg-slate-50">
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
      </div>

      <div className="border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-bold text-[#221340] flex items-center gap-2"><Bell size={16}/> سجل الإشعارات المرسلة</div>
          <button onClick={loadLog} className="text-xs text-[#452480] hover:underline" data-testid="bc-log-refresh">{loadingLog ? "جاري..." : "تحديث"}</button>
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {log.length === 0 && <div className="text-center text-slate-400 text-xs p-3">لا توجد إشعارات مرسلة سابقاً</div>}
          {log.map((row) => (
            <div key={row._id} className="border rounded p-2 bg-slate-50 text-sm" data-testid={`bc-log-${row._id}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold text-[#221340]">{row.title}</div>
                <div className="text-[10px] text-slate-500 shrink-0">{(row.created_at || "").replace("T"," ").slice(0,16)}</div>
              </div>
              <div className="text-xs text-slate-600 mt-1 whitespace-pre-line">{row.message}</div>
              <div className="mt-1 flex items-center gap-3 text-[11px]">
                <span className="text-slate-500">المستلمون: <strong className="text-[#221340]">{row.count}</strong></span>
                <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={11}/> قراءة: <strong>{row.read_count}</strong></span>
                <span className="text-amber-700">غير مقروء: <strong>{Math.max(0, (row.count||0) - (row.read_count||0))}</strong></span>
                {row.sender_username && <span className="text-slate-400">— أرسل بواسطة: {row.sender_username}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CurrenciesManager() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: "", symbol: "", rate_to_yer: "", active: true });
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/currencies").then((r) => setItems(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.name.trim() || !form.symbol.trim() || !form.rate_to_yer || Number(form.rate_to_yer) <= 0) {
      toast.error("اكمل بيانات العملة"); return;
    }
    try {
      const payload = { name: form.name.trim(), symbol: form.symbol.trim(), rate_to_yer: Number(form.rate_to_yer), active: !!form.active };
      if (editing) await api.put(`/currencies/${editing.id}`, payload);
      else await api.post("/currencies", payload);
      toast.success("تم الحفظ");
      setForm({ name: "", symbol: "", rate_to_yer: "", active: true });
      setEditing(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  const remove = async (c) => {
    if (!window.confirm(`حذف العملة "${c.name}"؟ إذا كانت مستخدمة سيتم تعطيلها فقط دون حذف السجل التاريخي.`)) return;
    try {
      const r = await api.delete(`/currencies/${c.id}`);
      toast.success(r.data.action === "disabled" ? "تم تعطيل العملة (لأنها مستخدمة في عمليات سابقة)" : "تم الحذف");
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  const beginEdit = (c) => { setEditing(c); setForm({ name: c.name, symbol: c.symbol, rate_to_yer: c.rate_to_yer, active: !!c.active }); };
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500 bg-blue-50 border border-blue-200 rounded p-2">
        <Coins size={12} className="inline ml-1"/>
        يتم حفظ العملة وسعر الصرف مع كل عملية. تغيير سعر الصرف يؤثر على العمليات الجديدة فقط.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="دولار أمريكي" data-testid="cur-name"/></div>
        <div><Label>الرمز</Label><Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="USD" data-testid="cur-symbol"/></div>
        <div><Label>سعر مقابل الريال</Label><Input type="number" value={form.rate_to_yer} onChange={(e) => setForm({ ...form, rate_to_yer: e.target.value })} placeholder="530" data-testid="cur-rate"/></div>
        <div className="flex flex-col gap-1">
          <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="cur-active"/> مفعّلة</label>
          <Button onClick={save} className="bg-[#221340]" data-testid="cur-save"><Plus size={14} className="ml-1"/> {editing ? "تحديث" : "إضافة"}</Button>
          {editing && <button onClick={() => { setEditing(null); setForm({ name: "", symbol: "", rate_to_yer: "", active: true }); }} className="text-xs text-slate-500 hover:underline">إلغاء التعديل</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الاسم</th><th className="p-2">الرمز</th><th className="p-2">السعر (ريال)</th><th className="p-2">الحالة</th><th className="p-2">إجراء</th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2">{c.name}</td>
                <td className="p-2 font-mono">{c.symbol}</td>
                <td className="p-2 num">{fmt(c.rate_to_yer)}</td>
                <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{c.active ? "مفعّلة" : "معطلة"}</span></td>
                <td className="p-2 flex gap-1">
                  <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => beginEdit(c)} data-testid={`cur-edit-${c.id}`}>تعديل</Button>
                  <Button size="sm" variant="outline" className="h-6 text-xs text-red-600" onClick={() => remove(c)} data-testid={`cur-del-${c.id}`}><Trash2 size={12}/></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد عملات — أضف عملة جديدة أعلاه</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InstallAppPanel() {
  const { user } = useAuth();
  const { canInstall, installed, promptInstall } = usePWAInstall();
  const [allowed, setAllowed] = useState([]);
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installedFlag, setInstalledFlag] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get("/settings").then((r) => {
      const list = r.data?.install_allowed_emails || [];
      setAllowed(list);
      setRaw(list.join("\n"));
    }).finally(() => setLoading(false));
    try { setInstalledFlag(!!localStorage.getItem("gwd_admin_pwa_installed")); } catch {}
    const onInstalled = () => {
      try { localStorage.setItem("gwd_admin_pwa_installed", String(Date.now())); } catch {}
      setInstalledFlag(true);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  const meAllowed = user?.email && allowed.map((e) => e.toLowerCase()).includes(user.email.toLowerCase());
  const isSuperAdmin = user?.role === "admin";
  const isInstalled = installed || installedFlag;

  const save = async () => {
    const list = raw
      .split(/[\n,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    setSaving(true);
    try {
      await api.post("/settings", { install_allowed_emails: list });
      setAllowed(list);
      toast.success("تم تحديث قائمة المسموح لهم بالتثبيت");
    } catch (e) { toast.error(errText(e)); }
    setSaving(false);
  };

  const doInstall = async () => {
    if (!meAllowed) { toast.error("هذا الإيميل غير مسموح له بتثبيت تطبيق الإدارة"); return; }
    if (!canInstall) {
      toast.error("المتصفح لم يعرض خيار التثبيت بعد. افتح التطبيق مرة أخرى بعد ثوانٍ، أو استخدم قائمة المتصفح: تثبيت التطبيق.");
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      try { localStorage.setItem("gwd_admin_pwa_installed", String(Date.now())); } catch {}
      setInstalledFlag(true);
      toast.success("تم بدء التثبيت");
    }
  };

  const doUpdate = async () => {
    setUpdating(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => !k.startsWith("jawad-")).map((k) => caches.delete(k)));
      }
      toast.success("جارٍ تحميل أحدث نسخة...");
      setTimeout(() => window.location.reload(true), 700);
    } catch (e) {
      toast.error("تعذّر التحقق من التحديث");
      setUpdating(false);
    }
  };

  const resetInstall = () => {
    if (!window.confirm("إعادة تفعيل زر التثبيت — يستخدم فقط لو أُلغي التطبيق من الجهاز. متابعة؟")) return;
    try { localStorage.removeItem("gwd_admin_pwa_installed"); } catch {}
    setInstalledFlag(false);
    toast.info("تم إعادة تفعيل زر التثبيت");
  };

  return (
    <div className="space-y-4" data-testid="install-panel">
      <div className="rounded-lg border border-[#452480]/20 bg-[#F8F5FF] p-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-[#452480] text-white flex items-center justify-center shrink-0">
          <Smartphone size={20}/>
        </div>
        <div className="flex-1 text-sm">
          <div className="font-bold text-[#221340]">إدارة الحسابات (MOF30)</div>
          <div className="text-xs text-slate-600 mt-1 leading-relaxed">
            ثبّت لوحة الإدارة كتطبيق مستقل على شاشة الجهاز (يفتح مباشرة على النطاق <span dir="ltr" className="font-mono">/mof30</span>). التثبيت مسموح فقط للإيميلات المضافة أدناه، ومسموح <b>مرة واحدة</b> — بعدها يظهر زر «تحديث التطبيق».
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {isInstalled ? (
              <>
                <Button
                  onClick={doUpdate}
                  disabled={updating}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  data-testid="update-admin-btn"
                >
                  <RotateCcw size={14} className="ml-1"/>
                  {updating ? "جاري التحديث..." : "تحديث التطبيق"}
                </Button>
                <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold">التطبيق مثبَّت مسبقاً</span>
                {isSuperAdmin && (
                  <button
                    type="button"
                    onClick={resetInstall}
                    className="text-[11px] text-slate-500 hover:text-red-600 hover:underline"
                    data-testid="reset-install-flag"
                  >
                    إعادة تفعيل زر التثبيت
                  </button>
                )}
              </>
            ) : (
              <>
                <Button
                  onClick={doInstall}
                  disabled={loading || !meAllowed}
                  className="bg-[#452480] hover:bg-[#5A2FA0] text-white"
                  data-testid="install-admin-btn"
                >
                  <Download size={14} className="ml-1"/>
                  {meAllowed ? "تثبيت تطبيق الإدارة" : "غير مسموح لك بالتثبيت"}
                </Button>
                <span className="text-[11px] text-slate-500">
                  حالتك: {user?.email ? <span className="font-mono" dir="ltr">{user.email}</span> : "لا يوجد بريد لحسابك"} —
                  {meAllowed ? <span className="text-emerald-700 font-bold"> مسموح</span> : <span className="text-red-700 font-bold"> غير مسموح</span>}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="border rounded-lg p-3">
          <div className="font-bold text-sm text-[#221340] mb-2">قائمة الإيميلات المسموح لها بالتثبيت</div>
          <div className="text-[11px] text-slate-500 mb-2">إيميل واحد في كل سطر (أو مفصولة بفاصلة).</div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            className="w-full border rounded-md p-2 text-sm font-mono"
            dir="ltr"
            placeholder="admin@example.com"
            data-testid="install-allowed-list"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[11px] text-slate-500">
              حالياً: <strong>{allowed.length}</strong> إيميل مسموح
            </div>
            <Button onClick={save} disabled={saving} className="bg-[#221340]" data-testid="install-allowed-save">
              {saving ? "جاري..." : "حفظ القائمة"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState({ currency: "ريال", logo_url: "", low_stock_default: 20, backup_email: "" });
  const [backupEmail, setBackupEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [backupSettings, setBackupSettings] = useState({ time: "02:00", auto: false });
  const [savingAuto, setSavingAuto] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [latestBackup, setLatestBackup] = useState(null);
  const [restoringCloud, setRestoringCloud] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetForm, setResetForm] = useState({ username: "", password: "" });

  useEffect(() => {
    api.get("/settings").then((r) => {
      setS(r.data);
      setBackupEmail(r.data.backup_email || "");
      setBackupSettings({
        time: r.data.backup_time || "02:00",
        auto: !!r.data.backup_auto,
      });
    });
    api.get("/backup/latest").then((r) => {
      if (r.data?.exists) setLatestBackup(r.data);
    }).catch(() => {});
  }, []);

  const save = async () => {
    try { await api.post("/settings", s); toast.success("تم الحفظ"); } catch (e) { toast.error(errText(e)); }
  };

  const saveBackupEmail = async () => {
    const v = (backupEmail || "").trim();
    if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error("البريد الإلكتروني غير صحيح. يرجى إدخال بريد إلكتروني صالح.");
      return;
    }
    setSavingEmail(true);
    try {
      await api.post("/settings", { backup_email: v });
      setS((prev) => ({ ...prev, backup_email: v }));
      toast.success("تم حفظ البريد الإلكتروني بنجاح.");
    } catch (e) { toast.error(errText(e)); }
    setSavingEmail(false);
  };

  const saveBackupAuto = async () => {
    const time = backupSettings.time || "02:00";
    if (!/^\d{2}:\d{2}$/.test(time)) {
      toast.error("الرجاء إدخال وقت صحيح بصيغة HH:MM.");
      return;
    }
    if (backupSettings.auto && !((backupEmail || "").trim())) {
      toast.error("يرجى حفظ البريد الإلكتروني للنسخ أولاً قبل تفعيل النسخ التلقائي.");
      return;
    }
    setSavingAuto(true);
    try {
      await api.post("/settings", { backup_time: time, backup_auto: !!backupSettings.auto });
      toast.success(backupSettings.auto ? "تم تفعيل النسخ الاحتياطي التلقائي." : "تم حفظ إعدادات النسخ التلقائي.");
    } catch (e) { toast.error(errText(e)); }
    setSavingAuto(false);
  };

  const runBackupNow = async () => {
    const v = (backupEmail || "").trim();
    if (!v) {
      toast.error("يرجى حفظ البريد الإلكتروني للنسخ أولاً.");
      return;
    }
    setRunningNow(true);
    try {
      const r = await api.post("/backup/run-now");
      if (r.data?.email_sent) {
        toast.success(`تم رفع النسخة (${(r.data.size/1024).toFixed(1)} KB) وإرسال الرابط إلى ${r.data.email_to}`);
      } else if (r.data?.email_error) {
        toast.error(`تم الرفع لكن فشل الإرسال: ${r.data.email_error}`);
      } else {
        toast.success(`تم رفع النسخة إلى السحابة (${(r.data.size/1024).toFixed(1)} KB)`);
      }
      // refresh latest
      const l = await api.get("/backup/latest");
      if (l.data?.exists) setLatestBackup(l.data);
    } catch (e) { toast.error(errText(e)); }
    setRunningNow(false);
  };

  const restoreLatestCloud = async () => {
    if (!latestBackup) {
      toast.error("لا توجد نسخة سحابية للاستعادة.");
      return;
    }
    const when = (latestBackup.created_at || "").replace("T", " ").slice(0, 16);
    if (!window.confirm(
      `سيتم استعادة آخر نسخة سحابية (${when}). سيتم استبدال كل البيانات (باستثناء المستخدمين) بمحتوى النسخة، مع إنشاء نسخة أمان تلقائية أولاً. تأكيد؟`
    )) return;
    setRestoringCloud(true);
    try {
      const r = await api.post("/backup/restore-latest", { confirm: true });
      toast.success(`تمت الاستعادة بنجاح — ${r.data?.total_docs || 0} وثيقة من ${Object.keys(r.data?.restored || {}).length} مجموعة.`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { toast.error(errText(e)); }
    setRestoringCloud(false);
  };

  const exportBackup = async () => {
    try {
      const r = await api.get("/backup/export");
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jawad-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("تم إنشاء النسخة الاحتياطية");
    } catch (e) { toast.error(errText(e)); }
  };

  const uploadBackup = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!window.confirm("سيتم استبدال البيانات الحالية. سيتم إنشاء نسخة أمان تلقائية أولاً. تأكيد؟")) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.post("/backup/restore", { data });
      toast.success("تمت الاستعادة");
    } catch (e) { toast.error(errText(e)); }
  };

  const performReset = async () => {
    try {
      await api.post("/settings/reset-data", { username: resetForm.username, password: resetForm.password, confirm: true });
      toast.success("تم مسح جميع البيانات");
      setResetOpen(false);
      setResetForm({ username: "", password: "" });
    } catch (e) { toast.error(errText(e)); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="settings-page">
      <Card className="p-6 space-y-4">
        <div className="text-lg font-bold text-[#221340]">إعدادات عامة</div>
        <div><Label>اسم الشبكة</Label><Input value={s.company_name || ""} disabled/></div>
        <div><Label>الهاتف</Label><Input value={s.company_phone || ""} disabled/></div>
        <div>
          <Label>العملة</Label>
          <Select value={s.currency || "ريال"} onValueChange={(v) => setS({ ...s, currency: v })}>
            <SelectTrigger data-testid="set-currency"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="ريال">ريال يمني (ريال)</SelectItem>
              <SelectItem value="ر.س">ريال سعودي (ر.س)</SelectItem>
              <SelectItem value="د.إ">درهم إماراتي (د.إ)</SelectItem>
              <SelectItem value="ج.م">جنيه مصري (ج.م)</SelectItem>
              <SelectItem value="د.ك">دينار كويتي (د.ك)</SelectItem>
              <SelectItem value="د.ب">دينار بحريني (د.ب)</SelectItem>
              <SelectItem value="ر.ع">ريال عماني (ر.ع)</SelectItem>
              <SelectItem value="ر.ق">ريال قطري (ر.ق)</SelectItem>
              <SelectItem value="د.ع">دينار عراقي (د.ع)</SelectItem>
              <SelectItem value="د.أ">دينار أردني (د.أ)</SelectItem>
              <SelectItem value="ل.س">ليرة سورية (ل.س)</SelectItem>
              <SelectItem value="USD">دولار أمريكي (USD)</SelectItem>
              <SelectItem value="EUR">يورو (EUR)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>حد التنبيه الافتراضي للمخزون</Label><Input type="number" value={s.low_stock_default || 20} onChange={(e) => setS({ ...s, low_stock_default: Number(e.target.value) })}/></div>
        <div><Label>رابط الشعار</Label><Input value={s.logo_url || ""} onChange={(e) => setS({ ...s, logo_url: e.target.value })}/></div>
        <Button onClick={save} className="bg-[#221340]" data-testid="set-save">حفظ</Button>
      </Card>

      <Card className="p-6 space-y-4" data-testid="install-card">
        <div className="text-lg font-bold text-[#221340] flex items-center gap-2"><Smartphone size={20}/> تثبيت / تحديث «إدارة الحسابات»</div>
        <InstallAppPanel/>
      </Card>

      <Card className="p-6 space-y-4" data-testid="currencies-panel">
        <div className="text-lg font-bold text-[#221340]">العملات المتعددة</div>
        <CurrenciesManager/>
        <IncentivesManager/>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="text-lg font-bold text-[#221340] flex items-center gap-2"><Database size={20}/> النسخ الاحتياطي والمزامنة</div>
        <div>
          <Label>البريد الإلكتروني للنسخ الاحتياطية</Label>
          <Input
            type="email"
            value={backupEmail}
            onChange={(e) => setBackupEmail(e.target.value)}
            data-testid="backup-email"
            placeholder="admin@example.com"
            autoComplete="email"
            inputMode="email"
          />
          <div className="text-xs text-slate-500 mt-1">سيتم استخدام هذا البريد تلقائياً عند إرسال النسخ الاحتياطية.</div>
          <Button
            onClick={saveBackupEmail}
            disabled={savingEmail}
            className="mt-2 bg-[#452480] hover:bg-[#5A2FA0]"
            data-testid="backup-email-save"
          >
            {savingEmail ? "جاري..." : "حفظ البريد الإلكتروني"}
          </Button>
        </div>
        <div className="pt-3 border-t space-y-3">
          <div><Label>وقت النسخ اليومي</Label><Input type="time" value={backupSettings.time} onChange={(e) => setBackupSettings({ ...backupSettings, time: e.target.value })} data-testid="backup-time"/></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={backupSettings.auto} onChange={(e) => setBackupSettings({ ...backupSettings, auto: e.target.checked })} data-testid="backup-auto-toggle"/> تفعيل النسخ الاحتياطي التلقائي</label>
          <Button
            onClick={saveBackupAuto}
            disabled={savingAuto}
            className="bg-[#452480] hover:bg-[#5A2FA0] w-full sm:w-auto"
            data-testid="backup-auto-save"
          >
            {savingAuto ? "جاري..." : "حفظ إعدادات النسخ التلقائي"}
          </Button>
          <div className="flex gap-2 flex-wrap pt-3 border-t">
            <Button onClick={runBackupNow} disabled={runningNow} className="bg-emerald-700 hover:bg-emerald-800" data-testid="backup-run-now"><Send size={14} className="ml-1"/> {runningNow ? "جاري الرفع والإرسال..." : "رفع للسحابة وإرسال بالبريد الآن"}</Button>
            <Button onClick={restoreLatestCloud} disabled={restoringCloud || !latestBackup} className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50" data-testid="backup-restore-latest"><CloudDownload size={14} className="ml-1"/> {restoringCloud ? "جاري الاستعادة..." : "استعادة آخر نسخة سحابية"}</Button>
            <Button onClick={exportBackup} className="bg-[#221340]" data-testid="backup-export"><Download size={14} className="ml-1"/> تنزيل نسخة محلية</Button>
            <label className="inline-flex">
              <input type="file" accept=".json" onChange={uploadBackup} className="hidden" data-testid="backup-upload"/>
              <span className="bg-[#452480] text-white px-4 py-2 rounded cursor-pointer flex items-center gap-1 text-sm hover:bg-[#5A2FA0]"><Upload size={14}/> استعادة نسخة</span>
            </label>
          </div>
          {latestBackup ? (
            <div className="text-xs text-slate-600 bg-slate-50 rounded p-2 mt-2" data-testid="latest-backup-info">
              آخر نسخة سحابية: <strong>{(latestBackup.created_at || "").replace("T"," ").slice(0,16)}</strong>
              — الحجم: {(latestBackup.size/1024).toFixed(1)} KB — المصدر: {latestBackup.trigger || "—"}
            </div>
          ) : (
            <div className="text-xs text-slate-500 mt-2">لا توجد نسخة سحابية بعد. اضغط "رفع للسحابة" لإنشاء أول نسخة.</div>
          )}
          <div className="text-xs text-slate-500 pt-2">
            الرفع للسحابة يستخدم تخزين Emergent Object Storage ويُرسل رابط تحميل صالح لمدة 14 يوماً إلى بريدك.
            التشغيل التلقائي يعمل يومياً الساعة 02:00 (توقيت عدن) عبر جدولة النظام.
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-3 border-red-200 bg-red-50/40">
        <div className="text-lg font-bold text-red-700 flex items-center gap-2"><Trash2 size={20}/> منطقة الخطر</div>
        <div className="text-sm text-slate-700">مسح جميع البيانات السابقة يحذف: العملاء، الموردون، الكروت، المخزون، الفواتير، السندات، الطلبات، الإشعارات. المستخدمون والإعدادات محفوظة.</div>
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogTrigger asChild><Button variant="destructive" data-testid="reset-btn"><Trash2 size={14} className="ml-1"/> مسح جميع البيانات السابقة</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-700">⚠️ عملية غير قابلة للتراجع</AlertDialogTitle>
              <AlertDialogDescription>هذا الإجراء سيحذف جميع بيانات العمليات نهائياً. أدخل بيانات المدير للتأكيد.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <div><Label>اسم المستخدم</Label><Input value={resetForm.username} onChange={(e) => setResetForm({ ...resetForm, username: e.target.value })} data-testid="reset-username"/></div>
              <div><Label>كلمة المرور</Label><Input type="password" value={resetForm.password} onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })} data-testid="reset-password"/></div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={performReset} className="bg-red-600 hover:bg-red-700" data-testid="reset-confirm">تأكيد المسح</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </div>
  );
}
