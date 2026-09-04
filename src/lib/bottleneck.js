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
