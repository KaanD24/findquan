"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Line, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, Filler
);
ChartJS.defaults.color = "#71717a";
ChartJS.defaults.borderColor = "#27272a";

// ─── types ─────────────────────────────────────────────────────────────────────
type TimeFilter = "ALL" | "10Y" | "5Y" | "3Y" | "2Y" | "1Y" | "YTD";

// ─── formatters ────────────────────────────────────────────────────────────────
function fmtB(v: number | null | undefined, dec = 2): string {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return "$" + (v / 1e12).toFixed(dec) + "T";
  if (a >= 1e9)  return "$" + (v / 1e9).toFixed(dec)  + "B";
  if (a >= 1e6)  return "$" + (v / 1e6).toFixed(dec)  + "M";
  return "$" + v.toLocaleString();
}

function fmtAuto(v: number, unit: string): string {
  if (unit === "USD") return fmtB(v);
  const a = Math.abs(v);
  if (a >= 1e9)  return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6)  return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3)  return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

function fmtPct(v: number | null | undefined, plus = true): string {
  if (v == null || !isFinite(v)) return "—";
  const p = v * 100;
  return (plus && p >= 0 ? "+" : "") + p.toFixed(2) + "%";
}
function fmtPctPlain(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return (v * 100).toFixed(2) + "%";
}
function fmtX(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(2) + "x";
}
function fmtUSD(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return "$" + Number(v).toFixed(2);
}

function yearLabel(period: string): string {
  const d = new Date(period);
  return isNaN(d.getTime()) ? period : String(d.getFullYear());
}
function quarterLabel(period: string): string {
  const d = new Date(period);
  if (isNaN(d.getTime())) return period;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

// ─── chart data helpers ────────────────────────────────────────────────────────
function sortedByPeriod(arr: any[]): any[] {
  if (!arr?.length) return [];
  return arr.slice().sort((a, b) =>
    (a.period || a.date || "").localeCompare(b.period || b.date || "")
  );
}

function computeCagr(arr: any[]): number | null {
  const s = sortedByPeriod(arr).filter(r => r.val > 0);
  if (s.length < 2) return null;
  const yrs = new Date(s[s.length-1].period).getFullYear() - new Date(s[0].period).getFullYear();
  if (yrs <= 0) return null;
  return Math.pow(s[s.length-1].val / s[0].val, 1 / yrs) - 1;
}

// Annualized growth rate from ~`years` years ago to the latest data point.
// Works with negative values (simple annualized % change) when CAGR isn't applicable.
function growthForYears(arr: any[], years: number): number | null {
  const sorted = sortedByPeriod(arr);
  if (sorted.length < 2) return null;
  const latest = sorted[sorted.length - 1];
  const cutoff = new Date(latest.period);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const bases = sorted.filter(r => new Date(r.period) <= cutoff);
  if (!bases.length) return null;
  const base = bases[bases.length - 1];
  if (base.period === latest.period) return null;
  const actualYrs = (new Date(latest.period).getTime() - new Date(base.period).getTime()) / (365.25 * 86400000);
  if (actualYrs < 0.4) return null;
  if (base.val > 0 && latest.val > 0)
    return Math.pow(latest.val / base.val, 1 / actualYrs) - 1;
  // Fallback for sign changes: simple annualised delta
  if (base.val === 0) return null;
  return (latest.val - base.val) / Math.abs(base.val) / actualYrs;
}

function computeEps(netArr: any[], sharesArr: any[]): any[] {
  if (!netArr.length || !sharesArr.length) return [];
  return netArr.map(n => {
    const d = new Date(n.period).getTime();
    const s = sharesArr
      .filter(x => new Date(x.period).getTime() <= d)
      .sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime())[0];
    if (!s || s.val === 0) return null;
    return { period: n.period, val: n.val / s.val };
  }).filter(Boolean);
}

function computeMarginPct(numerator: any[], denominator: any[]): any[] {
  if (!numerator.length || !denominator.length) return [];
  return numerator.map(n => {
    // exact period first, year fallback for annual data with slightly different end dates
    let d = denominator.find(x => x.period === n.period);
    if (!d) {
      const ny = new Date(n.period).getFullYear();
      d = denominator.find(x => new Date(x.period).getFullYear() === ny);
    }
    if (!d || d.val === 0) return null;
    return { period: n.period, val: (n.val / d.val) * 100 };
  }).filter(Boolean);
}

function computeFcf(ocfArr: any[], capexArr: any[]): any[] {
  if (!ocfArr.length) return [];
  return ocfArr.map(o => {
    // Exact match first (quarterly), fall back to year match (annual)
    let c = capexArr.find(x => x.period === o.period);
    if (!c) {
      const ny = new Date(o.period).getFullYear();
      c = capexArr.find(x => new Date(x.period).getFullYear() === ny);
    }
    return { period: o.period, val: o.val - (c ? Math.abs(c.val) : 0) };
  });
}

function computeTtm(quarters: any[]): any[] {
  const s = sortedByPeriod(quarters);
  return s.slice(3).map((_, i) => ({
    period: s[i + 3].period,
    val: s.slice(i, i + 4).reduce((acc, q) => acc + (Number(q.val) || 0), 0),
  }));
}

function mergeEbitda(oiArr: any[], daArr: any[]): any[] {
  return oiArr.map(oi => {
    const yr = new Date(oi.period).getFullYear();
    const da = daArr.find(d => new Date(d.period).getFullYear() === yr);
    if (!da) return null;
    return { period: oi.period, val: oi.val + da.val };
  }).filter(Boolean);
}

function keepLatestPerYear(arr: any[]): any[] {
  const map = new Map<number, any>();
  for (const e of arr) {
    const yr = new Date(e.period).getFullYear();
    const prev = map.get(yr);
    if (!prev || e.period > prev.period) map.set(yr, e);
  }
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function mergeByYear(arrA: any[], arrB: any[], fn: (a: number, b: number) => number): any[] {
  return arrA.map(a => {
    const yr = new Date(a.period).getFullYear();
    const b = arrB.find(x => new Date(x.period).getFullYear() === yr);
    if (!b) return null;
    return { period: a.period, val: fn(a.val, b.val) };
  }).filter(Boolean);
}

function mergeByPeriod(arrA: any[], arrB: any[], fn: (a: number, b: number) => number): any[] {
  return arrA.map(a => {
    let b = arrB.find(x => x.period === a.period);
    if (!b) {
      const yr = new Date(a.period).getFullYear();
      b = arrB.find(x => new Date(x.period).getFullYear() === yr);
    }
    if (!b) return null;
    return { period: a.period, val: fn(a.val, b.val) };
  }).filter(Boolean);
}

function rangeToStart(range: string): string {
  const now = new Date();
  if (range === "YTD") return `${now.getFullYear()}-01-01`;
  if (range === "1Y")  { now.setFullYear(now.getFullYear() - 1);  return now.toISOString().slice(0, 10); }
  if (range === "3Y")  { now.setFullYear(now.getFullYear() - 3);  return now.toISOString().slice(0, 10); }
  if (range === "5Y")  { now.setFullYear(now.getFullYear() - 5);  return now.toISOString().slice(0, 10); }
  if (range === "10Y") { now.setFullYear(now.getFullYear() - 10); return now.toISOString().slice(0, 10); }
  return "1993-01-01";
}

function barBg(vals: number[], pos: string, neg: string): string[] {
  return vals.map(v => (Number(v) >= 0 ? pos : neg));
}

// Cumulative split adjustment factor for a given historical date.
// Multiplies all split ratios for splits that occurred AFTER that date.
function getCumulativeSplitFactor(dateStr: string, splits: any[]): number {
  let f = 1;
  for (const s of splits) {
    if (s.date > dateStr) f *= s.numerator / s.denominator;
  }
  return f;
}

// Filter chart data to a time window for the expand modal
function filterChartData<T extends { labels: string[]; datasets: any[] }>(
  data: T | null,
  tf: TimeFilter,
): T | null {
  if (!data || !data.labels.length || tf === "ALL") return data;
  const cutoff = new Date();
  if (tf === "YTD") {
    cutoff.setMonth(0, 1);
  } else {
    const yrs = tf === "10Y" ? 10 : tf === "5Y" ? 5 : tf === "3Y" ? 3 : tf === "1Y" ? 1 : 2;
    cutoff.setFullYear(cutoff.getFullYear() - yrs);
  }

  const first = data.labels[0] || "";
  let startIdx = 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    const cut = cutoff.toISOString().slice(0, 10);
    startIdx = data.labels.findIndex(l => l >= cut);
  } else if (/^\d{4}$/.test(first)) {
    const cutYr = cutoff.getFullYear();
    startIdx = data.labels.findIndex(l => parseInt(l) >= cutYr);
  } else if (/^Q\d \d{4}$/.test(first)) {
    const cutYr = cutoff.getFullYear();
    const cutQ  = Math.floor(cutoff.getMonth() / 3);
    startIdx = data.labels.findIndex(l => {
      const [qp, yp] = l.split(" ");
      const yr = parseInt(yp);
      const q  = parseInt(qp[1]) - 1;
      return yr > cutYr || (yr === cutYr && q >= cutQ);
    });
  }

  if (startIdx <= 0) return data;
  return {
    ...data,
    labels: data.labels.slice(startIdx),
    datasets: data.datasets.map(ds => ({
      ...ds,
      data: Array.isArray(ds.data) ? ds.data.slice(startIdx) : ds.data,
      backgroundColor: Array.isArray(ds.backgroundColor) ? ds.backgroundColor.slice(startIdx) : ds.backgroundColor,
      borderColor:     Array.isArray(ds.borderColor)     ? ds.borderColor.slice(startIdx)     : ds.borderColor,
    })),
  };
}

