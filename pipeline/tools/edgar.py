"""SEC EDGAR client — primary-source financials with citations attached.

This is the Hudson Labs "Co-Analyst" concept applied to our map: every figure
traces to an accession number, so provenance is mechanical rather than typed by
hand. XBRL company-facts give machine-readable reported financials for US filers
and 20-F foreign private issuers (TSMC, SK hynix). Private companies (OpenAI,
Anthropic, Databricks) have no filings and stay press-sourced estimates.

SEC fair-access rules: declare a real User-Agent with contact info, stay under
10 req/sec. See https://www.sec.gov/os/accessing-edgar-data
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

USER_AGENT = os.environ.get("SEC_USER_AGENT", "ai-ecosystem-explorer research asinugobi@gmail.com")
CACHE = Path(__file__).resolve().parents[1] / ".cache" / "edgar"
_LAST_CALL = [0.0]
MIN_INTERVAL = 0.12  # ~8 req/s, under SEC's 10/s ceiling

# Filers tag revenue under different concepts; try in order of specificity.
CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
    ),
    "gross_profit": ("GrossProfit",),
    "operating_income": ("OperatingIncomeLoss", "OperatingIncomeLossIncludingNoncontrollingInterest"),
    "capex": (
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsToAcquirePropertyPlantAndEquipmentExcludingCapitalizedInterest",
    ),
    "rnd": ("ResearchAndDevelopmentExpense",),
    "net_income": ("NetIncomeLoss",),
}


def _get(url: str, cache_key: str | None = None, ttl_hours: int = 12) -> dict:
    """Rate-limited GET with on-disk cache. EDGAR is generous but not infinite."""
    if cache_key:
        p = CACHE / f"{cache_key}.json"
        if p.exists() and (time.time() - p.stat().st_mtime) < ttl_hours * 3600:
            return json.loads(p.read_text())

    wait = MIN_INTERVAL - (time.time() - _LAST_CALL[0])
    if wait > 0:
        time.sleep(wait)
    _LAST_CALL[0] = time.time()

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            import gzip
            raw = gzip.decompress(raw)
        data = json.loads(raw)

    if cache_key:
        CACHE.mkdir(parents=True, exist_ok=True)
        (CACHE / f"{cache_key}.json").write_text(json.dumps(data))
    return data


def ticker_to_cik(ticker: str) -> tuple[int, str] | None:
    """Resolve a ticker to (CIK, registrant name)."""
    d = _get("https://www.sec.gov/files/company_tickers.json", "company_tickers", ttl_hours=168)
    for v in d.values():
        if v["ticker"].upper() == ticker.upper():
            return int(v["cik_str"]), v["title"]
    return None


def _days(fact: dict) -> int:
    a = dt.date.fromisoformat(fact["start"])
    b = dt.date.fromisoformat(fact["end"])
    return (b - a).days


def filing_url(cik: int, accn: str) -> str:
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-', '')}/{accn}-index.htm"


@dataclass
class Figure:
    """One reported number, with everything needed to cite it."""
    concept: str
    value: float           # USD
    start: str
    end: str
    form: str              # 10-Q / 10-K / 20-F
    filed: str
    accn: str
    url: str
    period_days: int

    @property
    def is_quarterly(self) -> bool:
        return 80 <= self.period_days <= 100

    @property
    def annualized(self) -> float:
        """Run-rate. Quarterly x4; annual as-is. The spec's chosen vintage."""
        return self.value * 4 if self.is_quarterly else self.value


@dataclass
class CompanyFinancials:
    ticker: str
    cik: int
    name: str
    figures: dict[str, Figure] = field(default_factory=dict)

    def get(self, key: str) -> Figure | None:
        return self.figures.get(key)

    def margin_pct(self, numerator: str) -> float | None:
        """Margin computed from two same-period reported figures — never mixed periods."""
        num, rev = self.figures.get(numerator), self.figures.get("revenue")
        if not num or not rev or not rev.value:
            return None
        if (num.start, num.end) != (rev.start, rev.end):
            return None  # refuse to divide across mismatched windows
        return round(100.0 * num.value / rev.value, 2)

    @property
    def period_label(self) -> str:
        rev = self.figures.get("revenue")
        if not rev:
            return "unknown"
        kind = "quarter annualized (run-rate)" if rev.is_quarterly else "fiscal year"
        return f"{rev.start}..{rev.end} {kind}, per {rev.form} filed {rev.filed}"


