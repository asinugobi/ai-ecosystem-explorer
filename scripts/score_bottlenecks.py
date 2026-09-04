#!/usr/bin/env python3
"""Derive bottleneck criticality from substitutability evidence.

The earlier five ratings were hand-written from domain knowledge, which made
them unarguable — you either trusted them or you didn't. These are computed from
three stated fields, so a disagreement becomes a disagreement about evidence.

Weighting reflects what actually makes a chokepoint bite. Supplier count sets
the base: a sole source is categorically different from a duopoly, which is
categorically different from a crowded field. Lead time decides whether that
matters — three months to qualify a second source is an inconvenience, five
years is a thesis. Capacity state converts a theoretical constraint into a
binding one: a sole supplier with idle capacity is not a bottleneck today.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SUPPLIER_BASE = [(1, 5.0), (2, 4.2), (3, 3.5), (5, 2.8), (9, 2.0), (10**9, 1.3)]
LEAD_ADJ = [(48, 0.8), (24, 0.4), (12, 0.1), (0, -0.3)]
CAPACITY_ADJ = {"sold_out": 0.6, "constrained": 0.3, "balanced": 0.0, "oversupplied": -0.5}

# Where a company sits INSIDE its supplier set. Without this, all three
# qualified accelerator vendors score identically to each other — but they are
# each other's substitutes, so the FUNCTION has one collective chokepoint and
# the companies share it unevenly.
POSITION_MULT = {"sole": 1.0, "dominant": 0.92, "co_leader": 0.80,
                 "one_of_several": 0.62, "marginal": 0.45}

# A physical constraint cannot be paid around. A commercial one can be,
# expensively. Thomson Reuters scoring level with ASML was the tell that the
# formula was treating "hard to switch" as "impossible to substitute".
CONSTRAINT_MULT = {"physical": 1.0, "commercial": 0.78}


def score(suppliers, lead_months, capacity, position=None, constraint=None):
    if suppliers is None:
        return None
    base = next(v for cap, v in SUPPLIER_BASE if suppliers <= cap)
    lead = next((v for threshold, v in LEAD_ADJ if (lead_months or 0) >= threshold), -0.3)
    cap = CAPACITY_ADJ.get(capacity, 0.0)
    raw = base + lead + cap
    raw *= POSITION_MULT.get(position, 0.62)
    raw *= CONSTRAINT_MULT.get(constraint, 1.0)
    return round(max(1.0, min(5.0, raw)), 1)


def main():
    nodes = json.loads((ROOT / "data/seed/nodes.json").read_text())
    cfg = json.loads((ROOT / "data/seed/bottlenecks.json").read_text())
    defaults, overrides = cfg["segment_defaults"], cfg["company_overrides"]

    counts = {"override": 0, "segment": 0, "none": 0}
    for n in nodes:
        ev = overrides.get(n["id"]) or defaults.get(n["segment"])
        if not ev:
            counts["none"] += 1
            continue
        counts["override" if overrides.get(n["id"]) else "segment"] += 1
        c = score(ev["qualified_suppliers"], ev["substitution_lead_time_months"], ev["capacity_state"],
                  ev.get("market_position"), ev.get("constraint_type"))
        n["bottleneck"] = {
            "is_bottleneck": c is not None and c >= 3.5,
            "criticality": int(round(c)) if c is not None else None,
            "computed_criticality": c,
            "rationale": ev["note"],
            "qualified_suppliers": ev["qualified_suppliers"],
            "substitution_lead_time_months": ev["substitution_lead_time_months"],
            "capacity_state": ev["capacity_state"],
            "confidence": ev.get("confidence"),
            "evidence_source": "company" if overrides.get(n["id"]) else "segment",
            "market_position": ev.get("market_position"),
            "constraint_type": ev.get("constraint_type"),
        }

    (ROOT / "data/seed/nodes.json").write_text(json.dumps(nodes, indent=2) + "\n")
    rated = [n for n in nodes if (n.get("bottleneck") or {}).get("computed_criticality") is not None]
    print(f"rated {len(rated)}/{len(nodes)}  ({counts['override']} company-specific, "
          f"{counts['segment']} from segment default)")

    rated.sort(key=lambda n: -n["bottleneck"]["computed_criticality"])
    print(f"\n{'crit':<6}{'company':<24}{'sup':>4}{'lead':>6}{'capacity':>13}{'position':>16}{'type':>6}  segment")
    print("-" * 100)
    for n in rated[:16]:
        b = n["bottleneck"]
        print(f"{b['computed_criticality']:<6}{n['name'][:23]:<24}{b['qualified_suppliers']:>4}"
              f"{b['substitution_lead_time_months']:>5}m{b['capacity_state']:>13}"
              f"{(b.get('market_position') or '—'):>16}{(b.get('constraint_type') or '—')[:4]:>6}  {n['segment']}")

    import collections
    dist = collections.Counter(n["bottleneck"]["criticality"] for n in rated)
    print("\ncriticality distribution:", dict(sorted(dist.items(), reverse=True)))
    print("flagged as bottlenecks (>=3.5):", sum(1 for n in rated if n["bottleneck"]["is_bottleneck"]))


if __name__ == "__main__":
    main()
