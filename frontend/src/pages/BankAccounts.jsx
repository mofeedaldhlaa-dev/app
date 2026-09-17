import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Landmark, Plus, Edit, Trash2, Power, PowerOff } from "lucide-react";

const SHOW_IN_OPTIONS = [
  { key: "invoices", label: "أسفل الفواتير" },
  { key: "receipts", label: "أسفل السندات" },
  { key: "payment_requests", label: "في طلبات السداد" },
  { key: "over_limit", label: "إشعارات تجاوز السقف وطلبات السداد" },
];

const EMPTY = { bank_name: "", holder_name: "", account_number: "", details: "", active: true, show_in: [] };

export default function BankAccounts() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);

  const load = async () => { try { setItems((await api.get("/bank-accounts")).data); } catch (e) { toast.error(errText(e)); } };
  useEffect(() => { load(); }, []);

  const startEdit = (b) => { setEditId(b.id); setForm({ ...EMPTY, ...b, show_in: b.show_in || [] }); setOpen(true); };
  const startNew = () => { setEditId(null); setForm(EMPTY); setOpen(true); };

  const toggleShow = (k) => setForm((f) => {
    const s = new Set(f.show_in || []);
    if (s.has(k)) s.delete(k); else s.add(k);
    return { ...f, show_in: Array.from(s) };
  });

  const save = async () => {
    if (!form.bank_name || !form.account_number) { toast.error("أدخل اسم البنك ورقم الحساب"); return; }
    try {
      if (editId) await api.put(`/bank-accounts/${editId}`, form);
      else await api.post("/bank-accounts", form);
      toast.success("تم الحفظ"); setOpen(false); load();
    } catch (e) { toast.error(errText(e)); }
  };

  const remove = async (b) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try { await api.delete(`/bank-accounts/${b.id}`); toast.success("تم الحذف"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const toggleActive = async (b) => {
    try { await api.put(`/bank-accounts/${b.id}`, { ...b, active: !b.active }); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  return (
    <div className="space-y-4" data-testid="banks-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[#221340] font-bold text-lg"><Landmark size={20}/> الحسابات البنكية</div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#221340]" onClick={startNew} data-testid="bank-add"><Plus size={16} className="ml-1"/> إضافة حساب بنكي</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "تعديل حساب بنكي" : "حساب بنكي جديد"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>اسم البنك *</Label><Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} data-testid="bank-name"/></div>
              <div><Label>اسم الحساب / صاحب الحساب *</Label><Input value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} data-testid="bank-holder"/></div>
              <div><Label>رقم الحساب *</Label><Input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} data-testid="bank-number" className="font-mono"/></div>
              <div><Label>تفاصيل الحساب</Label><Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="IBAN، فرع، ملاحظات..." data-testid="bank-details"/></div>
              <div>
                <Label>أماكن ظهور بيانات الحساب</Label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SHOW_IN_OPTIONS.map((o) => (
                    <label key={o.key} className={`flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm ${form.show_in?.includes(o.key) ? "border-[#452480] bg-[#452480]/10" : "border-slate-200"}`}>
                      <input type="checkbox" checked={form.show_in?.includes(o.key) || false} onChange={() => toggleShow(o.key)} data-testid={`bank-show-${o.key}`}/>
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="bank-active"/>
                <span>الحساب مفعّل</span>
              </label>
              <Button onClick={save} className="w-full bg-[#221340]" data-testid="bank-save">حفظ</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((b) => (
          <Card key={b.id} className={`p-4 ${!b.active ? "opacity-60 bg-slate-50" : ""}`} data-testid={`bank-row-${b.id}`}>
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[#221340] text-base">{b.bank_name}</div>
                <div className="text-sm text-slate-600 mt-0.5">{b.holder_name}</div>
                <div className="font-mono text-sm mt-1 select-all break-all" data-testid={`bank-num-${b.id}`}>{b.account_number}</div>
                {b.details && <div className="text-xs text-slate-500 mt-1 whitespace-pre-line">{b.details}</div>}
                <div className="flex flex-wrap gap-1 mt-2">
                  {(b.show_in || []).map((s) => (
                    <span key={s} className="text-[10px] bg-[#452480]/10 text-[#452480] rounded-full px-2 py-0.5">
                      {SHOW_IN_OPTIONS.find((o) => o.key === s)?.label || s}
                    </span>
                  ))}
                  {(!b.show_in || b.show_in.length === 0) && <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">لا يظهر في أي مكان</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => startEdit(b)} data-testid={`bank-edit-${b.id}`}><Edit size={12}/></Button>
                <Button size="sm" variant="outline" onClick={() => toggleActive(b)} data-testid={`bank-toggle-${b.id}`} title={b.active ? "تعطيل" : "تفعيل"}>
                  {b.active ? <PowerOff size={12} className="text-red-600"/> : <Power size={12} className="text-green-600"/>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => remove(b)} data-testid={`bank-delete-${b.id}`} className="border-red-300"><Trash2 size={12} className="text-red-600"/></Button>
              </div>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-slate-400 p-8">لا توجد حسابات بنكية — أضف واحداً أعلاه</div>}
      </div>
    </div>
  );
}
