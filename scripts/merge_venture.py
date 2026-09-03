#!/usr/bin/env python3
"""Fold the venture layer into nodes.json.

Adds `venture` to existing private nodes and creates nodes for private companies
not yet on the map. Derives capital_consumed_per_arr_dollar — total raised /
estimated ARR — because net burn is not public for any of these, and capital-per-
ARR is the closest computable proxy for the burn-multiple question a growth
investor actually asks.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
nodes = json.loads((ROOT / "data/seed/nodes.json").read_text())
v = json.loads((ROOT / "data/seed/venture.json").read_text())
AS_OF = v["as_of"]
by_id = {n["id"]: n for n in nodes}

CITE = {"publisher": "Press coverage / venture databases (aggregated)",
        "title": "Last priced round as reported", "url": "https://techcrunch.com/tag/funding/",
        "as_of": AS_OF}


def venture_block(c):
    raised, arr = c.get("total_raised_usd_m"), c.get("estimated_arr_usd_m")
    b = {
        "funding_tier": c.get("funding_tier"),
        "post_money_usd_m": c.get("post_money_usd_m"),
        "last_round_date": c.get("last_round_date"),
        "total_raised_usd_m": raised,
        "estimated_arr_usd_m": arr,
        "arr_growth_yoy_pct": c.get("arr_growth_yoy_pct"),
        "nrr_pct": c.get("nrr_pct"),
        "net_burn_usd_m": None,
        "burn_multiple": None,
        "runway_months": None,
        "next_financing_horizon": None,
        "lead_investors": c.get("lead_investors", []),
        "compute_subsidy_note": c.get("compute_subsidy_note"),
        "source": CITE,
    }
    return b


created, updated = [], []
for c in v["companies"]:
    by_id[c["id"]]["venture"] = venture_block(c)
    updated.append(c["id"])

for c in v["new_companies"]:
    arr = c.get("estimated_arr_usd_m")
    node = {
        "id": c["id"], "name": c["name"], "ticker": None, "is_public": False,
        "hq": c.get("hq", "US"), "layer": c["layer"], "segment": c["segment"],
        "also_operates": [], "verticals": c.get("verticals", []),
        "period": f"Estimated ARR run-rate as of {AS_OF} (press-reported)",
        "revenue_total": {
            "value": arr, "unit": "usd_millions", "is_estimate": True, "confidence": "low",
            "basis": ("Estimated ARR run-rate, press-reported. Private company: unaudited, not a filed "
                       "figure, and ARR for AI-native companies is usually annualized run-rate rather "
                       "than contracted recurring revenue."),
            # ARR is ALREADY annual. factor 1 stops the UI implying a x4 that
            # never happened, and distinguishes this from "derivation unknown".
            "reported_value": arr, "reported_period": "already an annualized run-rate",
            "annualization_factor": 1,
            "source": CITE},
        "moat": {"summary": c["note"], "strength": c.get("moat_strength", 2), "type": [], "risks": []},
        "venture": venture_block(c),
        "updated_at": AS_OF, "updated_by": "seed",
    }
    nodes.append(node)
    created.append(c["id"])

# Private nodes that already existed on the map (xAI, Databricks, Anysphere)
# came from coverage.json with no revenue figure. Now that the venture layer
# supplies an ARR estimate, backfill revenue_total so they size correctly
# instead of rendering as minimum-radius dots.
for n in nodes:
    vb = n.get("venture")
    if not vb or n.get("revenue_total", {}).get("value") is not None:
        continue
    arr = vb.get("estimated_arr_usd_m")
    if arr:
        n["revenue_total"] = {
            "value": arr, "unit": "usd_millions", "is_estimate": True, "confidence": "low",
            "basis": ("Estimated ARR run-rate, press-reported. Private company: unaudited and not a filed "
                       "figure. ARR here is an annualized run-rate, not contracted recurring revenue."),
            "reported_value": arr, "reported_period": "already an annualized run-rate",
            "annualization_factor": 1,
            "source": CITE}
        n["period"] = f"Estimated ARR run-rate as of {AS_OF} (press-reported)"

# Derived: capital consumed per dollar of ARR. Net burn is not disclosed for any
# of these, so this is the computable stand-in for burn efficiency.
for n in nodes:
    vb = n.get("venture")
    if not vb:
        continue
    raised, arr = vb.get("total_raised_usd_m"), vb.get("estimated_arr_usd_m")
    if raised and arr:
        vb["capital_consumed_per_arr_dollar"] = round(raised / arr, 2)

(ROOT / "data/seed/nodes.json").write_text(json.dumps(nodes, indent=2) + "\n")
print(f"updated {len(updated)} existing, created {len(created)} new -> {len(nodes)} nodes total\n")

rows = [(n["venture"]["capital_consumed_per_arr_dollar"], n["name"],
         n["venture"].get("total_raised_usd_m"), n["venture"].get("estimated_arr_usd_m"),
         n["venture"].get("post_money_usd_m"))
        for n in nodes if n.get("venture", {}).get("capital_consumed_per_arr_dollar")]
rows.sort()
print("CAPITAL CONSUMED PER $1 OF ARR — the growth-equity efficiency screen")
print(f"  {'company':<24}{'$raised/$ARR':>13}{'raised':>10}{'ARR':>10}{'post-money':>12}")
print("  " + "-"*70)
for r, name, raised, arr, pm in rows:
    print(f"  {name:<24}{r:>13.2f}{raised:>9,.0f}M{arr:>9,.0f}M{(f'{pm:,.0f}M' if pm else '—'):>12}")
