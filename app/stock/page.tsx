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
type TimeFilter = "ALL" | "10Y" | "5Y" | "2Y";

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
    const ny = new Date(n.period).getFullYear();
    const d = denominator.find(x => new Date(x.period).getFullYear() === ny);
    if (!d || d.val === 0) return null;
    return { period: n.period, val: (n.val / d.val) * 100 };
  }).filter(Boolean);
}

function computeFcf(ocfArr: any[], capexArr: any[]): any[] {
  if (!ocfArr.length) return [];
  return ocfArr.map(o => {
    const ny = new Date(o.period).getFullYear();
    const c = capexArr.find(x => new Date(x.period).getFullYear() === ny);
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

function mergeByYear(arrA: any[], arrB: any[], fn: (a: number, b: number) => number): any[] {
  return arrA.map(a => {
    const yr = new Date(a.period).getFullYear();
    const b = arrB.find(x => new Date(x.period).getFullYear() === yr);
    if (!b) return null;
    return { period: a.period, val: fn(a.val, b.val) };
  }).filter(Boolean);
}

function rangeToStart(range: string): string {
  const now = new Date();
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
  const yrs = tf === "10Y" ? 10 : tf === "5Y" ? 5 : 2;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - yrs);

  const first = data.labels[0] || "";
  let startIdx = 0;

  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    const cut = cutoff.toISOString().slice(0, 10);
    startIdx = data.labels.findIndex(l => l >= cut);
  } else if (/^\d{4}$/.test(first)) {
    const cutYr = cutoff.getFullYear();
    startIdx = data.labels.findIndex(l => parseInt(l) > cutYr);
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
function ChartCard({
  title, badge, controls, height = 180, chart,
}: {
  title: string;
  badge?: string;
  controls?: React.ReactNode;
  height?: number;
  chart: (h: number, tf: TimeFilter) => React.ReactNode;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [expandFilter, setExpandFilter] = useState<TimeFilter>("ALL");

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
        <div style={{ height }}>{chart(height, "ALL")}</div>
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
                  {(["ALL", "10Y", "5Y", "2Y"] as TimeFilter[]).map(f => (
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
            <div className="p-5" style={{ height: "65vh" }}>
              {chart(Math.round(window.innerHeight * 0.65 - 80), expandFilter)}
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

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function StockPage() {
  const [inputVal, setInputVal]   = useState("AAPL");
  const [symbol, setSymbol]       = useState("");
  const [period, setPeriod]       = useState<"quarterly" | "ttm" | "annual">("annual");
  const [timeRange, setTimeRange] = useState<"1Y" | "3Y" | "5Y" | "10Y" | "MAX">("MAX");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [visibleSegments, setVisibleSegments] = useState<Set<string>>(new Set());

  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [priceSeries, setPriceSeries] = useState<any[]>([]);
  const [splits, setSplits]       = useState<any[]>([]);
  const [meta, setMeta]           = useState<any>(null);
  const [revData, setRevData]     = useState<any>(null);
  const [kpiData, setKpiData]     = useState<{ segments: any[]; kpis: any[] }>({ segments: [], kpis: [] });

  useEffect(() => {
    try { const s = localStorage.getItem("fq_favorites"); if (s) setFavorites(JSON.parse(s)); } catch {}
    const p = new URLSearchParams(window.location.search);
    const t = (p.get("ticker") || p.get("s") || "AAPL").trim().toUpperCase();
    setInputVal(t);
    loadStock(t, "MAX");
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
        const qs  = revJson.revenue?.quarter   || [];
        const niQ = revJson.netIncome?.quarter || [];
        const oiQ = revJson.operatingIncome?.quarter || [];
        setRevData({
          annual: revJson.revenue?.annual || [], quarter: qs, ttm: computeTtm(qs),
          netIncomeAnnual: revJson.netIncome?.annual || [], netIncomeQuarter: niQ, netIncomeTtm: computeTtm(niQ),
          oiAnnual: revJson.operatingIncome?.annual || [], oiQuarter: oiQ, oiTtm: computeTtm(oiQ),
          daAnnual: revJson.da?.annual || [], daQuarter: revJson.da?.quarter || [],
          grossProfitAnnual: revJson.grossProfit?.annual || [],
          ocfAnnual: revJson.ocf?.annual || [], ocfQuarter: revJson.ocf?.quarter || [],
          capexAnnual: revJson.capex?.annual || [], capexQuarter: revJson.capex?.quarter || [],
          cashAnnual:   revJson.cash?.annual   || [],
          ltDebtAnnual: revJson.ltDebt?.annual || [],
          stDebtAnnual: revJson.stDebt?.annual || [],
          shares: revJson.shares || [],
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
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const s = inputVal.trim().toUpperCase();
    if (s) { setTimeRange("MAX"); loadStock(s, "MAX"); }
  }
  function handleRange(r: "1Y" | "3Y" | "5Y" | "10Y" | "MAX") {
    setTimeRange(r); if (symbol) loadStock(symbol, r);
  }
  function toggleSegment(key: string) {
    setVisibleSegments(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // ─── derived series ──────────────────────────────────────────────────────────
  const revArr    = useMemo(() => sortedByPeriod(revData?.annual           || []), [revData]);
  const netArr    = useMemo(() => sortedByPeriod(revData?.netIncomeAnnual  || []), [revData]);
  const oiArr     = useMemo(() => sortedByPeriod(revData?.oiAnnual         || []), [revData]);
  const gpArr     = useMemo(() => sortedByPeriod(revData?.grossProfitAnnual || []), [revData]);
  const ocfArr    = useMemo(() => sortedByPeriod(revData?.ocfAnnual        || []), [revData]);
  const capexArr  = useMemo(() => sortedByPeriod(revData?.capexAnnual      || []), [revData]);
  const sharesArr = useMemo(() => sortedByPeriod(revData?.shares           || []), [revData]);
  const rawEpsArr = useMemo(() => computeEps(netArr, sharesArr), [netArr, sharesArr]);

  // Split-adjusted shares and EPS
  const splitAdjSharesArr = useMemo(() => {
    if (!sharesArr.length || !splits.length) return sharesArr;
    return sharesArr.map(s => ({ ...s, val: s.val * getCumulativeSplitFactor(s.period, splits) }));
  }, [sharesArr, splits]);

  const splitAdjEpsArr = useMemo(() => {
    if (!rawEpsArr.length || !splits.length) return rawEpsArr;
    return rawEpsArr.map((e: any) => {
      const f = getCumulativeSplitFactor(e.period, splits);
      return { ...e, val: e.val / f };
    });
  }, [rawEpsArr, splits]);

  const ebitdaArr      = useMemo(() => mergeEbitda(oiArr, sortedByPeriod(revData?.daAnnual || [])), [oiArr, revData]);
  const grossMarginArr = useMemo(() => computeMarginPct(gpArr,  revArr), [gpArr, revArr]);
  const opMarginArr    = useMemo(() => computeMarginPct(oiArr,  revArr), [oiArr, revArr]);
  const netMarginArr   = useMemo(() => computeMarginPct(netArr, revArr), [netArr, revArr]);
  const fcfArr         = useMemo(() => computeFcf(ocfArr, capexArr), [ocfArr, capexArr]);

  // Balance sheet: cash and total debt (LT + ST) by year
  const cashArr   = useMemo(() => sortedByPeriod(revData?.cashAnnual   || []), [revData]);
  const ltDebtArr = useMemo(() => sortedByPeriod(revData?.ltDebtAnnual || []), [revData]);
  const stDebtArr = useMemo(() => sortedByPeriod(revData?.stDebtAnnual || []), [revData]);
  const totalDebtArr = useMemo(() =>
    mergeByYear(ltDebtArr, stDebtArr, (a, b) => a + b).length
      ? mergeByYear(ltDebtArr, stDebtArr, (a, b) => a + b)
      : ltDebtArr,
    [ltDebtArr, stDebtArr]);

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
  const peLineData = useMemo(() => {
    if (!dailyPeSeries.length) return null;
    const series = dailyPeSeries as any[];
    return {
      labels: series.map(p => p.date),
      datasets: [
        { label: "P/E Ratio", data: series.map(p => p.pe),
          borderColor: "#a855f7", backgroundColor: "rgba(168,85,247,0.07)",
          fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0 },
        ...(peStats?.avg5 ? [{ label: "5y avg", data: series.map(() => peStats.avg5),
          borderColor: "rgba(251,191,36,0.6)", borderDash: [4,4], borderWidth: 1.5, pointRadius: 0, tension: 0 }] : []),
        ...(peStats?.avg10 ? [{ label: "10y avg", data: series.map(() => peStats.avg10),
          borderColor: "rgba(239,68,68,0.5)", borderDash: [6,6], borderWidth: 1.5, pointRadius: 0, tension: 0 }] : []),
      ],
    };
  }, [dailyPeSeries, peStats]);

  // Split-adjusted EPS bar
  const epsData = useMemo(() => {
    if (!splitAdjEpsArr.length) return null;
    const vals = splitAdjEpsArr.map((e: any) => e.val);
    return { labels: splitAdjEpsArr.map((e: any) => yearLabel(e.period)),
      datasets: [{ label: "EPS (adj)", data: vals,
        backgroundColor: barBg(vals, "rgba(245,158,11,0.75)", "rgba(239,68,68,0.75)"),
        borderColor:     barBg(vals, "rgba(245,158,11,1)",    "rgba(239,68,68,1)"),
        borderWidth: 1, borderRadius: 3 }] };
  }, [splitAdjEpsArr]);

  // Margins 3-line
  const marginsData = useMemo(() => {
    if (!revArr.length) return null;
    const getVal = (arr: any[], yr: number) => arr.find(x => new Date(x.period).getFullYear() === yr)?.val ?? null;
    const years  = revArr.map(r => new Date(r.period).getFullYear());
    const gVals  = years.map(y => getVal(grossMarginArr, y));
    const oVals  = years.map(y => getVal(opMarginArr, y));
    const nVals  = years.map(y => getVal(netMarginArr, y));
    if (![...gVals,...oVals,...nVals].some(v => v !== null)) return null;
    return {
      labels: revArr.map(r => yearLabel(r.period)),
      datasets: [
        { label: "Gross",     data: gVals, borderColor: "#22c55e", backgroundColor: "rgba(34,197,94,0.07)",  fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
        { label: "Operating", data: oVals, borderColor: "#3b82f6", backgroundColor: "transparent", fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
        { label: "Net",       data: nVals, borderColor: "#f59e0b", backgroundColor: "transparent", fill: false, tension: 0.3, borderWidth: 1.5, pointRadius: 2, spanGaps: true },
      ],
    };
  }, [revArr, grossMarginArr, opMarginArr, netMarginArr]);

  // Split-adjusted shares bar
  const sharesData = useMemo(() => {
    if (!splitAdjSharesArr.length) return null;
    const vals = splitAdjSharesArr.map(s => s.val / 1e9);
    const col  = dilutionRate != null && dilutionRate < 0
      ? { bg: "rgba(34,197,94,0.75)",  b: "rgba(34,197,94,1)" }
      : { bg: "rgba(249,115,22,0.75)", b: "rgba(249,115,22,1)" };
    return { labels: splitAdjSharesArr.map(s => yearLabel(s.period)),
      datasets: [{ label: "Shares (adj)", data: vals, backgroundColor: col.bg, borderColor: col.b, borderWidth: 1, borderRadius: 3 }] };
  }, [splitAdjSharesArr, dilutionRate]);

  // Balance sheet
  const balanceData = useMemo(() => {
    if (!cashArr.length && !totalDebtArr.length) return null;
    const base = cashArr.length ? cashArr : totalDebtArr;
    const years = base.map(r => new Date(r.period).getFullYear());
    const labels = base.map(r => yearLabel(r.period));
    const getY = (arr: any[], yr: number) => (arr.find(x => new Date(x.period).getFullYear() === yr)?.val ?? null);
    return {
      labels,
      datasets: [
        { label: "Cash & Equiv.", data: years.map(y => { const v = getY(cashArr, y); return v != null ? v/1e9 : null; }),
          backgroundColor: "rgba(34,197,94,0.75)", borderColor: "rgba(34,197,94,1)", borderWidth: 1, borderRadius: 3 },
        { label: "Total Debt",    data: years.map(y => { const v = getY(totalDebtArr, y); return v != null ? v/1e9 : null; }),
          backgroundColor: "rgba(239,68,68,0.75)",  borderColor: "rgba(239,68,68,1)",  borderWidth: 1, borderRadius: 3 },
      ],
    };
  }, [cashArr, totalDebtArr]);

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
              <button key={s} onClick={() => { setInputVal(s); setTimeRange("MAX"); loadStock(s,"MAX"); }}
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

            <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-zinc-800/60 border border-zinc-800/60 rounded-t-xl overflow-hidden bg-zinc-900/40">
              <MetricsSection title="Valuation">
                <MetricRow label="Market Cap"    value={fmtB(meta.marketCap)} />
                <MetricRow label="PE (TTM | Fwd)" value={`${meta.trailingPE ? Number(meta.trailingPE).toFixed(1):"—"} | ${meta.forwardPE ? Number(meta.forwardPE).toFixed(1):"—"}`} />
                <MetricRow label="Price / Sales" value={meta.priceToSales ? fmtX(meta.priceToSales) : "—"} />
                <MetricRow label="EV / EBITDA"   value={meta.evToEbitda   ? fmtX(meta.evToEbitda)   : "—"} />
                <MetricRow label="Price / Book"  value={meta.priceToBook  ? fmtX(meta.priceToBook)  : "—"} />
              </MetricsSection>
              <MetricsSection title="Cash Flow">
                <MetricRow label="Free Cash Flow"  value={fmtB(meta.freeCashflow)} />
                <MetricRow label="FCF Yield"        value={meta.fcfYield    ? fmtPctPlain(meta.fcfYield)    : "—"} />
                <MetricRow label="FCF / Share"      value={meta.fcfPerShare ? fmtUSD(meta.fcfPerShare)      : "—"} />
                <MetricRow label="Operating CF"     value={fmtB(meta.operatingCashflow)} />
                {revCagr != null && <MetricRow label="Rev CAGR" value={fmtPct(revCagr)} color={revCagr >= 0 ? "text-emerald-400" : "text-red-400"} />}
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
              <MetricsSection title="Balance">
                <MetricRow label="Cash"  value={fmtB(meta.totalCash)} color="text-emerald-400" />
                <MetricRow label="Debt"  value={fmtB(meta.totalDebt)} color={meta.totalDebt ? "text-red-400":undefined} />
                <MetricRow label="Net"   value={fmtB(meta.netCash)}
                  color={meta.netCash != null ? (meta.netCash >= 0 ? "text-emerald-400":"text-red-400") : undefined} />
                {dilutionRate != null && <MetricRow label="Dilution / yr" value={fmtPct(dilutionRate)}
                  color={dilutionRate < 0 ? "text-emerald-400" : dilutionRate > 0.02 ? "text-red-400":"text-amber-400"} />}
                {earningsCagr != null && <MetricRow label="EPS CAGR" value={fmtPct(earningsCagr)}
                  color={earningsCagr >= 0 ? "text-emerald-400":"text-red-400"} />}
              </MetricsSection>
              <MetricsSection title="Dividend">
                <MetricRow label="Div Yield"    value={meta.dividendYield ? fmtPctPlain(meta.dividendYield) : "None"}
                  color={meta.dividendYield ? "text-amber-400":"text-zinc-600"} />
                <MetricRow label="Payout Ratio" value={meta.payoutRatio ? fmtPctPlain(meta.payoutRatio) : "—"} />
                {meta.exDividendDate && <MetricRow label="Ex-Div Date" value={
                  typeof meta.exDividendDate === "number"
                    ? new Date(meta.exDividendDate*1000).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
                    : String(meta.exDividendDate)
                } />}
                {currentPe != null && <MetricRow label="P/E (current)" value={fmtX(currentPe)} />}
                {peStats?.avg5  && <MetricRow label="P/E 5Y Avg"  value={fmtX(peStats.avg5)}  color="text-amber-400/80" />}
                {peStats?.avg10 && <MetricRow label="P/E 10Y Avg" value={fmtX(peStats.avg10)} color="text-red-400/70"   />}
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
            {(["1Y","3Y","5Y","10Y","MAX"] as const).map(r => (
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
          <ChartCard title="Price"
            controls={pricePct!=null ? <span className={`font-semibold text-xs ${isUp?"text-emerald-400":"text-red-400"}`}>{isUp?"+":""}{(pricePct*100).toFixed(2)}%</span> : undefined}
            chart={(h,tf) => { const d=filterChartData(priceData,tf); return d ? <Line data={d} options={mkOpts(ctx=>fmtUSD(ctx.raw))} /> : <NoData/>; }} />
          <ChartCard title="Revenue" badge="USD B"
            chart={(h,tf) => { const d=filterChartData(revenueData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="EBITDA" badge="USD B"
            chart={(h,tf) => { const d=filterChartData(ebitdaData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Net Income" badge="USD B"
            chart={(h,tf) => { const d=filterChartData(netIncomeData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
        </div>

        {/* Row 2: P/E (continuous), EPS, FCF, Margins */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <ChartCard title="P/E Ratio" badge="price ÷ EPS"
            chart={(h,tf) => { const d=filterChartData(peLineData,tf); return d ? <Line data={d} options={mkOpts(ctx=>fmtX(ctx.raw),peStats?.avg5!=null)} /> : <NoData msg="Needs EPS data"/>; }} />
          <ChartCard title="EPS" badge="split-adj USD"
            chart={(h,tf) => { const d=filterChartData(epsData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>fmtUSD(ctx.raw))} /> : <NoData/>; }} />
          <ChartCard title="Free Cash Flow" badge="USD B"
            chart={(h,tf) => { const d=filterChartData(fcfData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Margins" badge="%"
            chart={(h,tf) => { const d=filterChartData(marginsData,tf); return d ? <Line data={d} options={mkOpts(ctx=>`${Number(ctx.raw).toFixed(1)}%`,true)} /> : <NoData/>; }} />
        </div>

        {/* Row 3: Shares, Balance Sheet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChartCard title="Shares Outstanding" badge="split-adj B"
            controls={dilutionRate!=null ? <span className={`text-[10px] ${dilutionRate<0?"text-emerald-400":"text-amber-400"}`}>{fmtPct(dilutionRate)}/yr</span> : undefined}
            chart={(h,tf) => { const d=filterChartData(sharesData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`${Number(ctx.raw).toFixed(2)}B`)} /> : <NoData/>; }} />
          <ChartCard title="Balance Sheet" badge="USD B"
            chart={(h,tf) => { const d=filterChartData(balanceData,tf); return d ? <Bar data={d} options={mkOpts(ctx=>`$${Number(ctx.raw).toFixed(1)}B`,true)} /> : <NoData/>; }} />
        </div>

        {/* Row 4: Revenue by Segment (if available) */}
        {kpiData.segments.length > 0 && (
          <ChartCard title="Revenue by Segment" badge="USD B" height={220}
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
              <ChartCard key={kpi.key} title={kpi.label} badge={kpi.badge} height={180}
                chart={(h,tf) => { const d=filterChartData(kpi.data,tf); return d ? <Bar data={d} options={mkOpts(kpi.ttFmt)} /> : <NoData/>; }} />
            ))}
          </div>
        )}

        <div className="pt-1 pb-4 border-t border-zinc-800/40">
          <p className="text-xs text-zinc-700">Data: SEC EDGAR (financials, KPIs, segments) · Yahoo Finance (price, splits, metrics). Not financial advice.</p>
        </div>
      </div>
    </div>
  );
}
