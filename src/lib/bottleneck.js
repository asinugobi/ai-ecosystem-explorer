import * as d3 from 'd3'

/**
 * Selectors for the substitutability matrix.
 *
 * The two axes are ORDINAL, not continuous. Supplier counts take 9 distinct
 * values and lead times 10, because most evidence comes from segment-level
 * defaults. 93 companies therefore occupy ~30 cells, with up to 12 stacked on
 * one. Any design that treats these as continuous and plots a dot per company
 * renders ~30 marks while implying 93 — so binning is not a rendering
 * convenience here, it is the honest primitive.
 */

export const SUPPLIER_TICKS = [1, 2, 3, 4, 5, 6, 8, 10, 12]
export const LEAD_TICKS = [6, 9, 12, 18, 24, 30, 36, 48, 60, 120]

export const CAPACITY_ORDER = ['sold_out', 'constrained', 'balanced', 'oversupplied']
export const CAPACITY_LABEL = {
  sold_out: 'Sold out', constrained: 'Constrained',
  balanced: 'Balanced', oversupplied: 'Oversupplied',
}

export const POSITION_LABEL = {
  sole: 'Sole source', dominant: 'Dominant', co_leader: 'Co-leader',
  one_of_several: 'One of several', marginal: 'Marginal',
}

export const bn = (n) => n?.bottleneck ?? {}

/** Quadrant naming — the interpretation the reader should get without decoding axes. */
export const QUADRANTS = [
  { id: 'sole_source', title: 'Sole source',
    blurb: 'Few suppliers, long to replace. No alternative exists on a relevant timescale.',
    test: (s, l) => s <= 3 && l >= 24 },
  { id: 'slow_switch', title: 'Slow to switch',
    blurb: 'Alternatives exist but migration is measured in years. Commercial lock-in, not physical scarcity.',
    test: (s, l) => s > 3 && l >= 24 },
  { id: 'tight_now', title: 'Tight now',
    blurb: 'Few suppliers but replaceable before long. Cyclical tightness rather than a structural chokepoint.',
    test: (s, l) => s <= 3 && l < 24 },
  { id: 'competitive', title: 'Competitive',
    blurb: 'Many suppliers, quick to switch. No constraint worth pricing.',
    test: (s, l) => s > 3 && l < 24 },
]

export const quadrantOf = (s, l) =>
  (s == null || l == null) ? null : QUADRANTS.find((q) => q.test(s, l))?.id ?? null

/** Group nodes into (suppliers, lead) cells. This is the matrix's real unit. */
export function cells(nodes) {
  const plot = nodes.filter((n) => bn(n).qualified_suppliers != null && bn(n).substitution_lead_time_months != null)
  const grouped = d3.group(plot, (n) => `${bn(n).qualified_suppliers}|${bn(n).substitution_lead_time_months}`)
  return [...grouped].map(([key, members]) => {
    const [suppliers, lead] = key.split('|').map(Number)
    const sorted = [...members].sort((a, b) => bn(b).computed_criticality - bn(a).computed_criticality)
    return {
      key, suppliers, lead, members: sorted,
      count: members.length,
      quadrant: quadrantOf(suppliers, lead),
      maxCriticality: d3.max(members, (n) => bn(n).computed_criticality),
      revenue: d3.sum(members, (n) => n.revenue_total?.value ?? 0),
      // A cell is only as trustworthy as its weakest evidence.
      anyLowConfidence: members.some((n) => bn(n).confidence === 'low'),
      physical: members.filter((n) => bn(n).constraint_type === 'physical').length,
      // 66 of 93 companies inherit their segment's evidence. A cell whose members
      // all inherit is ONE judgment drawn N times, not N measurements — the marks
      // are replications, and a chart that hides that overstates its own evidence.
      ownEvidence: members.filter((n) => bn(n).evidence_source === 'company').length,
      allInherited: members.every((n) => bn(n).evidence_source === 'segment'),
      segments: [...new Set(members.map((n) => n.segment))],
      worstCapacity: CAPACITY_ORDER.find((c) => members.some((n) => bn(n).capacity_state === c)) ?? null,
    }
  })
}

