# AI Ecosystem Hierarchical Network Explorer

An interactive market map of the AI stack — 93 companies across 11 layers and 24 segments — built as an equity-research and growth-equity instrument rather than an infographic.

Inspired by Hudson Labs, *The AI Ecosystem Stack — Market Map* (Suhas Pai, 2026-06-16).

## Why this exists

Hudson Labs maps 521 companies as a **Sankey ribbon diagram**. A Sankey shows flow between layers. It structurally cannot show that **Nvidia invested in OpenAI, which committed compute spend to Oracle, which buys Nvidia**.

That relationship layer is the point of this project: a company-level directed graph nested inside their layer/segment hierarchy. Same taxonomy, different primitive, answers questions theirs can't.

## What it answers

| Question | How |
|---|---|
| Who is the comp set? | Segments are peer groups; containers show revenue-weighted margin and segment totals |
| Where does cash actually pool? | Capital-efficiency lens: revenue per $ of capex (public), ARR per $ raised (private) |
| Is this a moat or compute arbitrage? | Gross margin beside capital intensity — CoreWeave shows 65.9% GM on capex 3× revenue |
| If TSMC guides capex up, who moves? | Read-across: typed-edge traversal, 1st and 2nd degree |
| Is capital circling? | Cycle detection over the **money** graph (goods and cash flow opposite ways) |
| Where are the chokepoints? | `bottleneck.criticality` — ASML EUV and TSMC CoWoS at 5/5 |

## Quick start

```bash
npm install && npm run dev          # http://localhost:5173
```

```bash
npm run check                       # schema + data validation
node scripts/verify_layout.mjs      # headless geometry check
node scripts/check_components.mjs   # undefined JSX component references
```

Set your SEC contact address first — EDGAR's fair-access policy requires one, and requests without it may be throttled:

```bash
cp .env.example .env && export SEC_USER_AGENT="ai-ecosystem-explorer you@example.com"
```

The Python pipeline needs 3.10+ (the Agent SDK requires it):

```bash
/opt/homebrew/bin/python3.12 -m venv .venv && .venv/bin/pip install claude-agent-sdk jsonschema
```

```bash
.venv/bin/python pipeline/run_pipeline.py --demo --no-commit
```

```bash
.venv/bin/python scripts/test_guard.py
```

## Data provenance

**67 of 93 companies are sourced entirely from SEC EDGAR XBRL**, with every figure carrying an accession number. `pipeline/tools/edgar.py` pulls reported revenue, gross profit, operating income and capex, computes margins only across matching periods, and refuses figures that aren't contemporaneous with revenue.

The rest are press-sourced estimates, flagged `is_estimate: true` with confidence set by source quality. 20 private companies carry a `venture` block — post-money, total raised, estimated ARR, lead investors — which is best-effort and properly belongs to a licensed source (PitchBook/Crunchbase).

**Consensus estimates are absent by design.** Hudson Labs sources theirs from S&P Market Intelligence. There is no free consensus feed, and a fabricated one is worse than a null.

## Architecture

```
data/schema/     taxonomy (11 layers / 24 segments) + JSON Schemas
data/seed/       coverage universe, EDGAR-generated nodes, links, venture layer
src/lib/         scales (sqrt radius, symlog diverging), forces, money-flow analysis
src/components/  NetworkGraph, IntelligencePanel
pipeline/        Monitor -> Classifier -> Committer (Claude Agent SDK)
scripts/         seed build, enrichment, and the verification suite
```

### The pipeline

**Monitor** watches EDGAR for material filings and pulls XBRL facts as primary-source evidence.
**Classifier** is the only LLM stage (`claude-opus-5`), constrained to the 24 real segment ids and forbidden from emitting a figure absent from its evidence.
**Committer** is deliberately *not* an LLM. It validates schema, taxonomy, and provenance, and rejects any figure lacking a resolving citation. `scripts/test_guard.py` runs nine adversarial cases a hallucinating model could plausibly produce; all nine are rejected.

## Non-obvious engineering decisions

