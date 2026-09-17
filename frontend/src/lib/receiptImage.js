import { toast } from "sonner";

const fmtNum = (n) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

const fmtDT = (iso) => {
  if (!iso) return { date: "", time: "" };
  try {
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, "0");
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  } catch {
    const s = String(iso).replace("T", " ").slice(0, 16);
    return { date: s.slice(0, 10), time: s.slice(11, 16) };
  }
};

// Rounded rect helper
const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

/**
 * Render an operation as a clean, modern receipt PNG using Canvas 2D
 * (native browser text renderer — Arabic shaping is preserved perfectly).
 * Header is always "شبكة جواد نت اللاسلكية".
 */
export async function saveOperationImage({
  kind = "transfer",
  number,
  createdAt,
  senderName,
  recipientName,
  recipientPhone,
  recipientType,
  amount,
  commission = 0,
  senderDebit = 0,
  recipientCredit = 0,
  description = "",
  filenameHint = "",
}) {
  const isTransfer = kind === "transfer";
  const title = isTransfer ? "إشعار تحويل رصيد" : "إشعار شحن رصيد";
  const rtypeLbl =
    recipientType === "pos" ? "نقطة بيع" :
    recipientType === "customer" ? "عميل" : "";
  const dt = fmtDT(createdAt);

  // Ensure Arabic web fonts are ready before drawing
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    // Explicitly force-load the exact weights we use
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load("700 22px Tajawal"),
        document.fonts.load("800 22px Tajawal"),
        document.fonts.load("500 14px Tajawal"),
        document.fonts.load("700 40px Cairo"),
      ]).catch(() => {});
    }
  } catch {}

  // Rows
  const rows = [];
  rows.push({ k: "المرسل", v: senderName || "—" });
  rows.push({ k: "المستلم", v: recipientName || "—" });
  if (recipientPhone) rows.push({ k: "رقم الهاتف", v: recipientPhone, mono: true });
  if (rtypeLbl) rows.push({ k: "نوع الحساب", v: rtypeLbl });
  const rowsBottom = [];
  if (recipientCredit) rowsBottom.push({ k: "المبلغ المستلم", v: `${fmtNum(recipientCredit)} ريال`, tone: "success" });
  if (commission > 0) rowsBottom.push({ k: "العمولة", v: `${fmtNum(commission)} ريال`, tone: "warn" });
  if (senderDebit && senderDebit !== amount) rowsBottom.push({ k: "الخصم من الرصيد", v: `${fmtNum(senderDebit)} ريال`, tone: "danger" });

  // Sizing (@2x for retina)
  const scale = 2;
  const W = 560;
  const padX = 16;
  const cardX = padX;
  const cardW = W - padX * 2;
  const innerX = cardX + 24;
  const innerW = cardW - 48;
  const rightEdge = cardX + cardW - 24;
  const leftEdge = cardX + 24;
  const hHeader = 108;
  const hTitle = 74;
  const hAmount = 138;
  const rowH = 44;
  const rowsAllH = rows.length * rowH + (rowsBottom.length ? 8 + rowsBottom.length * rowH : 0);
  const descLines = description ? Math.ceil(description.length / 62) : 0;
  const hDesc = description ? 22 + descLines * 22 + 20 : 0;
  const hFooter = 84;
  const H = 18 + hHeader + hTitle + hAmount + rowsAllH + hDesc + hFooter + 26;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";
  const AR_FONT = "Tajawal, Cairo, 'Segoe UI', Arial, sans-serif";

  // Page background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Card shadow (subtle)
  ctx.save();
  ctx.shadowColor = "rgba(34,19,64,0.18)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cardX, 18, cardW, H - 36, 24);
  ctx.fill();
  ctx.restore();

  // Header gradient
  const grad = ctx.createLinearGradient(cardX, 18, cardX + cardW, 18 + hHeader);
  grad.addColorStop(0, "#452480");
  grad.addColorStop(1, "#221340");
  ctx.save();
  roundRect(ctx, cardX, 18, cardW, hHeader, 24);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(cardX, 18, cardW, hHeader);
  ctx.restore();

  // Header — company name (right side, RTL)
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 22px ${AR_FONT}`;
  ctx.fillText("شبكة جواد نت اللاسلكية", rightEdge, 18 + 40);
  ctx.font = `400 12px ${AR_FONT}`;
  ctx.globalAlpha = 0.85;
  ctx.textAlign = "right";
  ctx.direction = "ltr";
  ctx.fillText("Jawad Net Wireless Network", rightEdge, 18 + 66);
  ctx.globalAlpha = 1;

  // GAWAD NET pill (left)
  const pillW = 116, pillH = 30;
  const pillX = cardX + 24;
  const pillY = 18 + hHeader / 2 - pillH / 2;
  const pillGrad = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY);
  pillGrad.addColorStop(0, "#D4AF37");
  pillGrad.addColorStop(1, "#F2D06B");
  ctx.fillStyle = pillGrad;
  roundRect(ctx, pillX, pillY, pillW, pillH, 15);
  ctx.fill();
  ctx.fillStyle = "#1A0F33";
  ctx.font = `800 13px ${AR_FONT}`;
  ctx.textAlign = "center";
  ctx.direction = "ltr";
  ctx.fillText("GAWAD NET", pillX + pillW / 2, pillY + pillH / 2 + 1);

  // Title strip
  const tsY = 18 + hHeader;
  ctx.fillStyle = "#F8F5FF";
  ctx.fillRect(cardX, tsY, cardW, hTitle);
  ctx.strokeStyle = "#eef1f6";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cardX, tsY + hTitle); ctx.lineTo(cardX + cardW, tsY + hTitle); ctx.stroke();

  // Check circle (right side in RTL) — actually left visually (start of the row)
  const ccR = 18;
  const ccX = rightEdge - ccR;
  const ccY = tsY + hTitle / 2;
  ctx.fillStyle = "#dcfce7";
  ctx.beginPath(); ctx.arc(ccX, ccY, ccR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#059669";
  ctx.font = `800 22px ${AR_FONT}`;
  ctx.textAlign = "center";
  ctx.direction = "ltr";
  ctx.fillText("✓", ccX, ccY + 1);

  // Title text (right, next to check)
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#221340";
  ctx.font = `800 16px ${AR_FONT}`;
  ctx.fillText(title, ccX - ccR - 10, ccY - 8);
  ctx.fillStyle = "#64748b";
  ctx.font = `400 12px ${AR_FONT}`;
  ctx.fillText("تمت العملية بنجاح", ccX - ccR - 10, ccY + 12);

  // Date/time (left side)
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  ctx.fillStyle = "#64748b";
  ctx.font = `500 12px ${AR_FONT}`;
  ctx.fillText(dt.date, leftEdge, ccY - 8);
  ctx.fillStyle = "#0f172a";
  ctx.font = `700 13px ${AR_FONT}`;
  ctx.fillText(dt.time, leftEdge, ccY + 10);

  // Amount hero
  const aY = tsY + hTitle;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(cardX, aY, cardW, hAmount);
  const centerX = cardX + cardW / 2;

  ctx.fillStyle = "#64748b";
  ctx.font = `500 13px ${AR_FONT}`;
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.fillText("مبلغ العملية", centerX, aY + 22);

  // Big number + ريال
  const amountStr = fmtNum(amount);
  ctx.font = `800 40px Cairo, Tajawal, sans-serif`;
  const numWidth = ctx.measureText(amountStr).width;
  ctx.font = `700 18px ${AR_FONT}`;
  const rialText = " ريال";
  const rialWidth = ctx.measureText(rialText).width;
  const totalWidth = numWidth + 6 + rialWidth;
  const aStart = centerX - totalWidth / 2;
  // Draw number
  ctx.fillStyle = "#221340";
  ctx.font = `800 40px Cairo, Tajawal, sans-serif`;
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  ctx.fillText(amountStr, aStart, aY + 62);
  // Draw ريال next to it (with a proper gap)
  ctx.fillStyle = "#64748b";
  ctx.font = `700 18px ${AR_FONT}`;
  ctx.textAlign = "left";
  ctx.direction = "rtl";
  ctx.fillText("ريال", aStart + numWidth + 10, aY + 62);

  // Operation number pill
  const opLabel = "رقم العملية: ";
  const opNum = String(number || "—");
  ctx.font = `700 13px ${AR_FONT}`;
  const opLabelW = ctx.measureText(opLabel).width;
  ctx.font = `800 13px Cairo, Tajawal, sans-serif`;
  const opNumW = ctx.measureText(opNum).width;
  const opPillW = opLabelW + opNumW + 34;
  const opPillH = 30;
  const opPillX = centerX - opPillW / 2;
  const opPillY = aY + 92;
  ctx.fillStyle = "#F1EDFB";
  roundRect(ctx, opPillX, opPillY, opPillW, opPillH, 15);
  ctx.fill();
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#452480";
  ctx.font = `700 13px ${AR_FONT}`;
  ctx.fillText(opLabel, opPillX + opPillW - 12, opPillY + opPillH / 2 + 1);
  ctx.fillStyle = "#221340";
  ctx.font = `800 13px Cairo, Tajawal, sans-serif`;
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  ctx.fillText(opNum, opPillX + 12, opPillY + opPillH / 2 + 1);

  // Rows
  let rowY = aY + hAmount + 6;
  const drawRow = ({ k, v, mono, tone }) => {
    ctx.strokeStyle = "#eef1f6";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(innerX, rowY + rowH - 1);
    ctx.lineTo(innerX + innerW, rowY + rowH - 1);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label (right)
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#64748b";
    ctx.font = `500 14px ${AR_FONT}`;
    ctx.fillText(k, rightEdge, rowY + rowH / 2);
    // Value (left)
    const c =
      tone === "success" ? "#059669" :
      tone === "warn" ? "#b45309" :
      tone === "danger" ? "#b91c1c" : "#0f172a";
    ctx.fillStyle = c;
    ctx.font = mono
      ? `700 15px Cairo, Tajawal, sans-serif`
      : `700 15px ${AR_FONT}`;
    ctx.textAlign = "left";
    ctx.direction = "ltr";
    ctx.fillText(v, leftEdge, rowY + rowH / 2);
    rowY += rowH;
  };
  rows.forEach(drawRow);
  if (rowsBottom.length) { rowY += 8; rowsBottom.forEach(drawRow); }

  // Description panel
  if (description) {
    const dY = rowY + 4;
    ctx.fillStyle = "#FDFAF0";
    roundRect(ctx, innerX, dY, innerW, hDesc - 4, 8);
    ctx.fill();
    ctx.fillStyle = "#D4AF37";
    ctx.fillRect(innerX + innerW - 4, dY, 4, hDesc - 4);
    ctx.fillStyle = "#4b3d13";
    ctx.font = `500 13px ${AR_FONT}`;
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    // simple line wrap
    const maxWidth = innerW - 28;
    const words = String(description).split(/\s+/);
    let line = "";
    let ly = dY + 22;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth) {
        ctx.fillText(line, innerX + innerW - 12, ly);
        line = words[i];
        ly += 22;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, innerX + innerW - 12, ly);
    rowY = dY + hDesc;
  }

  // Footer
  const fY = rowY + 10;
  ctx.fillStyle = "#FAFAFB";
  ctx.fillRect(cardX, fY, cardW, hFooter);
  ctx.strokeStyle = "#eef1f6";
  ctx.beginPath(); ctx.moveTo(cardX, fY); ctx.lineTo(cardX + cardW, fY); ctx.stroke();
  ctx.fillStyle = "#94a3b8";
  ctx.font = `400 12px ${AR_FONT}`;
  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.fillText("إشعار إلكتروني — لا يحتاج ختماً أو توقيعاً", centerX, fY + 28);
  ctx.fillStyle = "#64748b";
  ctx.font = `700 12px ${AR_FONT}`;
  ctx.fillText("شبكة جواد نت اللاسلكية · GAWAD NET", centerX, fY + 56);

  // Clip corners of the card
  // Re-clip the whole card to keep rounded corners on top of everything painted above
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = canvas.width;
  finalCanvas.height = canvas.height;
  const fctx = finalCanvas.getContext("2d");
  fctx.fillStyle = "#ffffff";
  fctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
  fctx.save();
  fctx.scale(scale, scale);
  roundRect(fctx, cardX, 18, cardW, H - 36, 24);
  fctx.clip();
  fctx.scale(1 / scale, 1 / scale);
  fctx.drawImage(canvas, 0, 0);
  fctx.restore();

  try {
    const dataUrl = finalCanvas.toDataURL("image/png");
    const a = document.createElement("a");
    const safeName = (
      filenameHint || `${isTransfer ? "transfer" : "recharge"}-${number || Date.now()}`
    ).replace(/[^\w\-]+/g, "_");
    a.href = dataUrl;
    a.download = `${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("تم حفظ الإشعار كصورة");
  } catch (e) {
    toast.error("تعذّر حفظ الصورة");
  }
}
