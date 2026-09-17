import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { fmtDate } from "@/lib/utils";
import { Plus, Edit, Power, PowerOff, Trash2, ShieldCheck, Unlock, Smartphone, RotateCcw } from "lucide-react";

const PERMS_LABELS = {
  dashboard: "لوحة التحكم", sales: "المبيعات", purchases: "المشتريات", customers: "العملاء",
  suppliers: "الموردون", stock: "المخزون", categories: "الفئات", receipts: "السندات",
  reports: "التقارير", print_reports: "طباعة التقارير", users: "المستخدمون", settings: "الإعدادات",
  card_orders: "طلبات الكروت", delete_ops: "حذف/إلغاء العمليات", edit_ops: "تعديل العمليات",
  cards: "الكروت", backup: "النسخ الاحتياطي",
};

function UserForm({ initial, allPerms, onSaved, onClose }) {
  const [f, setF] = useState(initial ? { ...initial, password: "" } : { name: "", username: "", email: "", password: "", role: "user", status: "active", permissions: [] });
  const [loading, setLoading] = useState(false);
  const toggle = (p) => setF({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] });
  const submit = async (e) => {
    e.preventDefault();
    const em = (f.email || "").trim();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      toast.error("صيغة البريد الإلكتروني غير صحيحة");
      return;
    }
    setLoading(true);
    try {
      const body = { ...f, email: em };
      if (!body.password && initial?.id) delete body.password;
      if (initial?.id) await api.put(`/users/${initial.id}`, body);
      else await api.post("/users", body);
      toast.success("تم الحفظ"); onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>الاسم</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="usr-name"/></div>
        <div><Label>اسم المستخدم</Label><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required data-testid="usr-username"/></div>
      </div>
      <div><Label>البريد الإلكتروني <span className="text-xs text-slate-400">(يُستخدم لتسجيل الدخول واستقبال النسخ الاحتياطية)</span></Label><Input type="email" value={f.email || ""} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="user@example.com" autoComplete="email" data-testid="usr-email"/></div>
      <div>
        <Label>الدور</Label>
        <div className="flex gap-2 mt-1">
          <label className={`flex-1 flex items-center gap-2 border rounded p-2 cursor-pointer ${f.role==='user' ? 'border-slate-300 bg-slate-50' : 'border-slate-200'}`}>
            <input type="radio" name="role" value="user" checked={f.role==='user'} onChange={() => setF({ ...f, role: 'user' })} data-testid="usr-role-user"/>
            <span className="text-sm">مستخدم عادي</span>
          </label>
          <label className={`flex-1 flex items-center gap-2 border rounded p-2 cursor-pointer ${f.role==='admin' ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}>
            <input type="radio" name="role" value="admin" checked={f.role==='admin'} onChange={() => setF({ ...f, role: 'admin', permissions: [] })} data-testid="usr-role-admin"/>
            <ShieldCheck size={14} className="text-red-600"/>
            <span className="text-sm font-bold">مدير نظام</span>
          </label>
        </div>
        {f.role === 'admin' && <div className="text-[11px] text-red-600 mt-1">تحذير: المدير يملك كل الصلاحيات ولا يحتاج قائمة صلاحيات.</div>}
      </div>
      <div><Label>كلمة المرور {initial?.id && "(اتركها فارغة لعدم التغيير)"}</Label><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required={!initial?.id} data-testid="usr-password"/></div>
      <div>
        <Label>الصلاحيات {f.role === 'admin' && <span className="text-xs text-slate-400">(لا حاجة لها للمدير)</span>}</Label>
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-52 overflow-y-auto p-2 bg-slate-50 rounded ${f.role === 'admin' ? 'opacity-40 pointer-events-none' : ''}`}>
          {allPerms.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <Checkbox checked={f.permissions.includes(p)} onCheckedChange={() => toggle(p)} data-testid={`perm-${p}`}/>
              {PERMS_LABELS[p] || p}
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="usr-save">{loading?"جاري...":"حفظ"}</Button>
    </form>
  );
}

