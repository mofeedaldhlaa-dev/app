import { useEffect, useRef, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useNavigate, useParams } from "react-router-dom";
import { fmt, genUUID, deviceId } from "@/lib/utils";
import { Plus, Trash2, Save } from "lucide-react";

export default function PurchaseForm() {
  const nav = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;

  const [cats, setCats] = useState([]);
  const [sups, setSups] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseType, setPurchaseType] = useState("");
  const [items, setItems] = useState([{ category_id: "", quantity: 1, price: 0, use_numbered: false, card_numbers_text: "" }]);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [origNumber, setOrigNumber] = useState("");
  const requestKey = useRef(genUUID());

  useEffect(() => {
    api.get("/categories").then((r) => setCats(r.data));
    api.get("/suppliers").then((r) => setSups(r.data));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/purchases/${editId}`).then((r) => {
      const p = r.data;
      setOrigNumber(p.number || "");
      setSupplierId(p.supplier_id || "");
      setPurchaseType(p.purchase_type || "credit");
      setDiscount(p.discount || 0);
      setPaid(p.paid || 0);
      setNotes(p.notes || "");
      setItems((p.items || []).map((it) => ({
        category_id: it.category_id, quantity: it.quantity, price: it.price,
        use_numbered: !!it.use_numbered,
        card_numbers_text: (it.card_numbers || []).join("\n"),
      })));
    }).catch((e) => { toast.error(errText(e)); nav("/purchases"); });
  }, [editId]);

  const update = (i, k, v) => {
    const c = [...items]; c[i] = { ...c[i], [k]: v };
    if (k === "category_id") { const cat = cats.find(x => x.id === v); if (cat) c[i].price = cat.purchase_price; }
    setItems(c);
  };

  const subtotal = items.reduce((s, i) => {
    const q = i.use_numbered ? (i.card_numbers_text || "").split(/\r?\n/).filter((x) => x.trim()).length : Number(i.quantity) || 0;
    return s + q * (Number(i.price) || 0);
  }, 0);
  const total = subtotal - (Number(discount) || 0);
  const effectivePaid = purchaseType === "cash" ? total : Math.min(Math.max(Number(paid) || 0, 0), total);
  const remaining = purchaseType === "cash" ? 0 : Math.max(total - effectivePaid, 0);
  const supplier = sups.find((s) => s.id === supplierId);

  const payload = () => {
    const finalItems = items.map((i) => {
      const nums = (i.card_numbers_text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const q = i.use_numbered ? nums.length : Number(i.quantity);
      return {
        category_id: i.category_id, quantity: q, price: Number(i.price),
        category_name: cats.find((c) => c.id === i.category_id)?.name || "",
        use_numbered: i.use_numbered, card_numbers: i.use_numbered ? nums : [],
      };
    });
    return {
      supplier_id: supplierId || null, supplier_name: supplier?.name || "",
      purchase_type: purchaseType,
      items: finalItems, discount: Number(discount) || 0, paid: effectivePaid, notes,
    };
  };

  const submitCreate = async () => {
    setLoading(true);
    try {
      const r = await api.post("/purchases", { ...payload(), idempotency_key: requestKey.current, device_id: deviceId() });
      nav("/purchases", { state: { savedInvoice: { ...r.data, account_phone: supplier?.phone || "" } } });
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  const submitEdit = async () => {
    setConfirmOpen(false);
    setLoading(true);
    try {
      const r = await api.put(`/purchases/${editId}`, payload());
      nav("/purchases", { state: { savedInvoice: { ...r.data, account_phone: supplier?.phone || "" } } });
    } catch (e) { toast.error(errText(e)); }
    setLoading(false);
  };
  const submit = () => {
    if (!purchaseType) { toast.error("يرجى اختيار نوع الفاتورة: نقد أو آجل."); return; }
    if (items.some((i) => !i.category_id)) { toast.error("أكمل بيانات الأصناف"); return; }
    if (isEdit) setConfirmOpen(true);
    else submitCreate();
  };

  return (
    <Card className="p-4 md:p-6 space-y-4 max-w-4xl" data-testid="purchase-form">
      {isEdit && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
          وضع التعديل — فاتورة مشتريات رقم <span className="font-mono font-bold text-[#452480]" data-testid="purch-edit-number">{origNumber}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label>المورد</Label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger data-testid="purch-supplier"><SelectValue placeholder="اختر المورد" /></SelectTrigger>
            <SelectContent>{sups.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>نوع الفاتورة *</Label>
          <Select value={purchaseType} onValueChange={(value) => { setPurchaseType(value); if (value === "cash") setPaid(0); }}>
            <SelectTrigger data-testid="purch-type"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">نقد</SelectItem>
              <SelectItem value="credit">آجل</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between"><div className="font-bold">الأصناف</div><Button size="sm" onClick={() => setItems([...items, { category_id: "", quantity: 1, price: 0, use_numbered: false, card_numbers_text: "" }])}><Plus size={14}/></Button></div>
        {items.map((it, i) => (
          <Card key={i} className="p-3 bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-center">
              <div className="sm:col-span-2 md:col-span-1">
                <Select value={it.category_id} onValueChange={(v) => update(i, "category_id", v)}>
                  <SelectTrigger data-testid={`purch-item-cat-${i}`}><SelectValue placeholder="الفئة"/></SelectTrigger>
                  <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input type="number" placeholder="الكمية" value={it.use_numbered ? (it.card_numbers_text || "").split(/\r?\n/).filter((x) => x.trim()).length : it.quantity} onChange={(e) => update(i, "quantity", e.target.value)} disabled={it.use_numbered} data-testid={`purch-qty-${i}`}/>
              <Input type="number" placeholder="سعر الشراء" value={it.price} onChange={(e) => update(i, "price", e.target.value)}/>
              <div className="num font-bold px-2 h-10 flex items-center bg-white rounded border">{fmt((it.use_numbered ? (it.card_numbers_text || "").split(/\r?\n/).filter((x) => x.trim()).length : it.quantity) * it.price)}</div>
              <Button variant="ghost" onClick={() => setItems(items.filter((_, x) => x !== i))} className="justify-self-start sm:justify-self-auto"><Trash2 size={14} className="text-red-500"/> <span className="sm:hidden mr-1">حذف</span></Button>
            </div>
            <div className="mt-2 text-xs">
              <label className="flex items-center gap-2"><input type="checkbox" checked={it.use_numbered} onChange={(e) => update(i, "use_numbered", e.target.checked)} data-testid={`purch-numbered-${i}`}/> شراء كروت مرقمة (ألصق الأرقام)</label>
              {it.use_numbered && <Textarea rows={4} value={it.card_numbers_text || ""} onChange={(e) => update(i, "card_numbers_text", e.target.value)} placeholder="7777665544&#10;5563737380" className="mt-2 font-mono text-xs" data-testid={`purch-numbers-${i}`}/>}
            </div>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><Label>الخصم</Label><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)}/></div>
        <div><Label>المدفوع</Label><Input type="number" value={purchaseType === "cash" ? total : paid} onChange={(e) => setPaid(e.target.value)} disabled={purchaseType === "cash"}/></div>
        <div><Label>الإجمالي</Label><div className="h-10 flex items-center px-3 bg-slate-100 rounded num font-bold">{fmt(total)}</div></div>
        <div><Label>المتبقي</Label><div className="h-10 flex items-center px-3 bg-slate-100 rounded num font-bold">{fmt(remaining)}</div></div>
      </div>
      <Textarea placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)}/>
      <Button onClick={submit} disabled={loading} className="bg-[#221340] w-full sm:w-auto" data-testid="purch-save"><Save size={16} className="ml-1"/> {loading ? "جاري..." : (isEdit ? "حفظ التعديل" : "حفظ")}</Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حفظ تعديلات فاتورة المشتريات {origNumber}</AlertDialogTitle>
            <AlertDialogDescription>
              سيؤدي حفظ التعديل إلى تحديث المخزون وحساب المورد والمديونية وإجمالي المشتريات
              وتكلفة المخزون والتقارير المرتبطة بالفاتورة. لا يتراجع النظام تلقائياً بعد الحفظ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="purch-edit-cancel">إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={submitEdit} className="bg-[#221340]" data-testid="purch-edit-confirm">تأكيد وحفظ</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
