import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yf = new (YahooFinance as any)();

async function fetchSplits(sym: string): Promise<any[]> {
  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = 631152000; // 1990-01-01 unix
    const url  = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
                 `?period1=${from}&period2=${now}&interval=1d&events=split`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FindQuan/1.0)' },
    });
    if (!res.ok) return [];
    const data   = await res.json();
    const events = data?.chart?.result?.[0]?.events?.splits;
    if (!events) return [];
    return Object.values(events)
      .map((s: any) => ({
        date:        new Date(s.date * 1000).toISOString().slice(0, 10),
        numerator:   Number(s.numerator),
        denominator: Number(s.denominator),
      }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
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
    const [result, quote, splits] = await Promise.all([
      (yf as any).historical(sym, { period1: start, period2: end }),
      (yf as any).quoteSummary(sym, { modules: MODULES }).catch(() => null),
      fetchSplits(sym),
    ]);
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
