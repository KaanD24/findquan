import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yf = new (YahooFinance as any)();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'AAPL').trim().toUpperCase();

  try {
    const quote = await (yf as any).quoteSummary(symbol, {
      modules: ['financialData', 'recommendationTrend', 'earningsTrend', 'price', 'upgradeDowngradeHistory'],
    }).catch(() => null);

    if (!quote) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const fd = quote.financialData        || {};
    const rt = quote.recommendationTrend  || {};
    const et = quote.earningsTrend        || {};
    const pr = quote.price                || {};
    const uh = quote.upgradeDowngradeHistory || {};

    const trend = rt.trend?.[0] || {};

    const estimates = (et.trend || []).map((e: any) => ({
      period:      e.period,
      endDate:     e.endDate,
      epsAvg:      e.earningsEstimate?.avg    ?? null,
      epsLow:      e.earningsEstimate?.low    ?? null,
      epsHigh:     e.earningsEstimate?.high   ?? null,
      epsYearAgo:  e.earningsEstimate?.yearAgoEps ?? null,
      revenueAvg:  e.revenueEstimate?.avg     ?? null,
      revenueLow:  e.revenueEstimate?.low     ?? null,
      revenueHigh: e.revenueEstimate?.high    ?? null,
      epsGrowth:   e.earningsEstimate?.growth ?? null,
      revGrowth:   e.revenueEstimate?.growth  ?? null,
    }));

    return NextResponse.json({
      symbol,
      currentPrice: fd.currentPrice    ?? pr.regularMarketPrice ?? null,
      targetLow:    fd.targetLowPrice  ?? null,
      targetMean:   fd.targetMeanPrice ?? null,
      targetMedian: fd.targetMedianPrice ?? null,
      targetHigh:   fd.targetHighPrice ?? null,
      numAnalysts:  fd.numberOfAnalystOpinions ?? null,
      recMean:      fd.recommendationMean ?? null,
      recKey:       fd.recommendationKey  ?? null,
      strongBuy:    trend.strongBuy  ?? 0,
      buy:          trend.buy        ?? 0,
      hold:         trend.hold       ?? 0,
      sell:         trend.sell       ?? 0,
      strongSell:   trend.strongSell ?? 0,
      estimates,
      // Most recent rating per firm, up to 15 firms, sorted by date desc
      ratings: Object.values(
        ((uh.history || []) as any[]).reduce((acc: any, h: any) => {
          if (!acc[h.firm]) acc[h.firm] = h;
          return acc;
        }, {} as any)
      )
        .sort((a: any, b: any) => b.epochGradeDate - a.epochGradeDate)
        .slice(0, 15)
        .map((h: any) => ({
          firm:   h.firm,
          grade:  h.toGrade,
          action: h.action,   // "main" | "up" | "down" | "init" | "reit"
          date:   new Date(h.epochGradeDate * 1000).toISOString().slice(0, 10),
        })),
    });
  } catch (err: any) {
    console.error('Error in /api/analyst:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