const CHART_COLORS = [
  "#3b82f6","#f97316","#22c55e","#a855f7",
  "#14b8a6","#f59e0b","#ec4899","#ef4444","#84cc16","#06b6d4",
];

// ─── chart options factory ─────────────────────────────────────────────────────
function mkOpts(ttFmt?: (ctx: any) => string, legend = false): any {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: legend, labels: { color: "#a1a1aa", boxWidth: 12, font: { size: 10 } } },
      tooltip: {
        mode: "index" as const, intersect: false,
        backgroundColor: "#18181b", borderColor: "#3f3f46", borderWidth: 1,
        titleColor: "#e4e4e7", bodyColor: "#a1a1aa", padding: 10,
        callbacks: ttFmt ? { label: (ctx: any) => ` ${ctx.dataset.label}: ${ttFmt(ctx)}` } : undefined,
      },
    },
    interaction: { mode: "index" as const, intersect: false },
    scales: {
      x: { ticks: { color: "#52525b", maxTicksLimit: 8, font: { size: 10 } }, grid: { color: "#1c1c1e" }, border: { color: "#27272a" } },
      y: { ticks: { color: "#52525b", font: { size: 10 } }, grid: { color: "#1c1c1e" }, border: { color: "#27272a" } },
    },
    elements: { point: { radius: 0, hoverRadius: 4 } },
  };
}

function mkStacked(ttFmt?: (ctx: any) => string): any {
  const base = mkOpts(ttFmt, true);
  return { ...base, scales: { ...base.scales, x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true } } };
}

// ─── ExpandIcon ─────────────────────────────────────────────────────────────────
function ExpandIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 1h4v4M5 12H1V8M12 1L7.5 5.5M1 12l4.5-4.5" />
    </svg>
  );
}

// ─── ChartCard (with expand + time filter) ─────────────────────────────────────
type GrowthStat = { label: string; val: number | null };


