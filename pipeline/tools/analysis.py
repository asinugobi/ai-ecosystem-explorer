"""Graph analytics over the map — the Python mirror of src/lib/flow.js.

Money direction is the load-bearing idea. Links are authored "source provides X
to target", but cash runs the other way on supply, foundry, power and licensing
edges. Circular-financing analysis follows cash, not goods; get it backwards and
the Nvidia -> OpenAI -> Oracle loop is invisible.
"""
from __future__ import annotations

import json
from collections import defaultdict, Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"

# True  = cash flows source -> target (the source is paying)
# False = cash flows target -> source (the source supplies; the target pays)
MONEY_FORWARD = {
    "investment": True, "equity_stake": True, "corporate_venture": True,
    "compute_contract": True, "compute_for_equity": True, "compute_credits": True,
    "customer_concentration": True, "partnership": True,
    "supply": False, "foundry": False, "power_purchase": False,
    "data_license": False, "operational_integration": False,
}
TIER = {
    "investment": "capital", "equity_stake": "capital", "corporate_venture": "capital",
    "compute_contract": "compute", "compute_for_equity": "compute", "compute_credits": "compute",
}


def tier(link_type: str) -> str:
    return TIER.get(link_type, "operational")


class Graph:
    def __init__(self) -> None:
        self.nodes: list[dict] = json.loads((SEED / "nodes.json").read_text())
        self.links: list[dict] = json.loads((SEED / "links.json").read_text())
        self.overrides: dict = json.loads((SEED / "overrides.json").read_text())["overrides"]
        self.tax: dict = json.loads((ROOT / "data/schema/taxonomy.json").read_text())
        # Press overrides are applied at render time in the UI; apply them here
        # too so the MCP server and the map never disagree about a number.
        for n in self.nodes:
            if n["id"] in self.overrides:
                o = dict(self.overrides[n["id"]])
                o.pop("moat", None)
                n.update(o)
        self.by_id = {n["id"]: n for n in self.nodes}
        self.layers = {l["layer"]: l for l in self.tax["layers"]}
        self.segments = {s["id"]: s for s in self.tax["segments"]}

    # ---------- accessors ----------
    @staticmethod
    def val(node: dict, key: str):
        m = node.get(key)
        return m.get("value") if isinstance(m, dict) else None

    def venture(self, node: dict, key: str):
        return (node.get("venture") or {}).get(key)

    def metric(self, node: dict, key: str):
        """Unified metric accessor across public figures and venture fields."""
        direct = {
            "revenue": lambda n: self.val(n, "revenue_total"),
            "gross_margin": lambda n: self.val(n, "gross_margin_pct"),
            "operating_margin": lambda n: self.val(n, "operating_margin_pct"),
            "growth": lambda n: self.val(n, "revenue_growth_yoy_pct") or self.venture(n, "arr_growth_yoy_pct"),
            "capex": lambda n: self.val(n, "capex"),
            "capex_pct_revenue": lambda n: (n.get("capital_efficiency") or {}).get("capex_pct_revenue"),
            "revenue_per_capex": lambda n: (n.get("capital_efficiency") or {}).get("revenue_per_capex_dollar"),
            "capital_per_arr": lambda n: self.venture(n, "capital_consumed_per_arr_dollar"),
            "post_money": lambda n: self.venture(n, "post_money_usd_m"),
            "total_raised": lambda n: self.venture(n, "total_raised_usd_m"),
            "market_cap": lambda n: (n.get("valuation") or {}).get("market_cap_usd_m"),
            "ev_revenue": lambda n: (n.get("valuation") or {}).get("ev_revenue"),
            "ev_gross_profit": lambda n: (n.get("valuation") or {}).get("ev_gross_profit"),
            "bottleneck": lambda n: (n.get("bottleneck") or {}).get("criticality"),
            "moat_strength": lambda n: (n.get("moat") or {}).get("strength"),
        }
        f = direct.get(key)
        return f(node) if f else None

    # ---------- money graph ----------
    def money_edge(self, link: dict) -> tuple[str, str]:
        return ((link["source"], link["target"]) if MONEY_FORWARD.get(link["type"], True)
                else (link["target"], link["source"]))

    def financing_cycles(self, max_len: int = 5) -> list[dict]:
        adj = defaultdict(list)
        for l in self.links:
            a, b = self.money_edge(l)
            adj[a].append((b, l))
        found: dict[tuple, dict] = {}

        def walk(start, path, edges, seen):
            for nxt, link in adj.get(path[-1], []):
                if nxt == start and len(path) > 2:
                    key = tuple(sorted(set(path)))
                    found.setdefault(key, {"nodes": path + [nxt], "links": edges + [link]})
                elif nxt not in seen and len(path) < max_len:
                    walk(start, path + [nxt], edges + [link], seen | {nxt})

        for s in list(adj):
            walk(s, [s], [], {s})
        return sorted(found.values(), key=lambda c: len(c["nodes"]))

    def exposure(self, node_id: str, depth: int = 2) -> dict[str, int]:
        """Hop distance only, direction-agnostic. Kept for callers that just
        want the neighbourhood; prefer exposure_directed for analysis."""
        return {k: v["hop"] for k, v in self.exposure_directed(node_id, depth).items()}

    def exposure_directed(self, node_id: str, depth: int = 2) -> dict[str, dict]:
        """Read-across WITH the sign, which is what makes it actionable.

        Goods direction is dependency direction: on a link, `source` supplies
        `target`. Walking from the origin, an edge where the origin is the
        source goes DOWNSTREAM (they depend on our output); an edge where the
        origin is the target goes UPSTREAM (they receive our spend).

        Over multiple hops the composition matters, and this is the part a plain
        neighbourhood list hides. Down-then-up does not reach a dependent — it
        reaches a CO-SUPPLIER into a shared customer. Micron sits two hops from
        TSMC via Nvidia, but Micron does not depend on TSMC; they share a
        customer. Correlated, not dependent, and it trades differently.

          upstream   — they supply us; our spend is their revenue
          downstream — we supply them; our output is their constraint
          lateral    — reached by mixing directions; shares a counterparty
        """
        adj: dict[str, list[tuple[str, str, dict]]] = defaultdict(list)
        for l in self.links:
            adj[l["source"]].append((l["target"], "down", l))   # source supplies target
            adj[l["target"]].append((l["source"], "up", l))

        out: dict[str, dict] = {node_id: {"hop": 0, "relation": "self", "via": [], "moves": []}}
        frontier = [(node_id, [], [])]
        for d in range(1, depth + 1):
            nxt = []
            for cur, via, moves in frontier:
                for nb, move, link in adj.get(cur, []):
                    if nb in out:
                        continue
                    m = moves + [move]
                    kinds = set(m)
                    relation = ("downstream" if kinds == {"down"}
                                else "upstream" if kinds == {"up"} else "lateral")
                    out[nb] = {"hop": d, "relation": relation,
                                "via": via + [cur] if via or cur != node_id else [],
                                "moves": m, "first_link": link if d == 1 else None,
                                "through": cur if d > 1 else None}
                    nxt.append((nb, via + [cur], m))
            frontier = nxt
        return out

    def relationships(self, node_id: str) -> list[dict]:
        return [l for l in self.links if l["source"] == node_id or l["target"] == node_id]

    # ---------- comp sets ----------
    def segment_stats(self, segment_id: str) -> dict:
        members = [n for n in self.nodes if n["segment"] == segment_id]
        rev = [self.val(n, "revenue_total") for n in members]
        rev = [r for r in rev if r is not None]

        def wavg(key):
            pairs = [(self.val(n, key), self.val(n, "revenue_total")) for n in members]
            pairs = [(a, b) for a, b in pairs if a is not None and b]
            w = sum(b for _, b in pairs)
            return round(sum(a * b for a, b in pairs) / w, 1) if w else None

        def med(key):
            vals = sorted(v for v in (self.metric(n, key) for n in members) if v is not None)
            if not vals:
                return None
            m = len(vals) // 2
            return round(vals[m] if len(vals) % 2 else (vals[m - 1] + vals[m]) / 2, 1)

        return {
            "segment": segment_id,
            "name": self.segments[segment_id]["name"],
            "layer": self.segments[segment_id]["layer"],
            "layer_name": self.layers[self.segments[segment_id]["layer"]]["name"],
            "members": len(members),
            "total_revenue_usd_m": round(sum(rev), 1) if rev else None,
            "weighted_gross_margin": wavg("gross_margin_pct"),
            "weighted_operating_margin": wavg("operating_margin_pct"),
            "median_growth_pct": med("growth"),
            "median_revenue_per_capex": med("revenue_per_capex"),
        }


def fmt_usd(m) -> str:
    if m is None:
        return "—"
    b = m / 1000
    if abs(b) >= 1000:
        return f"${b/1000:.2f}T"
    if abs(b) >= 1:
        return f"${b:.1f}B"
    return f"${m:.0f}M"
