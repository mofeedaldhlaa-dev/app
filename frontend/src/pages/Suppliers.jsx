import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { fmt } from "@/lib/utils";
import { Plus, Edit, Trash2 } from "lucide-react";

function SupplierForm({ initial, onSaved, onClose }) {
  const [f, setF] = useState(initial || { name: "", phone: "", credit_limit: 0, opening_balance: 0, address: "", notes: "", status: "active" });
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const body = { ...f, credit_limit: Number(f.credit_limit) || 0, opening_balance: Number(f.opening_balance) || 0 };
      if (initial?.id) await api.put(`/suppliers/${initial.id}`, body);
      else await api.post("/suppliers", body);
      toast.success("تم الحفظ");
      onSaved(); onClose();
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div><Label>اسم المورد *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required data-testid="sup-name" /></div>
      <div><Label>الهاتف</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="sup-phone" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label>سقف الحساب</Label><Input type="number" value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: e.target.value })} /></div>
        <div><Label>الرصيد الافتتاحي</Label><Input type="number" value={f.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} /></div>
      </div>
      <div><Label>العنوان</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <div><Label>ملاحظات</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <Button type="submit" disabled={loading} className="w-full bg-[#221340]" data-testid="sup-save">{loading ? "جاري..." : "حفظ"}</Button>
    </form>
  );
}

export default function Suppliers() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const load = async () => { const r = await api.get("/suppliers"); setItems(r.data); };
  useEffect(() => { load(); }, []);

  const removeSupplier = async (s) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      toast.success(`تم حذف المورد: ${s.name}`);
      load();
    } catch (e) { toast.error(errText(e)); }
  };
  return (
    <div className="space-y-4" data-testid="suppliers-page">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEdit(null); }}>
          <DialogTrigger asChild><Button className="bg-[#221340]" data-testid="add-supplier-btn"><Plus size={16} className="ml-1" /> إضافة مورد</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>{edit ? "تعديل" : "مورد جديد"}</DialogTitle></DialogHeader>
            <SupplierForm initial={edit} onSaved={load} onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الاسم</th><th className="p-3">الهاتف</th><th className="p-3">السقف</th><th className="p-3">الرصيد</th><th></th></tr></thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="p-3 font-medium">{s.name}</td><td className="p-3">{s.phone}</td>
                <td className="p-3 num">{fmt(s.credit_limit)}</td><td className="p-3 num">{fmt(s.balance)}</td>
                <td className="p-3 flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => { setEdit(s); setOpen(true); }} data-testid={`sup-edit-${s.id}`}><Edit size={14}/></Button>
                  <Button size="sm" variant="outline" onClick={() => removeSupplier(s)} data-testid={`sup-delete-${s.id}`} className="border-red-300" title="حذف"><Trash2 size={14} className="text-red-600"/></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-400">لا يوجد موردين</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2">
        {items.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-bold truncate">{s.name}</div>
                <div className="text-xs text-slate-500 truncate">{s.phone}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="outline" onClick={() => { setEdit(s); setOpen(true); }}><Edit size={14}/></Button>
                <Button size="sm" variant="outline" onClick={() => removeSupplier(s)} data-testid={`sup-delete-m-${s.id}`} className="border-red-300"><Trash2 size={14} className="text-red-600"/></Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div><div className="text-slate-500">السقف</div><div className="num font-bold">{fmt(s.credit_limit)}</div></div>
              <div><div className="text-slate-500">الرصيد</div><div className="num font-bold">{fmt(s.balance)}</div></div>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا يوجد موردين</div>}
      </div>
    </div>
  );
}
