import { useEffect, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import InvoiceSuccessDialog from "@/components/InvoiceSuccessDialog";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { buildInvoiceMessage, fmt, fmtDate, openWhatsApp } from "@/lib/utils";
import { Plus, Printer, Eye, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { printPurchase } from "@/lib/print";
import { useAuth } from "@/lib/auth";

export default function Purchases() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [banks, setBanks] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [successInvoice, setSuccessInvoice] = useState(location.state?.savedInvoice || null);
  const [settings, setSettings] = useState({ company_name: "شبكة جواد نت اللاسلكية" });

  const load = () => api.get("/purchases").then((r) => setItems(r.data));
  useEffect(() => {
    load();
    api.get("/suppliers").then((r) => setSuppliers(r.data));
    api.get("/settings").then((r) => setSettings(r.data));
    api.get("/bank-accounts").then((r) => setBanks(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!location.state?.savedInvoice) return;
    setSuccessInvoice(location.state.savedInvoice);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  const doPrint = (p) => {
    const supplier = suppliers.find((s) => s.id === p.supplier_id) || { phone: p.account_phone };
    printPurchase({ purchase: p, supplier, username: user?.name || user?.username, banks });
  };

  const sendWA = (p) => {
    const supplier = suppliers.find((s) => s.id === p.supplier_id);
    const phone = supplier?.phone || p.account_phone;
    if (!phone) { toast.error("لا يوجد رقم هاتف مسجل لهذا الحساب."); return; }
    const details = (p.items || []).map((i) => `${i.category_name} × ${i.quantity} = ${fmt(i.total)}`).join("\n");
    const msg = buildInvoiceMessage({
      company: settings.company_name, number: p.number, kind: "مشتريات",
      details, amount: p.subtotal, discount: p.discount, total: p.total,
      paid: p.paid, remaining: p.remaining,
      balance_after: p.balance_after ?? supplier?.balance,
    });
    openWhatsApp(phone, msg);
  };

  const removePurchase = async (p) => {
    if (!window.confirm("هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن عملية الحذف.")) return;
    try {
      await api.delete(`/purchases/${p.id}`);
      toast.success(`تم حذف فاتورة مشتريات ${p.number}`);
      setViewing(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  return (
    <div className="space-y-4" data-testid="purchases-page">
      <div className="flex justify-end no-print"><Link to="/purchases/new"><Button className="bg-[#221340]" data-testid="new-purchase-btn"><Plus size={16} className="ml-1"/> مشتريات جديدة</Button></Link></div>
      <Card className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr className="text-right"><th className="p-3">الرقم</th><th className="p-3">التاريخ</th><th className="p-3">المورد</th><th className="p-3">النوع</th><th className="p-3">الإجمالي</th><th className="p-3">المدفوع</th><th className="p-3">المتبقي</th><th className="p-3 no-print"></th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-[#452480] font-bold">{p.number}</td>
                <td className="p-3">{fmtDate(p.created_at)}</td>
                <td className="p-3">{p.supplier_name}</td>
                <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${p.purchase_type === "cash" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{p.purchase_type === "cash" ? "نقد" : "آجل"}</span></td>
                <td className="p-3 num">{fmt(p.total)}</td>
                <td className="p-3 num">{fmt(p.paid)}</td>
                <td className="p-3 num text-amber-700">{fmt(p.remaining)}</td>
                <td className="p-3 no-print flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setViewing(p)} data-testid={`purch-view-${p.id}`}><Eye size={12}/></Button>
                  <Link to={`/purchases/${p.id}/edit`}><Button size="sm" variant="outline" data-testid={`purch-edit-${p.id}`}><Edit size={12}/></Button></Link>
                  <Button size="sm" variant="outline" onClick={() => doPrint(p)} data-testid={`purch-print-${p.id}`}><Printer size={12}/></Button>
                  <Button size="sm" variant="outline" onClick={() => removePurchase(p)} data-testid={`purch-delete-${p.id}`} className="border-red-300" title="حذف"><Trash2 size={12} className="text-red-600"/></Button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">لا توجد فواتير مشتريات</td></tr>}
          </tbody>
        </table>
      </Card>
      <div className="md:hidden space-y-2 no-print">
        {items.map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-bold text-[#452480] truncate">{p.number}</div>
                <div className="text-xs text-slate-500 truncate">{p.supplier_name} • {fmtDate(p.created_at)}</div>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] ${p.purchase_type === "cash" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{p.purchase_type === "cash" ? "نقد" : "آجل"}</span>
              </div>
              <div className="text-left text-xs shrink-0">
                <div>الإجمالي: <span className="num font-bold">{fmt(p.total)}</span></div>
                <div className="text-amber-700">المتبقي: <span className="num font-bold">{fmt(p.remaining)}</span></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Button size="sm" variant="outline" onClick={() => setViewing(p)}><Eye size={12} className="ml-1"/> عرض</Button>
              <Link to={`/purchases/${p.id}/edit`}><Button size="sm" variant="outline"><Edit size={12} className="ml-1"/> تعديل</Button></Link>
              <Button size="sm" variant="outline" onClick={() => doPrint(p)}><Printer size={12} className="ml-1"/> طباعة</Button>
              <Button size="sm" variant="outline" onClick={() => removePurchase(p)} data-testid={`purch-delete-m-${p.id}`} className="border-red-300"><Trash2 size={12} className="ml-1 text-red-600"/> حذف</Button>
            </div>
          </Card>
        ))}
        {items.length === 0 && <div className="text-center text-slate-400 p-6">لا توجد فواتير مشتريات</div>}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>فاتورة مشتريات {viewing?.number}</DialogTitle></DialogHeader>
          {viewing && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>التاريخ</span><span>{fmtDate(viewing.created_at)}</span></div>
                <div className="flex justify-between"><span>المورد</span><span>{viewing.supplier_name}</span></div>
                <div className="flex justify-between"><span>النوع</span><span>{viewing.purchase_type === "cash" ? "نقد" : "آجل"}</span></div>
              <div className="border-t pt-2">
                {(viewing.items || []).map((it, i) => (
                  <div key={i} className="flex justify-between py-1"><span>{it.category_name} × {it.quantity}</span><span className="num">{fmt(it.total)}</span></div>
                ))}
              </div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>الإجمالي</span><span className="num font-bold">{fmt(viewing.total)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between"><span>الخصم</span><span className="num">{fmt(viewing.discount)}</span></div>}
                <div className="flex justify-between"><span>المدفوع</span><span className="num">{fmt(viewing.paid)}</span></div>
                <div className="flex justify-between"><span>المتبقي</span><span className="num font-bold text-amber-700">{fmt(viewing.remaining)}</span></div>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button onClick={() => doPrint(viewing)} className="bg-[#221340] flex-1 min-w-[120px]"><Printer size={14} className="ml-1"/> طباعة</Button>
                <Link to={`/purchases/${viewing.id}/edit`} className="flex-1 min-w-[120px]"><Button variant="outline" className="w-full"><Edit size={14} className="ml-1"/> تعديل الفاتورة</Button></Link>
                <Button onClick={() => removePurchase(viewing)} variant="outline" className="border-red-500 text-red-700 flex-1 min-w-[120px]" data-testid="purch-delete-view"><Trash2 size={14} className="ml-1"/> حذف الفاتورة</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InvoiceSuccessDialog
        open={!!successInvoice}
        onOpenChange={(open) => !open && setSuccessInvoice(null)}
        invoice={successInvoice}
        accountName={successInvoice?.supplier_name}
        paymentType={successInvoice?.purchase_type === "cash" ? "نقد" : "آجل"}
        onWhatsApp={() => successInvoice && sendWA(successInvoice)}
        onPrint={() => successInvoice && doPrint(successInvoice)}
      />

    </div>
  );
}
