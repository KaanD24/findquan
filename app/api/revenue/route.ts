import { NextResponse } from 'next/server';

const UA = 'FindQuan/1.0 (kaanthegamer24@gmail.com)';

const REV_PRIORITY = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'Revenues',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'NetSales',
  'TotalRevenues',
  'RevenuesNetOfInterestExpense',
];

const NI_PRIORITY = [
  'NetIncomeLoss',
  'NetIncomeLossAvailableToCommonStockholdersBasic',
  'ProfitLoss',
  'NetIncome',
  'IncomeLossFromContinuingOperations',
];

const SHARES_PRIORITY = [
  'CommonStockSharesOutstanding',
  'WeightedAverageNumberOfSharesOutstandingBasic',
  'WeightedAverageNumberOfDilutedSharesOutstanding',
  'WeightedAverageNumberOfSharesOutstandingDiluted',
];

const OI_PRIORITY = [
  'OperatingIncomeLoss',
  'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
];

const DA_PRIORITY = [
  'DepreciationDepletionAndAmortization',
  'DepreciationAndAmortization',
  'Depreciation',
  'DepreciationAmortizationAndAccretionNet',
];

const GP_PRIORITY = [
  'GrossProfit',
];

const COGS_PRIORITY = [
  'CostOfRevenue',
  'CostOfGoodsAndServicesSold',
  'CostOfGoodsSold',
  'CostOfGoodsSoldAndServicesSold',
];

const OCF_PRIORITY = [
  'NetCashProvidedByUsedInOperatingActivities',
  'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
];

const CAPEX_PRIORITY = [
  'PaymentsToAcquirePropertyPlantAndEquipment',
  'PaymentsForCapitalImprovements',
];

// Balance sheet
const CASH_PRIORITY = [
  'CashCashEquivalentsAndShortTermInvestments',
  'CashAndCashEquivalentsAndShortTermInvestments',
  'CashAndCashEquivalentsAtCarryingValue',
  'CashAndCashEquivalents',
];

const LT_DEBT_PRIORITY = [
  'LongTermDebtNoncurrent',
  'LongTermDebt',
  'LongTermDebtAndCapitalLeaseObligations',
];

const ST_DEBT_PRIORITY = [
  'DebtCurrent',
  'ShortTermBorrowings',
  'NotesPayableToBankCurrent',
  'LongTermDebtCurrent',
  'LongTermDebtAndCapitalLeaseObligationsCurrent',
];

function getUnitEntries(usgaap: any, concept: string): any[] {
  const obj = usgaap[concept];
  if (!obj?.units) return [];
  const units = obj.units as Record<string, any[]>;
  return (units['USD'] || units['shares'] || (Object.values(units)[0] as any[]) || []);
}

function dedupeByEnd(entries: any[]): any[] {
  const map = new Map<string, any>();
  for (const e of entries) {
    const key = e.end || e.date;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (e.filed || '') > (existing.filed || '')) {
      map.set(key, e);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    (a.end || a.date || '').localeCompare(b.end || b.date || '')
  );
}

function periodDays(e: any): number {
  if (!e.start || !e.end) return 0;
  return (new Date(e.end).getTime() - new Date(e.start).getTime()) / 86400000;
}

function isAnnual(e: any): boolean {
  const d = periodDays(e);
  if (d > 0) return d >= 330 && d <= 400;
  if (e.fp === 'FY') return true;
  // Some filings omit fp but identify via form type
  if (e.form && (e.form === '10-K' || e.form.startsWith('10-K'))) return true;
  return false;
}

function isQuarterly(e: any): boolean {
  const d = periodDays(e);
  if (d > 0) return d >= 60 && d <= 120;
  if (['Q1','Q2','Q3','Q4'].includes(e.fp)) return true;
  if (e.form && (e.form === '10-Q' || e.form.startsWith('10-Q'))) return true;
  return false;
}

interface ConceptSeries { annual: any[]; quarter: any[] }

