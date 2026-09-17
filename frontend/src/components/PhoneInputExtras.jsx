import { useState, useEffect } from "react";
import { Heart, Trash2, Plus, BookUser, X } from "lucide-react";
import { toast } from "sonner";

const KEY = "gwd_fav_subscribers";

const loadFavs = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
const saveFavs = (list) => { localStorage.setItem(KEY, JSON.stringify(list)); };

export function SubscriberFavorites({ currentPhone = "", currentName = "", onPick, testidPrefix = "fav" }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);

  useEffect(() => { setList(loadFavs()); }, [open]);

  const add = () => {
    const phone = (currentPhone || "").trim();
    if (!phone) { toast.error("أدخل رقم الهاتف أولاً"); return; }
    const existing = loadFavs();
    if (existing.some((f) => f.phone === phone)) { toast.info("الرقم مضاف مسبقاً"); return; }
    const name = window.prompt("اسم الحساب المميز:", currentName || "");
    if (name === null) return;
    const next = [...existing, { phone, name: (name || "").trim() || phone }];
    saveFavs(next); setList(next);
    toast.success("تمت إضافة الحساب للمميزين");
  };
  const remove = (phone) => {
    const next = loadFavs().filter((f) => f.phone !== phone);
    saveFavs(next); setList(next);
  };
  const pick = (f) => { onPick && onPick(f); setOpen(false); };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-lg border border-pink-300 text-pink-600 hover:bg-pink-50 shrink-0"
        data-testid={`${testidPrefix}-open`}
        title="الحسابات المميزة"
        aria-label="الحسابات المميزة"
      >
        <Heart size={16} fill={list.length > 0 ? "currentColor" : "none"} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 left-0 w-64 bg-white border rounded-lg shadow-xl p-2" data-testid={`${testidPrefix}-panel`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1"><Heart size={12} className="text-pink-600 fill-pink-600" /> الحسابات المميزة</div>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={14} /></button>
            </div>
            <button
              type="button"
              onClick={add}
              className="w-full text-xs bg-pink-600 hover:bg-pink-700 text-white rounded py-1.5 mb-2 flex items-center justify-center gap-1"
              data-testid={`${testidPrefix}-add`}
            >
              <Plus size={12} /> إضافة الرقم الحالي
            </button>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {list.length === 0 && <div className="text-center text-slate-400 text-xs py-3">لا توجد حسابات مميزة</div>}
              {list.map((f) => (
                <div key={f.phone} className="flex items-center gap-1 p-1.5 hover:bg-slate-50 rounded text-sm border border-transparent hover:border-slate-200">
                  <button
                    type="button"
                    onClick={() => pick(f)}
                    className="flex-1 text-right min-w-0"
                    data-testid={`${testidPrefix}-pick-${f.phone}`}
                  >
                    <div className="font-bold text-[#221340] truncate">{f.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{f.phone}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(f.phone)}
                    className="p-1 text-red-500 hover:bg-red-50 rounded shrink-0"
                    data-testid={`${testidPrefix}-del-${f.phone}`}
                    title="حذف"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function ContactPickerButton({ onPick, testid = "contact-pick" }) {
  const supported =
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof navigator.contacts?.select === "function";
  const [busy, setBusy] = useState(false);
  const pick = async () => {
    if (!supported) {
      toast.error("المتصفح لا يدعم اختيار جهات الاتصال. استخدم Chrome على أندرويد.");
      return;
    }
    setBusy(true);
    try {
      const contacts = await navigator.contacts.select(["tel", "name"], { multiple: false });
      if (contacts && contacts.length > 0) {
        const c = contacts[0];
        const tel = Array.isArray(c.tel) ? c.tel[0] : c.tel;
        const nm = Array.isArray(c.name) ? c.name[0] : c.name;
        if (tel) onPick && onPick({ phone: String(tel).replace(/[^0-9+]/g, ""), name: nm || "" });
        else toast.error("لا يوجد رقم في جهة الاتصال");
      }
    } catch (e) {
      if (e?.name !== "AbortError" && e?.name !== "NotAllowedError") toast.error("تعذر فتح جهات الاتصال");
    }
    setBusy(false);
  };
  return (
    <button
      type="button"
      onClick={pick}
      disabled={busy}
      className="p-2 rounded-lg border border-[#452480]/30 text-[#452480] hover:bg-[#452480]/10 disabled:opacity-50 shrink-0"
      data-testid={testid}
      title="اختيار من جهات الاتصال"
      aria-label="اختيار من جهات الاتصال"
    >
      <BookUser size={16} />
    </button>
  );
}
