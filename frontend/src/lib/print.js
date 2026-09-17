// Standalone print utility - opens a new window with A4-formatted document
// Never uses window.print() on the admin shell
import { fmt, fmtDate, fmtDateOnly } from "./utils";

const HEADER_STYLE = `
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    direction: rtl;
    font-family: 'Cairo', 'Tajawal', 'Noto Sans Arabic', system-ui, sans-serif;
    color: #1A0F33;
    background: white;
    margin: 0; padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }
  .doc { max-width: 186mm; margin: 0 auto; padding: 0; }
  .head {
    text-align: center;
    padding-bottom: 8mm;
    border-bottom: 2px solid #221340;
    margin-bottom: 8mm;
  }
  .head h1 { margin: 0; font-size: 20px; color: #221340; font-weight: 800; }
  .head .sub { font-size: 13px; color: #555; margin-top: 3px; }
  .title {
    background: #F3EFFA;
    border-right: 4px solid #D4AF37;
    padding: 6mm 5mm;
    margin-bottom: 6mm;
    font-size: 16px;
    font-weight: 700;
    color: #221340;
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 3mm 8mm;
    margin-bottom: 6mm;
  }
  .info-row { display: flex; justify-content: space-between; padding: 2mm 0; border-bottom: 1px dotted #ddd; }
  .info-row .lbl { color: #666; font-weight: 500; }
  .info-row .val { color: #1A0F33; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; font-size: 11px; }
  thead { display: table-header-group; background: #221340; color: white; }
  thead th {
    padding: 3mm 2mm;
    text-align: right;
    font-weight: 600;
    font-size: 11px;
    border-left: 1px solid rgba(255,255,255,0.1);
  }
  tbody td {
    padding: 2.5mm 2mm;
    border-bottom: 1px solid #eee;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #FAF7FF; }
  .num { font-variant-numeric: tabular-nums; text-align: left; direction: ltr; }
  .totals { margin-top: 4mm; margin-right: auto; margin-left: 0; max-width: 90mm; }
  .totals .row { display: flex; justify-content: space-between; padding: 2mm 0; border-bottom: 1px solid #eee; }
  .totals .row.grand { border-top: 2px solid #221340; border-bottom: none; padding-top: 3mm; font-size: 14px; font-weight: 800; color: #221340; }
  .footer {
    margin-top: 10mm;
    padding-top: 4mm;
    border-top: 1px solid #ccc;
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: #666;
  }
  .empty { text-align: center; padding: 20mm 0; color: #888; font-size: 13px; }
  .no-data { color: #888; text-align: center; padding: 15mm 0; }
  @media print {
    .doc { max-width: 100%; }
  }
</style>
`;

const buildHeader = () => `
  <div class="head">
    <h1>شبكة جواد نت اللاسلكية</h1>
    <div class="sub">المخاء</div>
    <div class="sub">784225716</div>
  </div>
`;

const buildFooter = (username) => `
  <div class="footer">
    <div>أنشأ الملف: ${username || "-"}</div>
    <div>${new Date().toLocaleString("en-GB")}</div>
  </div>
`;

