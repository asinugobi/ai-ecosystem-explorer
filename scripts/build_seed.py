#!/usr/bin/env python3
"""Generate nodes.json from coverage.json + SEC EDGAR.

Division of labour: EDGAR supplies every number and its citation; coverage.json
supplies taxonomy placement and qualitative judgment. Nothing quantitative is
typed by hand, so nothing quantitative can be wrong in a way a filing wouldn't
catch. Private companies carry no filings and are emitted with null metrics for
a later manual/press pass, explicitly flagged as estimates.
"""
import json, sys, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from tools.edgar import latest_facts, yoy_growth  # noqa: E402

TODAY = dt.date.today().isoformat()


def metric(value, *, is_estimate, basis, fig=None, unit="usd_millions", confidence="high"):
    m = {"value": value, "unit": unit, "is_estimate": is_estimate,
         "basis": basis, "confidence": confidence}
    if fig is not None:
        m["source"] = {
            "publisher": f"SEC EDGAR — {fig.form} (CIK filing)",
            "title": f"{fig.concept} for {fig.start}..{fig.end}",
            "url": fig.url,
            "as_of": fig.filed,
        }
    return m


def build(company):
    cid, name = company["id"], company["name"]
    node = {
        "id": cid, "name": name, "ticker": company.get("ticker"),
        "is_public": company.get("is_public", True), "hq": company.get("hq", "US"),
        "layer": company["layer"], "segment": company["segment"],
        "also_operates": company.get("also_operates", []),
        "verticals": company.get("verticals", []),
        "updated_at": TODAY, "updated_by": "seed",
        "moat": {"summary": company["note"], "strength": company.get("moat_strength", 3),
                 "type": company.get("moat_type", []), "risks": company.get("risks", [])},
    }

    if not node["is_public"]:
        node["period"] = "press-reported run-rate; no SEC filings exist"
        node["revenue_total"] = metric(
            company.get("revenue_est_usd_m"), is_estimate=True, confidence="medium",
            basis=company.get("revenue_basis", "Press-reported annualized run-rate. Private company: unaudited and not a filed figure."))
        return node, "private"

    fin = latest_facts(company["ticker"])
    if not fin or not fin.get("revenue"):
        node["period"] = "unavailable — no usable XBRL revenue concept"
        node["revenue_total"] = metric(None, is_estimate=True, confidence="low",
            basis="Foreign private issuer or filer without XBRL revenue tagging. Needs a press-sourced pass.")
        return node, "no-xbrl"

    rev = fin.get("revenue")
    node["period"] = fin.period_label
    node["revenue_total"] = metric(
        round(rev.annualized / 1e6, 1), is_estimate=False, fig=rev,
        basis=f"Reported {rev.concept} for {rev.start}..{rev.end} ({rev.period_days}d), annualized x4 per run-rate convention.")
    node["revenue_ai"] = metric(
        None, is_estimate=True, confidence="low",
        basis="Not yet apportioned. Only a handful of filers report an AI-attributable line; requires a segment-level or analyst-estimate pass.")

    for key, label in (("gross_profit", "gross_margin_pct"), ("operating_income", "operating_margin_pct")):
        pct = fin.margin_pct(key)
        if pct is not None:
            f = fin.get(key)
            node[label] = metric(pct, unit="percent", is_estimate=False, fig=f,
                basis=f"{f.concept} / revenue, both for {f.start}..{f.end}. Computed from reported figures, same period.")

    cx = fin.get("capex")
    if cx:
        node["capex"] = metric(round(cx.annualized / 1e6, 1), is_estimate=False, fig=cx,
            basis=f"Reported {cx.concept} for {cx.start}..{cx.end}, annualized x4. Cash PP&E only — EXCLUDES finance leases, so it will read below headline capex for filers that lease heavily.")

    g = yoy_growth(fin)
    if g is not None:
        node["revenue_growth_yoy_pct"] = metric(g, unit="percent", is_estimate=False, fig=rev,
            basis=f"Latest quarter vs. the same quarter a year prior, both reported. Total revenue, not AI-attributable.")

    node["valuation"] = {"as_of": TODAY}  # market data: separate cadence, filled by its own job
    return node, "ok"


def main():
    cov = json.loads((ROOT / "data/seed/coverage.json").read_text())["companies"]
    nodes, stats = [], {"ok": 0, "private": 0, "no-xbrl": 0}
    for i, c in enumerate(cov, 1):
        try:
            n, st = build(c)
        except Exception as e:
            print(f"[{i}/{len(cov)}] {c['id']}: ERROR {e}", flush=True); continue
        nodes.append(n); stats[st] += 1
        rv = n.get("revenue_total", {}).get("value")
        gm = n.get("gross_margin_pct", {}).get("value")
        print(f"[{i}/{len(cov)}] {c['id']:<22} {st:<9} rev={('$%.1fB' % (rv/1000)) if rv else '—':>9} gm={gm if gm is not None else '—'}", flush=True)

    out = ROOT / "data/seed/nodes.json"
    out.write_text(json.dumps(nodes, indent=2) + "\n")
    print(f"\nwrote {out} — {len(nodes)} nodes  {stats}")


if __name__ == "__main__":
    main()
