"""Agent 1 — the Monitor.

Originally specified as a mock search. Reframed to the Hudson Labs Co-Analyst
model: watch SEC EDGAR for filings that could change a mapped company's numbers,
and pull the machine-readable XBRL facts alongside. Grounding in primary
documents is what makes the Classifier's output citable instead of plausible.

Private companies have no filings, so their path is press evidence supplied by
the caller, always flagged as an estimate downstream.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from state import PipelineState
from tools.edgar import latest_facts, recent_filings, yoy_growth

MATERIAL_FORMS = ("8-K", "10-Q", "10-K", "20-F")


def run(state: PipelineState, since: str | None = None) -> PipelineState:
    stage = "monitor"
    if not state.is_public:
        state.say(stage, f"{state.target} is private — no EDGAR path. Using supplied press evidence.")
        if not state.evidence:
            state.fail(stage, "private company with no evidence supplied")
        return state

    state.say(stage, f"polling EDGAR for {state.target}…")
    filings = recent_filings(state.target, forms=MATERIAL_FORMS, limit=8)
    if since:
        filings = [f for f in filings if f["filed"] >= since]
    state.filings = filings
    if not filings:
        state.say(stage, "no new material filings — nothing to do")
        return state
    state.say(stage, f"{len(filings)} material filings, newest {filings[0]['form']} on {filings[0]['filed']}")

    fin = latest_facts(state.target)
    if not fin or not fin.get("revenue"):
        state.fail(stage, f"no usable XBRL revenue concept for {state.target} (foreign filer?)")
        return state

    rev = fin.get("revenue")
    growth = yoy_growth(fin)
    state.facts = {
        "ticker": fin.ticker, "cik": fin.cik, "name": fin.name,
        "period": fin.period_label,
        "revenue_q": rev.value, "revenue_annualized": rev.annualized,
        "revenue_concept": rev.concept, "period_start": rev.start, "period_end": rev.end,
        "form": rev.form, "filed": rev.filed, "accn": rev.accn, "url": rev.url,
        "gross_margin_pct": fin.margin_pct("gross_profit"),
        "operating_margin_pct": fin.margin_pct("operating_income"),
        "capex_annualized": fin.get("capex").annualized if fin.get("capex") else None,
        "capex_url": fin.get("capex").url if fin.get("capex") else None,
        "yoy_growth_pct": growth,
    }
    state.say(stage, f"XBRL: ${rev.annualized/1e9:.1f}B run-rate, "
                     f"GM {state.facts['gross_margin_pct']}%, OM {state.facts['operating_margin_pct']}%, "
                     f"YoY {growth}% — per {rev.form} filed {rev.filed}")

    state.evidence = (
        f"COMPANY: {fin.name} ({fin.ticker}, CIK {fin.cik})\n"
        f"REPORTING PERIOD: {fin.period_label}\n"
        f"SOURCE FILING: {rev.url} ({rev.form}, filed {rev.filed}, accession {rev.accn})\n\n"
        f"REPORTED FIGURES (SEC XBRL, in USD):\n"
        f"- Revenue for {rev.start}..{rev.end}: {rev.value:,.0f}  (annualized x4: {rev.annualized:,.0f})\n"
        f"- Gross margin: {state.facts['gross_margin_pct']}%\n"
        f"- Operating margin: {state.facts['operating_margin_pct']}%\n"
        f"- Capex annualized: {state.facts['capex_annualized']}\n"
        f"- Revenue growth YoY: {growth}%\n\n"
        f"RECENT FILINGS:\n" + "\n".join(
            f"- {f['filed']} {f['form']}: {f['description'] or '(no description)'} — {f['url']}"
            for f in filings[:5])
    )
    return state
