import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yf = new (YahooFinance as any)();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'AAPL').toUpperCase();
    const start = searchParams.get('start') || '2013-01-01';
    const end = searchParams.get('end') || new Date().toISOString().slice(0, 10);

    // Fetch prices and earnings data in parallel — no internal HTTP calls
    const [prices, summary] = await Promise.all([
      (yf as any).historical(symbol, { period1: start, period2: end }),
      (yf as any).quoteSummary(symbol, {
        modules: ['defaultKeyStatistics', 'summaryDetail', 'earnings'],
      }).catch(() => null),
    ]);

    if (!Array.isArray(prices) || !prices.length) {
      return NextResponse.json({ error: 'No price data found' }, { status: 404 });
    }

    // ── Extract split-adjusted quarterly EPS ──────────────────────────────
    // earningsChart.quarterly[].actual is the reported EPS per quarter,
    // already split-adjusted. periodEndDate is in epoch SECONDS.
    const rawQuarters: any[] =
      summary?.earnings?.earningsChart?.quarterly || [];

    const quarterlyEps: { date: string; eps: number }[] = rawQuarters
      .map((q: any) => {
        const ts = q.periodEndDate;
        if (ts == null || q.actual == null) return null;
        const date = new Date(Number(ts) * 1000).toISOString().slice(0, 10);
        return { date, eps: Number(q.actual) };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.date.localeCompare(b.date)) as any[];

    // ── Build TTM EPS for a given price date ─────────────────────────────
    // TTM = sum of the 4 most recent quarterly EPS values on or before priceDate.
    function ttmEpsAt(priceDate: string): number | null {
      const available = quarterlyEps.filter((q) => q.date <= priceDate);
      if (available.length < 4) return null;
      const recent4 = available.slice(-4);
      const sum = recent4.reduce((s, q) => s + q.eps, 0);
      return isFinite(sum) ? sum : null;
    }

    // ── Build daily P/E series ────────────────────────────────────────────
    const peSeries: { date: string; close: number; pe: number }[] = [];

    for (const p of prices) {
      const priceDate = new Date(p.date).toISOString().slice(0, 10);
      const ttm = ttmEpsAt(priceDate);
      if (ttm == null || ttm <= 0) continue;
      const pe = p.close / ttm;
      if (isFinite(pe) && pe > 0 && pe < 1000) {
        peSeries.push({ date: priceDate, close: p.close, pe });
      }
    }

    // ── Rolling averages ──────────────────────────────────────────────────
    const now = new Date();
    const cut5 = new Date(now); cut5.setFullYear(now.getFullYear() - 5);
    const cut10 = new Date(now); cut10.setFullYear(now.getFullYear() - 10);

    const pe5 = peSeries.filter((s) => new Date(s.date) >= cut5).map((s) => s.pe);
    const pe10 = peSeries.filter((s) => new Date(s.date) >= cut10).map((s) => s.pe);

    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const trailingEps: number | null =
      summary?.defaultKeyStatistics?.trailingEps ?? null;
    const trailingPE: number | null =
      summary?.summaryDetail?.trailingPE ??
      summary?.defaultKeyStatistics?.trailingPE ??
      null;

    const stats = {
      avg5: avg(pe5),
      avg10: avg(pe10),
      max: peSeries.length ? Math.max(...peSeries.map((s) => s.pe)) : null,
      min: peSeries.length ? Math.min(...peSeries.map((s) => s.pe)) : null,
      trailingEps,
      trailingPE,
    };

    return NextResponse.json({ symbol, peSeries, stats, quarterlyEps });
  } catch (err: any) {
    console.error('Error in /api/pe:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