function ChartCard({
  title, badge, controls, height = 180, chart, globalTf = "ALL", stats,
}: {
  title: string;
  badge?: string;
  controls?: React.ReactNode;
  height?: number;
  chart: (h: number, tf: TimeFilter) => React.ReactNode;
  globalTf?: TimeFilter;
  stats?: GrowthStat[];
}) {
  const [expanded, setExpanded]         = useState(false);
  const [expandFilter, setExpandFilter] = useState<TimeFilter>(globalTf);

  useEffect(() => {
    if (!expanded) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [expanded]);

  return (
    <>
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-semibold text-zinc-200 truncate">{title}</span>
            {badge && <span className="text-[9px] text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5 shrink-0">{badge}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {controls}
            <button onClick={() => setExpanded(true)} className="text-zinc-600 hover:text-zinc-300 transition-colors" title="Expand">
              <ExpandIcon />
            </button>
          </div>
        </div>
        <div style={{ height }}>{chart(height, globalTf)}</div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-6xl flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-base font-semibold text-white">{title}</span>
                {badge && <span className="text-[10px] text-zinc-500 bg-zinc-800 rounded px-2 py-0.5">{badge}</span>}
                {controls}
                {/* Time frame selector */}
                <div className="flex gap-0.5 bg-zinc-800 rounded-lg p-0.5">
                  {(["ALL", "10Y", "5Y", "3Y", "1Y", "YTD"] as TimeFilter[]).map(f => (
                    <button key={f} onClick={() => setExpandFilter(f)}
                      className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${expandFilter === f ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-200"}`}>
                      {f === "ALL" ? "All Time" : f}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => setExpanded(false)}
                className="text-zinc-500 hover:text-white transition-colors text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-800">
                ×
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4" style={{ height: "65vh" }}>
              <div style={{ flex: 1, minHeight: 0 }}>{chart(Math.round(window.innerHeight * 0.65 - 120), expandFilter)}</div>
              {stats && (() => {
                const visible = stats.filter(s => s.val != null);
                if (!visible.length) return null;
                return (
                  <div className="border-t border-zinc-800/60 pt-4 flex justify-center gap-8 flex-wrap shrink-0">
                    {visible.map(s => (
                      <div key={s.label} className="flex flex-col items-center gap-0.5">
                        <span className="text-xs text-zinc-500 font-medium">{s.label}</span>
                        <span className={`text-2xl font-bold tabular-nums ${s.val! >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {s.val! >= 0 ? "+" : ""}{(s.val! * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Metrics helpers ───────────────────────────────────────────────────────────
function MetricsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col px-5 py-4 min-w-0">
      <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3 border-b border-zinc-700/50 pb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-[11px] text-zinc-500 shrink-0">{label}:</span>
      <span className={`text-[12px] font-semibold tabular-nums text-right ${color || "text-zinc-100"}`}>{value}</span>
    </div>
  );
}
function NoData({ msg }: { msg?: string }) {
  return <div className="h-full flex items-center justify-center text-zinc-700 text-xs">{msg || "No data"}</div>;
}

// ─── AnalystBox ────────────────────────────────────────────────────────────────
const REC_LABELS: Record<string, { label: string; color: string }> = {
  strongBuy:   { label: "Strong Buy",   color: "text-emerald-400" },
  buy:         { label: "Buy",          color: "text-green-400"   },
  outperform:  { label: "Outperform",   color: "text-green-400"   },
  hold:        { label: "Hold",         color: "text-amber-400"   },
  neutralRating: { label: "Neutral",   color: "text-amber-400"   },
  underperform: { label: "Underperform", color: "text-red-400"   },
  sell:        { label: "Sell",         color: "text-red-400"     },
  strongSell:  { label: "Strong Sell",  color: "text-red-500"     },
};

function AnalystBox({ data, currentPrice, priceSeries }: {
  data: any;
  currentPrice: number | null;
  priceSeries: any[];
}) {
  const price = currentPrice ?? data.currentPrice;
  const low   = data.targetLow;
  const mean  = data.targetMean;
  const high  = data.targetHigh;
  const rec   = REC_LABELS[data.recKey] ?? { label: data.recKey ?? "—", color: "text-zinc-400" };
  const total = (data.strongBuy ?? 0) + (data.buy ?? 0) + (data.hold ?? 0) + (data.sell ?? 0) + (data.strongSell ?? 0);

  const PERIOD_LABEL: Record<string, string> = {
    "0q": "Current Q", "+1q": "Next Q", "0y": "Current Year", "+1y": "Next Year",
  };

  // Filter price history to last 1Y
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const prices1Y = priceSeries.filter(p => new Date(p.date).toISOString().slice(0, 10) >= cutoffStr);

  // Grade → color
  const gradeColor = (g: string) => {
    const l = (g || "").toLowerCase();
    if (l.includes("strong buy") || l.includes("outperform") || l.includes("overweight") || l === "buy") return "text-emerald-400";
    if (l.includes("sell") || l.includes("underweight") || l.includes("underperform")) return "text-red-400";
    return "text-amber-400";
  };
  const actionIcon = (a: string) => ({ up: "↑", down: "↓", init: "●", reit: "→" }[a] ?? "→");

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[12px] font-semibold text-zinc-200">Analyst Consensus</span>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${rec.color}`}>{rec.label}</span>
          {data.numAnalysts && (
            <span className="text-[10px] text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5">
              {data.numAnalysts} analyst{data.numAnalysts !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Rating breakdown bar */}
      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex rounded-md overflow-hidden h-1.5">
            {data.strongBuy  > 0 && <div style={{ width: `${(data.strongBuy  / total) * 100}%` }} className="bg-emerald-500" />}
            {data.buy        > 0 && <div style={{ width: `${(data.buy        / total) * 100}%` }} className="bg-green-400" />}
            {data.hold       > 0 && <div style={{ width: `${(data.hold       / total) * 100}%` }} className="bg-amber-400" />}
            {data.sell       > 0 && <div style={{ width: `${(data.sell       / total) * 100}%` }} className="bg-red-400" />}
            {data.strongSell > 0 && <div style={{ width: `${(data.strongSell / total) * 100}%` }} className="bg-red-600" />}
          </div>
          <div className="flex gap-3 flex-wrap">
            {data.strongBuy  > 0 && <span className="text-[10px] text-emerald-400">● Strong Buy {data.strongBuy}</span>}
            {data.buy        > 0 && <span className="text-[10px] text-green-400">● Buy {data.buy}</span>}
            {data.hold       > 0 && <span className="text-[10px] text-amber-400">● Hold {data.hold}</span>}
            {data.sell       > 0 && <span className="text-[10px] text-red-400">● Sell {data.sell}</span>}
            {data.strongSell > 0 && <span className="text-[10px] text-red-500">● Strong Sell {data.strongSell}</span>}
          </div>
        </div>
      )}

      {/* Main body: ratings table (left) + price chart (right) */}
      <div className="flex gap-4 items-start">

        {/* ── Left: analyst ratings table ── */}
        {data.ratings?.length > 0 && (
          <div className="flex-1 min-w-0 overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-600 border-b border-zinc-800">
                  <th className="text-left pb-1 font-medium pr-3">Firm</th>
                  <th className="text-left pb-1 font-medium pr-3">Rating</th>
                  <th className="text-left pb-1 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.ratings.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-zinc-800/40">
                    <td className="py-0.5 pr-3 text-zinc-300 truncate max-w-[140px]">{r.firm}</td>
                    <td className={`py-0.5 pr-3 font-medium ${gradeColor(r.grade)}`}>
                      <span className="text-zinc-600 mr-1">{actionIcon(r.action)}</span>{r.grade}
                    </td>
                    <td className="py-0.5 text-zinc-600 tabular-nums">
                      {new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Right: 1Y price + target chart (half container width) ── */}
        {prices1Y.length > 1 && low != null && high != null && price != null && mean != null && (() => {
          const PTOP = 14, PBOT = 20;
          const H = 150;
          const IH = H - PTOP - PBOT;
          const PRICE_L = 4;
          const PRICE_R = 145;
          const HIST_W  = PRICE_R - PRICE_L;
          const TARGET_X = PRICE_R + HIST_W;
          const LABEL_X  = TARGET_X + 7;
          const W = TARGET_X + 88;

          const closes  = prices1Y.map((p: any) => p.close);
          const allVals = [...closes, low, mean, high];
          const vMin = Math.min(...allVals);
          const vMax = Math.max(...allVals);
          const vPad = (vMax - vMin) * 0.15 || price * 0.02;
          const yBot = vMin - vPad, yTop = vMax + vPad;
          const toY  = (v: number) => PTOP + ((yTop - v) / (yTop - yBot)) * IH;

          const n = prices1Y.length;
          const toX = (i: number) => PRICE_L + (i / (n - 1)) * HIST_W;
          const linePts  = prices1Y.map((p: any, i: number) => `${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(" L ");
          const linePath = `M ${linePts}`;
          const areaPath = `M ${PRICE_L},${H - PBOT} L ${linePts} L ${PRICE_R},${H - PBOT} Z`;

          const isUp    = closes[closes.length - 1] >= closes[0];
          const lineCol = isUp ? "#22c55e" : "#ef4444";
          const areaCol = isUp ? "rgba(34,197,94,0.09)" : "rgba(239,68,68,0.09)";

          const pY = toY(price), lY = toY(low), mY = toY(mean), hY = toY(high);
          const upsidePos = mean >= price;
          const upsidePct = ((mean - price) / price * 100).toFixed(1);

          const fmtD = (d: any) => new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          const xLabels = [
            { x: PRICE_L,              label: fmtD(prices1Y[0].date),               anchor: "start"  },
            { x: PRICE_L + HIST_W / 2, label: fmtD(prices1Y[Math.floor(n/2)].date), anchor: "middle" },
            { x: PRICE_R,              label: "Today",                               anchor: "middle" },
            { x: PRICE_R + HIST_W / 2, label: "+6 mo",                               anchor: "middle" },
            { x: TARGET_X,             label: "+1Y",                                 anchor: "middle" },
          ];

          return (
            <div className="shrink-0 w-1/2">
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
                <defs>
                  <clipPath id="ag-clip">
                    <rect x={PRICE_L} y={0} width={HIST_W} height={H} />
                  </clipPath>
                </defs>
                <path d={areaPath} fill={areaCol} clipPath="url(#ag-clip)" />
                <path d={linePath} fill="none" stroke={lineCol} strokeWidth="1.2" clipPath="url(#ag-clip)" />
                <rect x={PRICE_R} y={PTOP} width={HIST_W} height={IH} fill="rgba(255,255,255,0.012)" />
                <line x1={PRICE_R} y1={pY} x2={TARGET_X} y2={hY} stroke="#22c55e" strokeWidth="1" strokeDasharray="4 2.5" strokeOpacity="0.6" />
                <line x1={PRICE_R} y1={pY} x2={TARGET_X} y2={mY} stroke="#3b82f6" strokeWidth="1" strokeDasharray="4 2.5" strokeOpacity="0.7" />
                <line x1={PRICE_R} y1={pY} x2={TARGET_X} y2={lY} stroke="#f97316" strokeWidth="1" strokeDasharray="4 2.5" strokeOpacity="0.6" />
                <circle cx={TARGET_X} cy={hY} r="2.5" fill="#22c55e" />
                <circle cx={TARGET_X} cy={mY} r="2.5" fill="#3b82f6" />
                <circle cx={TARGET_X} cy={lY} r="2.5" fill="#f97316" />
                <circle cx={PRICE_R}  cy={pY} r="2.5" fill="#ffffff" />
                <text x={LABEL_X}    y={hY} dominantBaseline="middle" fill="#22c55e" fontSize="8.5" fontWeight="500">{"$"+high.toFixed(2)}</text>
                <text x={LABEL_X+40} y={hY} dominantBaseline="middle" fill="#52525b" fontSize="8">High</text>
                <text x={LABEL_X}    y={mY} dominantBaseline="middle" fill="#3b82f6" fontSize="8.5" fontWeight="500">{"$"+mean.toFixed(2)}</text>
                <text x={LABEL_X+40} y={mY} dominantBaseline="middle" fill="#52525b" fontSize="8">{"Avg "}<tspan fill={upsidePos?"#22c55e":"#ef4444"} fontWeight="600">{(upsidePos?"+":"")+upsidePct+"%"}</tspan></text>
                <text x={LABEL_X}    y={lY} dominantBaseline="middle" fill="#f97316" fontSize="8.5" fontWeight="500">{"$"+low.toFixed(2)}</text>
                <text x={LABEL_X+40} y={lY} dominantBaseline="middle" fill="#52525b" fontSize="8">Low</text>
                {xLabels.map(({ x, label, anchor }, i) => (
                  <text key={i} x={x} y={H - 4} fill={label === "Today" ? "#71717a" : "#3f3f46"} fontSize="7.5" textAnchor={anchor as any}>{label}</text>
                ))}
              </svg>
            </div>
          );
        })()}
      </div>

      {/* Forward estimates table */}
      {data.estimates?.length > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-zinc-800/40">
          <span className="text-[11px] text-zinc-500 font-medium uppercase tracking-wide">Forward Estimates</span>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-600">
                  <th className="text-left pb-1 font-medium">Period</th>
                  <th className="text-right pb-1 font-medium">EPS Low</th>
                  <th className="text-right pb-1 font-medium">EPS Avg</th>
                  <th className="text-right pb-1 font-medium">EPS High</th>
                  <th className="text-right pb-1 font-medium">Rev Avg</th>
                  <th className="text-right pb-1 font-medium">YoY</th>
                </tr>
              </thead>
              <tbody>
                {data.estimates.map((e: any) => {
                  const periodLabel = PERIOD_LABEL[e.period] ??
                    (e.endDate ? new Date(e.endDate).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : e.period);
                  const growth = e.epsGrowth;
                  return (
                    <tr key={e.period} className="border-t border-zinc-800/60">
                      <td className="py-1 text-zinc-400">{periodLabel}</td>
                      <td className="py-1 text-right text-zinc-500">{e.epsLow  != null ? `$${e.epsLow.toFixed(2)}`  : "—"}</td>
                      <td className="py-1 text-right text-zinc-200 font-medium">{e.epsAvg  != null ? `$${e.epsAvg.toFixed(2)}`  : "—"}</td>
                      <td className="py-1 text-right text-zinc-500">{e.epsHigh != null ? `$${e.epsHigh.toFixed(2)}` : "—"}</td>
                      <td className="py-1 text-right text-zinc-400">
                        {e.revenueAvg != null ? (e.revenueAvg >= 1e9 ? `$${(e.revenueAvg/1e9).toFixed(1)}B` : `$${(e.revenueAvg/1e6).toFixed(0)}M`) : "—"}
                      </td>
                      <td className={`py-1 text-right font-medium ${growth == null ? "text-zinc-600" : growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {growth != null ? `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function StockPage() {
  const [inputVal, setInputVal]   = useState("AAPL");
  const [symbol, setSymbol]       = useState("");
  const [period, setPeriod]       = useState<"quarterly" | "ttm" | "annual">("annual");
  const [timeRange, setTimeRange] = useState<"YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "MAX">("5Y");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [visibleSegments, setVisibleSegments] = useState<Set<string>>(new Set());

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [priceSeries, setPriceSeries] = useState<any[]>([]);
  const [splits, setSplits]       = useState<any[]>([]);
  const [meta, setMeta]           = useState<any>(null);
  const [revData, setRevData]     = useState<any>(null);
  const [kpiData, setKpiData]     = useState<{ segments: any[]; kpis: any[] }>({ segments: [], kpis: [] });
  const [analystData, setAnalystData] = useState<any>(null);

  useEffect(() => {
    try { const s = localStorage.getItem("fq_favorites"); if (s) setFavorites(JSON.parse(s)); } catch {}
    const p = new URLSearchParams(window.location.search);
    const t = (p.get("ticker") || p.get("s") || "AAPL").trim().toUpperCase();
    setInputVal(t);
    loadStock(t, "5Y");
  }, []); // eslint-disable-line

  function saveFavs(list: string[]) {
    setFavorites(list);
    try { localStorage.setItem("fq_favorites", JSON.stringify(list)); } catch {}
  }
  function toggleFav(sym: string) {
    saveFavs(favorites.includes(sym) ? favorites.filter(f => f !== sym) : [...favorites, sym]);
  }

  const loadStock = useCallback(async (sym: string, range: string) => {
    sym = sym.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setError(null); setSymbol(sym);
    setKpiData({ segments: [], kpis: [] }); setVisibleSegments(new Set());
    setAnalystData(null);

    const start = rangeToStart(range);
    const end   = new Date().toISOString().slice(0, 10);

    try {
      const [stockRes, revRes] = await Promise.all([
        fetch(`/api/stock?symbol=${encodeURIComponent(sym)}&start=${start}&end=${end}`),
        fetch(`/api/revenue?symbol=${encodeURIComponent(sym)}`),
      ]);

      const stockJson = await stockRes.json();
      const revJson   = revRes.ok ? await revRes.json() : null;

      if (!stockRes.ok || !Array.isArray(stockJson.result) || !stockJson.result.length) {
        setError(stockJson.error || "No data found for that ticker.");
        setLoading(false); return;
      }

      setPriceSeries(stockJson.result);
      setSplits(stockJson.splits || []);

      const q  = stockJson.quote || {};
      const pr = q.price || {};
      const sd = q.summaryDetail || {};
      const fd = q.financialData || {};
      const ks = q.defaultKeyStatistics || {};
      const ce = q.calendarEvents || {};
      const mktCap = pr.marketCap || sd.marketCap;
      const fcf    = fd.freeCashflow;
      const sOut   = ks.sharesOutstanding || sd.sharesOutstanding;

      setMeta({
        symbol: stockJson.symbol || sym, longName: pr.longName || pr.shortName || sym, logo: pr.logo,
        regularMarketPrice: pr.regularMarketPrice, regularMarketChange: pr.regularMarketChange,
        regularMarketChangePercent: pr.regularMarketChangePercent,
        marketCap: mktCap, trailingPE: sd.trailingPE, forwardPE: sd.forwardPE,
        priceToSales: sd.priceToSalesTrailingTwelveMonths, evToEbitda: ks.enterpriseToEbitda,
        priceToBook: ks.priceToBook,
        freeCashflow: fcf, operatingCashflow: fd.operatingCashflow,
        fcfYield: fcf && mktCap ? fcf / mktCap : null,
        fcfPerShare: fcf && sOut ? fcf / sOut : null,
        grossMargins: fd.grossMargins, profitMargins: fd.profitMargins,
        operatingMargins: fd.operatingMargins, revenueGrowth: fd.revenueGrowth,
        earningsGrowth: ks.earningsQuarterlyGrowth,
        totalCash: fd.totalCash, totalDebt: fd.totalDebt,
        netCash: fd.totalCash && fd.totalDebt ? fd.totalCash - fd.totalDebt : null,
        dividendYield: sd.dividendYield, payoutRatio: sd.payoutRatio,
        exDividendDate: sd.exDividendDate,
        earningsDate: ce?.earnings?.earningsDate?.[0]?.fmt,
      });

      if (revJson) {
        const qs  = revJson.revenue?.quarter            || [];
        const niQ = revJson.netIncome?.quarter          || [];
        const oiQ = revJson.operatingIncome?.quarter    || [];
        setRevData({
          annual: revJson.revenue?.annual || [], quarter: qs, ttm: computeTtm(qs),
          netIncomeAnnual: revJson.netIncome?.annual || [], netIncomeQuarter: niQ, netIncomeTtm: computeTtm(niQ),
          oiAnnual: revJson.operatingIncome?.annual || [], oiQuarter: oiQ, oiTtm: computeTtm(oiQ),
          daAnnual: revJson.da?.annual || [], daQuarter: revJson.da?.quarter || [],
          grossProfitAnnual:   revJson.grossProfit?.annual  || [],
          grossProfitQuarter:  revJson.grossProfit?.quarter || [],
          ocfAnnual: revJson.ocf?.annual || [], ocfQuarter: revJson.ocf?.quarter || [],
          capexAnnual: revJson.capex?.annual || [], capexQuarter: revJson.capex?.quarter || [],
          cashAnnual:    revJson.cash?.annual    || [],
          cashQuarter:   revJson.cash?.quarter   || [],
          ltDebtAnnual:  revJson.ltDebt?.annual  || [],
          ltDebtQuarter: revJson.ltDebt?.quarter || [],
          stDebtAnnual:  revJson.stDebt?.annual  || [],
          stDebtQuarter: revJson.stDebt?.quarter || [],
          // shares.all = every deduped entry; annual/quarter for display charts
          shares:        revJson.shares?.all     || revJson.shares || [],
          sharesAnnual:  revJson.shares?.annual  || [],
          sharesQuarter: revJson.shares?.quarter || [],
        });
      }

      fetch(`/api/kpi?symbol=${encodeURIComponent(sym)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const segs: any[] = d.segments || [];
          setKpiData({ segments: segs, kpis: d.kpis || [] });
          setVisibleSegments(new Set(segs.map((s: any) => s.key)));
        }).catch(() => {});

      fetch(`/api/analyst?symbol=${encodeURIComponent(sym)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && !d.error) setAnalystData(d); })
        .catch(() => {});
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const s = inputVal.trim().toUpperCase();
    if (s) { setTimeRange("5Y"); loadStock(s, "5Y"); }
  }
  function handleRange(r: "YTD" | "1Y" | "3Y" | "5Y" | "10Y" | "MAX") {
    setTimeRange(r); if (symbol) loadStock(symbol, r);
  }
  function toggleSegment(key: string) {
    setVisibleSegments(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // ─── derived series ──────────────────────────────────────────────────────────
  const revArr    = useMemo(() => sortedByPeriod(revData?.annual            || []), [revData]);
  const netArr    = useMemo(() => sortedByPeriod(revData?.netIncomeAnnual   || []), [revData]);
  const oiArr     = useMemo(() => sortedByPeriod(revData?.oiAnnual          || []), [revData]);
  const gpArr     = useMemo(() => sortedByPeriod(revData?.grossProfitAnnual || []), [revData]);
  const ocfArr    = useMemo(() => sortedByPeriod(revData?.ocfAnnual         || []), [revData]);
  const capexArr  = useMemo(() => sortedByPeriod(revData?.capexAnnual       || []), [revData]);

  // sharesArr = full flat list (used for EPS computation — most coverage)
  const sharesArr        = useMemo(() => sortedByPeriod(revData?.shares        || []), [revData]);
  const sharesAnnualArr  = useMemo(() => sortedByPeriod(revData?.sharesAnnual  || []), [revData]);
  const sharesQuarterArr = useMemo(() => sortedByPeriod(revData?.sharesQuarter || []), [revData]);

  // Split-adjusted versions of all three
  const adjShares = useCallback((arr: any[]) => arr.map(s => ({
    ...s, val: s.val * getCumulativeSplitFactor(s.period, splits),
  })), [splits]);

  const splitAdjSharesArr        = useMemo(() => adjShares(sharesArr),        [sharesArr,        adjShares]);
  const splitAdjSharesAnnualArr  = useMemo(() => adjShares(sharesAnnualArr),  [sharesAnnualArr,  adjShares]);
  const splitAdjSharesQuarterArr = useMemo(() => adjShares(sharesQuarterArr), [sharesQuarterArr, adjShares]);

  // Active display shares (for chart — respects period toggle)
  const activeSharesDisplay = useMemo(() => {
    if (period === "quarterly") {
      return splitAdjSharesQuarterArr.length ? splitAdjSharesQuarterArr : splitAdjSharesArr;
    }
    // For annual view always deduplicate to one entry per year; prevents duplicate bars
    // when the flat fallback list contains multiple filings within the same fiscal year.
    const base = splitAdjSharesAnnualArr.length ? splitAdjSharesAnnualArr : splitAdjSharesArr;
    return keepLatestPerYear(base);
  }, [period, splitAdjSharesAnnualArr, splitAdjSharesQuarterArr, splitAdjSharesArr]);

  // Annual EPS (split-adjusted) — used for daily P/E line
  const splitAdjEpsArr = useMemo(
    () => computeEps(netArr, splitAdjSharesArr),
    [netArr, splitAdjSharesArr],
  );

  // Quarterly EPS (split-adjusted)
  const splitAdjEpsQArr = useMemo(() => {
    const qNet = sortedByPeriod(revData?.netIncomeQuarter || []);
    return computeEps(qNet, splitAdjSharesArr);
  }, [revData, splitAdjSharesArr]);

  const ebitdaArr      = useMemo(() => mergeEbitda(oiArr, sortedByPeriod(revData?.daAnnual || [])), [oiArr, revData]);
  const grossMarginArr = useMemo(() => computeMarginPct(gpArr,  revArr), [gpArr, revArr]);
  const opMarginArr    = useMemo(() => computeMarginPct(oiArr,  revArr), [oiArr, revArr]);
  const netMarginArr   = useMemo(() => computeMarginPct(netArr, revArr), [netArr, revArr]);
  const fcfArr         = useMemo(() => computeFcf(ocfArr, capexArr), [ocfArr, capexArr]);

  // Growth stats for money charts: 1Y / 2Y / 5Y / 10Y annualised growth
  const GROWTH_YEARS = [1, 2, 5, 10] as const;
  const mkGrowthStats = (arr: any[]): GrowthStat[] =>
    GROWTH_YEARS.map(y => ({ label: `${y}Y`, val: growthForYears(arr, y) }));
  const revGrowthStats    = useMemo(() => mkGrowthStats(revArr),     [revArr]);    // eslint-disable-line
  const netGrowthStats    = useMemo(() => mkGrowthStats(netArr),     [netArr]);    // eslint-disable-line
  const ebitdaGrowthStats = useMemo(() => mkGrowthStats(ebitdaArr),  [ebitdaArr]); // eslint-disable-line
  const fcfGrowthStats    = useMemo(() => mkGrowthStats(fcfArr),     [fcfArr]);    // eslint-disable-line

  // Balance sheet: annual
  const cashArr   = useMemo(() => sortedByPeriod(revData?.cashAnnual   || []), [revData]);
  const ltDebtArr = useMemo(() => sortedByPeriod(revData?.ltDebtAnnual || []), [revData]);
  const stDebtArr = useMemo(() => sortedByPeriod(revData?.stDebtAnnual || []), [revData]);
  const totalDebtArr = useMemo(() => {
    const merged = mergeByYear(ltDebtArr, stDebtArr, (a, b) => a + b);
    return merged.length ? merged : ltDebtArr;
  }, [ltDebtArr, stDebtArr]);

  // Balance sheet: quarterly + active (period-aware)
  const cashQArr    = useMemo(() => sortedByPeriod(revData?.cashQuarter   || []), [revData]);
  const ltDebtQArr  = useMemo(() => sortedByPeriod(revData?.ltDebtQuarter || []), [revData]);
  const stDebtQArr  = useMemo(() => sortedByPeriod(revData?.stDebtQuarter || []), [revData]);
  const totalDebtQArr = useMemo(() => {
    const merged = mergeByPeriod(ltDebtQArr, stDebtQArr, (a, b) => a + b);
    return merged.length ? merged : ltDebtQArr;
  }, [ltDebtQArr, stDebtQArr]);
  const activeCashArr      = useMemo(() =>
    period === "quarterly" && cashQArr.length      ? cashQArr      : cashArr,
    [period, cashArr, cashQArr]);
  const activeTotalDebtArr = useMemo(() =>
    period === "quarterly" && totalDebtQArr.length ? totalDebtQArr : totalDebtArr,
    [period, totalDebtArr, totalDebtQArr]);

  // Continuous daily P/E: price / split-adjusted annual EPS (staircase EPS)
  const dailyPeSeries = useMemo(() => {
    if (!priceSeries.length || !splitAdjEpsArr.length) return [];
    const sortedEps = [...splitAdjEpsArr].sort((a: any, b: any) => a.period.localeCompare(b.period));
    return priceSeries.map(p => {
      const date = new Date(p.date).toISOString().slice(0, 10);
      const eps  = sortedEps.filter((e: any) => e.period <= date).slice(-1)[0];
      if (!eps || eps.val <= 0) return null;
      const pe = p.close / eps.val;
      if (!isFinite(pe) || pe <= 0 || pe > 500) return null;
      return { date, pe };
    }).filter(Boolean);
  }, [priceSeries, splitAdjEpsArr]);

  const peStats = useMemo(() => {
    if (!dailyPeSeries.length) return null;
    const now = new Date();
    const cut5  = new Date(); cut5.setFullYear(now.getFullYear() - 5);
    const cut10 = new Date(); cut10.setFullYear(now.getFullYear() - 10);
    const pe5  = (dailyPeSeries as any[]).filter(s => new Date(s.date) >= cut5).map((s: any) => s.pe);
    const pe10 = (dailyPeSeries as any[]).filter(s => new Date(s.date) >= cut10).map((s: any) => s.pe);
    const avg  = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    return { avg5: avg(pe5), avg10: avg(pe10) };
  }, [dailyPeSeries]);

  const currentPe = dailyPeSeries.length ? (dailyPeSeries as any[])[dailyPeSeries.length - 1]?.pe : null;

  // FCF Yield = (annual FCF / split-adj shares) / daily price  ×100  (%)
  const dailyFcfYieldSeries = useMemo(() => {
    if (!priceSeries.length || !fcfArr.length || !splitAdjSharesArr.length) return [];
    const sortedFcf = [...fcfArr].sort((a: any, b: any) => a.period.localeCompare(b.period));
    const sortedSh  = [...splitAdjSharesArr].sort((a: any, b: any) => a.period.localeCompare(b.period));
    return priceSeries.map((p: any) => {
      const date  = new Date(p.date).toISOString().slice(0, 10);
      const fcf   = sortedFcf.filter((e: any) => e.period <= date).slice(-1)[0];
      const sh    = sortedSh.filter((e: any)  => e.period <= date).slice(-1)[0];
      if (!fcf || !sh || sh.val <= 0 || p.close <= 0) return null;
      const val = (fcf.val / sh.val) / p.close * 100;
      if (!isFinite(val) || val < -50 || val > 100) return null;
      return { date, val };
    }).filter(Boolean);
  }, [priceSeries, fcfArr, splitAdjSharesArr]);

  // P/S = daily price / (annual revenue / split-adj shares)
  const dailyPsSeries = useMemo(() => {
    if (!priceSeries.length || !revArr.length || !splitAdjSharesArr.length) return [];
    const sortedRev = [...revArr].sort((a: any, b: any) => a.period.localeCompare(b.period));
    const sortedSh  = [...splitAdjSharesArr].sort((a: any, b: any) => a.period.localeCompare(b.period));
    return priceSeries.map((p: any) => {
      const date  = new Date(p.date).toISOString().slice(0, 10);
      const rev   = sortedRev.filter((e: any) => e.period <= date).slice(-1)[0];
      const sh    = sortedSh.filter((e: any)  => e.period <= date).slice(-1)[0];
      if (!rev || !sh || sh.val <= 0 || rev.val <= 0 || p.close <= 0) return null;
      const val = p.close / (rev.val / sh.val);
      if (!isFinite(val) || val <= 0 || val > 500) return null;
      return { date, val };
    }).filter(Boolean);
  }, [priceSeries, revArr, splitAdjSharesArr]);

  const revCagr      = useMemo(() => computeCagr(revArr), [revArr]);
  const earningsCagr = useMemo(() => computeCagr(netArr.filter(n => n.val > 0)), [netArr]);
  const dilutionRate = useMemo(() => {
    if (!splitAdjSharesArr.length) return null;
    return computeCagr(splitAdjSharesArr);
  }, [splitAdjSharesArr]);

  const totalYears = useMemo(() => {
    if (revArr.length < 2) return null;
    return new Date(revArr[revArr.length-1].period).getFullYear() - new Date(revArr[0].period).getFullYear();
  }, [revArr]);

  // Period-aware active arrays
  const activeRevArr = useMemo(() => {
    if (period === "quarterly") return sortedByPeriod(revData?.quarter || []);
    if (period === "ttm")       return sortedByPeriod(revData?.ttm     || []);
    return revArr;
  }, [period, revArr, revData]);

  const activeNetArr = useMemo(() => {
    if (period === "quarterly") return sortedByPeriod(revData?.netIncomeQuarter || []);
    if (period === "ttm")       return sortedByPeriod(revData?.netIncomeTtm     || []);
    return netArr;
  }, [period, netArr, revData]);

  const activeEbitdaArr = useMemo(() => {
    if (period === "quarterly") return mergeEbitda(sortedByPeriod(revData?.oiQuarter || []), sortedByPeriod(revData?.daQuarter || []));
    if (period === "ttm")       return mergeEbitda(sortedByPeriod(revData?.oiTtm || []), sortedByPeriod(revData?.daQuarter || []));
    return ebitdaArr;
  }, [period, ebitdaArr, revData]);

  const activeFcfArr = useMemo(() => {
    if (period === "quarterly") return computeFcf(sortedByPeriod(revData?.ocfQuarter || []), sortedByPeriod(revData?.capexQuarter || []));
    return fcfArr;
  }, [period, fcfArr, revData]);

  function pLabel(p: string) { return period === "annual" ? yearLabel(p) : quarterLabel(p); }

  // ─── chart datasets ──────────────────────────────────────────────────────────
  const priceData = useMemo(() => {
    if (!priceSeries.length) return null;
    const isPos = priceSeries[priceSeries.length-1]?.close >= priceSeries[0]?.close;
    return {
      labels: priceSeries.map(p => new Date(p.date).toISOString().slice(0, 10)),
      datasets: [{ label: "Price", data: priceSeries.map(p => p.close),
        borderColor: isPos ? "#22c55e" : "#ef4444",
        backgroundColor: isPos ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
        fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 }],
    };
  }, [priceSeries]);

  const revenueData = useMemo(() => {
    if (!activeRevArr.length) return null;
    return { labels: activeRevArr.map(r => pLabel(r.period)),
      datasets: [{ label: "Revenue", data: activeRevArr.map(r => r.val/1e9),
        backgroundColor: "rgba(251,146,60,0.75)", borderColor: "rgba(251,146,60,1)", borderWidth: 1, borderRadius: 3 }] };
  }, [activeRevArr, period]); // eslint-disable-line

  const ebitdaData = useMemo(() => {
    if (!activeEbitdaArr.length) return null;
    const vals = activeEbitdaArr.map((r: any) => r.val/1e9);
    return { labels: activeEbitdaArr.map((r: any) => pLabel(r.period)),
      datasets: [{ label: "EBITDA", data: vals,
        backgroundColor: barBg(vals, "rgba(99,102,241,0.75)", "rgba(239,68,68,0.75)"),
        borderColor:     barBg(vals, "rgba(99,102,241,1)",    "rgba(239,68,68,1)"),
        borderWidth: 1, borderRadius: 3 }] };
  }, [activeEbitdaArr, period]); // eslint-disable-line

  const netIncomeData = useMemo(() => {
    if (!activeNetArr.length) return null;
    const vals = activeNetArr.map(r => r.val/1e9);
    return { labels: activeNetArr.map(r => pLabel(r.period)),
      datasets: [{ label: "Net Income", data: vals,
        backgroundColor: barBg(vals, "rgba(34,197,94,0.75)",  "rgba(239,68,68,0.75)"),
        borderColor:     barBg(vals, "rgba(34,197,94,1)",     "rgba(239,68,68,1)"),
        borderWidth: 1, borderRadius: 3 }] };
  }, [activeNetArr, period]); // eslint-disable-line

  const fcfData = useMemo(() => {
    if (!activeFcfArr.length) return null;
    const vals = activeFcfArr.map((r: any) => r.val/1e9);
    return { labels: activeFcfArr.map((r: any) => pLabel(r.period)),
      datasets: [{ label: "Free Cash Flow", data: vals,
        backgroundColor: barBg(vals, "rgba(20,184,166,0.75)",  "rgba(239,68,68,0.75)"),
        borderColor:     barBg(vals, "rgba(20,184,166,1)",     "rgba(239,68,68,1)"),
        borderWidth: 1, borderRadius: 3 }] };
  }, [activeFcfArr, period]); // eslint-disable-line

  // Continuous P/E line — looks like stock price chart
  const [valuationMetric, setValuationMetric] = useState<"pe" | "fcfy" | "ps">("pe");

  const peLineData = useMemo(() => {
    if (!dailyPeSeries.length) return null;
    const series = dailyPeSeries as any[];
    return {
      labels: series.map(p => p.date),
      datasets: [
        { label: "P/E Ratio", data: series.map(p => p.pe),
          borderColor: "#a855f7", backgroundColor: "rgba(168,85,247,0.07)",
          fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 },
        ...(peStats?.avg5  ? [{ label: "5y avg",  data: series.map(() => peStats.avg5),
          borderColor: "rgba(251,191,36,0.6)", borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, tension: 0 }] : []),
        ...(peStats?.avg10 ? [{ label: "10y avg", data: series.map(() => peStats.avg10),
          borderColor: "rgba(239,68,68,0.5)",  borderDash: [6,6], borderWidth: 1.5, pointRadius: 0, tension: 0 }] : []),
      ],
    };
  }, [dailyPeSeries, peStats]);

  const fcfYieldLineData = useMemo(() => {
    if (!dailyFcfYieldSeries.length) return null;
    const series = dailyFcfYieldSeries as any[];
    return {
      labels: series.map(p => p.date),
      datasets: [{ label: "FCF Yield", data: series.map(p => p.val),
        borderColor: "#14b8a6", backgroundColor: "rgba(20,184,166,0.07)",
        fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 }],
    };
  }, [dailyFcfYieldSeries]);

  const psLineData = useMemo(() => {
    if (!dailyPsSeries.length) return null;
    const series = dailyPsSeries as any[];
    return {
      labels: series.map(p => p.date),
      datasets: [{ label: "P/S Ratio", data: series.map(p => p.val),
        borderColor: "#f97316", backgroundColor: "rgba(249,115,22,0.07)",
        fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 }],
    };
  }, [dailyPsSeries]);

  // EPS bar — period-aware (quarterly or annual)
  const epsData = useMemo(() => {
    const arr = period === "quarterly" ? splitAdjEpsQArr : splitAdjEpsArr;
    if (!arr.length) return null;
    const vals = arr.map((e: any) => e.val);
    return {
      labels: arr.map((e: any) => pLabel(e.period)),
      datasets: [{ label: "EPS (adj)", data: vals,
        backgroundColor: barBg(vals, "rgba(245,158,11,0.75)", "rgba(239,68,68,0.75)"),
        borderColor:     barBg(vals, "rgba(245,158,11,1)",    "rgba(239,68,68,1)"),
        borderWidth: 1, borderRadius: 3 }],
    };
  }, [period, splitAdjEpsArr, splitAdjEpsQArr]); // eslint-disable-line

  // Margins 3-line — period-aware
  const marginsData = useMemo(() => {
    const isQ   = period === "quarterly";
    const baseArr = isQ ? sortedByPeriod(revData?.quarter || []) : revArr;
    if (!baseArr.length) return null;

    let gArr: any[], oArr: any[], nArr: any[];
    if (isQ) {
      const qRev = sortedByPeriod(revData?.quarter             || []);
      const qGp  = sortedByPeriod(revData?.grossProfitQuarter  || []);
      const qOi  = sortedByPeriod(revData?.oiQuarter           || []);
      const qNet = sortedByPeriod(revData?.netIncomeQuarter     || []);
      gArr = computeMarginPct(qGp,  qRev);
      oArr = computeMarginPct(qOi,  qRev);
      nArr = computeMarginPct(qNet, qRev);
    } else {
      gArr = grossMarginArr;
      oArr = opMarginArr;
      nArr = netMarginArr;
    }

    const getVal = (a: any[], p: string) => a.find(x => x.period === p)?.val ?? null;
    const gVals = baseArr.map(r => getVal(gArr, r.period));
    const oVals = baseArr.map(r => getVal(oArr, r.period));
    const nVals = baseArr.map(r => getVal(nArr, r.period));
    if (![...gVals, ...oVals, ...nVals].some(v => v !== null)) return null;

    return {
      labels: baseArr.map(r => pLabel(r.period)),
      datasets: [
        { label: "Gross",     data: gVals, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.07)",  fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
        { label: "Operating", data: oVals, borderColor: "#3b82f6", backgroundColor: "transparent",           fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
        { label: "Net",       data: nVals, borderColor: "#f59e0b", backgroundColor: "transparent",           fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
      ],
    };
  }, [period, revArr, revData, grossMarginArr, opMarginArr, netMarginArr]); // eslint-disable-line

  // Split-adjusted shares bar — period-aware
  const sharesData = useMemo(() => {
    const arr = activeSharesDisplay;
    if (!arr.length) return null;
    const vals = arr.map(s => s.val / 1e9);
    const col  = dilutionRate != null && dilutionRate < 0
      ? { bg: "rgba(34,197,94,0.75)",  b: "rgba(34,197,94,1)" }
      : { bg: "rgba(249,115,22,0.75)", b: "rgba(249,115,22,1)" };
    return {
      labels: arr.map(s => pLabel(s.period)),
      datasets: [{ label: "Shares (adj)", data: vals, backgroundColor: col.bg, borderColor: col.b, borderWidth: 1, borderRadius: 3 }],
    };
  }, [activeSharesDisplay, dilutionRate, period]); // eslint-disable-line

  // Balance sheet — period-aware
  const balanceData = useMemo(() => {
    const cArr = activeCashArr;
    const dArr = activeTotalDebtArr;
    if (!cArr.length && !dArr.length) return null;
    const base   = cArr.length ? cArr : dArr;
    const labels = base.map(r => pLabel(r.period));
    const getV   = (arr: any[], p: string) => arr.find(x => x.period === p)?.val ?? null;
    return {
      labels,
      datasets: [
        { label: "Cash & Equiv.", data: base.map(r => { const v = getV(cArr, r.period); return v != null ? v/1e9 : null; }),
          backgroundColor: "rgba(34,197,94,0.75)", borderColor: "rgba(34,197,94,1)", borderWidth: 1, borderRadius: 3 },
        { label: "Total Debt",    data: base.map(r => { const v = getV(dArr, r.period); return v != null ? v/1e9 : null; }),
          backgroundColor: "rgba(239,68,68,0.75)",  borderColor: "rgba(239,68,68,1)",  borderWidth: 1, borderRadius: 3 },
      ],
    };
  }, [activeCashArr, activeTotalDebtArr, period]); // eslint-disable-line

  // Revenue by segment (stacked bar, toggleable)
  const segmentChartData = useMemo(() => {
    const vis = kpiData.segments.filter(s => visibleSegments.has(s.key));
    if (!vis.length) return null;
    const key = period === "quarterly" ? "quarterly" : "annual";
    const allPeriods = Array.from(new Set(vis.flatMap(s => (s[key] as any[]).map((e: any) => e.period)))).sort();
    return {
      labels: allPeriods.map(p => pLabel(p)),
      datasets: vis.map((s, i) => {
        const map = new Map((s[key] as any[]).map((e: any) => [e.period, e.val]));
        return {
          label: s.label,
          data:  allPeriods.map(p => (map.get(p) ?? 0) / 1e9),
          backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "bf",
          borderColor:     CHART_COLORS[i % CHART_COLORS.length],
          borderWidth: 1, borderRadius: 2,
        };
      }),
    };
  }, [kpiData.segments, visibleSegments, period]); // eslint-disable-line

  // KPI charts
  const kpiCharts = useMemo(() =>
    kpiData.kpis.map((kpi, i) => {
      const key    = period === "quarterly" && kpi.quarterly?.length ? "quarterly" : "annual";
      const series: any[] = kpi[key] || [];
      if (!series.length) return null;
      const isUSD = kpi.unit === "USD";
      const vals  = series.map((e: any) => isUSD ? e.val/1e9 : e.val);
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const bg    = barBg(vals, color + "bf", "rgba(239,68,68,0.75)");
      const bc    = barBg(vals, color,        "rgba(239,68,68,1)");
      return {
        key: kpi.key, label: kpi.label, badge: isUSD ? "USD B" : kpi.unit,
        data: { labels: series.map((e: any) => pLabel(e.period)),
          datasets: [{ label: kpi.label, data: vals, backgroundColor: bg, borderColor: bc, borderRadius: 3, borderWidth: 1 }] },
        ttFmt: (ctx: any) => isUSD ? `$${Number(ctx.raw).toFixed(2)}B` : fmtAuto(Number(ctx.raw), kpi.unit),
      };
    }).filter(Boolean),
    [kpiData.kpis, period] // eslint-disable-line
  );

  // ─── render ──────────────────────────────────────────────────────────────────
  const isUp     = (meta?.regularMarketChange ?? 0) >= 0;
  const isFav    = favorites.includes(symbol);
  const pricePct = meta?.regularMarketChangePercent;
  const globalTf: TimeFilter = timeRange === "MAX" ? "ALL" : timeRange as TimeFilter;

  // Percentage change of price over the current time range
  const priceChangePct = useMemo(() => {
    if (!priceSeries.length) return null;
    const start = rangeToStart(timeRange);
    const filtered = timeRange === "MAX"
      ? priceSeries
      : priceSeries.filter((p: any) => new Date(p.date).toISOString().slice(0, 10) >= start);
    if (filtered.length < 2) return null;
    return (filtered[filtered.length - 1].close - filtered[0].close) / filtered[0].close;
  }, [priceSeries, timeRange]);
  const priceChg = meta?.regularMarketChange;

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg,#111118 0%,#0a0a0f 40%,#08080c 100%)" }}>

      {/* Navbar */}
      <nav className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/60">
        <div className="max-w-screen-2xl mx-auto px-5 h-13 flex items-center gap-3">
          <a href="/" className="text-emerald-400 font-bold text-base tracking-tight shrink-0">FindQuan</a>
          <form onSubmit={handleSearch} className="flex gap-2 w-full max-w-xs">
            <input value={inputVal} onChange={e => setInputVal(e.target.value.toUpperCase())} placeholder="AAPL"
              className="flex-1 bg-zinc-800/80 text-white text-sm rounded-lg px-3 py-2 border border-zinc-700 focus:outline-none focus:border-emerald-500 uppercase placeholder:normal-case placeholder:text-zinc-600 font-mono tracking-widest" />
            <button type="submit" disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg px-4 font-medium transition-colors">
              {loading ? "…" : "Go"}
            </button>
          </form>
          <div className="hidden md:flex gap-1 ml-1">
            {["AAPL","MSFT","GOOGL","AMZN","NVDA","TSLA","META"].map(s => (
              <button key={s} onClick={() => { setInputVal(s); setTimeRange("5Y"); loadStock(s,"5Y"); }}
                className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors font-mono">{s}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {favorites.map(f => (
              <button key={f} onClick={() => { setInputVal(f); loadStock(f, timeRange); }}
                className="text-xs px-2 py-1 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-400 border border-amber-800/50 transition-colors font-mono">★ {f}</button>
            ))}
          </div>
        </div>
      </nav>

      {loading && <div className="h-0.5 bg-zinc-900"><div className="h-full bg-emerald-500" style={{ width:"60%", transition:"width 1s ease" }} /></div>}
      {error   && <div className="max-w-screen-2xl mx-auto px-5 pt-4"><div className="bg-red-950/50 border border-red-900 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div></div>}

      {/* Company header + metrics */}
      {meta && (
        <div className="border-b border-zinc-800/60" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="max-w-screen-2xl mx-auto px-5 pt-5 pb-0">
            <div className="flex items-center gap-4 mb-5 flex-wrap">
              {meta.logo && <img src={meta.logo} alt="" className="w-11 h-11 rounded-xl object-contain bg-zinc-800 p-1.5 border border-zinc-700/60 shrink-0" />}
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white leading-none">{meta.longName}</h1>
                <span className="text-zinc-500 text-sm font-mono">{meta.symbol}</span>
                <button onClick={() => toggleFav(meta.symbol)}
                  className={`text-lg transition-colors leading-none ${isFav ? "text-amber-400" : "text-zinc-700 hover:text-zinc-400"}`}>
                  {isFav ? "★" : "☆"}
                </button>
              </div>
              <div className="flex items-center gap-3 ml-auto flex-wrap">
                {meta.regularMarketPrice && <span className="text-2xl font-bold text-white tabular-nums">{fmtUSD(meta.regularMarketPrice)}</span>}
                {priceChg != null && (
                  <span className={`text-sm font-semibold tabular-nums px-2 py-0.5 rounded-md ${isUp ? "text-emerald-400 bg-emerald-950/50" : "text-red-400 bg-red-950/50"}`}>
                    {isUp ? "▲" : "▼"} {Math.abs(Number(priceChg)).toFixed(2)} ({pricePct != null ? Math.abs(pricePct*100).toFixed(2)+"%": ""})
                  </span>
                )}
                {meta.earningsDate && <span className="text-xs text-zinc-500 border border-zinc-800 px-2 py-0.5 rounded-md">Earnings: {meta.earningsDate}</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 divide-x divide-zinc-800/60 border border-zinc-800/60 rounded-t-xl overflow-hidden bg-zinc-900/40">
              <MetricsSection title="Valuation">
                <MetricRow label="Market Cap"    value={fmtB(meta.marketCap)} />
                <MetricRow label="PE (TTM | Fwd)" value={`${meta.trailingPE ? Number(meta.trailingPE).toFixed(1):"—"} | ${meta.forwardPE ? Number(meta.forwardPE).toFixed(1):"—"}`} />
                <MetricRow label="Price / Sales" value={meta.priceToSales ? fmtX(meta.priceToSales) : "—"} />
                {revCagr != null && <MetricRow label="Rev CAGR" value={fmtPct(revCagr)} color={revCagr >= 0 ? "text-emerald-400" : "text-red-400"} />}
              </MetricsSection>
              <MetricsSection title="Cash Flow">
                <MetricRow label="Free Cash Flow"  value={fmtB(meta.freeCashflow)} />
                <MetricRow label="FCF Yield"        value={meta.fcfYield    ? fmtPctPlain(meta.fcfYield)    : "—"} />
                <MetricRow label="FCF / Share"      value={meta.fcfPerShare ? fmtUSD(meta.fcfPerShare)      : "—"} />
                <MetricRow label="Operating CF"     value={fmtB(meta.operatingCashflow)} />
              </MetricsSection>
              <MetricsSection title="Margins & Growth">
                <MetricRow label="Gross Margin"     value={fmtPctPlain(meta.grossMargins)}    color="text-emerald-400" />
                <MetricRow label="Operating Margin" value={fmtPctPlain(meta.operatingMargins)} color="text-emerald-400" />
                <MetricRow label="Profit Margin"    value={fmtPctPlain(meta.profitMargins)}    color="text-emerald-400" />
                <MetricRow label="Earnings (YoY)"   value={meta.earningsGrowth != null ? fmtPct(meta.earningsGrowth) : "—"}
                  color={meta.earningsGrowth != null ? (meta.earningsGrowth >= 0 ? "text-emerald-400":"text-red-400") : undefined} />
                <MetricRow label="Revenue (YoY)"    value={meta.revenueGrowth  != null ? fmtPct(meta.revenueGrowth)  : "—"}
                  color={meta.revenueGrowth  != null ? (meta.revenueGrowth  >= 0 ? "text-emerald-400":"text-red-400") : undefined} />
              </MetricsSection>
              <MetricsSection title="Balance Sheet">
                <MetricRow label="Cash"   value={fmtB(meta.totalCash)} color="text-emerald-400" />
                <MetricRow label="Debt"   value={fmtB(meta.totalDebt)} color={meta.totalDebt ? "text-red-400":undefined} />
                <MetricRow label="Equity" value={fmtB(meta.netCash)}
                  color={meta.netCash != null ? (meta.netCash >= 0 ? "text-emerald-400":"text-red-400") : undefined} />
                {dilutionRate != null && <MetricRow label="Dilution / yr" value={fmtPct(dilutionRate)}
                  color={dilutionRate < 0 ? "text-emerald-400" : dilutionRate > 0.02 ? "text-red-400":"text-amber-400"} />}
              </MetricsSection>
              <MetricsSection title="Dividend">
                <MetricRow label="Div Yield"    value={meta.dividendYield ? fmtPctPlain(meta.dividendYield) : "None"}
                  color={meta.dividendYield ? "text-amber-400":"text-zinc-600"} />
                <MetricRow label="Payout Ratio" value={meta.payoutRatio ? fmtPctPlain(meta.payoutRatio) : "—"} />
                {meta.exDividendDate && <MetricRow label="Ex-Div Date" value={(() => {
                  const raw = meta.exDividendDate;
                  const d = typeof raw === "number" ? new Date(raw * 1000) : new Date(raw);
                  return isNaN(d.getTime()) ? String(raw)
                    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                })()} />}
              </MetricsSection>
            </div>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="max-w-screen-2xl mx-auto px-5 py-5 space-y-4">

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 gap-0.5">
            {([{key:"quarterly",label:"Quarterly"},{key:"ttm",label:"Quarterly (TTM)"},{key:"annual",label:"Annually"}] as const).map(({key,label}) => (
              <button key={key} onClick={() => setPeriod(key)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${period===key?"bg-blue-600 text-white":"text-zinc-500 hover:text-zinc-200"}`}>{label}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["YTD","1Y","3Y","5Y","10Y","MAX"] as const).map(r => (
              <button key={r} onClick={() => handleRange(r)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${timeRange===r?"bg-zinc-700 text-white":"text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"}`}>{r}</button>
            ))}
          </div>
          <div className="ml-auto text-xs text-zinc-600 flex gap-2">
            {totalYears && <span>{totalYears}Y of data</span>}
            {splits.length > 0 && <span>· {splits.length} split{splits.length>1?"s":""}</span>}
          </div>
        </div>

        {/* Row 1: Price, Revenue, EBITDA, Net Income */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <ChartCard title="Price" globalTf={globalTf}
            controls={priceChangePct != null ? (
              <span className={`font-semibold text-xs ${priceChangePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {priceChangePct >= 0 ? "+" : ""}{(priceChangePct * 100).toFixed(2)}%
                <span className="text-zinc-600 font-normal ml-1">{timeRange}</span>
              </span>
            ) : undefined}
            chart={(h,tf) => { const d=filterChartData(priceData,tf); return d ? <Line data={d} options={mkOpts(ctx=>fmtUSD(ctx.raw))} /> : <NoData/>; }} />
          <ChartCard title="Revenue" badge="USD B" globalTf={globalTf} stats={revGrowthStats}
            chart={(h,tf) => { const d=filterChartData(revenueData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="EBITDA" badge="USD B" globalTf={globalTf} stats={ebitdaGrowthStats}
            chart={(h,tf) => { const d=filterChartData(ebitdaData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Net Income" badge="USD B" globalTf={globalTf} stats={netGrowthStats}
            chart={(h,tf) => { const d=filterChartData(netIncomeData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
        </div>

        {/* Row 2: P/E (continuous), EPS, FCF, Margins */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <ChartCard
            title={valuationMetric === "pe" ? "P/E Ratio" : valuationMetric === "fcfy" ? "FCF Yield" : "P/S Ratio"}
            badge={valuationMetric === "pe" ? "price ÷ EPS" : valuationMetric === "fcfy" ? "FCF / mkt cap" : "mkt cap ÷ rev"}
            globalTf={globalTf}
            controls={
              <div className="flex gap-0.5 bg-zinc-800/80 rounded-md p-0.5">
                {([["pe","P/E"],["fcfy","FCF Yield"],["ps","P/S"]] as const).map(([key, label]) => (
                  <button key={key} onClick={() => setValuationMetric(key)}
                    className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${valuationMetric===key?"bg-zinc-600 text-white":"text-zinc-500 hover:text-zinc-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
            }
            chart={(h,tf) => {
              const activeData = valuationMetric === "pe" ? peLineData : valuationMetric === "fcfy" ? fcfYieldLineData : psLineData;
              const d = filterChartData(activeData, tf);
              if (!d) return <NoData msg={valuationMetric === "pe" ? "Needs EPS data" : "No data"} />;
              const showLegend = valuationMetric === "pe" && peStats?.avg5 != null;
              const ttFmt = valuationMetric === "fcfy"
                ? (ctx: any) => `${Number(ctx.raw).toFixed(2)}%`
                : (ctx: any) => fmtX(ctx.raw);
              return <Line data={d} options={mkOpts(ttFmt, showLegend)} />;
            }}
          />
          <ChartCard title="EPS" badge="split-adj USD" globalTf={globalTf}
            chart={(h,tf) => { const d=filterChartData(epsData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>fmtUSD(ctx.raw))} /> : <NoData/>; }} />
          <ChartCard title="Free Cash Flow" badge="USD B" globalTf={globalTf} stats={fcfGrowthStats}
            chart={(h,tf) => { const d=filterChartData(fcfData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Margins" badge="%" globalTf={globalTf}
            chart={(h,tf) => { const d=filterChartData(marginsData,tf); return d ? <Line data={d} options={mkOpts(ctx=>`${Number(ctx.raw).toFixed(1)}%`,true)} /> : <NoData/>; }} />
        </div>

        {/* Row 3: Shares, Balance Sheet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChartCard title="Shares Outstanding" badge="split-adj B" globalTf={globalTf}
            controls={dilutionRate!=null ? <span className={`text-[10px] ${dilutionRate<0?"text-emerald-400":"text-amber-400"}`}>{fmtPct(dilutionRate)}/yr</span> : undefined}
            chart={(h,tf) => { const d=filterChartData(sharesData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`${Number(ctx.raw).toFixed(2)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Balance Sheet" badge="USD B" globalTf={globalTf}
            chart={(h,tf) => { const d=filterChartData(balanceData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`,true)} /> : <NoData/>; }} />
        </div>

        {/* Row 4: Revenue by Segment (if available) */}
        {kpiData.segments.length > 0 && (
          <ChartCard title="Revenue by Segment" badge="USD B" height={220} globalTf={globalTf}
            controls={
              <div className="flex flex-wrap gap-1">
                {kpiData.segments.map((s,i) => (
                  <button key={s.key} onClick={() => toggleSegment(s.key)}
                    style={{ borderColor: CHART_COLORS[i%CHART_COLORS.length],
                      color: visibleSegments.has(s.key) ? "#fff" : "#71717a",
                      backgroundColor: visibleSegments.has(s.key) ? CHART_COLORS[i%CHART_COLORS.length]+"40" : "transparent" }}
                    className="text-[10px] px-2 py-0.5 rounded border transition-colors">
                    {s.label}
                  </button>
                ))}
              </div>
            }
            chart={(h,tf) => {
              const d = filterChartData(segmentChartData, tf);
              return d ? <Bar data={d} options={mkStacked(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData msg="Select at least one segment"/>;
            }}
          />
        )}

        {/* KPI charts */}
        {kpiCharts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {kpiCharts.map((kpi: any) => (
              <ChartCard key={kpi.key} title={kpi.label} badge={kpi.badge} height={180} globalTf={globalTf}
                chart={(h,tf) => { const d=filterChartData(kpi.data,tf); return d ? <Bar data={d} options={mkOpts(kpi.ttFmt)} /> : <NoData/>; }} />
            ))}
          </div>
        )}

        {/* Analyst consensus + price targets */}
        {analystData && (
          <AnalystBox data={analystData} currentPrice={meta?.regularMarketPrice ?? null} priceSeries={priceSeries} />
        )}

        <div className="pt-1 pb-4 border-t border-zinc-800/40">
          <p className="text-xs text-zinc-700">Data: SEC EDGAR (financials, KPIs, segments) · Yahoo Finance (price, splits, metrics, analyst estimates). Not financial advice.</p>
        </div>
      </div>
    </div>
  );
}
