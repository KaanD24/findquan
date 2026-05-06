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
  return e.fp === 'FY';
}

function isQuarterly(e: any): boolean {
  const d = periodDays(e);
  if (d > 0) return d >= 60 && d <= 120;
  return e.fp === 'Q1' || e.fp === 'Q2' || e.fp === 'Q3' || e.fp === 'Q4';
}

interface ConceptSeries { annual: any[]; quarter: any[] }

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
      ocf:             { annual: norm(ocf.annual),             quarter: norm(ocf.quarter) },
      capex:           { annual: norm(capex.annual),           quarter: norm(capex.quarter) },
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
