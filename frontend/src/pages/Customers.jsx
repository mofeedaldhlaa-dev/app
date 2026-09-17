import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Link } from "react-router-dom";
import { Search, Plus, FileText, Edit, KeyRound, Eye, Power, PowerOff, Trash2 } from "lucide-react";

function SpecialPricesEditor({ f, setF }) {
  const [cats, setCats] = useState([]);
  useEffect(() => { api.get("/categories").then((r) => setCats(r.data)).catch(() => {}); }, []);
  const list = f.special_prices || [];
  const setList = (v) => setF({ ...f, special_prices: v });
  const addRow = () => setList([...list, { category_id: "", price: 0 }]);
  const upd = (i, key, val) => setList(list.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const rm = (i) => setList(list.filter((_, idx) => idx !== i));
  if (!f.special_prices_enabled) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-3 space-y-2" data-testid="cust-special-prices">
      <div className="flex justify-between items-center">
        <div className="text-sm font-bold text-[#221340]">الأسعار الخاصة</div>
        <Button type="button" size="sm" variant="outline" onClick={addRow} data-testid="sp-add">+ إضافة سعر</Button>
      </div>
      {list.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
          <select value={row.category_id} onChange={(e) => upd(i, "category_id", e.target.value)} className="h-9 border rounded-md px-2 text-sm" data-testid={`sp-cat-${i}`}>
            <option value="">— اختر الفئة —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Input type="number" value={row.price} onChange={(e) => upd(i, "price", Number(e.target.value) || 0)} placeholder="السعر" className="w-28" data-testid={`sp-price-${i}`}/>
          <Button type="button" size="sm" variant="outline" onClick={() => rm(i)} className="border-red-300" data-testid={`sp-del-${i}`}><Trash2 size={12} className="text-red-600"/></Button>
        </div>
      ))}
      {list.length === 0 && <div className="text-xs text-slate-500 text-center py-2">لا توجد أسعار خاصة — اضغط "إضافة سعر" لبدء التخصيص</div>}
      <div className="text-[11px] text-slate-500">الفئات التي لم تُحدَّد لها سعر خاص تستخدم السعر العادي تلقائياً.</div>
    </div>
  );
}

function CustomerForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial || { name: "", phone: "", password: "", credit_limit: 500, opening_balance: 0, address: "", notes: "", status: "active", customer_type: "customer", special_prices_enabled: false, special_prices: [], incentives_visible: true });
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { ...f, credit_limit: Number(f.credit_limit) || 0, opening_balance: Number(f.opening_balance) || 0, special_prices_enabled: !!f.special_prices_enabled, incentives_visible: f.incentives_visible !== false, special_prices: (f.special_prices || []).filter((r) => r.category_id && Number(r.price) > 0).map((r) => ({ category_id: r.category_id, price: Number(r.price) })) };
      if (initial?.id) await api.put(`/customers/${initial.id}`, body);
      else await api.post("/customers", body);
      toast.success("تم الحفظ بنجاح");
      onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3" data-testid="customer-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>الاسم *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="cust-name" /></div>
        <div><Label>نوع الحساب</Label>
          <Select value={f.customer_type || "customer"} onValueChange={(v) => setF({ ...f, customer_type: v })}>
            <SelectTrigger data-testid="cust-type"><SelectValue/></SelectTrigger>
            <SelectContent><SelectItem value="customer">عميل</SelectItem><SelectItem value="pos">نقطة بيع</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div><Label>رقم الهاتف</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="cust-phone" /></div>
      {!initial?.id && <div><Label>كلمة المرور (اتركها فارغة للتوليد)</Label><Input value={f.password || ""} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="JWDXXXXX" data-testid="cust-password" /></div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>سقف الحساب</Label><Input type="number" value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value })} data-testid="cust-limit" /></div>
        <div><Label>الرصيد الافتتاحي</Label><Input type="number" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} data-testid="cust-opening" /></div>
      </div>
      <div><Label>العنوان</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <label className="flex items-center gap-2 text-sm cursor-pointer border rounded-md p-2 bg-slate-50">
        <input type="checkbox" checked={!!f.special_prices_enabled} onChange={(e) => setF({ ...f, special_prices_enabled: e.target.checked })} data-testid="cust-special-toggle"/>
        <span className="font-bold text-[#221340]">تفعيل سعر خاص</span>
        {f.special_prices_enabled && <span className="text-[10px] bg-amber-500 text-white rounded-full px-2 py-0.5 mr-auto">مفعل</span>}
      </label>
      <SpecialPricesEditor f={f} setF={setF}/>
      <div>
        <Label>الحوافز</Label>
        <Select value={f.incentives_visible === false ? "hide" : "show"} onValueChange={(v) => setF({ ...f, incentives_visible: v === "show" })}>
          <SelectTrigger data-testid="cust-incentives-visible"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="show">إظهار الحوافز</SelectItem>
            <SelectItem value="hide">إخفاء الحوافز</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-[10px] text-slate-500 mt-1">يخفي أيقونة الحوافز في نافذة طلب الكرت للعميل. لا يحذف السجلات.</div>
      </div>
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="cust-save">{loading ? "جاري..." : "حفظ"}</Button>
    </form>
  );
}

