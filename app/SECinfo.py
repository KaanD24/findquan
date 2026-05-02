"""
SEC Filing helper

Small, robust script to fetch SEC data (tickers -> CIK, submissions, company facts)
and extract and plot revenue time series.

Usage:
  python app/SECinfo.py --ticker AAPL --plot --eightk

Set SEC_USER_AGENT environment variable to include contact info.
"""
from __future__ import annotations

import datetime
import os
import time
import logging
from typing import Dict, Any, Optional

import requests
import pandas as pd

try:
    import matplotlib.pyplot as plt
    HAS_MPL = True
except Exception:
    HAS_MPL = False

_DEFAULT_USER_AGENT = "FindQuan/1.0 (contact: your.email@example.com)"

logger = logging.getLogger("secinfo")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def get_user_agent() -> str:
    return os.environ.get("SEC_USER_AGENT", _DEFAULT_USER_AGENT)


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": get_user_agent(), "Accept-Encoding": "gzip, deflate"})
    return s


def get_company_tickers(session: requests.Session) -> Dict[str, Any]:
    url = "https://www.sec.gov/files/company_tickers.json"
    logger.info("Fetching company tickers from %s", url)
    r = session.get(url, timeout=15)
    r.raise_for_status()
    return r.json()


def ticker_to_cik(session: requests.Session, ticker: str) -> Optional[str]:
    data = get_company_tickers(session)
    target = ticker.upper()
    for entry in data.values():
        if entry.get("ticker", "").upper() == target:
            return str(entry.get("cik_str", "")).zfill(10)
    return None


def get_submissions(session: requests.Session, cik: str) -> Dict[str, Any]:
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    logger.info("Fetching submissions for CIK %s", cik)
    r = session.get(url, timeout=15)
    r.raise_for_status()
    time.sleep(0.2)
    return r.json()


def get_company_facts(session: requests.Session, cik: str) -> Dict[str, Any]:
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    logger.info("Fetching company facts for CIK %s", cik)
    r = session.get(url, timeout=20)
    r.raise_for_status()
    time.sleep(0.2)
    return r.json()


def get_concept(session: requests.Session, cik: str, concept: str) -> Dict[str, Any]:
    url = f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json"
    logger.info("Fetching concept %s for CIK %s", concept, cik)
    r = session.get(url, timeout=20)
    r.raise_for_status()
    time.sleep(0.2)
    return r.json()


def list_8k_filings(submissions: Dict[str, Any]) -> list:
    """Return recent 8-K filings (accessionNumber, filingDate, form).

    Uses keys present in the submissions JSON (filingDate usually).
    """
    recent = submissions.get("filings", {}).get("recent", {})
    results = []
    if not recent:
        return results
    # determine length of lists
    length = None
    for v in recent.values():
        if isinstance(v, list):
            length = len(v)
            break
    if not length:
        return results
    for i in range(length):
        form = recent.get("form", [None] * length)[i]
        if not form:
            continue
        if str(form).upper().startswith("8-"):
            filing_date = recent.get("filingDate", [None] * length)[i]
            if filing_date is None:
                filing_date = recent.get("filed", [None] * length)[i]
            results.append({
                "accessionNumber": recent.get("accessionNumber", [None] * length)[i],
                "filingDate": filing_date,
                "form": form,
            })
    return results


def find_revenue_entries(facts: Dict[str, Any]) -> Dict[str, list]:
    candidates = [
        "Revenues",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "TotalRevenue",
    ]
    found = {}
    facts_root = facts.get("facts", {})
    for concept in candidates:
        concept_obj = facts_root.get("us-gaap", {}).get(concept)
        if concept_obj:
            units = concept_obj.get("units", {})
            entries = units.get("USD") or units.get("shares") or (next(iter(units.values()), []) if isinstance(units, dict) else [])
            found[concept] = entries
    return found


def select_revenue_concept(revenue_map: Dict[str, list], preferred: Optional[list] = None) -> Optional[tuple]:
    """Select a single revenue concept to use for plotting/aggregation.

    preferred: ordered list of concept names to prefer. Returns (concept, entries)
    or None if nothing found.
    """
    if not revenue_map:
        return None
    if preferred is None:
        preferred = ["SalesRevenueNet", "Revenues", "TotalRevenue", "SalesRevenueGoodsNet"]
    for p in preferred:
        if p in revenue_map and revenue_map[p]:
            return p, revenue_map[p]
    # fallback: pick the concept with the most entries
    best = max(revenue_map.items(), key=lambda kv: len(kv[1]))
    return best[0], best[1]


