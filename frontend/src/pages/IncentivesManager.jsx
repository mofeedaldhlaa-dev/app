import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Plus, Gift, Edit } from "lucide-react";

export default function IncentivesManager() {
  const [settings, setSettings] = useState({ customer_enabled: false, pos_enabled: false, exclude_special_price: false });
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ account_type: "customer", category_id: "", buy_qty: 10, reward_qty: 1, active: true });
  const [editId, setEditId] = useState(null);

  const load = async () => {
    try {
      setSettings((await api.get("/incentive-settings")).data);
      setRules((await api.get("/incentive-rules")).data);
      setCats((await api.get("/categories")).data);
    } catch (e) { toast.error(errText(e)); }
  };
  useEffect(() => { load(); }, []);

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await api.put("/incentive-settings", next); toast.success("تم الحفظ"); }
    catch (e) { toast.error(errText(e)); }
  };

  const saveRule = async () => {
    if (!form.category_id) { toast.error("اختر الفئة"); return; }
    if (Number(form.buy_qty) <= 0 || Number(form.reward_qty) <= 0) { toast.error("الكميات غير صحيحة"); return; }
    const payload = { ...form, buy_qty: Number(form.buy_qty), reward_qty: Number(form.reward_qty) };
    try {
      if (editId) await api.put(`/incentive-rules/${editId}`, payload);
      else await api.post("/incentive-rules", payload);
      toast.success("تم الحفظ");
      setForm({ account_type: form.account_type, category_id: "", buy_qty: 10, reward_qty: 1, active: true });
      setEditId(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const removeRule = async (r) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try { await api.delete(`/incentive-rules/${r.id}`); toast.success("تم الحذف"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const editRule = (r) => { setEditId(r.id); setForm({ ...r }); };
  const cancelEdit = () => { setEditId(null); setForm({ account_type: "customer", category_id: "", buy_qty: 10, reward_qty: 1, active: true }); };

  const custRules = rules.filter((r) => r.account_type === "customer");
  const posRules = rules.filter((r) => r.account_type === "pos");
  const catName = (id) => cats.find((c) => c.id === id)?.name || "-";

  return (
    <Card className="p-4 space-y-4" data-testid="incentives-section">
      <div className="flex items-center gap-2 text-[#221340] font-bold text-lg"><Gift size={20}/> الحوافز</div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="flex items-center gap-2 border rounded-md p-2 bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={!!settings.customer_enabled} onChange={(e) => saveSettings({ customer_enabled: e.target.checked })} data-testid="inc-toggle-customer"/>
          <span className="text-sm">تفعيل حوافز العملاء</span>
        </label>
        <label className="flex items-center gap-2 border rounded-md p-2 bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={!!settings.pos_enabled} onChange={(e) => saveSettings({ pos_enabled: e.target.checked })} data-testid="inc-toggle-pos"/>
          <span className="text-sm">تفعيل حوافز نقاط البيع</span>
        </label>
        <label className="flex items-center gap-2 border rounded-md p-2 bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={!!settings.exclude_special_price} onChange={(e) => saveSettings({ exclude_special_price: e.target.checked })} data-testid="inc-toggle-exclude"/>
          <span className="text-sm">استثناء أصحاب السعر الخاص</span>
        </label>
      </div>

      <div className="border rounded-lg p-3 bg-white">
        <div className="text-sm font-bold text-[#221340] mb-2">{editId ? "تعديل قاعدة" : "إضافة قاعدة جديدة"}</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
          <div><Label className="text-xs">نوع الحساب</Label>
            <select value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value })} className="w-full h-9 border rounded-md px-2 text-sm" data-testid="rule-account-type">
              <option value="customer">عميل</option><option value="pos">نقطة بيع</option>
            </select>
          </div>
          <div><Label className="text-xs">الفئة</Label>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full h-9 border rounded-md px-2 text-sm" data-testid="rule-category">
              <option value="">— اختر —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><Label className="text-xs">كمية الشراء</Label><Input type="number" value={form.buy_qty} onChange={(e) => setForm({ ...form, buy_qty: e.target.value })} data-testid="rule-buy"/></div>
          <div><Label className="text-xs">كمية الحافز</Label><Input type="number" value={form.reward_qty} onChange={(e) => setForm({ ...form, reward_qty: e.target.value })} data-testid="rule-reward"/></div>
          <div className="flex gap-1">
            <Button onClick={saveRule} className="bg-[#221340] flex-1" data-testid="rule-save"><Plus size={14} className="ml-1"/>{editId ? "تحديث" : "إضافة"}</Button>
            {editId && <Button variant="outline" onClick={cancelEdit}>إلغاء</Button>}
          </div>
        </div>
      </div>

      {[["customer","قواعد حوافز العملاء", custRules], ["pos","قواعد حوافز نقاط البيع", posRules]].map(([key, title, list]) => (
        <div key={key} className="border rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-sm font-bold text-[#221340]">{title} ({list.length})</div>
          <div className="divide-y">
            {list.map((r) => (
              <div key={r.id} className="p-2 flex justify-between items-center text-sm" data-testid={`rule-row-${r.id}`}>
                <div>
                  <span className="font-bold">{catName(r.category_id)}</span>
                  <span className="text-slate-500 mx-2">شراء {r.buy_qty} = حافز {r.reward_qty}</span>
                  {!r.active && <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-2 py-0.5">معطل</span>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => editRule(r)} data-testid={`rule-edit-${r.id}`}><Edit size={12}/></Button>
                  <Button size="sm" variant="outline" onClick={() => removeRule(r)} className="border-red-300" data-testid={`rule-delete-${r.id}`}><Trash2 size={12} className="text-red-600"/></Button>
                </div>
              </div>
            ))}
            {list.length === 0 && <div className="p-3 text-center text-slate-400 text-xs">لا توجد قواعد لهذا النوع</div>}
          </div>
        </div>
      ))}
    </Card>
  );
}