// Cash-flow items (OCF, CAPEX) are filed as cumulative YTD in 10-Qs:
//   Q1 filing  = 90-day period   (standalone Q1 already)
//   Q2 filing  = 180-day period  (Q1+Q2 cumulative)
//   Q3 filing  = 270-day period  (Q1+Q2+Q3 cumulative)
//   Annual     = 365-day period
// We collect all durations from one fiscal-year start date and diff them
// to produce standalone quarterly values.
function extractCashFlowQuarters(entries: any[]): any[] {
  const dur = entries.filter(e => e.start && e.end && e.end > e.start);
  if (!dur.length) return [];

  // Dedupe by (start, end) pair — keep most-recently-filed version
  const pairMap = new Map<string, any>();
  for (const e of dur) {
    const key = `${e.start}|${e.end}`;
    const prev = pairMap.get(key);
    if (!prev || (e.filed || '') > (prev.filed || '')) pairMap.set(key, e);
  }

  // Group by fiscal-year start date
  const byStart = new Map<string, any[]>();
  for (const e of pairMap.values()) {
    if (!byStart.has(e.start)) byStart.set(e.start, []);
    byStart.get(e.start)!.push(e);
  }

  const result: any[] = [];

  for (const periodEntries of byStart.values()) {
    const sorted = periodEntries.sort((a, b) => periodDays(a) - periodDays(b));

    const find = (lo: number, hi: number) =>
      sorted.find(e => { const d = periodDays(e); return d >= lo && d <= hi; });

    const q1 = find(75,  115);  // ~90d
    const q2 = find(155, 205);  // ~180d
    const q3 = find(235, 300);  // ~270d
    const fy = find(330, 400);  // ~365d

    // Standalone = cumulative[n] - cumulative[n-1]
    if (q1)       result.push({ ...q1, val: q1.val });
    if (q2 && q1) result.push({ ...q2, val: q2.val - q1.val });
    if (q3 && q2) result.push({ ...q3, val: q3.val - q2.val });
    if (fy && q3) result.push({ ...fy, val: fy.val - q3.val });
    else if (fy && q2 && !q3) result.push({ ...fy, val: fy.val - q2.val });
  }

  return dedupeByEnd(result).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
}

function pickBestConcept(usgaap: any, priorityList: string[]): ConceptSeries {
  const allAnnual: any[] = [];
  const allQuarter: any[] = [];

  const conceptsToTry: string[] = [...priorityList];
  const patterns = priorityList.map((c) => c.toLowerCase().slice(0, 12));
  for (const key of Object.keys(usgaap)) {
    const lk = key.toLowerCase();
    if (!priorityList.includes(key) && patterns.some((p) => lk.startsWith(p))) {
      conceptsToTry.push(key);
    }
  }

  for (const c of conceptsToTry) {
    const all = getUnitEntries(usgaap, c);
    allAnnual.push(...all.filter(isAnnual));
    allQuarter.push(...all.filter(isQuarterly));
  }

  return { annual: dedupeByEnd(allAnnual), quarter: dedupeByEnd(allQuarter) };
}