def match_revenues_to_8k(eightks: list, revenue_map: Dict[str, list]) -> Dict[str, list]:
    def parse_date_any(d):
        # accept multiple date-like inputs
        if not d:
            return None
        if isinstance(d, (datetime.date, datetime.datetime)):
            return d.date() if isinstance(d, datetime.datetime) else d
        try:
            return datetime.date.fromisoformat(str(d))
        except Exception:
            try:
                return datetime.datetime.fromisoformat(str(d)).date()
            except Exception:
                return None

    matches = {}
    # flatten revenue entries
    flat = []
    for concept, entries in revenue_map.items():
        for ent in entries:
            rec = dict(ent)
            rec["_concept"] = concept
            flat.append(rec)

    for ek in eightks:
        acc = ek.get("accessionNumber") or "<no-acc>"
        matches[acc] = []
        ek_date = parse_date_any(ek.get("filingDate") or ek.get("filing_date") or ek.get("filed"))
        for rec in flat:
            # direct form match
            if str(rec.get("form", "")).upper().startswith("8-"):
                matches[acc].append(rec)
                continue
            # match by various date fields on the revenue record
            filed = parse_date_any(rec.get("filed") or rec.get("filedDate") or rec.get("filingDate") or rec.get("end"))
            if filed and ek_date:
                if abs((filed - ek_date).days) <= 3:
                    matches[acc].append(rec)
    return matches


def build_revenue_df(revenue_map: Dict[str, list]) -> pd.DataFrame:
    rows = []
    for concept, entries in revenue_map.items():
        for e in entries:
            rows.append({
                "concept": concept,
                "val": e.get("val"),
                "end": e.get("end") or e.get("date") or e.get("period"),
                "filed": e.get("filed") or e.get("filedDate") or e.get("filingDate"),
                "form": e.get("form"),
            })
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["end_dt"] = pd.to_datetime(df["end"], errors="coerce")
    df["filed_dt"] = pd.to_datetime(df["filed"], errors="coerce")
    df["val"] = pd.to_numeric(df["val"], errors="coerce")
    df = df.dropna(subset=["end_dt", "val"]).sort_values("end_dt")
    return df


def aggregate_annual(df: pd.DataFrame, fiscal_month: Optional[int] = None) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    df["year"] = df["end_dt"].dt.year
    rows = []
    years = sorted(df["year"].dropna().unique())
    for y in years:
        year_df = df[df["year"] == y]
        chosen = None
        # prefer filings that are full-year filings (10-K) when form is present
        try:
            tenk = year_df[year_df["form"].astype(str).str.upper().str.contains("10-K")]
        except Exception:
            tenk = pd.DataFrame()
        if not tenk.empty:
            # pick latest end_dt among 10-K candidates
            chosen = tenk.sort_values("end_dt", ascending=False).iloc[0]
        # next prefer entries that match fiscal month (e.g., Sept for Apple)
        if chosen is None and fiscal_month is not None:
            cand = year_df[year_df["end_dt"].dt.month == fiscal_month]
            if not cand.empty:
                chosen = cand.sort_values("end_dt", ascending=False).iloc[0]
        # fallback: take the entry with the latest end_dt (most complete for the year)
        if chosen is None:
            chosen = year_df.sort_values("end_dt", ascending=False).iloc[0]
        rows.append({"end_dt": chosen["end_dt"], "val": chosen["val"], "source_form": chosen.get("form")})
    out = pd.DataFrame(rows).sort_values("end_dt")
    return out


def plot_revenue_ts(df: pd.DataFrame, ticker: str, outpath: Optional[str] = None):
    if df.empty:
        logger.error("Empty revenue DataFrame; nothing to plot")
        return
    if not HAS_MPL:
        logger.error("matplotlib not available; install it to enable plotting")
        return
    df = df.copy()
    df["year"] = df["end_dt"].dt.year
    counts_per_year = df.groupby("year").size()
    if counts_per_year.max() > 1:
        annual = aggregate_annual(df, fiscal_month=9)
    else:
        annual = df.groupby("end_dt")["val"].sum().reset_index()
    max_val = annual["val"].abs().max()
    scale = 1.0
    unit_label = "USD"
    if max_val is not None and max_val > 1e9:
        scale = 1e9
        unit_label = "Billion USD"
    x = annual["end_dt"]
    y = annual["val"] / scale
    plt.figure(figsize=(10, 5))
    plt.plot(x, y, marker="o", linestyle="-", label="Annual revenue")
    plt.title(f"{ticker} - Annual Revenue time series")
    plt.xlabel("Date")
    plt.ylabel(f"Revenue ({unit_label})")
    plt.grid(True)
    plt.tight_layout()
    if not outpath:
        outpath = f"revenue_timeseries_{ticker}.png"
    plt.savefig(outpath)
    logger.info("Saved revenue timeseries to %s", outpath)
    try:
        plt.show()
    except Exception:
        pass


def log_facts_overview(cik: str, facts: Dict[str, Any]):
    facts_keys = list(facts.get("facts", {}).keys())
    logger.info("Company facts top-level keys: %s", facts_keys[:10])
    dei = facts.get("facts", {}).get("dei", {})
    if dei:
        for k, v in list(dei.items())[:5]:
            logger.info("DEI concept: %s (keys: %s)", k, list(v.keys()))


