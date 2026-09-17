import { Input } from "@/components/ui/input";

// Unified period selector used across the whole app.
// Mirrors EXACTLY the mechanism used in the customer/account statement screen:
//   periods: day / month / year / custom  (+ optional "all")
//   picking a preset sets start/end dates; editing a date switches to "custom".
// Yemen local dates (YYYY-MM-DD) so it lines up with the backend +03:00 filters.
export const iso = (d) => d.toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export const PERIOD_LABELS = { all: "الكل", day: "يومي", month: "شهري", year: "سنوي", custom: "مخصص" };

// Returns {start, end} for a preset key. "all" clears the range.
// day  = today → today
// month= first day of month → LAST day of month
// year = 01/01 → 31/12 of current year
export const rangeForPeriod = (p) => {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  if (p === "all") return { start: "", end: "" };
  if (p === "day") return { start: iso(startOfToday()), end: iso(startOfToday()) };
  if (p === "month") return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
  if (p === "year") return { start: iso(new Date(y, 0, 1)), end: iso(new Date(y, 11, 31)) };
  return null;
};

export default function PeriodFilter({
  period, start, end,
  onChange,               // ({period, start, end}) => void
  testidPrefix = "period",
  className = "",
}) {
  const presets = [["day", "يومي"], ["month", "شهري"], ["year", "سنوي"]];

  const applyPreset = (p) => {
    const r = rangeForPeriod(p);
    onChange({ period: p, start: r.start, end: r.end });
  };

  return (
    <div className={`flex flex-col sm:flex-row gap-2 sm:items-end flex-wrap ${className}`} data-testid={`${testidPrefix}-filter`}>
      <div className="flex gap-1 flex-wrap">
        {presets.map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => applyPreset(k)}
            className={`px-3 py-1.5 rounded-full text-xs border transition ${period === k ? "bg-[#452480] text-white border-[#452480]" : "border-slate-300 hover:bg-slate-50"}`}
            data-testid={`${testidPrefix}-${k}`}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ period: "custom", start, end })}
          className={`px-3 py-1.5 rounded-full text-xs border transition ${period === "custom" ? "bg-[#D4AF37] text-[#1A0F33] border-[#D4AF37]" : "border-slate-300 hover:bg-slate-50"}`}
          data-testid={`${testidPrefix}-custom`}
        >
          مخصص
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <div>
          <label className="text-xs text-slate-500 block">من</label>
          <Input type="date" value={start || ""} onChange={(e) => onChange({ period: "custom", start: e.target.value, end })} className="h-9" data-testid={`${testidPrefix}-start`} />
        </div>
        <div>
          <label className="text-xs text-slate-500 block">إلى</label>
          <Input type="date" value={end || ""} onChange={(e) => onChange({ period: "custom", start, end: e.target.value })} className="h-9" data-testid={`${testidPrefix}-end`} />
        </div>
      </div>
    </div>
  );
}
