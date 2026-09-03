#!/usr/bin/env python3
"""Derive capital efficiency from figures already sourced from EDGAR.

Nothing new is fetched. revenue_per_capex_dollar is the growth-equity read that
gross margin cannot give you: it separates a company that earns its margin from
one that is currently buying revenue with capital.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = ROOT / "data/seed/nodes.json"
nodes = json.loads(p.read_text())

def v(m):
    return m.get("value") if isinstance(m, dict) else None

def bucket(rpc, gm):
    """Two dimensions, because asset-light and high-margin are different things.

    Super Micro spends almost nothing on capex and earns a 9.9% gross margin —
    asset-light, but nobody's idea of high-margin IP. Collapsing capex intensity
    alone into a single axis puts it beside Reddit, which is nonsense. The third
    bucket, pass_through, is where most integrators and contractors actually sit.
    """
    if rpc is None:
        return None
    if rpc < 5:
        return "capital_heavy"
    if gm is None:
        return "balanced"
    return "ip_light" if gm >= 55 else "pass_through"

changed = 0
for n in nodes:
    rev, cx = v(n.get("revenue_total")), v(n.get("capex"))
    if rev is None or not cx:
        continue
    rpc = round(rev / cx, 2)
    n["capital_efficiency"] = {
        "revenue_per_capex_dollar": rpc,
        "capex_pct_revenue": round(100 * cx / rev, 1),
        "fcf_conversion_pct": None,
        "roic_pct": None,
        "asset_intensity": bucket(rpc, v(n.get("gross_margin_pct"))),
    }
    changed += 1

p.write_text(json.dumps(nodes, indent=2) + "\n")

rows = [(n["capital_efficiency"]["revenue_per_capex_dollar"], n["name"],
         v(n.get("gross_margin_pct")), n["capital_efficiency"]["capex_pct_revenue"],
         n["capital_efficiency"]["asset_intensity"]) for n in nodes if n.get("capital_efficiency")]
rows.sort()
print(f"enriched {changed}/{len(nodes)} nodes\n")
print("THE TOLL-COLLECTOR / IP SPECTRUM — capex-heaviest first")
print(f"  {'company':<26}{'rev/$capex':>11}{'capex %rev':>12}{'gross%':>9}  bucket")
print("  " + "-"*74)
for r, name, gm, cpr, b in rows[:9]:
    print(f"  {name:<26}{r:>11.2f}{cpr:>11.0f}%{(f'{gm:.1f}' if gm is not None else '—'):>9}  {b}")
print("  ...")
for r, name, gm, cpr, b in rows[-6:]:
    print(f"  {name:<26}{r:>11.2f}{cpr:>11.0f}%{(f'{gm:.1f}' if gm is not None else '—'):>9}  {b}")