export const openPrintWindow = (html) => {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { alert("يرجى السماح بالنوافذ المنبثقة"); return; }
  w.document.write(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>طباعة</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  ${HEADER_STYLE}
</head>
<body>
  <div class="doc">
    ${buildHeader()}
    ${html}
  </div>
  <script>
    window.addEventListener("load", () => { setTimeout(() => { window.print(); }, 400); });
  </script>
</body>
</html>
  `);
  w.document.close();
};

const buildBanksBlock = (banks, where) => {
  const list = (banks || []).filter((b) => b.active && (b.show_in || []).includes(where));
  if (!list.length) return "";
  const rows = list.map((b) => `
    <div style="border:1px solid #D4AF37;border-right:4px solid #D4AF37;background:#FFFCF3;padding:3mm 4mm;margin-top:3mm;border-radius:2mm">
      <div style="font-weight:700;color:#221340">${b.bank_name}</div>
      <div style="display:flex;flex-wrap:wrap;gap:2mm 6mm;margin-top:2mm;font-size:11px">
        <div><span style="color:#666">اسم الحساب: </span><span style="font-weight:700">${b.holder_name || "-"}</span></div>
        <div><span style="color:#666">رقم الحساب: </span><span style="font-family:monospace;font-weight:700">${b.account_number || "-"}</span></div>
      </div>
      ${b.details ? `<div style="margin-top:1mm;color:#555;font-size:10px;white-space:pre-line">${b.details}</div>` : ""}
    </div>
  `).join("");
  return `<div style="margin-top:6mm"><div style="font-weight:700;color:#221340;margin-bottom:1mm">للسداد عبر:</div>${rows}</div>`;
};

export const printSaleInvoice = ({ sale, customer, username, banks }) => {
  const itemsRows = (sale.items || []).map((it, i) => {
    const numbers = (it.card_numbers || []).join(", ");
    return `<tr>
      <td>${i + 1}</td>
      <td>${it.category_name || ""}${numbers ? `<div style="font-family:monospace;font-size:10px;color:#666;margin-top:1mm">${numbers}</div>` : ""}</td>
      <td class="num">${it.quantity}</td>
      <td class="num">${fmt(it.price)}</td>
      <td class="num">${fmt(it.total)}</td>
    </tr>`;
  }).join("");

  const html = `
    <div class="title">فاتورة مبيعات — ${sale.number}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">التاريخ</span><span class="val">${fmtDate(sale.created_at)}</span></div>
      <div class="info-row"><span class="lbl">نوع الفاتورة</span><span class="val">${sale.sale_type === "cash" ? "نقد" : "آجل"}</span></div>
      <div class="info-row"><span class="lbl">اسم العميل</span><span class="val">${sale.customer_name || "-"}</span></div>
      <div class="info-row"><span class="lbl">رقم الهاتف</span><span class="val">${customer?.phone || "-"}</span></div>
      <div class="info-row"><span class="lbl">نوع الحساب</span><span class="val">${(customer?.customer_type || "customer") === "pos" ? "نقطة بيع" : "عميل"}</span></div>
      ${sale.recipient_phone ? `<div class="info-row" style="grid-column:1/-1;background:#fff8e1;border-color:#f5c451"><span class="lbl">📤 المرسل إلى</span><span class="val" style="font-family:monospace;font-weight:bold;color:#7a4b00">${sale.recipient_phone}</span></div>` : ""}
      <div class="info-row"><span class="lbl">المستخدم</span><span class="val">${sale.username || "-"}</span></div>
    </div>
    <table>
      <thead><tr>
        <th style="width:8mm">م</th>
        <th>البيان / الفئة</th>
        <th style="width:20mm">الكمية</th>
        <th style="width:28mm">سعر الوحدة</th>
        <th style="width:32mm">الإجمالي</th>
      </tr></thead>
      <tbody>${itemsRows || `<tr><td colspan="5" class="empty">لا توجد أصناف</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>الإجمالي</span><span class="num">${fmt(sale.subtotal)}</span></div>
      ${sale.discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">${fmt(sale.discount)}</span></div>` : ""}
      <div class="row"><span>الصافي</span><span class="num">${fmt(sale.total)}</span></div>
      <div class="row"><span>المدفوع</span><span class="num">${fmt(sale.paid)}</span></div>
      <div class="row grand"><span>المتبقي</span><span class="num">${fmt(sale.remaining)}</span></div>
      ${customer ? `<div class="row"><span>إجمالي الرصيد المستحق</span><span class="num">${fmt(customer.balance || 0)}</span></div>` : ""}
    </div>
    ${buildBanksBlock(banks, "invoices")}
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};

export const printPurchase = ({ purchase, supplier, username, banks }) => {
  const itemsRows = (purchase.items || []).map((it, i) => `<tr>
    <td>${i + 1}</td><td>${it.category_name || ""}</td>
    <td class="num">${it.quantity}</td><td class="num">${fmt(it.price)}</td><td class="num">${fmt(it.total)}</td>
  </tr>`).join("");
  const html = `
    <div class="title">فاتورة مشتريات — ${purchase.number}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">التاريخ</span><span class="val">${fmtDate(purchase.created_at)}</span></div>
      <div class="info-row"><span class="lbl">نوع الفاتورة</span><span class="val">${purchase.purchase_type === "cash" ? "نقد" : "آجل"}</span></div>
      <div class="info-row"><span class="lbl">المورد</span><span class="val">${purchase.supplier_name || "-"}</span></div>
      <div class="info-row"><span class="lbl">رقم الهاتف</span><span class="val">${supplier?.phone || "-"}</span></div>
      <div class="info-row"><span class="lbl">المستخدم</span><span class="val">${purchase.username || "-"}</span></div>
    </div>
    <table>
      <thead><tr><th style="width:8mm">م</th><th>الفئة</th><th style="width:20mm">الكمية</th><th style="width:28mm">سعر الوحدة</th><th style="width:32mm">الإجمالي</th></tr></thead>
      <tbody>${itemsRows || `<tr><td colspan="5" class="empty">لا توجد أصناف</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>الإجمالي</span><span class="num">${fmt(purchase.subtotal)}</span></div>
      ${purchase.discount > 0 ? `<div class="row"><span>الخصم</span><span class="num">${fmt(purchase.discount)}</span></div>` : ""}
      <div class="row"><span>الصافي</span><span class="num">${fmt(purchase.total)}</span></div>
      <div class="row"><span>المدفوع</span><span class="num">${fmt(purchase.paid)}</span></div>
      <div class="row grand"><span>المتبقي</span><span class="num">${fmt(purchase.remaining)}</span></div>
    </div>
    ${buildBanksBlock(banks, "invoices")}
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};

export const printReceipt = ({ receipt, party, username, banks }) => {
  const dir = receipt.kind === "receipt" ? "لكم" : "عليكم";
  const label = receipt.kind === "receipt" ? "سند قبض" : "سند صرف";
  const html = `
    <div class="title">${label} — ${receipt.number}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">التاريخ</span><span class="val">${fmtDate(receipt.created_at)}</span></div>
      <div class="info-row"><span class="lbl">اسم الحساب</span><span class="val">${receipt.party_name || "-"}</span></div>
      <div class="info-row"><span class="lbl">نوع الحساب</span><span class="val">${receipt.party_type === "customer" ? "عميل" : "مورد"}</span></div>
      <div class="info-row"><span class="lbl">رقم الهاتف</span><span class="val">${party?.phone || "-"}</span></div>
      <div class="info-row"><span class="lbl">اتجاه السند</span><span class="val">${dir}</span></div>
      <div class="info-row"><span class="lbl">المستخدم</span><span class="val">${receipt.username || "-"}</span></div>
    </div>
    <div class="totals" style="max-width:120mm">
      <div class="row"><span>مبلغ السند</span><span class="num">${fmt(receipt.amount)}</span></div>
      <div class="row grand"><span>الرصيد بعد السند</span><span class="num">${fmt(receipt.balance_after || 0)}</span></div>
    </div>
    ${receipt.description ? `<div style="margin-top:5mm;padding:3mm;background:#FAF7FF;border-right:3px solid #D4AF37"><strong>التفاصيل:</strong><br/>${receipt.description}</div>` : ""}
    ${buildBanksBlock(banks, "receipts")}
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};

// ONE statement template, shared by the customers screens AND the accounts screens.
// Optional params (typeLabel / closingBalance / extraInfo) default to the original
// customer behaviour, so customer statements render byte-identically to before.
export const printStatement = ({ customer, entries, username, rangeTitle, typeLabel, closingBalance, extraInfo }) => {
  const rows = (entries || []).map((e) => `<tr>
    <td>${fmtDateOnly(e.created_at)}</td>
    <td>${e.op_number || "-"}</td>
    <td>${e.description || "-"}</td>
    <td class="num">${fmt(e.debit)}</td>
    <td class="num">${fmt(e.credit)}</td>
    <td class="num">${fmt(e.balance)}</td>
  </tr>`).join("");
  const totalDebit = (entries || []).reduce((s, e) => s + (e.debit || 0), 0);
  const totalCredit = (entries || []).reduce((s, e) => s + (e.credit || 0), 0);
  // Final balance: accounts screens pass the period closing balance; customers keep customer.balance.
  const finalBalance = closingBalance === undefined || closingBalance === null
    ? (customer.balance || 0)
    : closingBalance;
  const fmtBalance = (b) => (b || 0) === 0 ? "0 ريال" : `${fmt(Math.abs(b || 0))} ${(b || 0) > 0 ? "عليكم" : "لكم"}`;
  const extraRows = (extraInfo || []).map((r) => `
      <div class="info-row"><span class="lbl">${r.lbl}</span><span class="val">${r.val}</span></div>`).join("");
  const html = `
    <div class="title">${rangeTitle || `كشف حساب — ${customer.name}`}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">اسم الحساب</span><span class="val">${customer.name}</span></div>
      <div class="info-row"><span class="lbl">نوع الحساب</span><span class="val">${typeLabel || ((customer.customer_type || "customer") === "pos" ? "نقطة بيع" : "عميل")}</span></div>
      <div class="info-row"><span class="lbl">رقم الهاتف</span><span class="val">${customer.phone || "-"}</span></div>
      <div class="info-row"><span class="lbl">الرصيد الحالي</span><span class="val">${fmtBalance(customer.balance)}</span></div>${extraRows}
    </div>
    <table>
      <thead><tr>
        <th style="width:22mm">التاريخ</th>
        <th style="width:22mm">رقم المستند</th>
        <th>التفاصيل</th>
        <th style="width:22mm">مدين</th>
        <th style="width:22mm">دائن</th>
        <th style="width:22mm">الرصيد</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="no-data">لا توجد بيانات لعرضها</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>إجمالي المدين</span><span class="num">${fmt(totalDebit)}</span></div>
      <div class="row"><span>إجمالي الدائن</span><span class="num">${fmt(totalCredit)}</span></div>
      <div class="row grand"><span>الرصيد النهائي</span><span class="num">${fmtBalance(finalBalance)}</span></div>
    </div>
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};

export const printPublicOrder = ({ order, customer, company = "شبكة جواد نت اللاسلكية" }) => {
  const cards = (order.cards || []).join(", ");
  const html = `
    <div class="title">فاتورة طلب كرت — ${order.number}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">التاريخ</span><span class="val">${fmtDate(order.created_at)}</span></div>
      <div class="info-row"><span class="lbl">اسم الحساب</span><span class="val">${order.customer_name || customer?.name || "-"}</span></div>
      <div class="info-row"><span class="lbl">رقم الهاتف</span><span class="val">${order.phone || customer?.phone || "-"}</span></div>
      <div class="info-row"><span class="lbl">نوع الحساب</span><span class="val">${(customer?.customer_type || "customer") === "pos" ? "نقطة بيع" : "عميل"}</span></div>
      ${order.recipient_phone ? `<div class="info-row" style="grid-column:1/-1;background:#fff8e1;border-color:#f5c451"><span class="lbl">📤 المرسل إلى</span><span class="val" style="font-family:monospace;font-weight:bold;color:#7a4b00">${order.recipient_phone}</span></div>` : ""}
    </div>
    <table>
      <thead><tr>
        <th style="width:8mm">م</th>
        <th>الفئة</th>
        <th style="width:20mm">الكمية</th>
        <th style="width:28mm">سعر الوحدة</th>
        <th style="width:32mm">الإجمالي</th>
      </tr></thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>${order.category_name || "-"}${cards ? `<div style="font-family:monospace;font-size:10px;color:#666;margin-top:1mm">${cards}</div>` : ""}</td>
          <td class="num">${order.quantity || 0}</td>
          <td class="num">${fmt(order.total && order.quantity ? order.total / order.quantity : 0)}</td>
          <td class="num">${fmt(order.total)}</td>
        </tr>
      </tbody>
    </table>
    <div class="totals">
      <div class="row grand"><span>الإجمالي</span><span class="num">${fmt(order.total)}</span></div>
    </div>
    ${buildFooter(company)}
  `;
  openPrintWindow(html);
};

// Professional A4 accounts / debts statement (snapshot of balances by category).
// Shows: network name (header), account rows with balance + state (عليه / له),
// grand totals (owed to us / owed by us / net) and the report date + selected period.
export const printAccountsSummary = ({ categoryLabel, accounts, periodLabel, start, end, username }) => {
  const state = (b) => (b > 0 ? "عليه" : b < 0 ? "له" : "متعادل");
  const rowsHtml = (accounts || []).map((a, i) => {
    const b = a.balance || 0;
    return `<tr>
      <td class="num">${i + 1}</td>
      <td>${a.typeLabel || "-"}</td>
      <td>${a.name || "-"}</td>
      <td>${a.phone || "-"}</td>
      <td class="num">${fmt(Math.abs(b))}</td>
      <td style="font-weight:700;color:${b > 0 ? "#b91c1c" : b < 0 ? "#047857" : "#666"}">${state(b)}</td>
    </tr>`;
  }).join("");
  const totalDebit = (accounts || []).reduce((s, a) => s + ((a.balance || 0) > 0 ? a.balance : 0), 0);
  const totalCredit = (accounts || []).reduce((s, a) => s + ((a.balance || 0) < 0 ? Math.abs(a.balance) : 0), 0);
  const net = totalDebit - totalCredit;
  const periodTxt = start && end ? `من ${start} إلى ${end}` : (periodLabel || "حتى تاريخه");
  const html = `
    <div class="title">كشف حسابات — ${categoryLabel || "الكل"}</div>
    <div class="info-grid">
      <div class="info-row"><span class="lbl">الفئة</span><span class="val">${categoryLabel || "الكل"}</span></div>
      <div class="info-row"><span class="lbl">الفترة</span><span class="val">${periodTxt}</span></div>
      <div class="info-row"><span class="lbl">عدد الحسابات</span><span class="val num">${(accounts || []).length}</span></div>
      <div class="info-row"><span class="lbl">تاريخ التقرير</span><span class="val">${fmtDateOnly(new Date().toISOString())}</span></div>
    </div>
    <table>
      <thead><tr>
        <th style="width:8mm">م</th>
        <th style="width:26mm">النوع</th>
        <th>الاسم</th>
        <th style="width:28mm">الهاتف</th>
        <th style="width:26mm">الرصيد</th>
        <th style="width:20mm">الحالة</th>
      </tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="6" class="no-data">لا توجد حسابات لعرضها</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>إجمالي المبالغ (عليه)</span><span class="num">${fmt(totalDebit)}</span></div>
      <div class="row"><span>إجمالي المبالغ (له)</span><span class="num">${fmt(totalCredit)}</span></div>
      <div class="row grand"><span>الصافي</span><span class="num">${fmt(Math.abs(net))} ${net > 0 ? "عليه" : net < 0 ? "له" : ""}</span></div>
    </div>
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};

export const printReport = ({ title, headers, rows, totals, username }) => {
  const headerCells = headers.map((h) => `<th>${h}</th>`).join("");
  const dataRows = (rows || []).map((r) => `<tr>${r.map((c) => `<td>${c ?? "-"}</td>`).join("")}</tr>`).join("");
  const totalsHtml = totals ? `<div class="totals">${totals.map((t) => `<div class="row"><span>${t.label}</span><span class="num">${t.value}</span></div>`).join("")}</div>` : "";
  const html = `
    <div class="title">${title}</div>
    <table>
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${dataRows || `<tr><td colspan="${headers.length}" class="no-data">لا توجد بيانات لعرضها</td></tr>`}</tbody>
    </table>
    ${totalsHtml}
    ${buildFooter(username)}
  `;
  openPrintWindow(html);
};
