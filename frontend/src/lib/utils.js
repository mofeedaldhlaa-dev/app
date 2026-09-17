import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export const fmt = (n) => {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
};

export const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB") + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
};

export const fmtDateOnly = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB");
  } catch { return iso; }
};

export const genUUID = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const deviceId = () => {
  let id = localStorage.getItem("jwd_device");
  if (!id) {
    id = "dev-" + genUUID();
    localStorage.setItem("jwd_device", id);
  }
  return id;
};

/**
 * Hardware-based phone fingerprint. Stable across DIFFERENT BROWSERS on the
 * SAME phone (does NOT use userAgent or canvas, which vary per browser).
 * Uses only OS/hardware-level signals that every mobile browser exposes.
 * Returns a 32-char hex hash. Async because we hash with SubtleCrypto.
 */
export const phoneFingerprint = async () => {
  const parts = [
    navigator.platform || "",
    `${screen.width}x${screen.height}x${screen.colorDepth || 0}`,
    `${window.devicePixelRatio || 1}`,
    (Intl.DateTimeFormat().resolvedOptions().timeZone) || "",
    `${navigator.hardwareConcurrency || 0}`,
    `${navigator.deviceMemory || 0}`,
    `${navigator.maxTouchPoints || 0}`,
    (navigator.userAgentData?.platform) || "",
  ].join("|");
  try {
    const buf = new TextEncoder().encode(parts);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return "ph-" + Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  } catch {
    // Fallback: DJB2-ish hash so login still works on very old browsers.
    let h = 5381;
    for (let i = 0; i < parts.length; i++) h = ((h << 5) + h + parts.charCodeAt(i)) | 0;
    return "ph-" + (h >>> 0).toString(16);
  }
};

export const openWhatsApp = (phone, text) => {
  if (!phone) {
    alert("لا يوجد رقم هاتف مسجل لهذا الحساب.");
    return;
  }
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("00")) n = n.slice(2);
  if (!n.startsWith("967") && n.length <= 9) n = "967" + n;
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, "_blank");
};

export const openSMS = (phone, text) => {
  if (!phone) return;
  let n = String(phone).replace(/[^0-9+]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  const body = encodeURIComponent(text || "");
  // iOS uses '&', Android uses '?'. Modern browsers accept '?body='. Use it.
  const href = `sms:${n}?body=${body}`;
  // Use location.href to invoke the OS SMS app (window.open often blocks sms: on mobile).
  try { window.location.href = href; }
  catch { window.open(href, "_self"); }
};

export const buildInvoiceMessage = ({ company, number, kind, details, amount, discount, total, paid, remaining, balance_after }) => {
  const parts = [
    `من ${company}`,
    `المخاء`,
    `784225716`,
    ``,
    `عليكم فاتورة رقم: ${number}`,
    `تفاصيل الفاتورة:`,
    details || "",
    ``,
    `مبلغ الفاتورة: ${fmt(total)}`,
  ];
  if (discount > 0) parts.push(`الخصم: ${fmt(discount)}`);
  if (paid !== undefined) parts.push(`المدفوع: ${fmt(paid)}`, `المتبقي: ${fmt(remaining)}`);
  if (balance_after !== null && balance_after !== undefined) {
    parts.push(``, `الرصيد الإجمالي عليكم: ${fmt(balance_after)}`);
  }
  return parts.join("\n");
};

export const buildReceiptMessage = ({ company, kind, number, amount, description, balance_after }) => {
  const dir = kind === "receipt" ? "لكم" : "عليكم";
  const parts = [
    `من ${company}`,
    `المخاء`,
    `784225716`,
    ``,
    `${dir} سند رقم: ${number}`,
    `مبلغ السند: ${fmt(amount)}`,
    `تفاصيل السند:`,
    description || "-",
  ];
  if (balance_after !== null && balance_after !== undefined) {
    parts.push(``, `إجمالي الرصيد عليكم: ${fmt(balance_after)}`);
  }
  return parts.join("\n");
};
