# PRD — شبكة جواد نت (Jawad Net) Network/ISP ERP

## Original Problem Statement
Arabic RTL ISP/network ERP. This iteration modified the existing app per an 11-point spec while preserving ALL existing data, balances and functionality (nothing deleted/broken except explicitly requested removals).

## Architecture
- Frontend: React (CRA), Tailwind, shadcn/ui, React Router. RTL Arabic. Brand colors: #221340 / #452480 (purple) + #D4AF37 (gold).
- Backend: FastAPI (`/app/backend/server.py`, single file, `/api` prefix), Motor/MongoDB (`test_database`).
- Auth: JWT. Admin login at `/mof30` (admin / Admin@12345). Public customer portal at `/`.
- Data restored from provided MongoDB backup (backup/jawad_net_db → test_database).

## User Personas
- Admin/staff: manage sales, purchases, accounts, cards, receipts, reports, notifications.
- Subscribers/POS: public portal, receive notifications, order cards.

## Core Requirements (static)
- Never alter accounting/balance/sales/purchase logic. All filters operate on real DB data. RTL, offline/online sync, print/PDF, permissions preserved.

## Implemented (2026-06)
This iteration (all verified 100% by testing agent, iteration_1.json):
1. **Accounts screen** redesigned as responsive modern card grid (name, balance, state عليه/له); clicking a card opens full account detail. Type filters, custom lists, transfer, print preserved.
2. **Removed** the two transfer summary stats (مجموع التحويلات / التحويلات الكلية) from Accounts UI only (transfer data & feature kept).
3. **Dashboard 'نظرة عامة'** moved to top & made prominent (gradient hero). Now shows exactly 4 KPIs: مبيعات اليوم, مبيعات الشهر, ديون العملاء (excludes POS), ديون نقاط البيع (new, net of all POS balances). Removed: purchases, supplier debts, cards sold/available, inventory value. Backend `/reports/dashboard` returns `pos_debts` and POS-excluded `customer_debts`.
4. **Send Notification** moved to standalone screen `/send-notification` (removed from Settings) with the send form + سجل الإشعارات السابقة (log) featuring period filter (يومي/شهري/سنوي/مخصص) + search + summary counts.
5. **Quick shortcuts** added: المبيعات, السندات, المخزون, إرسال إشعار (same tile design), alongside existing shortcuts.
6/7. **Reports unified** via shared `PeriodFilter` (يومي/شهري/سنوي/مخصص/الكل) — real filtering on date-based tabs (sales, purchases, electronic, card order log, stock). Snapshot tabs (customer/supplier debts, opening balances) unchanged per user decision. Stock tab gets period movements (`أُضيف بالفترة` / `بيع بالفترة`) via `/stock?start=&end=`. Unified print/PDF headers & result totals.
8. **Quick transfer (شحن سريع) history** now has period filter + search (uses `/admin/quick-recharge/list` start/end).
9. **Cards numbered list** now has category filter + status + number search + period filter (by registered date), working together; result count shown. `/cards` supports `category_id`.

## Implemented (follow-ups)
- Unified period filter across the WHOLE app via shared `PeriodFilter` component — exactly 4 options (يومي/شهري/سنوي/مخصص + من/إلى), no "الكل" button anywhere. Applied to AccountDetail (reference), Sales, Receipts, Expenses, Reports, Cards, SendNotification log, quick-recharge history, Accounts print. Real data filtering. `includeAll` prop removed to lock the format.
- Dashboard mobile fix: removed `truncate` on KPI values; responsive font + break-words so monthly-sales (and all overview numbers) show fully on small screens. Verified 360/390px.
- PWA installability RESTORED (was broken: assets nested in public/public/ and plain template index.html). Moved manifest.json, manifest-mof30.json, service-worker.js, icons/ to public/; rewrote public/index.html (RTL, theme-color #221340, manifest link, apple-touch-icons, SW registration) keeping Emergent scripts. Users app → GAWAD NET manifest (start_url=/); admin → إدارة الحسابات manifest (start_url=/mof30) via setActiveManifest. SW uses network-only for /api (no stale API). InstallPromptBanner on public portal; admin install in Settings (email-gated). Verified 100%.

## Backlog / Remaining (P2, optional)
- Modularize server.py into domain routers.
- Add pagination to `/cards` as data grows.
- Aggregate stock period movements in Mongo for larger datasets.
- (Cosmetic) shadcn Calendar/Popover instead of native date input in PeriodFilter.

## Next Tasks
- Await user feedback on the delivered iteration.
