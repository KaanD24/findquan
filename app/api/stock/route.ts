import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yf = new (YahooFinance as any)();

async function fetchSplits(sym: string): Promise<any[]> {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = 631152000; // 1990-01-01 unix
    // Try query2 first, fall back to query1
    for (const host of ['query2.finance.yahoo.com', 'query1.finance.yahoo.com']) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}` +
                  `?period1=${from}&period2=${now}&interval=1mo&events=split`;
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://finance.yahoo.com/',
          },
        });
        if (!res.ok) continue;
        const data   = await res.json();
        const events = data?.chart?.result?.[0]?.events?.splits;
        if (!events) continue;
        const splits = Object.values(events)
          .map((s: any) => ({
            date:        new Date(s.date * 1000).toISOString().slice(0, 10),
            numerator:   Number(s.numerator),
            denominator: Number(s.denominator),
          }))
          .sort((a: any, b: any) => a.date.localeCompare(b.date));
        if (splits.length) return splits;
      } catch { /* try next host */ }
    }
    return [];
  } catch {
    return [];
  }
}

// Parse "20:1" or "4/1" style split factor strings into { numerator, denominator }
function parseSplitFactor(raw: string): { numerator: number; denominator: number } | null {
  const m = String(raw).match(/(\d+\.?\d*)\s*[:/]\s*(\d+\.?\d*)/);
  if (!m) return null;
  const n = parseFloat(m[1]), d = parseFloat(m[2]);
  if (!n || !d) return null;
  return { numerator: n, denominator: d };
}

const MODULES = [
  'price', 'summaryDetail', 'financialData',
  'defaultKeyStatistics', 'earnings', 'calendarEvents',
  'incomeStatementHistory', 'incomeStatementHistoryQuarterly',
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const input = (searchParams.get('symbol') || searchParams.get('q') || 'AAPL').trim();
  const start = searchParams.get('start') || '2013-01-01';
  const end   = searchParams.get('end')   || new Date().toISOString().slice(0, 10);

  async function fetchAll(sym: string) {
    const [result, quote, splitsFromChart] = await Promise.all([
      (yf as any).historical(sym, { period1: start, period2: end }),
      (yf as any).quoteSummary(sym, { modules: MODULES }).catch(() => null),
      fetchSplits(sym),
    ]);

    let splits = splitsFromChart;

    // Fallback: if the chart API returned nothing, read lastSplitFactor from
    // defaultKeyStatistics (already fetched via quoteSummary above)
    if (!splits.length && quote) {
      const ks = quote.defaultKeyStatistics || {};
      const raw  = ks.lastSplitFactor;
      const dateRaw = ks.lastSplitDate;
      if (raw && dateRaw) {
        const parsed = parseSplitFactor(String(raw));
        const ts = typeof dateRaw === 'number' ? dateRaw
          : dateRaw instanceof Date ? Math.floor(dateRaw.getTime() / 1000)
          : Number(dateRaw?.raw ?? dateRaw);
        if (parsed && ts > 0) {
          splits = [{ date: new Date(ts * 1000).toISOString().slice(0, 10), ...parsed }];
        }
      }
    }

    return { symbol: sym, result, quote, splits };
  }

  try {
    try {
      return NextResponse.json(await fetchAll(input));
    } catch (err: any) {
      console.error('Historical lookup failed for', input, err?.message || err);
      const searchRes: any = await (yf as any).search(input);
      const guessed: string | undefined =
        Array.isArray(searchRes) ? searchRes[0]?.symbol :
        searchRes?.quotes?.[0]?.symbol;
      if (!guessed) throw new Error('Could not resolve symbol: ' + input);
      return NextResponse.json(await fetchAll(guessed));
    }
  } catch (err: any) {
    console.error('Unexpected error in /api/stock', err?.message || err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
