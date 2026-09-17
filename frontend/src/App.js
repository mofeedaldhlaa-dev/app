import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { syncNow, getPending, isOnline } from "@/lib/offline";
import { toast } from "sonner";
import {
  LayoutDashboard, ShoppingCart, PackagePlus, Users, Truck, CreditCard,
  Boxes, Receipt, Ticket, BarChart3, UserCog, Bell, UserPlus, ScrollText, Settings,
  Menu, Wifi, WifiOff, LogOut, Search, FolderOpen, Wallet, Send
} from "lucide-react";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Sales from "@/pages/Sales";
import SaleForm from "@/pages/SaleForm";
import Purchases from "@/pages/Purchases";
import PurchaseForm from "@/pages/PurchaseForm";
import Customers from "@/pages/Customers";
import CustomerStatement from "@/pages/CustomerStatement";
import Suppliers from "@/pages/Suppliers";
import Cards from "@/pages/Cards";
import Categories from "@/pages/Categories";
import Stock from "@/pages/Stock";
import Receipts from "@/pages/Receipts";
import Expenses from "@/pages/Expenses";
import Orders from "@/pages/Orders";
import Reports from "@/pages/Reports";
import Accounts from "@/pages/Accounts";
import AccountDetail from "@/pages/AccountDetail";
import UsersPage from "@/pages/Users";
import Notifications from "@/pages/Notifications";
import SendNotification from "@/pages/SendNotification";
import AuditLog from "@/pages/AuditLog";
import SettingsPage from "@/pages/Settings";
import PublicOrder from "@/pages/PublicOrder";
import BlockedCustomers from "@/pages/BlockedCustomers";
import Files from "@/pages/Files";
import BankAccounts from "@/pages/BankAccounts";
import OfflineBanner from "@/components/OfflineBanner";
import StockAlertsBell from "@/components/StockAlertsBell";
import { setActiveManifest } from "@/lib/pwaInstall";
import "@/index.css";
import api from "@/lib/api";

function NotificationBell() {
  const [count, setCount] = useState(0);
  const [reqCount, setReqCount] = useState(0);
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const r = await api.get("/notifications/summary");
        setCount(r.data?.general_unread || 0);
        setReqCount(r.data?.request_unread || 0);
      } catch {}
    };
    fetchSummary();
    const id = setInterval(fetchSummary, 30000);
    const onRefresh = () => fetchSummary();
    window.addEventListener("notif-refresh", onRefresh);
    return () => { clearInterval(id); window.removeEventListener("notif-refresh", onRefresh); };
  }, []);
  return (
    <div className="flex items-center gap-1">
      <Link to="/notifications?tab=requests" className="relative p-2 hover:bg-amber-50 rounded" data-testid="requests-bell-btn" title="طلبات إنشاء الحساب">
        <UserPlus size={18} className="text-amber-600" />
        {reqCount > 0 && <span className="absolute -top-0.5 -left-0.5 bg-amber-500 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center font-bold" data-testid="req-badge">{reqCount}</span>}
      </Link>
      <Link to="/notifications?tab=general" className="relative p-2 hover:bg-slate-100 rounded" data-testid="bell-btn" title="إشعارات النظام">
        <Bell size={18} className="text-[#452480]" />
        {count > 0 && <span className="absolute -top-0.5 -left-0.5 bg-red-500 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center font-bold">{count}</span>}
      </Link>
    </div>
  );
}

const menu = [
  { path: "/dashboard", label: "لوحة التحكم", icon: LayoutDashboard, perm: "dashboard" },
  { path: "/sales", label: "المبيعات", icon: ShoppingCart, perm: "sales" },
  { path: "/purchases", label: "المشتريات", icon: PackagePlus, perm: "purchases" },
  { path: "/customers", label: "العملاء", icon: Users, perm: "customers" },
  { path: "/suppliers", label: "الموردون", icon: Truck, perm: "suppliers" },
  { path: "/cards", label: "الكروت", icon: CreditCard, perm: "cards" },
  { path: "/categories", label: "الفئات", icon: Ticket, perm: "categories" },
  { path: "/stock", label: "المخزون", icon: Boxes, perm: "stock" },
  { path: "/receipts", label: "السندات", icon: Receipt, perm: "receipts" },
  { path: "/expenses", label: "المصروفات", icon: Wallet, perm: "expenses" },
  { path: "/bank-accounts", label: "الحسابات البنكية", icon: Wallet, perm: "settings" },
  { path: "/orders", label: "طلبات الكروت", icon: Ticket, perm: "card_orders" },
  { path: "/reports", label: "التقارير", icon: BarChart3, perm: "reports" },
  { path: "/users", label: "المستخدمون", icon: UserCog, perm: "users" },
  { path: "/blocked", label: "العملاء المحظورون", icon: Bell, perm: "customers" },
  { path: "/notifications", label: "الإشعارات", icon: Bell, perm: "dashboard" },
  { path: "/send-notification", label: "إرسال إشعار", icon: Send, perm: "settings" },
  { path: "/audit", label: "سجل العمليات", icon: ScrollText, perm: "users" },
  { path: "/settings", label: "الإعدادات", icon: Settings, perm: "settings" },
  { path: "/files", label: "الملفات", icon: FolderOpen, perm: "dashboard" },
];