export default function UsersPage() {
  const [items, setItems] = useState([]);
  const [perms, setPerms] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const load = async () => setItems((await api.get("/users")).data);
  useEffect(() => { load(); api.get("/users/permissions/list").then((r) => setPerms(r.data)); }, []);
  const toggleStatus = async (u) => {
    const goDisabled = u.status === "active";
    if (!window.confirm(goDisabled ? `تعطيل حساب "${u.name}"؟ لن يتمكن من تسجيل الدخول.` : `تفعيل حساب "${u.name}" وإعادة السماح له بالدخول؟`)) return;
    try {
      const r = await api.post(`/users/${u.id}/toggle-status`);
      toast.success(r.data?.status === "disabled" ? "تم تعطيل الحساب" : "تم تفعيل الحساب");
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const unlockUser = async (u) => {
    if (!window.confirm(`فك حظر حساب "${u.name}" وإعادة ضبط عداد المحاولات؟`)) return;
    try { await api.post(`/users/${u.id}/unlock`); toast.success("تم فك الحظر"); load(); }
    catch (e) { toast.error(errText(e)); }
  };
  const resetAttempts = async (u) => {
    try { await api.post(`/users/${u.id}/reset-attempts`); toast.success("تم إعادة ضبط عداد المحاولات"); load(); }
    catch (e) { toast.error(errText(e)); }
  };
  const unbindDevice = async (u) => {
    if (!window.confirm(`فك ربط الجهاز عن حساب "${u.name}"؟\nسيتمكن من الدخول من أي جهاز في المرة القادمة.`)) return;
    try { await api.post(`/users/${u.id}/unbind-device`); toast.success("تم فك ربط الجهاز"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const hardDelete = async (u) => {
    if (!window.confirm(`⚠️ حذف نهائي لحساب "${u.name}"؟\nلن يمكن استرجاعه. تأكيد؟`)) return;
    const confirmText = window.prompt(`لتأكيد الحذف النهائي، اكتب اسم المستخدم:\n${u.username}`);
    if (confirmText !== u.username) { toast.error("تم إلغاء الحذف — الاسم غير مطابق."); return; }
    try {
      await api.delete(`/users/${u.id}/permanent`);
      toast.success("تم حذف الحساب نهائياً");
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="space-y-4" data-testid="users-page">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild><Button className="bg-[#221340]" data-testid="add-user-btn"><Plus size={16} className="ml-1"/> إضافة مستخدم</Button></DialogTrigger>
          <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{edit?"تعديل":"مستخدم جديد"}</DialogTitle></DialogHeader>
            <UserForm initial={edit} allPerms={perms} onSaved={load} onClose={() => setOpen(false)}/>
          </DialogContent>
        </Dialog>
      </div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الاسم</th><th className="p-3">المستخدم</th><th className="p-3">الدور</th><th className="p-3">الحالة</th><th className="p-3">المحاولات الفاشلة</th><th className="p-3">الجهاز</th><th className="p-3">آخر دخول</th><th></th></tr></thead>
          <tbody>
            {items.map((u) => {
              const locked = u.locked_until && u.locked_until > new Date().toISOString();
              return (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.name}<div className="text-[11px] text-slate-400 font-mono">{u.email || ""}</div></td>
                <td className="p-3 font-mono">{u.username}</td>
                <td className="p-3">{u.role==='admin'?<span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">مدير</span>:'مستخدم'}</td>
                <td className="p-3">
                  {locked ? <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">محظور</span>
                    : <span className={`text-xs px-2 py-0.5 rounded-full ${u.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{u.status==='active'?'نشط':'معطل'}</span>}
                </td>
                <td className="p-3"><span className={`num text-xs font-bold ${(u.failed_attempts||0)>=3?"text-red-700":"text-slate-600"}`}>{u.failed_attempts || 0} / 5</span></td>
                <td className="p-3 font-mono text-[11px] text-slate-500">{u.bound_device ? u.bound_device.slice(0,12)+"…" : "—"}</td>
                <td className="p-3">{fmtDate(u.last_login)}</td>
                <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                    {locked && <Button size="sm" variant="outline" onClick={() => unlockUser(u)} title="فك الحظر" data-testid={`usr-unlock-${u.id}`} className="border-red-400 hover:bg-red-50"><Unlock size={14} className="text-red-600"/></Button>}
                    {(u.failed_attempts||0) > 0 && !locked && <Button size="sm" variant="outline" onClick={() => resetAttempts(u)} title="إعادة ضبط العداد" data-testid={`usr-reset-${u.id}`}><RotateCcw size={14} className="text-amber-600"/></Button>}
                    {u.bound_device && <Button size="sm" variant="outline" onClick={() => unbindDevice(u)} title="فك ربط الجهاز" data-testid={`usr-unbind-${u.id}`}><Smartphone size={14} className="text-blue-600"/></Button>}
                    <Button size="sm" variant="outline" onClick={() => toggleStatus(u)} data-testid={`usr-toggle-${u.id}`} title={u.status==='active'?'تعطيل':'تفعيل'}>{u.status==='active' ? <PowerOff size={14} className="text-red-600"/> : <Power size={14} className="text-green-600"/>}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEdit(u); setOpen(true); }} title="تعديل"><Edit size={14}/></Button>
                    <Button size="sm" variant="outline" onClick={() => hardDelete(u)} data-testid={`usr-delete-${u.id}`} title="حذف نهائي" className="border-red-300 hover:bg-red-50"><Trash2 size={14} className="text-red-600"/></Button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {items.map((u) => {
          const locked = u.locked_until && u.locked_until > new Date().toISOString();
          return (
          <Card key={u.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-bold truncate">{u.name}</div>
                <div className="text-xs text-slate-500 font-mono truncate">{u.username} • {u.role==='admin'?'مدير':'مستخدم'}</div>
                {u.email && <div className="text-xs text-slate-500 font-mono truncate">{u.email}</div>}
                <div className="text-xs text-slate-400 mt-1">آخر دخول: {fmtDate(u.last_login)}</div>
                <div className="flex gap-2 items-center mt-1 text-[11px]">
                  <span className={`num ${(u.failed_attempts||0)>=3?"text-red-700 font-bold":"text-slate-500"}`}>محاولات: {u.failed_attempts || 0}/5</span>
                  {u.bound_device && <span className="text-blue-600" title={u.bound_device}>• مرتبط</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {locked ? <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">محظور</span>
                  : <span className={`text-[10px] px-2 py-0.5 rounded-full ${u.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{u.status==='active'?'نشط':'معطل'}</span>}
                <div className="flex gap-1">
                  {locked && <Button size="sm" variant="outline" onClick={() => unlockUser(u)} className="border-red-400" data-testid={`usr-unlock-m-${u.id}`}><Unlock size={14} className="text-red-600"/></Button>}
                  {u.bound_device && <Button size="sm" variant="outline" onClick={() => unbindDevice(u)} data-testid={`usr-unbind-m-${u.id}`}><Smartphone size={14} className="text-blue-600"/></Button>}
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(u)} data-testid={`usr-toggle-m-${u.id}`}>{u.status==='active' ? <PowerOff size={14} className="text-red-600"/> : <Power size={14} className="text-green-600"/>}</Button>
                  <Button size="sm" variant="outline" onClick={() => { setEdit(u); setOpen(true); }}><Edit size={14}/></Button>
                  <Button size="sm" variant="outline" onClick={() => hardDelete(u)} data-testid={`usr-delete-m-${u.id}`} className="border-red-300"><Trash2 size={14} className="text-red-600"/></Button>
                </div>
              </div>
            </div>
          </Card>
          );
        })}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا يوجد مستخدمون</div>}
      </div>
    </div>
  );
}
