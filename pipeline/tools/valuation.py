"""Valuation feed — market data on its own refresh cadence.

Only the PRICE comes from a quote feed. Shares outstanding, cash, debt and D&A
all come from EDGAR XBRL, so enterprise value is computed from primary-source
balance-sheet items rather than approximated by market cap. That matters most
exactly where it is least convenient: Oracle and CoreWeave carry enough debt
that EV and market cap are materially different numbers.

Forward P/E is deliberately absent. It requires consensus estimates, which are
licensed (Hudson Labs sources theirs from S&P Market Intelligence). A null is
more useful than a fabricated multiple.
"""
from __future__ import annotations

import datetime as dt
import json
import time
import urllib.request
from dataclasses import dataclass

from .edgar import _get, _days, ticker_to_cik, filing_url, USER_AGENT

QUOTE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1d&interval=1d"
_LAST = [0.0]


def quote(ticker: str) -> dict | None:
    """Latest price. Unofficial endpoint — cite it honestly as a quote feed."""
    wait = 0.25 - (time.time() - _LAST[0])
    if wait > 0:
        time.sleep(wait)
    _LAST[0] = time.time()
    try:
        req = urllib.request.Request(QUOTE_URL.format(ticker),
                                     headers={"User-Agent": "Mozilla/5.0 (compatible; ai-ecosystem-explorer)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read())
        m = d["chart"]["result"][0]["meta"]
        if m.get("regularMarketPrice") is None:
            return None
        return {
            "price": float(m["regularMarketPrice"]),
            "currency": m.get("currency", "USD"),
            "as_of": dt.datetime.fromtimestamp(m["regularMarketTime"], dt.timezone.utc).date().isoformat(),
            "exchange": m.get("fullExchangeName"),
        }
    except Exception:
        return None


def _latest(rows, unit_keys=("USD", "shares"), max_age_days: int | None = 500):
    """Most recent instant value, refusing anything implausibly stale."""
    best = None
    for u in unit_keys:
        for r in rows.get("units", {}).get(u, []):
            if "start" in r:          # duration fact, not an instant
                continue
            if best is None or (r["end"], r["filed"]) > (best["end"], best["filed"]):
                best = r
    if best and max_age_days is not None:
        age = (dt.date.today() - dt.date.fromisoformat(best["end"])).days
        if age > max_age_days:
            return None
    return best


@dataclass
class BalanceSheet:
    shares: float | None = None
    shares_as_of: str | None = None
    cash: float = 0.0
    debt: float = 0.0
    dna_quarterly: float | None = None
    accn: str | None = None
    cik: int | None = None
    notes: list[str] = None


CASH_CONCEPTS = ("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")
INVEST_CONCEPTS = ("MarketableSecuritiesCurrent", "ShortTermInvestments", "AvailableForSaleSecuritiesDebtSecuritiesCurrent")
DEBT_CONCEPTS = ("LongTermDebt", "LongTermDebtNoncurrent", "DebtLongtermAndShorttermCombinedAmount")
SHORT_DEBT = ("LongTermDebtCurrent", "ShortTermBorrowings", "DebtCurrent")
DNA_CONCEPTS = ("DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet",
                "DepreciationAndAmortization")


def balance_sheet(ticker: str) -> BalanceSheet | None:
    hit = ticker_to_cik(ticker)
    if not hit:
        return None
    cik, _ = hit
    try:
        facts = _get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json", f"facts_{cik}")
    except Exception:
        return None
    g = facts.get("facts", {}).get("us-gaap") or {}
    dei = facts.get("facts", {}).get("dei") or {}
    bs = BalanceSheet(cik=cik, notes=[])

    # SHARE COUNT — three traps, all of which produced wrong market caps on the
    # first run:
    #   1. dei:EntityCommonStockSharesOutstanding is reported PER CLASS. Mobileye
    #      returned 252M (Class A) against a true 818M, understating market cap
    #      3.2x and driving enterprise value negative.
    #   2. Foreign private issuers (20-F/40-F) report ORDINARY shares while the
    #      quote is for an ADR representing several of them. TSMC came out at
    #      $10.8T. The ratio is not in EDGAR, so those are skipped, not guessed.
    #   3. Thirteen filers, Meta and Palantir among them, do not tag the dei
    #      concept at all.
    # Diluted weighted-average shares is tagged by everyone for EPS, spans all
    # classes, and is therefore the better primary source.
    dil = None
    if "WeightedAverageNumberOfDilutedSharesOutstanding" in g:
        rows = [r for r in g["WeightedAverageNumberOfDilutedSharesOutstanding"].get("units", {}).get("shares", [])
                if "start" in r and 80 <= _days(r) <= 100]
        if rows:
            dil = max(rows, key=lambda r: (r["end"], r["filed"]))

    dei_row = None
    if "EntityCommonStockSharesOutstanding" in dei:
        dei_row = _latest(dei["EntityCommonStockSharesOutstanding"], ("shares",), max_age_days=270)

    foreign = (dei_row or {}).get("form") in ("20-F", "40-F")
    if foreign and not dil:
        bs.notes.append(f"foreign private issuer ({dei_row['form']}) — the quote is an ADR whose "
                        f"ratio to ordinary shares is not in EDGAR; market cap not computed")
    elif dil and dil["val"] > 0:
        bs.shares, bs.shares_as_of, bs.accn = float(dil["val"]), dil["end"], dil["accn"]
        if dei_row and dei_row["val"] and dil["val"] / dei_row["val"] > 1.5:
            bs.notes.append(f"multi-class: dei reported {dei_row['val']:,.0f} (one class); "
                            f"used diluted {dil['val']:,.0f}")
    elif dei_row and dei_row["val"] > 0 and not foreign:
        bs.shares, bs.shares_as_of, bs.accn = float(dei_row["val"]), dei_row["end"], dei_row["accn"]
    else:
        bs.notes.append("no usable share count")

    for group, target, label in ((CASH_CONCEPTS, "cash", "cash"), (INVEST_CONCEPTS, "cash", "investments")):
        for c in group:
            if c in g:
                r = _latest(g[c], ("USD",), max_age_days=400)
                if r:
                    bs.cash += float(r["val"])
                    break
    for group in (DEBT_CONCEPTS, SHORT_DEBT):
        for c in group:
            if c in g:
                r = _latest(g[c], ("USD",), max_age_days=400)
                if r:
                    bs.debt += float(r["val"])
                    break
    for c in DNA_CONCEPTS:
        if c in g:
            rows = [r for r in g[c].get("units", {}).get("USD", []) if "start" in r and 80 <= _days(r) <= 100]
            if rows:
                bs.dna_quarterly = float(max(rows, key=lambda r: (r["end"], r["filed"]))["val"])
                break
    return bs


def compute(ticker: str, revenue_annual_m: float | None, gross_profit_annual_m: float | None,
            operating_income_annual_m: float | None) -> dict | None:
    """Assemble the valuation block. All money values in USD millions."""
    q = quote(ticker)
    bs = balance_sheet(ticker)
    if not q or not bs:
        return None
    today = dt.date.today().isoformat()
    out = {"as_of": today, "market_cap_usd_m": None, "enterprise_value_usd_m": None,
           "ev_revenue": None, "ev_ebitda": None, "ev_gross_profit": None,
           "pe_forward": None, "fwd_revenue_growth_pct": None,
           "last_round_valuation_usd_m": None, "last_round_date": None,
           "notes": bs.notes or None,
           "source": {
               "publisher": f"Price: public quote feed ({q['exchange'] or 'exchange'}). "
                            f"Shares, cash and debt: SEC EDGAR XBRL.",
               "title": f"{ticker} close {q['price']:.2f} {q['currency']} on {q['as_of']}; "
                        f"shares outstanding as of {bs.shares_as_of}",
               "url": filing_url(bs.cik, bs.accn) if bs.accn else "https://www.sec.gov/edgar",
               "as_of": q["as_of"]}}

    if bs.shares and q["currency"] == "USD":
        mc = q["price"] * bs.shares / 1e6
        out["market_cap_usd_m"] = round(mc, 1)
        ev = mc + (bs.debt - bs.cash) / 1e6
        if ev <= 0:
            out["market_cap_usd_m"] = None
            out["_rejected"] = (f"computed EV {ev:,.0f}M <= 0 — almost always a wrong share count "
                                 f"rather than a real net-cash-above-market-cap situation")
            return out
        out["enterprise_value_usd_m"] = round(ev, 1)
        if revenue_annual_m:
            out["ev_revenue"] = round(ev / revenue_annual_m, 2)
        # A negative multiple off negative gross profit is not a cheap stock,
        # it is a meaningless number. Recursion produced EV/GP of -84.
        if gross_profit_annual_m and gross_profit_annual_m > 0:
            out["ev_gross_profit"] = round(ev / gross_profit_annual_m, 2)
        if operating_income_annual_m and bs.dna_quarterly:
            ebitda = operating_income_annual_m + bs.dna_quarterly * 4 / 1e6
            if ebitda > 0:
                out["ev_ebitda"] = round(ev / ebitda, 2)
    return out