def latest_facts(ticker: str, prefer_quarterly: bool = True) -> CompanyFinancials | None:
    """Pull the most recent reported figure for each concept we care about."""
    hit = ticker_to_cik(ticker)
    if not hit:
        return None
    cik, name = hit
    try:
        facts = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", f"facts_{cik}")
    except Exception as e:  # delisted, no XBRL, foreign filer without tagging
        print(f"  ! {ticker}: companyfacts unavailable ({e})")
        return None

    allf = facts.get("facts", {})
    gaap = allf.get("us-gaap") or allf.get("ifrs-full") or {}
    if not gaap:
        print(f"  ! {ticker}: no us-gaap/ifrs-full facts (foreign filer without XBRL tagging?)")
        return None
    out = CompanyFinancials(ticker=ticker.upper(), cik=cik, name=name)

    for key, concepts in CONCEPTS.items():
        best: Figure | None = None
        for concept in concepts:
            node = gaap.get(concept)
            if not node:
                continue
            rows = node.get("units", {}).get("USD", [])
            cands = []
            for r in rows:
                if "start" not in r or r["form"] not in ("10-Q", "10-K", "20-F"):
                    continue
                d = _days(r)
                ok = (80 <= d <= 100) if prefer_quarterly else (350 <= d <= 380)
                if ok:
                    cands.append((r, d))
            if not cands:
                continue
            r, d = max(cands, key=lambda x: (x[0]["end"], x[0]["filed"]))
            f = Figure(concept, float(r["val"]), r["start"], r["end"], r["form"],
                       r["filed"], r["accn"], filing_url(cik, r["accn"]), d)
            # Do NOT break on first hit: a filer may tag an old concept and a
            # current one. NVDA still carries RevenueFromContractWithCustomer...
            # rows that stop in 2020 while Revenues runs to today.
            if best is None or f.end > best.end:
                best = f
        if best:
            out.figures[key] = best

    # BUG 2: not every filer tags GrossProfit. Derive it from cost of revenue.
    if "gross_profit" not in out.figures and "revenue" in out.figures:
        rev = out.figures["revenue"]
        for cc in ("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices"):
            node = gaap.get(cc)
            if not node:
                continue
            match = [r for r in node.get("units", {}).get("USD", [])
                     if r.get("start") == rev.start and r.get("end") == rev.end]
            if match:
                r = match[0]
                out.figures["gross_profit"] = Figure(
                    f"{rev.concept} - {cc} (derived)", rev.value - float(r["val"]),
                    rev.start, rev.end, rev.form, rev.filed, rev.accn,
                    filing_url(cik, rev.accn), rev.period_days)
                break

    if "revenue" not in out.figures and prefer_quarterly:
        return latest_facts(ticker, prefer_quarterly=False)  # annual-only filers
    return out


def yoy_growth(fin: "CompanyFinancials", facts_cache: dict | None = None) -> float | None:
    """YoY growth for the latest reported quarter, comparing like period to like.

    Compares against the quarter ending closest to 365 days before the current
    one. Refuses a comparison that is not within 30 days of a true year, which
    matters for 52/53-week fiscal calendars and for filers that restate.
    """
    rev = fin.figures.get("revenue")
    if not rev:
        return None
    try:
        facts = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{fin.cik:010d}.json", f"facts_{fin.cik}")
    except Exception:
        return None
    gaap = facts.get("facts", {}).get("us-gaap") or facts.get("facts", {}).get("ifrs-full") or {}
    node = gaap.get(rev.concept.split(" - ")[0])
    if not node:
        return None
    cur_end = dt.date.fromisoformat(rev.end)
    best, best_gap = None, 10**9
    for r in node.get("units", {}).get("USD", []):
        if "start" not in r or not (80 <= _days(r) <= 100):
            continue
        gap = abs((cur_end - dt.date.fromisoformat(r["end"])).days - 365)
        if gap < best_gap and r["end"] < rev.end:
            best, best_gap = r, gap
    if not best or best_gap > 30 or not best["val"]:
        return None
    return round(100.0 * (rev.value - float(best["val"])) / abs(float(best["val"])), 1)


def recent_filings(ticker: str, forms=("8-K", "10-Q", "10-K"), limit: int = 20) -> list[dict]:
    """What Agent 1 (the Monitor) polls to detect that something has changed."""
    hit = ticker_to_cik(ticker)
    if not hit:
        return []
    cik, _ = hit
    d = _get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", f"sub_{cik}", ttl_hours=2)
    r = d["filings"]["recent"]
    out = []
    for i in range(len(r["form"])):
        if r["form"][i] in forms:
            out.append({
                "form": r["form"][i], "filed": r["filingDate"][i],
                "accn": r["accessionNumber"][i],
                "description": r["primaryDocDescription"][i],
                "url": filing_url(cik, r["accessionNumber"][i]),
            })
        if len(out) >= limit:
            break
    return out


if __name__ == "__main__":
    import sys
    for t in (sys.argv[1:] or ["NVDA", "MSFT", "CRWV", "VRT"]):
        f = latest_facts(t)
        if not f:
            print(f"{t}: no data"); continue
        rev = f.get("revenue")
        if not rev:
            print(f"\n{t}: resolved to {f.name} but no usable revenue concept"); continue
        print(f"\n{f.ticker}  {f.name}  (CIK {f.cik})")
        print(f"  period : {f.period_label}")
        print(f"  revenue: ${rev.value/1e9:.2f}B  ->  ${rev.annualized/1e9:.1f}B run-rate")
        print(f"  gross  : {f.margin_pct('gross_profit')}%   operating: {f.margin_pct('operating_income')}%")
        cx = f.get("capex")
        if cx: print(f"  capex  : ${cx.value/1e9:.2f}B/q  -> ${cx.annualized/1e9:.1f}B annualized")
        print(f"  cite   : {rev.url}")
