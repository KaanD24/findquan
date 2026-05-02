import { NextResponse } from 'next/server';

const UA = 'FindQuan/1.0 (kaanthegamer24@gmail.com)';

const USGAAP_KPI = [
  'RevenueRemainingPerformanceObligation',
  'ContractWithCustomerLiabilityNoncurrent',
];

// User/engagement metrics must be checked BEFORE generic revenue terms
// so "AverageRevenuePerUser" → kpi, not segment
const KPI_TERMS = [
  'user', 'subscriber', 'member', 'viewer', 'listener', 'player',
  'customer', 'account', 'device', 'vehicle', 'deliver', 'install',
  'backlog', 'remaining', 'impression', 'engagement', 'arpu', 'arpa',
  'dau', 'mau', 'wau', 'peruser', 'perperson', 'persubscriber',
  'rides', 'trips', 'riders', 'nights', 'listings', 'searches',
  'streams', 'downloads', 'activations', 'utilization',
];

const SEGMENT_TERMS = ['revenue', 'sales', 'income', 'net'];

// Precise boring patterns — NOT "other" (blocks OtherBets) or "total" (too broad)
const BORING_TERMS = [
  'stockbased', 'sharedbased', 'compensation', 'benefit', 'expense', 'cost', 'tax',
  'asset', 'liabilit', 'equity', 'interest', 'deprecia', 'amortiz',
  'pension', 'lease', 'property', 'goodwill', 'intangible', 'hedge',
  'derivative', 'cumulative', 'allowance', 'adjustment', 'deferred',
  'payable', 'receivable', 'inventory', 'prepaid',
  'weighted', 'authorize', 'repurchas',
  'comprehensiveincome', 'nonoperating', 'extraordinar',
];

interface Series { period: string; val: number }

function periodDays(e: any): number {
  if (!e.start || !e.end) return -1;
  return (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86400000;
}

function extractSeries(entries: any[], mode: 'annual' | 'quarterly' | 'pointInTime'): Series[] {
  const filtered = entries.filter((e) => {
    if (mode === 'pointInTime') return !e.start && !!e.end;
    const d = periodDays(e);
    if (d < 0) {
      // no start date: use fp field
      if (mode === 'annual')    return e.fp === 'FY';
      if (mode === 'quarterly') return e.fp === 'Q1' || e.fp === 'Q2' || e.fp === 'Q3' || e.fp === 'Q4';
      return false;
    }
    if (mode === 'annual')    return d >= 330 && d <= 400;
    if (mode === 'quarterly') return d >= 60  && d <= 120;
    return false;
  });

  const map = new Map<string, any>();
  for (const e of filtered) {
    const key = e.end;
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (e.filed || '') > (prev.filed || '')) map.set(key, e);
  }

  return Array.from(map.values())
    .sort((a, b) => (a.end || '').localeCompare(b.end || ''))
    .map((e) => ({ period: e.end, val: Number(e.val) }))
    .filter((e) => e.period && isFinite(e.val));
}

function toLabel(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// KPI terms checked FIRST so "AverageRevenuePerUser" → kpi not segment
function classify(name: string, unit: string): 'segment' | 'kpi' | null {
  const lower = name.toLowerCase();
  if (BORING_TERMS.some((t) => lower.includes(t))) return null;
  if (KPI_TERMS.some((t) => lower.includes(t))) return 'kpi';
  if (unit === 'USD' && SEGMENT_TERMS.some((t) => lower.includes(t))) return 'segment';
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'AAPL').toUpperCase();

    const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': UA },
    });
    if (!tickersRes.ok) return NextResponse.json({ segments: [], kpis: [] });

    const tickers = await tickersRes.json();
    let cik: string | null = null;
    for (const v of Object.values(tickers) as any[]) {
      if (v.ticker?.toUpperCase() === symbol) {
        cik = String(v.cik_str).padStart(10, '0');
        break;
      }
    }
    if (!cik) return NextResponse.json({ segments: [], kpis: [] });

    const factsRes = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { 'User-Agent': UA },
    });
    if (!factsRes.ok) return NextResponse.json({ segments: [], kpis: [] });

    const facts = await factsRes.json();
    const allFacts: Record<string, any> = facts?.facts || {};

    const segments: any[] = [];
    const kpis: any[]     = [];

    for (const [ns, concepts] of Object.entries(allFacts)) {
      if (ns === 'us-gaap' || ns === 'dei') continue;

      for (const [conceptName, conceptData] of Object.entries(concepts as Record<string, any>)) {
        const allUnits: Record<string, any[]> = conceptData?.units || {};
        const unit   = 'USD' in allUnits ? 'USD' : Object.keys(allUnits)[0] || '';
        const entries: any[] = allUnits[unit] || [];
        if (!entries.length) continue;

        const cat = classify(conceptName, unit);
        if (!cat) continue;

        let annual    = extractSeries(entries, 'annual');
        let quarterly = extractSeries(entries, 'quarterly');
        if (!annual.length) annual = extractSeries(entries, 'pointInTime');

        // KPIs need 2+ points; segments need 3+ and meaningful scale
        const best = annual.length >= quarterly.length ? annual : quarterly;
        const minPts = cat === 'segment' ? 3 : 2;
        if (best.length < minPts) continue;

        if (cat === 'segment') {
          const max = Math.max(...best.map((e) => Math.abs(e.val)));
          if (max < 1e8) continue; // must be at least $100M
        }

        const record = { key: `${ns}:${conceptName}`, label: toLabel(conceptName), unit, annual, quarterly };
        if (cat === 'segment') segments.push(record);
        else                   kpis.push(record);
      }
    }

    // us-gaap KPI concepts (backlog / deferred revenue)
    const usgaap = allFacts['us-gaap'] || {};
    for (const concept of USGAAP_KPI) {
      const data = usgaap[concept];
      if (!data?.units?.USD) continue;
      const entries = data.units.USD;
      const annual    = extractSeries(entries, 'annual');
      const quarterly = extractSeries(entries, 'quarterly');
      if (annual.length < 2 && quarterly.length < 2) continue;
      kpis.push({ key: `us-gaap:${concept}`, label: toLabel(concept), unit: 'USD', annual, quarterly });
    }

    // Sort segments largest-first (biggest revenue line first)
    segments.sort((a, b) => {
      const sumA = a.annual.reduce((s: number, e: Series) => s + e.val, 0);
      const sumB = b.annual.reduce((s: number, e: Series) => s + e.val, 0);
      return sumB - sumA;
    });

    return NextResponse.json({
      symbol,
      segments: segments.slice(0, 10),
      kpis:     kpis.slice(0, 8),
    });
  } catch (err: any) {
    console.error('Error in /api/kpi:', err);
    return NextResponse.json({ segments: [], kpis: [] });
  }
}
