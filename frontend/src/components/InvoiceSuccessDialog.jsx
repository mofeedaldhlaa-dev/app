import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmt } from "@/lib/utils";
import { CheckCircle2, MessageCircle, Printer } from "lucide-react";

export default function InvoiceSuccessDialog({
  open,
  onOpenChange,
  invoice,
  accountName,
  paymentType,
  onWhatsApp,
  onPrint,
}) {
  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden border-0 p-0 sm:max-w-md" data-testid="invoice-success-dialog">
        <div className="bg-gradient-to-l from-emerald-600 to-emerald-500 px-6 py-5 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-xl text-white sm:justify-start">
              <CheckCircle2 size={26} />
              تم حفظ الفاتورة بنجاح
            </DialogTitle>
          </DialogHeader>
          <p className="mt-2 text-center text-sm text-emerald-50 sm:text-right">
            تم تسجيل الفاتورة ومعالجتها ماليًا بنجاح.
          </p>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <div className="-mt-1 grid grid-cols-2 gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3 text-sm">
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <div className="text-xs text-slate-500">رقم الفاتورة</div>
              <div className="mt-1 font-mono font-bold text-[#452480]" data-testid="success-invoice-number">{invoice.number}</div>
            </div>
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <div className="text-xs text-slate-500">نوع الفاتورة</div>
              <div className="mt-1 font-bold" data-testid="success-invoice-type">{paymentType}</div>
            </div>
            <div className="col-span-2 rounded-lg bg-white p-3 shadow-sm">
              <div className="text-xs text-slate-500">اسم الحساب</div>
              <div className="mt-1 font-bold" data-testid="success-account-name">{accountName || "غير محدد"}</div>
            </div>
            <div className="col-span-2 rounded-lg bg-white p-3 shadow-sm">
              <div className="text-xs text-slate-500">مبلغ الفاتورة</div>
              <div className="mt-1 text-2xl font-bold text-emerald-700 num" data-testid="success-invoice-total">{fmt(invoice.total)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              onClick={onWhatsApp}
              className="h-11 bg-green-600 text-white hover:bg-green-700"
              data-testid="success-whatsapp"
            >
              <MessageCircle size={17} className="ml-2" />
              إرسال واتساب
            </Button>
            <Button
              onClick={onPrint}
              className="h-11 bg-[#221340] text-white hover:bg-[#35205c]"
              data-testid="success-print"
            >
              <Printer size={17} className="ml-2" />
              طباعة
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
