import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/utils";
import { AlertTriangle, Landmark, Copy, Check, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ONE unified over-credit-limit notice, shared by the card-purchase screen and the
// transfer-to-subscriber screen. Compact, centered, elegant. Shows ONLY:
//   1) the over-limit message
//   2) the account's current balance
//   3) the designated payment (bank) accounts
// The block/prevention logic lives in the caller and is unchanged by this dialog.
export default function OverLimitDialog({ open, onClose, message, customer, opAmount = 0, banks = [] }) {
  const [copied, setCopied] = useState("");

  const balance = Number(customer?.balance || 0); // > 0 = عليكم (owed by the subscriber)
  const balanceWord = balance > 0 ? "عليكم" : balance < 0 ? "لكم" : "متعادل";
  const balanceTone = balance > 0 ? "text-red-700" : balance < 0 ? "text-emerald-700" : "text-slate-600";

  const copy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(key);
      toast.success("تم نسخ رقم الحساب");
      setTimeout(() => setCopied(""), 1500);
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  return (
    <DialogPrimitive.Root open={!!open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-[#1A0F33]/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-testid="over-limit-dialog"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 -translate-y-1/2",
            "max-h-[85vh] overflow-y-auto rounded-2xl border border-[#D4AF37]/50 bg-white shadow-2xl shadow-[#1A0F33]/30",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          )}
          dir="rtl"
        >
          <DialogPrimitive.Close
            className="absolute left-2.5 top-2.5 rounded-full bg-slate-100 p-1 text-slate-500 transition-colors hover:bg-slate-200"
            aria-label="إغلاق"
            data-testid="over-limit-close-x"
          >
            <X size={14} />
          </DialogPrimitive.Close>

          <div className="p-4 text-center">
            {/* icon + title */}
            <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle size={24} />
            </div>
            <DialogPrimitive.Title className="text-base font-black text-[#221340]" data-testid="over-limit-title">
              تجاوز سقف الحساب
            </DialogPrimitive.Title>

            {/* the message */}
            <DialogPrimitive.Description
              className="mt-1.5 whitespace-pre-line text-[13px] font-bold leading-relaxed text-red-700"
              data-testid="over-limit-message"
            >
              {message}
            </DialogPrimitive.Description>

            {/* current balance */}
            <div
              className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center"
              data-testid="over-limit-balance"
            >
              <div className="text-[11px] font-bold text-slate-500">الرصيد الحالي للحساب</div>
              <div className={cn("num mt-0.5 text-lg font-black", balanceTone)}>
                {fmt(Math.abs(balance))} ريال{balance !== 0 && <span className="text-xs"> ({balanceWord})</span>}
              </div>
            </div>

            {/* designated payment accounts */}
            {banks.length > 0 && (
              <div className="mt-3 text-right" data-testid="over-limit-banks">
                <div className="mb-1.5 flex items-center justify-center gap-1 text-[12px] font-black text-[#221340]">
                  <Landmark size={13} className="text-[#D4AF37]" /> ويمكنكم السداد عبر الحسابات البنكية المحددة
                </div>
                <div className="space-y-2">
                  {banks.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-xl border border-amber-200 border-r-4 border-r-[#D4AF37] bg-[#FFFCF3] p-2.5 text-xs"
                      data-testid={`over-limit-bank-${b.id}`}
                    >
                      <div className="font-black text-[#221340]">{b.bank_name}</div>
                      <div className="mt-1 space-y-1">
                        {b.holder_name && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-500">اسم الحساب</span>
                            <span className="font-bold text-[#221340]">{b.holder_name}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">رقم الحساب</span>
                          <span className="flex items-center gap-1.5">
                            <span className="select-all font-mono font-bold text-[#221340]">{b.account_number || "-"}</span>
                            {b.account_number && (
                              <button
                                type="button"
                                onClick={() => copy(b.account_number, b.id)}
                                className="rounded-md bg-[#452480]/10 p-1 text-[#452480] transition-colors hover:bg-[#452480]/20"
                                aria-label="نسخ رقم الحساب"
                                data-testid={`over-limit-copy-${b.id}`}
                              >
                                {copied === b.id ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogPrimitive.Close
              className="mt-4 w-full rounded-xl bg-[#221340] py-2.5 text-sm font-black text-white transition-transform duration-100 active:scale-[0.99]"
              data-testid="over-limit-ok"
            >
              حسنًا
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
