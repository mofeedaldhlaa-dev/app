import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fmtDate } from "@/lib/utils";
import { Bell, Check, X, UserPlus, MapPin, Phone } from "lucide-react";

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [requests, setRequests] = useState([]);
  const [approvingId, setApprovingId] = useState(null);
  const [approveForm, setApproveForm] = useState({ credit_limit: 500, customer_type: "customer", password: "" });
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "all"; // all | requests

  const load = async () => {
    setItems((await api.get("/notifications")).data);
    try { setRequests((await api.get("/register-requests")).data); } catch {}
  };
  useEffect(() => { load(); }, []);

  // When viewing this page, mark notifications as seen (server-persisted, per-user):
  //  - account_request → mark-category-read (shared task queue counter)
  //  - system notifications → per-user mark-seen (clears the general bell instantly)
  // Then broadcast an event so the header bell refreshes its counters immediately.
  useEffect(() => {
    (async () => {
      try {
        if (tab === "requests" || tab === "all") {
          await api.post("/notifications/mark-category-read", null, { params: { category: "account_request" } });
        }
        if (tab === "general" || tab === "all") {
          await api.post("/notifications/mark-seen");
        }
      } catch {}
      try { window.dispatchEvent(new Event("notif-refresh")); } catch {}
    })();
  }, [tab]);

  const approve = async (rid) => {
    try {
      const r = await api.post(`/register-requests/${rid}/approve`, {
        credit_limit: Number(approveForm.credit_limit) || 0,
        customer_type: approveForm.customer_type,
        password: approveForm.password || null,
      });
      toast.success("تمت الموافقة وإنشاء الحساب");
      // Auto-open WhatsApp welcome message if backend provided the URL
      if (r.data.whatsapp_url) {
        window.open(r.data.whatsapp_url, "_blank");
      }
      setApprovingId(null);
      load();
    } catch (e) { toast.error(errText(e)); }
  };

  const reject = async (rid) => {
    try { await api.post(`/register-requests/${rid}/reject`); toast.success("تم الرفض"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const pending = requests.filter((r) => r.status === "pending");
  // Filter out account_request notifications from the general list (they have their own icon)
  const generalItems = items.filter((n) => n.category !== "account_request");
  const showRequestsOnly = tab === "requests";
  const showGeneralOnly = tab === "general";

  return (
    <div className="space-y-4" data-testid="notifications-page">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap no-print">
        <a href="/notifications?tab=all" className={`px-3 py-1.5 rounded-full text-xs border ${tab==='all'?"bg-[#452480] text-white border-[#452480]":"border-slate-300"}`} data-testid="notif-tab-all">الكل</a>
        <a href="/notifications?tab=requests" className={`px-3 py-1.5 rounded-full text-xs border ${tab==='requests'?"bg-amber-600 text-white border-amber-600":"border-slate-300"}`} data-testid="notif-tab-requests">
          <UserPlus size={12} className="inline ml-1"/>طلبات إنشاء الحساب ({pending.length})
        </a>
        <a href="/notifications?tab=general" className={`px-3 py-1.5 rounded-full text-xs border ${tab==='general'?"bg-[#452480] text-white border-[#452480]":"border-slate-300"}`} data-testid="notif-tab-general">إشعارات النظام</a>
      </div>

      {!showGeneralOnly && pending.length > 0 && (
        <Card className="p-4" data-testid="req-panel">
          <div className="font-bold text-[#221340] mb-3 flex items-center gap-2"><UserPlus size={18} className="text-amber-600"/> طلبات إنشاء حسابات جديدة <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">{pending.length}</span></div>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="border rounded-lg p-3 bg-amber-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2" data-testid={`req-${r.id}`}>
                <div className="flex-1">
                  <div className="font-bold text-[#221340]">{r.full_name}</div>
                  <div className="text-xs text-slate-700 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1"><Phone size={11}/>{r.phone}</span>
                    <span className="flex items-center gap-1"><MapPin size={11}/>{r.address || "-"}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{fmtDate(r.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setApprovingId(r.id)} className="bg-green-600 hover:bg-green-700" data-testid={`req-approve-${r.id}`}><Check size={14} className="ml-1"/> موافقة</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(r.id)} data-testid={`req-reject-${r.id}`}><X size={14}/></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!showRequestsOnly && (
        <div className="space-y-3">
          {generalItems.map((n) => (
            <Card key={n.id} className={`p-4 flex items-start gap-3 ${!n.read ? "border-r-4 border-[#D4AF37]" : ""}`}>
              <Bell className="text-[#D4AF37] mt-0.5" size={18}/>
              <div className="flex-1">
                <div className="font-bold">{n.title}</div>
                <div className="text-sm text-slate-600">{n.message}</div>
                <div className="text-xs text-slate-400 mt-1">{fmtDate(n.created_at)}</div>
              </div>
            </Card>
          ))}
          {generalItems.length === 0 && pending.length === 0 && <div className="text-center text-slate-400 p-8">لا توجد إشعارات</div>}
          {generalItems.length === 0 && pending.length > 0 && !showRequestsOnly && <div className="text-center text-slate-400 p-4 text-sm">لا توجد إشعارات نظام</div>}
        </div>
      )}

      <Dialog open={!!approvingId} onOpenChange={(o) => !o && setApprovingId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>الموافقة على الطلب</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>نوع الحساب</Label>
              <Select value={approveForm.customer_type} onValueChange={(v) => setApproveForm({ ...approveForm, customer_type: v })}>
                <SelectTrigger data-testid="approve-type"><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value="customer">عميل</SelectItem><SelectItem value="pos">نقطة بيع</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>سقف الحساب</Label><Input type="number" value={approveForm.credit_limit} onChange={(e) => setApproveForm({ ...approveForm, credit_limit: e.target.value })} data-testid="approve-limit"/></div>
            <div><Label>كلمة المرور (اتركها فارغة للتوليد)</Label><Input value={approveForm.password} onChange={(e) => setApproveForm({ ...approveForm, password: e.target.value })}/></div>
            <Button onClick={() => approve(approvingId)} className="w-full bg-[#221340]" data-testid="approve-confirm">إنشاء الحساب</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
