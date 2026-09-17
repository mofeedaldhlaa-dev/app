# PRD — شبكة جواد نت اللاسلكية (Jawad Net Wireless ERP)

## Original problem statement
Comprehensive UI modification of an existing Arabic ISP/network ERP (uploaded as gan-main.zip) WITHOUT deleting data or breaking existing functionality. Requests: move cash box + accounts to top of dashboard; remove cash from accounts screen and show عليه/له per account; add categorized professional A4 printing on accounts screen; unify the time-period system (day/month/year/custom) app-wide using the customer-statement mechanism; add an independent stock-notifications bell at the top with a count + details panel and remove low-stock from the dashboard bottom; clean the dashboard (remove recent invoices/vouchers/orders, daily sales chart). Deliver a runnable updated project ZIP with a direct download link.

## Architecture
- Backend: FastAPI (`/app/backend/server.py`), MongoDB (motor). All routes under `/api`. JWT auth. Admin login path `/mof30`.
- Frontend: React (CRA + craco), shadcn/ui, Tailwind, RTL Arabic. Public customer portal at `/`.
- Data: restored from provided MongoDB dump (`/app/backup/jawad_net_db`) into DB `test_database` (299 docs).

## Balance convention (unified)
Positive balance = مدين (debit) = **عليه**; Negative = دائن (credit) = **له**; zero = متعادل. Applied on Dashboard accounts panel, Accounts screen, AccountDetail, and print (`printAccountsSummary`, statement `fmtBalance`).

## Implemented (2026-06)
- Dashboard: Cash box + Accounts moved to TOP as main cards; removed daily-sales chart, recent invoices/vouchers/orders, and bottom low-stock section. Kept KPI overview + quick actions.
- Accounts screen: cash box/الصندوق removed entirely; added الحالة column (عليه/له badge) + absolute-value balances; added print dialog to print all or a specific category (customer debts / POS / suppliers / expenses) with a period selector → professional A4 report (network name, account rows, balance, state, totals, date/period).
- Stock notifications bell: new header icon (`StockAlertsBell`) with new-alert badge; dialog lists low-stock items; badge clears when viewed (localStorage). Backend endpoint `GET /api/stock/alerts`.
- Unified `PeriodFilter` component (day/month/year/custom + from/to) used in Cash box and Accounts print.
- Fixed backwards عليه/له label in AccountDetail.
- Final ZIP: `/app/frontend/public/jawad-net-updated.zip` (served at `/jawad-net-updated.zip`).

## Test status
Frontend testing agent: 100% pass (iteration_1.json). No data mutated. Regression on customers/reports/account-detail OK.

## Backlog / next
- P2: extract QuickRechargeButton/CashBox/AccountsPanel into separate component files.
- P2: optional server-side (cross-device) "seen" state for stock alerts.