- **Radius is `scaleSqrt`.** Amazon ($802B) vs Recursion ($0.06B) is 13,000×. Linear gives one planet and 92 invisible dots.
- **Operating margin uses `scaleDivergingSymlog`.** The observed range is −1760% to +80%; a linear diverging domain paints 92 nodes one shade.
- **Money direction ≠ goods direction.** Links are authored "source provides to target," but cash runs the other way for supply and foundry edges. Cycle detection traverses cash — without that, the Nvidia→OpenAI→Oracle loop is invisible.
- **Link types collapse 13 → 3 groups.** Only three categorical slots clear the all-pairs CVD gate; dash pattern carries "value undisclosed" as secondary encoding.
- **Segment containers tile their allocated span** rather than shrink-wrapping nodes, so a large node can't push its container across a neighbour's.
- **The simulation pre-settles headlessly** (~300 ticks, ~160ms) before the first paint, then stays stopped except during drag.

## Known limitations

- `revenue_ai` is unpopulated. Almost no filer reports an AI-attributable line, so it needs a segment-level or analyst-estimate pass.
- `valuation` (market cap, EV/S) is unpopulated — market data goes stale within a day and needs its own refresh cadence.
- 4 nodes have null revenue — all 20-F foreign filers without XBRL revenue tagging (Cameco, GlobalFoundries, Thomson Reuters, RELX). These are the pipeline's demo targets.
- Capital-intensity buckets are point-in-time. Micron reads `ip_light` because the memory supercycle tripled its revenue; structurally it is one of the most capital-heavy businesses here. Raw `capex_pct_revenue` is exposed so you can see through the label.

## MCP server — the Co-Analyst half

The map and live EDGAR access are exposed to Claude as tools, so you can research and screen the stack conversationally instead of clicking the graph.

```bash
claude mcp add -s user ai-ecosystem -- /Users/asinugobi/ai-ecosystem-explorer/.venv/bin/python /Users/asinugobi/ai-ecosystem-explorer/pipeline/mcp_server.py
```

| Tool | What it answers |
|---|---|
| `map_overview` | Coverage, the 11 layers and what constrains each |
| `find_companies` | Filter by layer / segment / vertical / ownership, sort by any metric |
| `company_detail` | Full research note with derivation basis and source URLs |
| `comp_set` | Segment peer table with revenue-weighted aggregates |
| `screen` | Metric-threshold screening — the growth-equity filter |
| `read_across` | If this moves, what else moves (the Sankey can't do this) |
| `financing_cycles` | Capital loops, traversing money direction not goods |
| `valuation_comps` | Market cap, EV, EV/S, EV/gross profit, EV/EBITDA by segment |
| `edgar_lookup` | Live XBRL for **any** US filer, on the map or not |
| `edgar_filings` | Recent filings — what the Monitor polls |

Worth trying: `screen("revenue_per_capex", maximum=1)` returns the three neoclouds currently buying revenue with capital. `comp_set("gpu_cloud")` shows that peer group at −15% weighted operating margin.

## Valuation feed

`scripts/build_valuations.py` populates `node.valuation` for 65 of 73 public companies. Only the **price** comes from a quote feed — shares outstanding, cash, debt and D&A all come from EDGAR XBRL, so enterprise value is computed from balance-sheet items rather than approximated by market cap.

Re-run it whenever you want fresh multiples; it stamps its own `as_of` and touches nothing else on the node:

```bash
.venv/bin/python scripts/build_valuations.py
```

**Eight companies are deliberately unpriced.** Foreign private issuers (TSMC, ASML, RELX, Thomson Reuters) report *ordinary* shares while the quote is for an ADR representing several of them, and the ratio is not in EDGAR — guessing it produced a $10.8T TSMC on the first run. The rest have no usable share count. A stated gap beats a confident wrong number.

**Forward P/E is always null.** It needs consensus estimates, which are licensed.

`EV / gross profit` is the better cross-stack comparator: Super Micro trades at 0.6× revenue but 5.6× gross profit, because its gross margin is under 10%. Comparing a 10%-margin integrator to a 98%-margin IP licensor on EV/S is comparing nothing.