function PasswordDialog({ customer, onClose, onSaved }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [unbinding, setUnbinding] = useState(false);
  const save = async () => {
    if (pwd !== confirm) { toast.error("كلمة المرور وتأكيدها غير متطابقين"); return; }
    if (pwd.length < 4) { toast.error("كلمة المرور قصيرة"); return; }
    try {
      const r = await api.post(`/customers/${customer.id}/password`, { password: pwd });
      toast.success("تم تغيير كلمة المرور");
      if (r.data?.whatsapp_url) window.open(r.data.whatsapp_url, "_blank");
      onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
  };
  const unbind = async () => {
    if (!window.confirm(`إلغاء ربط الجهاز الحالي عن ${customer.name}؟\nسيتمكن العميل من تسجيل الدخول من جهاز جديد وسيُربط تلقائياً.`)) return;
    setUnbinding(true);
    try {
      const r = await api.post(`/customers/${customer.id}/unbind-device`);
      toast.success("تم إلغاء ربط الجهاز. يمكن للعميل الآن تسجيل الدخول من جهاز جديد.");
      if (r.data?.whatsapp_url) window.open(r.data.whatsapp_url, "_blank");
      onSaved();
    } catch (e) { toast.error(errText(e)); }
    setUnbinding(false);
  };
  const isBound = !!customer?.bound_device;
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>إدارة حساب {customer?.name}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="font-bold text-sm text-[#221340]">تغيير كلمة المرور</div>
            <div><Label>كلمة المرور الجديدة</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} data-testid="admin-cust-pwd"/></div>
            <div><Label>تأكيد كلمة المرور</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="admin-cust-pwd-confirm"/></div>
            <Button onClick={save} className="w-full bg-[#221340]" data-testid="admin-cust-pwd-save">حفظ كلمة المرور</Button>
          </div>
          <div className="border-t pt-4 space-y-2">
            <div className="font-bold text-sm text-[#221340]">ربط الجهاز</div>
            <div className="text-xs text-slate-600">
              {isBound
                ? <>الجهاز الحالي: <span className="font-mono bg-slate-100 px-2 py-0.5 rounded" data-testid="cust-bound-device">{String(customer.bound_device).slice(0, 24)}…</span></>
                : <span className="text-amber-700">لا يوجد جهاز مرتبط — سيُربط تلقائياً بعد أول تسجيل دخول ناجح.</span>}
            </div>
            <Button onClick={unbind} disabled={unbinding || !isBound} variant="outline" className="w-full border-amber-500 text-amber-700 disabled:opacity-50" data-testid="admin-cust-unbind">
              {unbinding ? "جاري..." : "إلغاء ربط الجهاز الحالي"}
            </Button>
            <div className="text-[11px] text-slate-500">استخدم هذا الخيار عندما يستبدل العميل هاتفه القديم. سيتمكن من تسجيل الدخول من الجهاز الجديد بكلمة المرور، وسيُربط تلقائياً.</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RevealButton({ id }) {
  const [pwd, setPwd] = useState(null);
  const reveal = async () => {
    try { const r = await api.get(`/customers/${id}/password`); setPwd(r.data.password); setTimeout(() => setPwd(null), 6000); }
    catch (e) { toast.error(errText(e)); }
  };
  return pwd ? <span className="font-mono text-xs bg-amber-100 px-2 py-1 rounded">{pwd}</span>
             : <Button size="sm" variant="outline" onClick={reveal} data-testid={`cust-reveal-${id}`}><Eye size={12}/></Button>;
}

// Mobile-friendly inline reveal: shows dots + explicit label button that toggles
function RevealButtonInline({ id, testid }) {
  const [pwd, setPwd] = useState(null);
  const toggle = async () => {
    if (pwd) { setPwd(null); return; }
    try { const r = await api.get(`/customers/${id}/password`); setPwd(r.data.password); }
    catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded select-all break-all" data-testid={`${testid}-value`}>
        {pwd || "••••••••"}
      </span>
      <Button size="sm" variant="outline" onClick={toggle} data-testid={testid}>
        <Eye size={12} className="ml-1"/> {pwd ? "إخفاء" : "مشاهدة"}
      </Button>
    </div>
  );
}

export default function Customers() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pwdCustomer, setPwdCustomer] = useState(null);

  const load = async () => setItems((await api.get("/customers")).data);
  useEffect(() => { load(); }, []);

  const toggleStatus = async (c) => {
    const goDisabled = c.status === "active";
    if (!window.confirm(goDisabled ? `تعطيل حساب العميل "${c.name}"؟ لن يتمكن من تسجيل الدخول أو الشراء.` : `تفعيل حساب العميل "${c.name}"؟`)) return;
    try {
      const r = await api.post(`/customers/${c.id}/toggle-status`);
      toast.success(r.data?.status === "disabled" ? "تم تعطيل الحساب" : "تم تفعيل الحساب");
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const removeCustomer = async (c) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/customers/${c.id}`);
      toast.success(`تم حذف العميل: ${c.name}`);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const filtered = items.filter((c) => (!q || c.name.includes(q) || (c.phone || "").includes(q)) && (typeFilter === "all" || (c.customer_type || "customer") === typeFilter));

  return (
    <div className="space-y-4" data-testid="customers-page">
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={18} />
            <Input placeholder="بحث بالاسم أو الهاتف..." value={q} onChange={(e) => setQ(e.target.value)} className="pr-10" data-testid="cust-search" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="customer">عملاء</SelectItem>
              <SelectItem value="pos">نقاط بيع</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild>
            <Button className="bg-[#221340]" data-testid="add-customer-btn"><Plus size={16} className="ml-1" /> إضافة عميل</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{edit ? "تعديل عميل" : "إضافة عميل جديد"}</DialogTitle></DialogHeader>
            <CustomerForm initial={edit} onSaved={load} onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <Card className="overflow-hidden">
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-right">
                <th className="p-3">الاسم</th><th className="p-3">النوع</th><th className="p-3">الهاتف</th><th className="p-3">السقف</th>
                <th className="p-3">المديونية</th><th className="p-3">المتاح</th><th className="p-3">الحالة</th><th className="p-3">كلمة المرور</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className={`border-t border-slate-100 ${c.status==='disabled' ? 'opacity-60 bg-red-50/30' : ''}`} data-testid={`cust-row-${c.id}`}>
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${(c.customer_type||'customer')==='pos'?'bg-purple-100 text-purple-700':'bg-blue-100 text-blue-700'}`}>{(c.customer_type||'customer')==='pos'?'نقطة بيع':'عميل'}</span></td>
                  <td className="p-3">{c.phone}</td>
                  <td className="p-3 num">{fmt(c.credit_limit)}</td>
                  <td className="p-3 num">{fmt(c.balance)}</td>
                  <td className="p-3 num text-green-700">{fmt(Math.max(0, (c.credit_limit || 0) - (c.balance || 0)))}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${c.status==='active'?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{c.status==='active'?'نشط':'معطل'}</span></td>
                  <td className="p-3"><RevealButton id={c.id}/></td>
                  <td className="p-3 flex gap-2">
                    <Link to={`/customers/${c.id}`}><Button size="sm" variant="outline" data-testid={`cust-stmt-${c.id}`}><FileText size={14} /></Button></Link>
                    <Button size="sm" variant="outline" onClick={() => { setEdit(c); setOpen(true); }} data-testid={`cust-edit-${c.id}`}><Edit size={14} /></Button>
                    <Button size="sm" variant="outline" onClick={() => setPwdCustomer(c)} data-testid={`cust-pwd-${c.id}`}><KeyRound size={14} /></Button>
                    <Button size="sm" variant="outline" onClick={() => toggleStatus(c)} data-testid={`cust-toggle-${c.id}`} title={c.status==='active'?'تعطيل':'تفعيل'}>{c.status==='active' ? <PowerOff size={14} className="text-red-600"/> : <Power size={14} className="text-green-600"/>}</Button>
                    <Button size="sm" variant="outline" onClick={() => removeCustomer(c)} data-testid={`cust-delete-${c.id}`} title="حذف" className="border-red-300"><Trash2 size={14} className="text-red-600"/></Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-400">لا يوجد عملاء</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y">
          {filtered.map((c) => (
            <div key={c.id} className={`p-3 ${c.status==='disabled'?'opacity-60 bg-red-50/30':''}`} data-testid={`cust-card-${c.id}`}>
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-bold truncate flex items-center gap-2">{c.name} <span className="text-xs text-slate-500">({(c.customer_type||'customer')==='pos'?'نقطة بيع':'عميل'})</span>{c.status==='disabled' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">معطل</span>}</div>
                  <div className="text-xs text-slate-500 truncate">{c.phone}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Link to={`/customers/${c.id}`}><Button size="sm" variant="outline"><FileText size={14} /></Button></Link>
                  <Button size="sm" variant="outline" onClick={() => { setEdit(c); setOpen(true); }}><Edit size={14} /></Button>
                  <Button size="sm" variant="outline" onClick={() => setPwdCustomer(c)}><KeyRound size={14} /></Button>
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(c)} data-testid={`cust-toggle-m-${c.id}`}>{c.status==='active' ? <PowerOff size={14} className="text-red-600"/> : <Power size={14} className="text-green-600"/>}</Button>
                  <Button size="sm" variant="outline" onClick={() => removeCustomer(c)} data-testid={`cust-delete-m-${c.id}`} className="border-red-300"><Trash2 size={14} className="text-red-600"/></Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                <div><div className="text-slate-500">السقف</div><div className="num font-bold">{fmt(c.credit_limit)}</div></div>
                <div><div className="text-slate-500">المديونية</div><div className="num font-bold">{fmt(c.balance)}</div></div>
                <div><div className="text-slate-500">المتاح</div><div className="num font-bold text-green-700">{fmt(Math.max(0, (c.credit_limit || 0) - (c.balance || 0)))}</div></div>
              </div>
              <div className="mt-2 pt-2 border-t flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-slate-500 shrink-0">كلمة المرور</span>
                <RevealButtonInline id={c.id} testid={`cust-reveal-m-${c.id}`} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {pwdCustomer && <PasswordDialog customer={pwdCustomer} onClose={() => setPwdCustomer(null)} onSaved={load}/>}
    </div>
  );
}