function Shell({ children }) {
  const { user, logout, hasPerm } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const on = () => { setOnline(true); handleSync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    refreshPending();
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const refreshPending = async () => {
    const p = await getPending();
    setPending(p.length);
  };

  const handleSync = async () => {
    if (!isOnline()) { toast.error("لا يوجد اتصال بالإنترنت"); return; }
    const r = await syncNow();
    await refreshPending();
    if (r.ok || r.failed) toast.success(`تمت مزامنة ${r.ok} عملية` + (r.failed ? ` وفشلت ${r.failed}` : ""));
  };

  useEffect(() => { setOpen(false); refreshPending(); }, [location.pathname]);

  const items = menu.filter((m) => hasPerm(m.perm));

  return (
    <div className="min-h-screen bg-[#F6F4FB] flex" data-testid="app-shell">
      {/* Print header/footer */}
      <div className="print-only print-header">
        <div className="text-xl font-bold">شبكة جواد نت اللاسلكية</div>
        <div className="text-sm">المخاء • 784225716</div>
      </div>
      <div className="print-only print-footer">
        أنشأ الملف: {user?.name || user?.username || "-"} • {new Date().toLocaleString("en-GB")}
      </div>
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex fixed top-0 right-0 h-screen w-64 flex-col brand-gradient text-white z-30">
        <div className="p-5 border-b border-white/10">
          <div className="text-xl font-extrabold gold-text">شبكة جواد نت</div>
          <div className="text-xs opacity-70">اللاسلكية • 784225716</div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {items.map((m) => {
            const active = location.pathname === m.path || (m.path !== "/dashboard" && location.pathname.startsWith(m.path));
            return (
              <Link key={m.path} to={m.path}
                data-testid={`nav-${m.perm}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${active ? "bg-[#D4AF37] text-[#1A0F33] font-bold" : "hover:bg-white/10"}`}>
                <m.icon size={18} />
                <span>{m.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          <button onClick={logout} data-testid="logout-btn" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/20 text-sm">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <aside className="absolute top-0 right-0 h-full w-72 brand-gradient text-white overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-white/10">
              <div className="text-xl font-extrabold gold-text">شبكة جواد نت</div>
              <div className="text-xs opacity-70">784225716</div>
            </div>
            <nav className="p-3 space-y-1">
              {items.map((m) => (
                <Link key={m.path} to={m.path} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-white/10" data-testid={`mnav-${m.perm}`}>
                  <m.icon size={18} /> <span>{m.label}</span>
                </Link>
              ))}
              <button onClick={logout} className="w-full mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/20 text-sm">
                <LogOut size={16} /> تسجيل الخروج
              </button>
            </nav>
          </aside>
        </div>
      )}

      <main className="flex-1 md:mr-64 flex flex-col min-h-screen min-w-0 w-full">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button className="md:hidden p-2 -mr-2 shrink-0" onClick={() => setOpen(true)} data-testid="menu-btn" aria-label="menu"><Menu /></button>
              <div className="font-bold text-[#221340] truncate text-sm sm:text-base">
                {items.find((m) => location.pathname === m.path)?.label || "لوحة التحكم"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button onClick={handleSync} data-testid="sync-btn" aria-label={online?"متصل":"غير متصل"} className={`flex items-center gap-1 text-xs px-2 sm:px-3 py-1.5 rounded-full ${online ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                <span className="hidden sm:inline">{online ? "متصل" : "غير متصل"}</span>
                {pending > 0 && <span className="mr-1 bg-amber-500 text-white rounded-full px-1.5">{pending}</span>}
              </button>
              <NotificationBell />
              <StockAlertsBell />
              <div className="text-sm text-slate-600 hidden md:block max-w-[140px] truncate">{user?.name}</div>
            </div>
          </div>
        </header>
        <div className="flex-1 p-3 sm:p-4 md:p-6 pb-24 md:pb-6 min-w-0">{children}</div>
      </main>
    </div>
  );
}

function Guard({ children, perm }) {
  const { user, hasPerm } = useAuth();
  if (user === undefined) return <div className="min-h-screen flex items-center justify-center text-slate-500">جاري التحميل...</div>;
  if (user === null) return <Navigate to="/mof30" replace />;
  if (perm && !hasPerm(perm)) return <Shell><div className="p-8 text-center text-slate-500">لا تملك صلاحية الوصول إلى هذه الصفحة</div></Shell>;
  return <Shell>{children}</Shell>;
}

function AppRoutes() {
  const location = useLocation();
  useEffect(() => {
    // Swap active manifest: admin sub-app uses its own manifest with scope=/mof30,
    // public GAWAD NET uses the root manifest with scope=/.
    const adminScope = location.pathname === "/mof30" || location.pathname.startsWith("/dashboard") ||
      location.pathname.startsWith("/sales") || location.pathname.startsWith("/purchases") ||
      location.pathname.startsWith("/customers") || location.pathname.startsWith("/suppliers") ||
      location.pathname.startsWith("/cards") || location.pathname.startsWith("/categories") ||
      location.pathname.startsWith("/stock") || location.pathname.startsWith("/receipts") ||
      location.pathname.startsWith("/expenses") || location.pathname.startsWith("/accounts") ||
      location.pathname.startsWith("/orders") || location.pathname.startsWith("/reports") ||
      location.pathname.startsWith("/users") || location.pathname.startsWith("/notifications") ||
      location.pathname.startsWith("/audit") || location.pathname.startsWith("/blocked") ||
      location.pathname.startsWith("/settings") || location.pathname.startsWith("/files") ||
      location.pathname.startsWith("/send-notification") ||
      location.pathname.startsWith("/bank-accounts");
    setActiveManifest(adminScope ? "/manifest-mof30.json" : "/manifest.json");
  }, [location.pathname]);
  return (
    <Routes>
      <Route path="/mof30" element={<Login />} />
      <Route path="/order-card" element={<PublicOrder />} />
      <Route path="/order" element={<PublicOrder />} />
      <Route path="/" element={<PublicOrder />} />
      <Route path="/dashboard" element={<Guard perm="dashboard"><Dashboard /></Guard>} />
      <Route path="/sales" element={<Guard perm="sales"><Sales /></Guard>} />
      <Route path="/sales/new" element={<Guard perm="sales"><SaleForm /></Guard>} />
      <Route path="/sales/:id/edit" element={<Guard perm="edit_ops"><SaleForm /></Guard>} />
      <Route path="/purchases" element={<Guard perm="purchases"><Purchases /></Guard>} />
      <Route path="/purchases/new" element={<Guard perm="purchases"><PurchaseForm /></Guard>} />
      <Route path="/purchases/:id/edit" element={<Guard perm="edit_ops"><PurchaseForm /></Guard>} />
      <Route path="/customers" element={<Guard perm="customers"><Customers /></Guard>} />
      <Route path="/customers/:id" element={<Guard perm="customers"><CustomerStatement /></Guard>} />
      <Route path="/suppliers" element={<Guard perm="suppliers"><Suppliers /></Guard>} />
      <Route path="/cards" element={<Guard perm="cards"><Cards /></Guard>} />
      <Route path="/categories" element={<Guard perm="categories"><Categories /></Guard>} />
      <Route path="/stock" element={<Guard perm="stock"><Stock /></Guard>} />
      <Route path="/receipts" element={<Guard perm="receipts"><Receipts /></Guard>} />
      <Route path="/expenses" element={<Guard perm="expenses"><Expenses /></Guard>} />
      <Route path="/accounts" element={<Guard perm="receipts"><Accounts /></Guard>} />
      <Route path="/accounts/:type/:id" element={<Guard perm="receipts"><AccountDetail /></Guard>} />
      <Route path="/orders" element={<Guard perm="card_orders"><Orders /></Guard>} />
      <Route path="/reports" element={<Guard perm="reports"><Reports /></Guard>} />
      <Route path="/users" element={<Guard perm="users"><UsersPage /></Guard>} />
      <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
      <Route path="/send-notification" element={<Guard perm="settings"><SendNotification /></Guard>} />
      <Route path="/audit" element={<Guard perm="users"><AuditLog /></Guard>} />
      <Route path="/blocked" element={<Guard perm="customers"><BlockedCustomers /></Guard>} />
      <Route path="/settings" element={<Guard perm="settings"><SettingsPage /></Guard>} />
      <Route path="/files" element={<Guard perm="dashboard"><Files /></Guard>} />
      <Route path="/bank-accounts" element={<Guard perm="settings"><BankAccounts /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <OfflineBanner />
        <AppRoutes />
        <Toaster position="top-center" />
      </BrowserRouter>
    </AuthProvider>
  );
}
