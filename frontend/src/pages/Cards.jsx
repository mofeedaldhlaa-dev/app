import { useEffect, useMemo, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Edit, Trash2, Filter } from "lucide-react";
import PeriodFilter from "@/components/PeriodFilter";

export default function Cards() {
  const [cats, setCats] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [numbers, setNumbers] = useState("");
  const [qty, setQty] = useState(0);
  const [cardsList, setCardsList] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("numbers");
  const [editCard, setEditCard] = useState(null);

  // ===== list filters (category + period) =====
  const [listCategory, setListCategory] = useState(""); // "" = all categories
  const [period, setPeriod] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const loadCats = async () => setCats((await api.get("/categories")).data);
  const loadCards = async () => setCardsList((await api.get("/cards", {
    params: {
      q: search,
      status_filter: statusFilter || undefined,
      category_id: listCategory || undefined,
    },
  })).data);
  useEffect(() => { loadCats(); loadCards(); }, []);
  useEffect(() => { loadCards(); }, [search, statusFilter, listCategory]);

  const parseNumbers = () => numbers.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const addNumbers = async () => {
    if (!categoryId) { toast.error("اختر الفئة"); return; }
    try {
      const list = parseNumbers();
      const r = await api.post("/cards/add-numbers", { category_id: categoryId, numbers: list });
      setResult(r.data);
      toast.success(`تمت إضافة ${r.data.added} كرت`);
      setNumbers("");
      loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  const addQty = async () => {
    if (!categoryId || !qty) { toast.error("اختر الفئة والكمية"); return; }
    try {
      await api.post("/cards/add-quantity", { category_id: categoryId, quantity: Number(qty) });
      toast.success("تمت الإضافة"); setQty(0);
    } catch (e) { toast.error(errText(e)); }
  };

  const removeCard = async (id) => {
    try {
      const r = await api.delete(`/cards/${id}`);
      toast.success(r.data.action === "deleted" ? "تم الحذف" : "تم إلغاء الكرت (لأنه مباع)");
      loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  const saveEdit = async () => {
    try {
      await api.put(`/cards/${editCard.id}`, { number: editCard.number, category_id: editCard.category_id, status: editCard.status, notes: editCard.notes });
      toast.success("تم التعديل"); setEditCard(null); loadCards();
    } catch (e) { toast.error(errText(e)); }
  };

  // Combined filtering: category comes from backend; period is applied on the
  // registered date (created_at) of each card — real data filtering, not cosmetic.
  const visibleCards = useMemo(() => {
    return cardsList.filter((c) => {
      const day = (c.created_at || "").slice(0, 10);
      if (start && day < start) return false;
      if (end && day > end) return false;
      return true;
    });
  }, [cardsList, start, end]);

  return (
    <div className="space-y-4" data-testid="cards-page">
      <Card className="p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2 max-w-md">
            <TabsTrigger value="numbers" data-testid="tab-numbers">كروت بأرقام</TabsTrigger>
            <TabsTrigger value="qty" data-testid="tab-qty">كمية بدون أرقام</TabsTrigger>
          </TabsList>
          <TabsContent value="numbers" className="space-y-3">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger data-testid="cards-cat"><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
              <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea rows={10} placeholder="ألصق أرقام الكروت هنا (كل رقم في سطر)" value={numbers} onChange={(e) => setNumbers(e.target.value)} data-testid="cards-numbers" className="font-mono" />
            <div className="text-sm text-slate-500">عدد الأسطر: {parseNumbers().length}</div>
            <Button onClick={addNumbers} className="bg-[#221340]" data-testid="cards-add-numbers">إضافة الكروت</Button>
            {result && (
              <Card className="p-4 bg-slate-50">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><div className="text-slate-500">الصحيحة</div><div className="text-xl font-bold text-green-600">{result.added}</div></div>
                  <div><div className="text-slate-500">المكررة</div><div className="text-xl font-bold text-amber-600">{result.duplicates?.length || 0}</div></div>
                  <div><div className="text-slate-500">غير صالحة</div><div className="text-xl font-bold text-red-600">{result.invalid?.length || 0}</div></div>
                </div>
              </Card>
            )}
          </TabsContent>
          <TabsContent value="qty" className="space-y-3">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
              <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input type="number" placeholder="الكمية" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="cards-qty" />
            <Button onClick={addQty} className="bg-[#221340]" data-testid="cards-add-qty">إضافة</Button>
          </TabsContent>
        </Tabs>
      </Card>

      <Card className="p-4">
        <div className="font-bold text-[#221340] mb-3">قائمة عرض الكروت المرقمة</div>

        {/* Filters: category + status + period + number search (all work together) */}
        <div className="space-y-3 bg-slate-50 border rounded-lg p-3 mb-3">
          <div className="flex items-center gap-2 text-sm text-slate-600"><Filter size={14}/> البحث والتصفية</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">الفئة</label>
              <Select value={listCategory || "all"} onValueChange={(v) => setListCategory(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="cards-list-cat"><SelectValue placeholder="كل الفئات"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الفئات</SelectItem>
                  {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">الحالة</label>
              <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger data-testid="cards-status"><SelectValue placeholder="كل الحالات"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="available">متوفر</SelectItem>
                  <SelectItem value="sold">مباع</SelectItem>
                  <SelectItem value="used">مستخدم</SelectItem>
                  <SelectItem value="cancelled">ملغي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">بحث برقم الكرت</label>
              <Input placeholder="رقم الكرت" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="cards-search" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">الفترة (حسب تاريخ التسجيل)</label>
            <PeriodFilter includeAll period={period} start={start} end={end}
              onChange={({ period: p, start: s, end: e }) => { setPeriod(p); setStart(s); setEnd(e); }}
              testidPrefix="cards-period" />
          </div>
        </div>

        <div className="text-xs text-slate-500 mb-2" data-testid="cards-count">عدد النتائج: <strong className="text-[#221340]">{visibleCards.length}</strong></div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-50"><tr className="text-right"><th className="p-2">الرقم</th><th className="p-2">الفئة</th><th className="p-2">الحالة</th><th className="p-2">تاريخ التسجيل</th><th className="p-2"></th></tr></thead>
            <tbody>
              {visibleCards.slice(0, 500).map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="p-2 font-mono">{c.number}</td>
                  <td className="p-2">{c.category_name}</td>
                  <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full ${c.status==='available'?'bg-green-100 text-green-700':c.status==='sold'?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-700'}`}>{c.status==='available'?'متوفر':c.status==='sold'?'مباع':c.status==='used'?'مستخدم':'ملغي'}</span></td>
                  <td className="p-2 text-xs text-slate-500">{(c.created_at || "").slice(0, 10)}</td>
                  <td className="p-2 flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditCard({...c})} data-testid={`card-edit-${c.id}`}><Edit size={12}/></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button size="sm" variant="outline" data-testid={`card-del-${c.id}`}><Trash2 size={12} className="text-red-500"/></Button></AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader><AlertDialogTitle>تأكيد</AlertDialogTitle>
                          <AlertDialogDescription>هل تريد حذف الكرت {c.number}؟ إذا كان مباعاً سيتم إلغاؤه فقط.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={() => removeCard(c.id)}>تأكيد</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
              {visibleCards.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد كروت مطابقة</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editCard && (
        <Dialog open onOpenChange={() => setEditCard(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>تعديل الكرت</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>رقم الكرت</Label><Input value={editCard.number} onChange={(e) => setEditCard({...editCard, number: e.target.value})} data-testid="edit-card-number"/></div>
              <div><Label>الفئة</Label>
                <Select value={editCard.category_id} onValueChange={(v) => setEditCard({...editCard, category_id: v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>الحالة</Label>
                <Select value={editCard.status} onValueChange={(v) => setEditCard({...editCard, status: v})}>
                  <SelectTrigger><SelectValue/></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">متوفر</SelectItem>
                    <SelectItem value="sold">مباع</SelectItem>
                    <SelectItem value="used">مستخدم</SelectItem>
                    <SelectItem value="cancelled">ملغي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea placeholder="ملاحظات" value={editCard.notes || ""} onChange={(e) => setEditCard({...editCard, notes: e.target.value})}/>
              <Button onClick={saveEdit} className="w-full bg-[#221340]" data-testid="edit-card-save">حفظ</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
