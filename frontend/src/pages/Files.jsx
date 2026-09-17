import { useEffect, useRef, useState } from "react";
import api, { errText } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { fmtDate } from "@/lib/utils";
import { Upload, Trash2, Download, FileText, Image as ImageIcon } from "lucide-react";

const humanSize = (b) => {
  if (!b) return "0";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

const isImage = (ct) => (ct || "").startsWith("image/");

export default function Files() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);

  const load = async () => {
    try { const r = await api.get("/files"); setItems(r.data); }
    catch (e) { toast.error(errText(e)); }
  };
  useEffect(() => { load(); }, []);

  const onPick = () => inputRef.current?.click();
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast.error("حجم الملف أكبر من 25 ميجابايت"); return; }
    setUploading(true); setProgress(0);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post("/files/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (ev) => setProgress(Math.round((ev.loaded * 100) / (ev.total || 1))),
      });
      toast.success(`تم رفع "${f.name}"`);
      e.target.value = "";
      load();
    } catch (err) { toast.error(errText(err)); }
    setUploading(false); setProgress(0);
  };

  const del = async (f) => {
    if (!window.confirm(`حذف "${f.original_filename}"؟`)) return;
    try { await api.delete(`/files/${f.id}`); toast.success("تم الحذف"); load(); }
    catch (e) { toast.error(errText(e)); }
  };

  const downloadHref = (f) => {
    const token = localStorage.getItem("jwd_token") || "";
    const base = process.env.REACT_APP_BACKEND_URL || "";
    return `${base}/api/files/${f.id}/download?auth=${encodeURIComponent(token)}`;
  };

  const filtered = items.filter((f) => !q || f.original_filename.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4" data-testid="files-page">
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
          <div>
            <div className="font-bold text-[#221340]">مركز الملفات والوسائط</div>
            <div className="text-xs text-slate-500">رفع الصور والمستندات (حد أقصى 25 ميجابايت لكل ملف).</div>
          </div>
          <div className="flex gap-2">
            <input ref={inputRef} type="file" hidden onChange={onFile} data-testid="files-input"
                   accept="image/*,application/pdf,.csv,.txt,.json,.xlsx,.docx"/>
            <Button onClick={onPick} disabled={uploading} className="bg-[#221340]" data-testid="files-upload-btn">
              <Upload size={14} className="ml-1"/> {uploading ? `جاري الرفع ${progress}%` : "رفع ملف"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-3">
        <Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" data-testid="files-search"/>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="files-grid">
        {filtered.map((f) => (
          <Card key={f.id} className="p-3 space-y-2" data-testid={`file-${f.id}`}>
            <div className="flex items-center gap-2 min-w-0">
              {isImage(f.content_type)
                ? <ImageIcon size={18} className="text-[#452480] shrink-0"/>
                : <FileText size={18} className="text-[#452480] shrink-0"/>}
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate" title={f.original_filename}>{f.original_filename}</div>
                <div className="text-xs text-slate-500 truncate">{f.content_type} • {humanSize(f.size)} • {fmtDate(f.created_at)}</div>
              </div>
            </div>
            {isImage(f.content_type) && (
              <a href={downloadHref(f)} target="_blank" rel="noreferrer">
                <img src={downloadHref(f)} alt={f.original_filename} loading="lazy"
                     className="w-full h-32 object-cover rounded border"/>
              </a>
            )}
            <div className="flex gap-2">
              <a href={downloadHref(f)} target="_blank" rel="noreferrer" className="flex-1">
                <Button variant="outline" size="sm" className="w-full" data-testid={`file-open-${f.id}`}>
                  <Download size={12} className="ml-1"/> فتح
                </Button>
              </a>
              <Button variant="outline" size="sm" onClick={() => del(f)} data-testid={`file-del-${f.id}`}>
                <Trash2 size={12} className="text-red-500"/>
              </Button>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-slate-400 p-6 border rounded bg-white">
            لا توجد ملفات بعد. اضغط "رفع ملف" لبدء رفع أول ملف.
          </div>
        )}
      </div>
    </div>
  );
}
