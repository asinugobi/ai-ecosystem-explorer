# AI Ecosystem Hierarchical Network Explorer — Spec

**Status:** locked 2026-09-03. Inspiration: Hudson Labs, *The AI Ecosystem Stack — Market Map* (Suhas Pai, 2026-06-16).

## What this is, and how it differs from the reference

Hudson Labs maps 521 companies across 11 layers / 24 segments as a **Sankey ribbon diagram**. Ribbon width = companies tracked. Their spine is `"Where the constraints sit — from megawatts to models"`, with 14 bottlenecks tracked.

A Sankey shows *flow between layers*. It structurally cannot show that **Nvidia invested in OpenAI, which contracts with Oracle, which buys Nvidia**. Company-to-company relationships have nowhere to live in a ribbon.

That relationship layer is this project's reason to exist: **a company-level directed graph nested inside their layer/segment hierarchy.** Same taxonomy, different primitive, answers questions theirs can't.

## Locked decisions

| Area | Decision |
|---|---|
| Taxonomy | Hudson's 11 layers / 24 segments, adopted wholesale (`data/schema/taxonomy.json`) |
| Layout | Force-directed, `forceY` pinning nodes into layer bands; segments as labeled containers with margin heatmap fill; curved cross-layer links |
| Seed size | ~50 companies, 2–3 per segment so no segment is degenerate |
| Data fidelity | Fully researched + cited. Every metric carries `is_estimate`, `basis`, `source` |
| Revenue | Both `revenue_total` and `revenue_ai`, user-toggleable |
| Margin | Both gross and operating, toggleable color |
| Vintage | Latest annualized run-rate; `period` string per node states the exact window |
| Pipeline | Claude Agent SDK — Monitor / Classifier / Committer |
| Design principle | Progressive disclosure — qualitative research revealed only on request |

## Layer ordering (deliberate deviation)

Hudson's sidebar lists Semiconductors *after* data centers. In a stack map the Y axis should encode physical dependency: chips feed systems feed data centers. Our order:

```
11  Applications & edge AI          ← top
10  Applications
 9  Data & content
 8  Data & AI infrastructure software
 7  Cloud, models & platforms
 6  Data centers & cloud capacity
 5  AI systems & hardware
 4  Networking
 3  Semiconductors
 2  Data center physical infrastructure
 1  Energy & power                  ← bottom
```

Reversible: it is one ordered array in `taxonomy.json`.

## The five theses the map must serve

1. **Partnerships & dependencies** — directed links, hover to isolate a company's ecosystem
2. **Circular financing** — cycle detection over `investment` + `compute_contract` edges
3. **Where margin accrues** — margin as node color, aggregated as segment-container heatmap
4. **Chokepoints & concentration** — `bottleneck.criticality` as a visual cue
5. **Capex vs. return** — `capex` alongside revenue

## Interaction model

| Requirement | Visual | Interaction |
|---|---|---|
| Industry structure | Nodes grouped into layer bands | Semantic zoom: scroll expands a layer into its segments |
| Profitability | Node radius (company) + container heatmap (segment/layer) | Global toggle: size by Revenue Scale ↔ Operating Margin % |
| Partnerships | Curved edges across layers | Hover isolates connections, dims the rest to 0.1 |
| AI verticals | Tags on application-layer nodes | Sidebar filter: "Isolate Healthcare AI" |
| Positioning & moat | Persistent right-hand intelligence panel | Click a node → qualitative moat analysis + exact financials |

## Non-obvious engineering constraints

- **Radius must be `scaleSqrt`, not linear.** Microsoft ~$280B vs. a startup ~$50M is 5,600×. Linear gives one planet and fifty invisible dots, and `forceCollide` on that radius throws nodes off-canvas. Area ∝ revenue is also what the eye actually reads.
- **Operating margin goes negative.** Model labs and app-layer startups are deeply unprofitable. Sequential color scale is wrong; must be diverging around zero.
- **Pre-settle the simulation.** Run ~300 ticks headless, paint the settled layout, then keep the sim warm only for drag. "No jitter on load" and "live physics" are otherwise in tension.
- **Estimates must not launder into facts.** `revenue_ai` is an estimate for nearly everyone — Microsoft reports no AI line item. Nvidia's Data Center segment *is* reported, so it is not an estimate. The UI must distinguish these visually, not just in a tooltip.
- **Nodes span layers.** Microsoft is hyperscale + enterprise_ai + gpu_cloud. Primary `segment` drives position; `also_operates` renders as a cue without moving the node.

## Open risk

Assistant knowledge cutoff is May 2026; today is 2026-09-03. Figures for quarters reported Jun–Aug 2026 require live lookup. Any figure that cannot be verified against a real source ships with `confidence: "low"` and a visible flag rather than a confident-looking guess.