def main():
    import argparse
    parser = argparse.ArgumentParser(description="SEC data fetcher (CIK, facts, filings)")
    parser.add_argument("--ticker", help="Ticker symbol, e.g. AAPL", required=False)
    parser.add_argument("--concept", help="US-GAAP concept to fetch, e.g. Assets", default=None)
    parser.add_argument("--eightk", help="Find revenues tied to recent 8-K filings", action="store_true")
    parser.add_argument("--plot", help="Build and show/save a revenue time-series plot", action="store_true")
    parser.add_argument("--export", help="Write aggregated annual revenue to CSV or JSON file (path)", default=None)
    args = parser.parse_args()
    ticker = args.ticker or os.environ.get("SEC_DEFAULT_TICKER", "AAPL")
    if not args.ticker:
        logger.info("No --ticker provided; using default ticker %s (set SEC_DEFAULT_TICKER to change)", ticker)
    session = make_session()
    try:
        logger.info("Using User-Agent: %s", get_user_agent())
        cik = ticker_to_cik(session, ticker)
        if cik is None:
            logger.error("Ticker %s not found in SEC list. Aborting.", ticker)
            return
        print(f"Ticker: {ticker} -> CIK: {cik}")
        subs = get_submissions(session, cik)
        recent = subs.get("filings", {}).get("recent", {})
        if recent:
            df_recent = pd.DataFrame.from_dict(recent)
            logger.info("Recent filings columns: %s", df_recent.columns.tolist())
            cols = [c for c in ["accessionNumber", "reportDate", "form"] if c in df_recent.columns]
            print("Recent filings (first 10):")
            print(df_recent[cols].head(10).to_string(index=False))
        else:
            logger.warning("No recent filings found for CIK %s", cik)
        facts = get_company_facts(session, cik)
        log_facts_overview(cik, facts)
        print("Top-level facts keys:", list(facts.get("facts", {}).keys())[:20])
        if args.eightk:
            eightks = list_8k_filings(subs)
            if not eightks:
                logger.warning("No recent 8-K filings found for %s", ticker)
            else:
                print(f"Found {len(eightks)} recent 8-K filings. Attempting to match revenue entries...")
                revenue_map = find_revenue_entries(facts)
                if not revenue_map:
                    print("No revenue-related concepts found in company facts. Will show recent 10-Q/10-K revenues instead if available.")
                else:
                    matches = match_revenues_to_8k(eightks, revenue_map)
                    for ek in eightks:
                        acc = ek.get("accessionNumber") or "<no-acc>"
                        print(f"\n8-K accession: {acc} filed: {ek.get('filingDate')}")
                        matched = matches.get(acc) or []
                        if not matched:
                            print("  No revenue values directly linked to this 8-K in company facts.")
                        else:
                            for m in matched:
                                conc = m.get("_concept")
                                print(f"  Concept: {conc} val: {m.get('val')} end: {m.get('end')} filed: {m.get('filed')} form: {m.get('form')}")
            # build revenue map and select a single concept to avoid mixing measures
            revenue_map = find_revenue_entries(facts)
            chosen_concept = None
            entries = []
            if revenue_map:
                if args.concept:
                    chosen_concept = args.concept
                    entries = revenue_map.get(chosen_concept) or []
                    if not entries:
                        logger.warning("Requested concept %s not found; falling back to auto-selection", chosen_concept)
                        sel = select_revenue_concept(revenue_map)
                        if sel:
                            chosen_concept, entries = sel
                        else:
                            chosen_concept, entries = None, []
                else:
                    sel = select_revenue_concept(revenue_map)
                    if sel:
                        chosen_concept, entries = sel
            df_rev = build_revenue_df({chosen_concept: entries} if chosen_concept else {})
            if df_rev.empty:
                logger.warning("No revenue entries found; cannot plot or export.")
            else:
                df_rev = df_rev[df_rev["end_dt"] >= pd.Timestamp("2013-01-01")]
                # export aggregated annual revenue if requested
                if args.export:
                    try:
                        annual_df = aggregate_annual(df_rev, fiscal_month=9)
                        outpath = args.export
                        if outpath.lower().endswith(".json"):
                            annual_df.to_json(outpath, orient="records", date_format="iso")
                        else:
                            annual_df.to_csv(outpath, index=False)
                        logger.info("Exported annual revenue to %s", outpath)
                    except Exception as e:
                        logger.exception("Failed to export annual revenue: %s", e)
                if args.plot:
                    plot_revenue_ts(df_rev, ticker)
        if args.concept:
            concept_data = get_concept(session, cik, args.concept)
            units = concept_data.get("units", {})
            usd = units.get("USD") or units.get("shares") or next(iter(units.values()), None)
            if usd:
                df = pd.DataFrame.from_dict(usd)
                print(df.head())
            else:
                print(list(concept_data.keys()))
    except requests.HTTPError as e:
        logger.error("HTTP error: %s", e)
    except Exception as e:
        logger.exception("Unexpected error: %s", e)


if __name__ == "__main__":
    main()