function norm(entries: any[]): { period: string; val: number }[] {
  return entries
    .map((e) => ({ period: e.end || e.date || '', val: Number(e.val) }))
    .filter((e) => e.period && isFinite(e.val));
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') || 'AAPL').toUpperCase();

    const tickersRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': UA },
    });
    if (!tickersRes.ok)
      return NextResponse.json({ error: 'Failed to fetch SEC tickers' }, { status: 502 });

    const tickers = await tickersRes.json();

    let cik: string | null = null;
    for (const v of Object.values(tickers) as any[]) {
      if (v.ticker?.toUpperCase() === symbol) {
        cik = String(v.cik_str).padStart(10, '0');
        break;
      }
    }
    if (!cik)
      return NextResponse.json({ error: `Ticker ${symbol} not found in SEC master list` }, { status: 404 });

    const factsRes = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { 'User-Agent': UA },
    });
    if (!factsRes.ok)
      return NextResponse.json({ error: 'Failed to fetch company facts from SEC' }, { status: 502 });

    const facts = await factsRes.json();
    const usgaap = facts?.facts?.['us-gaap'] || {};

    const revenue = pickBestConcept(usgaap, REV_PRIORITY);
    const netIncome = pickBestConcept(usgaap, NI_PRIORITY);
    const operatingIncome = pickBestConcept(usgaap, OI_PRIORITY);
    const da = pickBestConcept(usgaap, DA_PRIORITY);
    const ocf = pickBestConcept(usgaap, OCF_PRIORITY);
    const capex = pickBestConcept(usgaap, CAPEX_PRIORITY);

    // Build standalone quarterly OCF/CAPEX from cumulative YTD filings
    const ocfAllEntries   = OCF_PRIORITY.flatMap(c => getUnitEntries(usgaap, c));
    const capexAllEntries = CAPEX_PRIORITY.flatMap(c => getUnitEntries(usgaap, c));
    const ocfQStandalone   = norm(extractCashFlowQuarters(ocfAllEntries));
    const capexQStandalone = norm(extractCashFlowQuarters(capexAllEntries));
    const cash    = pickBestConcept(usgaap, CASH_PRIORITY);
    const ltDebt  = pickBestConcept(usgaap, LT_DEBT_PRIORITY);
    const stDebt  = pickBestConcept(usgaap, ST_DEBT_PRIORITY);

    // Gross profit: try direct concept, fall back to Revenue - COGS
    let gpAnnual: any[] = [];
    let gpQuarter: any[] = [];
    const grossProfit = pickBestConcept(usgaap, GP_PRIORITY);
    gpAnnual  = grossProfit.annual;
    gpQuarter = grossProfit.quarter;
    if (!gpAnnual.length) {
      const cogs = pickBestConcept(usgaap, COGS_PRIORITY);
      const byEnd = (arr: any[]) => new Map<string, any>(arr.map((e: any) => [e.end, e]));
      const revAnnMap = byEnd(revenue.annual);
      const revQMap   = byEnd(revenue.quarter);
      const deriveGP  = (cogsArr: any[], revMap: Map<string, any>) =>
        dedupeByEnd(
          cogsArr
            .map((c: any) => { const r = revMap.get(c.end); return r ? { ...c, val: r.val - c.val } : null; })
            .filter(Boolean),
        );
      gpAnnual  = deriveGP(cogs.annual,  revAnnMap);
      gpQuarter = deriveGP(cogs.quarter, revQMap);
    }

    // Shares: split into annual / quarter / all for flexible use in the frontend
    let sharesRaw: any[] = [];
    for (const c of SHARES_PRIORITY) {
      const all = getUnitEntries(usgaap, c);
      if (all.length > sharesRaw.length) sharesRaw = all;
    }
    const sharesAnnual  = dedupeByEnd(sharesRaw.filter(isAnnual));
    const sharesQuarter = dedupeByEnd(sharesRaw.filter(isQuarterly));
    const sharesAll     = dedupeByEnd(sharesRaw);

    return NextResponse.json({
      symbol,
      cik,
      revenue:         { annual: norm(revenue.annual),         quarter: norm(revenue.quarter) },
      netIncome:       { annual: norm(netIncome.annual),       quarter: norm(netIncome.quarter) },
      operatingIncome: { annual: norm(operatingIncome.annual), quarter: norm(operatingIncome.quarter) },
      da:              { annual: norm(da.annual),              quarter: norm(da.quarter) },
      grossProfit:     { annual: norm(gpAnnual),               quarter: norm(gpQuarter) },
      ocf:             { annual: norm(ocf.annual),             quarter: ocfQStandalone   },
      capex:           { annual: norm(capex.annual),           quarter: capexQStandalone },
      cash:            { annual: norm(cash.annual),            quarter: norm(cash.quarter) },
      ltDebt:          { annual: norm(ltDebt.annual),          quarter: norm(ltDebt.quarter) },
      stDebt:          { annual: norm(stDebt.annual),          quarter: norm(stDebt.quarter) },
      shares: {
        annual:  norm(sharesAnnual.length  ? sharesAnnual  : sharesAll),
        quarter: norm(sharesQuarter.length ? sharesQuarter : sharesAll),
        all:     norm(sharesAll),
      },
      segments: {},
    });
  } catch (err: any) {
    console.error('Error in /api/revenue:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
