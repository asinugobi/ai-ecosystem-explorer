#!/usr/bin/env python3
"""AI Ecosystem Explorer — MCP server.

The Hudson Labs "Co-Analyst" concept applied to this map: the whole dataset plus
live SEC EDGAR access, exposed to Claude as tools so you can research and screen
the AI stack conversationally instead of clicking around the graph.

Register it:
    claude mcp add ai-ecosystem -- /Users/asinugobi/ai-ecosystem-explorer/.venv/bin/python \
        /Users/asinugobi/ai-ecosystem-explorer/pipeline/mcp_server.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.mcpserver import MCPServer

from tools.analysis import Graph, fmt_usd, tier, MONEY_FORWARD

mcp = MCPServer(
    name="ai-ecosystem",
    instructions=(
        "A map of the AI ecosystem: 93 companies across 11 layers and 24 segments, with typed "
        "directed relationships. 67 companies are sourced from SEC EDGAR XBRL with accession-number "
        "citations; the rest are press-sourced estimates, always marked. Segments are comp sets. "
        "Use read_across to answer 'if X moves, what else moves'. Use screen for growth-equity "
        "filtering on capital efficiency. Figures marked [est] are not filed numbers — say so when "
        "you cite them."
    ),
)

G = Graph()


def _pct(v, d=1):
    return "—" if v is None else f"{v:.{d}f}%"


def _est(node, key):
    m = node.get(key)
    return " [est]" if isinstance(m, dict) and m.get("is_estimate") and m.get("value") is not None else ""


# ─────────────────────────── discovery ───────────────────────────

@mcp.tool(description="Overview of the map: coverage, layers, segments, and data provenance. Start here.")
def map_overview() -> str:
    sec = sum(1 for n in G.nodes if (n.get("revenue_total") or {}).get("is_estimate") is False)
    priv = sum(1 for n in G.nodes if not n["is_public"])
    rev = sum(v for v in (G.val(n, "revenue_total") for n in G.nodes) if v)
    out = [
        f"AI ECOSYSTEM MAP — {len(G.nodes)} companies, {len(G.links)} relationships",
        f"{sec} SEC-sourced (XBRL, cited to an accession number) · {priv} private (press estimates)",
        f"{fmt_usd(rev)} of mapped revenue run-rate",
        "",
        "LAYERS (1 = bottom of the stack, megawatts; 11 = top, applications):",
    ]
    for l in sorted(G.layers.values(), key=lambda x: -x["layer"]):
        segs = [s for s in G.segments.values() if s["layer"] == l["layer"]]
        n = sum(1 for x in G.nodes if x["layer"] == l["layer"])
        out.append(f"  {l['layer']:>2}. {l['name']:<38} {n:>2} companies, {len(segs)} segments")
        out.append(f"      constraint: {l['constraint']}")
    out += ["", "Every segment is a comp set — use comp_set(segment_id) for peer aggregates."]
    return "\n".join(out)


@mcp.tool(description=(
    "Find companies on the map. Filter by layer (1-11), segment id, vertical, or ownership "
    "('public'/'private'). Sort by any metric: revenue, gross_margin, operating_margin, growth, "
    "revenue_per_capex, capital_per_arr, post_money, market_cap, bottleneck, moat_strength."))
def find_companies(layer: int | None = None, segment: str | None = None, vertical: str | None = None,
                   ownership: str | None = None, sort_by: str = "revenue", descending: bool = True,
                   limit: int = 20, name_contains: str | None = None) -> str:
    rows = list(G.nodes)
    if layer is not None:
        rows = [n for n in rows if n["layer"] == layer]
    if segment:
        rows = [n for n in rows if n["segment"] == segment or segment in (n.get("also_operates") or [])]
    if vertical:
        rows = [n for n in rows if vertical in (n.get("verticals") or [])]
    if ownership:
        rows = [n for n in rows if n["is_public"] == (ownership.lower() == "public")]
    if name_contains:
        q = name_contains.lower()
        rows = [n for n in rows if q in n["name"].lower() or q in (n.get("ticker") or "").lower()]
    if not rows:
        return "No companies match those filters."

    keyed = [(G.metric(n, sort_by), n) for n in rows]
    keyed.sort(key=lambda x: (x[0] is None, -(x[0] or 0) if descending else (x[0] or 0)))
    out = [f"{len(rows)} match; showing {min(limit, len(rows))} sorted by {sort_by}",
           f"{'company':<26}{'tick':<7}{'L':<3}{'revenue':>10}{'gross':>8}{'oper':>9}{'YoY':>9}  segment"]
    out.append("-" * 104)
    for _, n in keyed[:limit]:
        out.append(
            f"{n['name'][:25]:<26}{(n.get('ticker') or 'priv'):<7}{n['layer']:<3}"
            f"{fmt_usd(G.val(n,'revenue_total')):>10}{_pct(G.val(n,'gross_margin_pct'),0):>8}"
            f"{_pct(G.val(n,'operating_margin_pct'),0):>9}{_pct(G.metric(n,'growth'),0):>9}  {n['segment']}")
    return "\n".join(out)


@mcp.tool(description=(
    "Full research note on one company: financials with their derivation basis and source URLs, "
    "capital efficiency, venture economics if private, moat, chokepoint status, and relationships. "
    "Takes a node id or a ticker."))
def company_detail(company: str) -> str:
    n = G.by_id.get(company.lower()) or next(
        (x for x in G.nodes if (x.get("ticker") or "").upper() == company.upper()
         or x["name"].lower() == company.lower()), None)
    if not n:
        return f"'{company}' is not on the map. Use find_companies(name_contains=...) to search."

    out = [f"{n['name']}" + (f"  [{n['ticker']}]" if n.get("ticker") else "  [PRIVATE]"),
           f"{G.layers[n['layer']]['name']} · {G.segments[n['segment']]['name']} · {n.get('hq','—')}",
           f"Period: {n.get('period','—')}", ""]

    if n.get("bottleneck", {}).get("is_bottleneck"):
        b = n["bottleneck"]
        out += [f"CHOKEPOINT — criticality {b['criticality']}/5", f"  {b['rationale']}", ""]

    out.append("FINANCIALS")
    for label, key in [("Revenue (run-rate)", "revenue_total"), ("Gross margin", "gross_margin_pct"),
                       ("Operating margin", "operating_margin_pct"), ("Growth YoY", "revenue_growth_yoy_pct"),
                       ("Capex (annualized)", "capex")]:
        m = n.get(key)
        if not isinstance(m, dict) or m.get("value") is None:
            continue
        unit = "%" if m.get("unit") == "percent" else ""
        v = f"{m['value']:,.1f}{unit}" if unit else fmt_usd(m["value"])
        out.append(f"  {label:<22} {v}{_est(n,key)}")
        out.append(f"      basis: {m.get('basis','')}")
        if m.get("source", {}).get("url"):
            out.append(f"      source: {m['source']['publisher']} ({m['source']['as_of']}) {m['source']['url']}")

    ce = n.get("capital_efficiency")
    if ce and ce.get("revenue_per_capex_dollar") is not None:
        out += ["", "CAPITAL EFFICIENCY",
                f"  Revenue per $1 capex   {ce['revenue_per_capex_dollar']:.2f}",
                f"  Capex as % revenue     {_pct(ce.get('capex_pct_revenue'),0)}",
                f"  Asset intensity        {ce.get('asset_intensity')}"]

    v = n.get("venture")
    if v:
        out += ["", "VENTURE ECONOMICS (press-estimated, not filed)"]
        out += [f"  Funding tier           {v.get('funding_tier')}",
                f"  Post-money             {fmt_usd(v.get('post_money_usd_m'))} ({v.get('last_round_date')})",
                f"  Total raised           {fmt_usd(v.get('total_raised_usd_m'))}",
                f"  Estimated ARR          {fmt_usd(v.get('estimated_arr_usd_m'))}",
                f"  Capital per $1 ARR     {v.get('capital_consumed_per_arr_dollar')}"]
        if v.get("nrr_pct"):
            out.append(f"  NRR                    {_pct(v['nrr_pct'],0)}")
        if v.get("lead_investors"):
            out.append(f"  Lead backers           {', '.join(v['lead_investors'])}")
        if v.get("compute_subsidy_note"):
            out += ["", f"  COMPUTE ARBITRAGE CHECK: {v['compute_subsidy_note']}"]

    m = n.get("moat") or {}
    out += ["", f"POSITIONING & MOAT (strength {m.get('strength','—')}/5)", f"  {m.get('summary','')}"]
    if m.get("risks"):
        out += ["  Risks:"] + [f"    - {r}" for r in m["risks"]]

    rels = G.relationships(n["id"])
    if rels:
        out += ["", f"RELATIONSHIPS ({len(rels)})"]
        for l in rels:
            other = l["target"] if l["source"] == n["id"] else l["source"]
            pays, _ = G.money_edge(l)
            arrow = "pays" if pays == n["id"] else "paid by"
            val = fmt_usd(l["value_usd_m"]) if l.get("value_usd_m") else "undisclosed"
            out.append(f"  {arrow:>7} {G.by_id[other]['name']:<24} {l['type']:<24} {val}  [{tier(l['type'])}]")
            if l.get("exposure_note"):
                out.append(f"          {l['exposure_note']}")
    return "\n".join(out)


# ─────────────────────────── analysis ───────────────────────────

@mcp.tool(description=(
    "Comp-set table for a segment: every peer with aggregates (revenue-weighted margin, median "
    "growth, median capital efficiency). Segments ARE the peer groups you would screen within."))
def comp_set(segment: str) -> str:
    if segment not in G.segments:
        return f"Unknown segment. Valid ids: {', '.join(sorted(G.segments))}"
    st = G.segment_stats(segment)
    members = [n for n in G.nodes if n["segment"] == segment]
    members.sort(key=lambda n: -(G.val(n, "revenue_total") or 0))
    out = [f"COMP SET — {st['name']}  (layer {st['layer']}: {st['layer_name']})",
           f"{st['members']} companies · {fmt_usd(st['total_revenue_usd_m'])} combined revenue",
           f"weighted gross {_pct(st['weighted_gross_margin'],0)} · weighted operating "
           f"{_pct(st['weighted_operating_margin'],0)} · median growth {_pct(st['median_growth_pct'],0)} "
           f"· median rev/$capex {st['median_revenue_per_capex']}", "",
           f"{'company':<26}{'tick':<7}{'revenue':>10}{'gross':>8}{'oper':>9}{'YoY':>9}{'rev/$cx':>9}"]
    out.append("-" * 78)
    for n in members:
        _r = G.metric(n, "revenue_per_capex")
        rpc = f"{_r:.1f}" if _r is not None else "—"
        out.append(f"{n['name'][:25]:<26}{(n.get('ticker') or 'priv'):<7}"
                    f"{fmt_usd(G.val(n,'revenue_total')):>10}{_pct(G.val(n,'gross_margin_pct'),0):>8}"
                    f"{_pct(G.val(n,'operating_margin_pct'),0):>9}{_pct(G.metric(n,'growth'),0):>9}"
                    f"{rpc:>9}")
    return "\n".join(out)


@mcp.tool(description=(
    "Screen the map on metric thresholds — the growth-equity filter. Metrics: revenue, "
    "gross_margin, operating_margin, growth, revenue_per_capex, capital_per_arr, capex_pct_revenue, "
    "post_money, moat_strength, bottleneck. Example: screen('revenue_per_capex', maximum=1) finds "
    "companies currently buying revenue with capital."))
def screen(metric: str, minimum: float | None = None, maximum: float | None = None,
           ownership: str | None = None, layer: int | None = None, limit: int = 25) -> str:
    rows = list(G.nodes)
    if ownership:
        rows = [n for n in rows if n["is_public"] == (ownership.lower() == "public")]
    if layer is not None:
        rows = [n for n in rows if n["layer"] == layer]
    hits = []
    for n in rows:
        v = G.metric(n, metric)
        if v is None:
            continue
        if minimum is not None and v < minimum:
            continue
        if maximum is not None and v > maximum:
            continue
        hits.append((v, n))
    if not hits:
        return f"Nothing passes that screen. ({len(rows)} candidates had a value for '{metric}'.)"
    hits.sort(key=lambda x: x[0])
    bounds = " and ".join(filter(None, [f">= {minimum}" if minimum is not None else None,
                                          f"<= {maximum}" if maximum is not None else None])) or "any value"
    out = [f"SCREEN — {metric} {bounds}  ({len(hits)} hits)",
           f"{'company':<26}{'tick':<7}{metric[:14]:>15}{'revenue':>11}{'oper':>8}  segment", "-" * 88]
    for v, n in hits[:limit]:
        out.append(f"{n['name'][:25]:<26}{(n.get('ticker') or 'priv'):<7}{v:>15,.2f}"
                    f"{fmt_usd(G.val(n,'revenue_total')):>11}{_pct(G.val(n,'operating_margin_pct'),0):>8}  {n['segment']}")
    return "\n".join(out)


@mcp.tool(description=(
    "Read-across WITH direction: if this company moves, what else moves, and which way? "
    "Classifies each counterparty as upstream (they supply us), downstream (we supply them), "
    "co_supplier (we sell into the same customers — rivals for demand), co_customer (we buy from "
    "the same suppliers — rivals for allocation), or lateral. The sign flips the trade, so a plain "
    "neighbourhood list is not enough. This is the question a Sankey market map cannot answer."))
def read_across(company: str, depth: int = 2) -> str:
    n = G.by_id.get(company.lower()) or next(
        (x for x in G.nodes if (x.get("ticker") or "").upper() == company.upper()), None)
    if not n:
        return f"'{company}' is not on the map."
    reach = G.exposure_directed(n["id"], depth)
    if len(reach) == 1:
        return f"{n['name']} has no mapped relationships yet."

    MEANING = {
        "upstream": ("UPSTREAM — they supply {me}; {me}'s spend is their revenue",
                     "A {me} capex raise is bullish these names. A {me} revenue miss leaves their "
                     "order book intact for several quarters."),
        "downstream": ("DOWNSTREAM — {me} supplies them; {me}'s output is their constraint",
                       "A {me} capacity constraint caps these names regardless of their own demand."),
        "co_supplier": ("CO-SUPPLIERS — they sell into the same customers as {me}",
                        "Rivals for the SAME DEMAND. They gain when {me} loses share, and both suffer "
                        "if that end customer cuts spend."),
        "co_customer": ("CO-CUSTOMERS — they buy from the same suppliers as {me}",
                        "Rivals for the SAME ALLOCATION. A supply constraint sets them against each "
                        "other; neither benefits from the other's shortage of end demand."),
        "lateral": ("LATERAL — related through a longer mixed path",
                    "Neither a clean dependency nor a clean rivalry. Treat as weakly correlated."),
    }
    out = [f"READ-ACROSS from {n['name']} (depth {depth})", ""]
    for rel in ("upstream", "downstream", "co_supplier", "co_customer", "lateral"):
        rows = [(i, v) for i, v in reach.items() if v["relation"] == rel]
        if not rows:
            continue
        head, note = MEANING[rel]
        me = n.get("ticker") or n["name"]
        out.append(head.format(me=me) + f"  ({len(rows)})")
        for i, v in sorted(rows, key=lambda x: (x[1]["hop"], -(G.val(G.by_id[x[0]], "revenue_total") or 0))):
            o = G.by_id[i]
            if v["hop"] == 1 and v.get("first_link"):
                why = f"({v['first_link']['type']})"
            else:
                why = f"via {G.by_id[v['through']]['name']}" if v.get("through") else ""
            out.append(f"    hop{v['hop']}  {o['name'][:24]:<25}{(o.get('ticker') or 'priv'):<7}"
                        f"{fmt_usd(G.val(o,'revenue_total')):>10}  {why}")
        out.append(f"    -> {note.format(me=me)}")
        out.append("")
    if n.get("analyst", {}).get("read_across"):
        out += ["ANALYST NOTES:"] + [f"  - {x}" for x in n["analyst"]["read_across"]]
    return "\n".join(out)


@mcp.tool(description=(
    "Detect circular financing — capital that leaves a company and returns through the ecosystem. "
    "Traverses the MONEY direction, which is the reverse of the authored edge for supply, foundry, "
    "power and licensing relationships."))
def financing_cycles() -> str:
    cycles = G.financing_cycles()
    if not cycles:
        return "No financing cycles in the current link set."
    out = [f"{len(cycles)} CIRCULAR FINANCING LOOP(S)", ""]
    for i, c in enumerate(cycles, 1):
        out.append(f"LOOP {i}: " + " -> ".join(G.by_id[x]["name"] for x in c["nodes"]))
        total = 0
        for l in c["links"]:
            payer, payee = G.money_edge(l)
            val = fmt_usd(l["value_usd_m"]) if l.get("value_usd_m") else "undisclosed"
            if l.get("value_usd_m"):
                total += l["value_usd_m"]
            out.append(f"    {G.by_id[payer]['name']:<12} pays {G.by_id[payee]['name']:<14} "
                        f"{l['type']:<24}{val:>12}")
        out.append(f"    disclosed value around the loop: {fmt_usd(total) if total else 'none disclosed'}")
        out.append("")
    out.append("Bulls read these as demand visibility; bears read them as vendor financing that "
               "inflates reported demand on both sides.")
    return "\n".join(out)


@mcp.tool(description=(
    "Valuation comps — market cap, EV, EV/revenue, EV/gross profit, EV/EBITDA. Filter to a segment "
    "or layer. EV is market cap plus debt less cash, all from the balance sheet. Forward P/E is "
    "always null: it needs licensed consensus estimates, and a fabricated multiple is worse than none. "
    "Sort by ev_revenue, ev_gross_profit, ev_ebitda or market_cap."))
def valuation_comps(segment: str | None = None, layer: int | None = None,
                    sort_by: str = "ev_revenue", limit: int = 20) -> str:
    rows = [n for n in G.nodes if (n.get("valuation") or {}).get("market_cap_usd_m") is not None]
    if segment:
        rows = [n for n in rows if n["segment"] == segment]
    if layer is not None:
        rows = [n for n in rows if n["layer"] == layer]
    if not rows:
        return "No priced companies match. 8 filers are unpriced — foreign private issuers whose ADR ratio is not in EDGAR, plus filers with no usable share count."
    key = lambda n: (n["valuation"].get(sort_by) is None, -(n["valuation"].get(sort_by) or 0))
    rows.sort(key=key)
    out = [f"VALUATION COMPS — sorted by {sort_by}  ({len(rows)} priced, as of {rows[0]['valuation']['as_of']})",
           f"{'company':<24}{'tick':<7}{'mcap':>9}{'EV':>9}{'EV/S':>7}{'EV/GP':>7}{'EV/EBITDA':>11}{'gross':>7}{'YoY':>7}",
           "-" * 88]
    for n in rows[:limit]:
        v = n["valuation"]
        f = lambda x, d=1: "—" if x is None else f"{x:.{d}f}"
        out.append(f"{n['name'][:23]:<24}{(n.get('ticker') or 'priv'):<7}"
                    f"{fmt_usd(v['market_cap_usd_m']):>9}{fmt_usd(v['enterprise_value_usd_m']):>9}"
                    f"{f(v.get('ev_revenue')):>7}{f(v.get('ev_gross_profit')):>7}{f(v.get('ev_ebitda')):>11}"
                    f"{_pct(G.val(n,'gross_margin_pct'),0):>7}{_pct(G.metric(n,'growth'),0):>7}")
    out += ["", "EV/gross profit is the better cross-stack comparator: Super Micro looks cheap at 0.6x "
                "revenue but trades near 5.6x gross profit, because its gross margin is under 10%."]
    return "\n".join(out)


# ─────────────────────────── live primary source ───────────────────────────

@mcp.tool(description=(
    "Pull current reported financials straight from SEC EDGAR XBRL for ANY US filer, including "
    "companies not on the map. Returns revenue, margins and capex with the accession number."))
def edgar_lookup(ticker: str) -> str:
    from tools.edgar import latest_facts, yoy_growth
    fin = latest_facts(ticker)
    if not fin or not fin.get("revenue"):
        return (f"No usable XBRL revenue concept for {ticker}. Likely a 20-F foreign private issuer "
                f"without revenue tagging (TSMC and ASML both behave this way).")
    rev = fin.get("revenue")
    out = [f"{fin.name}  [{fin.ticker}]  CIK {fin.cik}",
           f"Period: {fin.period_label}", "",
           f"  Revenue (quarter)      {fmt_usd(rev.value/1e6)}",
           f"  Revenue (annualized)   {fmt_usd(rev.annualized/1e6)}",
           f"  Gross margin           {_pct(fin.margin_pct('gross_profit'))}",
           f"  Operating margin       {_pct(fin.margin_pct('operating_income'))}"]
    cx = fin.get("capex")
    if cx:
        out.append(f"  Capex (annualized)     {fmt_usd(cx.annualized/1e6)}   (cash PP&E only, excludes finance leases)")
        if rev.annualized:
            out.append(f"  Revenue per $1 capex   {rev.annualized/cx.annualized:.2f}")
    g = yoy_growth(fin)
    if g is not None:
        out.append(f"  Revenue growth YoY     {g}%")
    if fin.stale:
        out += ["", "  DROPPED as non-contemporaneous with revenue:"] + [f"    - {s}" for s in fin.stale]
    out += ["", f"  Source: {rev.form} filed {rev.filed}, accession {rev.accn}", f"  {rev.url}"]
    on_map = next((n for n in G.nodes if (n.get("ticker") or "").upper() == ticker.upper()), None)
    out.append("")
    out.append(f"  On the map as '{on_map['id']}'." if on_map else "  NOT on the map — a candidate to add.")
    return "\n".join(out)


@mcp.tool(description="Recent SEC filings for a ticker — what the Monitor agent polls to detect change.")
def edgar_filings(ticker: str, limit: int = 10) -> str:
    from tools.edgar import recent_filings
    f = recent_filings(ticker, forms=("8-K", "10-Q", "10-K", "20-F"), limit=limit)
    if not f:
        return f"No recent filings found for {ticker}."
    out = [f"RECENT FILINGS — {ticker.upper()}", ""]
    for x in f:
        out.append(f"  {x['filed']}  {x['form']:<6} {(x['description'] or '')[:44]:<46} {x['url']}")
    return "\n".join(out)


if __name__ == "__main__":
    mcp.run(transport="stdio")