/** Summary per quadrant, for the labels that do the interpreting. */
export function quadrantStats(nodes) {
  const plot = nodes.filter((n) => bn(n).qualified_suppliers != null)
  return QUADRANTS.map((q) => {
    const members = plot.filter((n) => quadrantOf(bn(n).qualified_suppliers, bn(n).substitution_lead_time_months) === q.id)
    return {
      ...q, count: members.length,
      revenue: d3.sum(members, (n) => n.revenue_total?.value ?? 0),
      bottlenecks: members.filter((n) => bn(n).is_bottleneck).length,
      top: [...members].sort((a, b) => bn(b).computed_criticality - bn(a).computed_criticality).slice(0, 3),
    }
  })
}

/** Ranked chokepoint list — the "just tell me" view. */
export function ranked(nodes, { min = 0 } = {}) {
  return nodes
    .filter((n) => (bn(n).computed_criticality ?? 0) >= min)
    .sort((a, b) => bn(b).computed_criticality - bn(a).computed_criticality)
}

/* ── The scoring model, mirrored from scripts/score_bottlenecks.py ──
   Rendering the model's own shape behind the data is what makes the method
   legible: you see what the formula PERMITS at each coordinate, separately
   from where companies actually sit. Divergence between the two is the
   interesting part. */
const SUPPLIER_BASE = [[1, 5.0], [2, 4.2], [3, 3.5], [5, 2.8], [9, 2.0], [Infinity, 1.3]]
const LEAD_ADJ = [[48, 0.8], [24, 0.4], [12, 0.1], [0, -0.3]]
export const CAPACITY_ADJ = { sold_out: 0.6, constrained: 0.3, balanced: 0.0, oversupplied: -0.5 }
export const POSITION_MULT = { sole: 1.0, dominant: 0.92, co_leader: 0.80, one_of_several: 0.62, marginal: 0.45 }
export const CONSTRAINT_MULT = { physical: 1.0, commercial: 0.78 }

export function scoreParts(suppliers, lead, capacity, position, constraint) {
  const base = SUPPLIER_BASE.find(([cap]) => suppliers <= cap)[1]
  const leadAdj = (LEAD_ADJ.find(([t]) => (lead ?? 0) >= t) ?? [0, -0.3])[1]
  const capAdj = CAPACITY_ADJ[capacity] ?? 0
  const raw = base + leadAdj + capAdj
  const pMult = POSITION_MULT[position] ?? 0.62
  const cMult = CONSTRAINT_MULT[constraint] ?? 1.0
  const product = raw * pMult * cMult
  const final = Math.round(Math.max(1, Math.min(5, product)) * 10) / 10
  return {
    base, leadAdj, capAdj, subtotal: raw, pMult, cMult,
    product: Math.round(product * 100) / 100,
    // The clamp fires 23 times and was previously invisible, so the audit
    // ledger failed to add up on ASML — the first company anyone clicks.
    // 21 of the 26 companies displaying 1.0 are censored by the floor, not
    // measured at it.
    clamped: product > 5.0001 ? 'ceiling' : product < 0.9999 ? 'floor' : null,
    final,
  }
}

/** The best score the model can produce at a coordinate, whatever the company.
 *  Columns 6+ can never reach 3.5, so 49 of 93 companies sit where a bottleneck
 *  is mathematically impossible — a checkable structural fact, not a judgment. */
export const ceilingAt = (suppliers, lead) =>
  scoreParts(suppliers, lead, 'sold_out', 'sole', 'physical').final
export const CEILING_THRESHOLD = 3.5

/** What the model permits at a coordinate, holding capacity/position neutral. */
export const permittedAt = (suppliers, lead) =>
  scoreParts(suppliers, lead, 'balanced', 'co_leader', 'physical').final
