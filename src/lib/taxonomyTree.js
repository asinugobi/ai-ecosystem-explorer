import * as d3 from 'd3'
import { segmentStats, val } from './scales.js'
import { bn, CAPACITY_LABEL } from './bottleneck.js'

/**
 * Layer -> segment -> company tree with the aggregates each level needs.
 *
 * The four questions a segment must answer are resolved to ANSWERS here rather
 * than in the view, because the headline should state the conclusion ("Sold out
 * into the 2030s") not the field name ("capacity_state: sold_out"). A reader who
 * stops at the heading should still have learned something.
 */
export function buildTree(nodes, taxonomy) {
  const bySeg = d3.group(nodes, (n) => n.segment)

  const segments = taxonomy.segments.map((s) => {
    const members = (bySeg.get(s.id) ?? []).slice()
      .sort((a, b) => (val(b.revenue_total) ?? 0) - (val(a.revenue_total) ?? 0))
    const st = segmentStats(members)
    const crits = members.map((n) => bn(n).computed_criticality).filter((x) => x != null)
    const worst = members.filter((n) => bn(n).is_bottleneck)
      .sort((a, b) => bn(b).computed_criticality - bn(a).computed_criticality)[0] ?? null
    const caps = members.map((n) => bn(n).capacity_state).filter(Boolean)
    const capMode = caps.length ? d3.mode(caps) : null
    const growth = members.map((n) => val(n.revenue_growth_yoy_pct) ?? n.venture?.arr_growth_yoy_pct)
      .filter((x) => x != null)

    return {
      ...s, members, stats: st,
      maxCriticality: crits.length ? d3.max(crits) : null,
      bottleneck: worst,
      capacityState: capMode,
      medianGrowth: growth.length ? d3.median(growth) : null,
      privateCount: members.filter((n) => !n.is_public).length,
      lowConfidence: members.filter((n) => bn(n).confidence === 'low').length,
      answers: answersFor(s, members, st, worst, capMode, growth),
    }
  })

  const layers = taxonomy.layers.map((l) => {
    const segs = segments.filter((s) => s.layer === l.layer)
    const members = segs.flatMap((s) => s.members)
    return {
      ...l, segments: segs, members,
      count: members.length,
      revenue: d3.sum(members, (n) => val(n.revenue_total) ?? 0),
      maxCriticality: d3.max(segs, (s) => s.maxCriticality ?? 0) || null,
      bottleneckCount: members.filter((n) => bn(n).is_bottleneck).length,
    }
  }).sort((a, b) => b.layer - a.layer)   // 11 at top, 1 at bottom — same as the map

  return { layers, segments }
}

/** The four questions, resolved to answers rather than field values. */
function answersFor(seg, members, st, worst, capState, growth) {
  const fmtB = (m) => (m == null ? '—' : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m.toFixed(0)}M`)
  const top = members.slice(0, 3).map((n) => n.ticker ?? n.name)

  const earns = st.weightedGross == null ? 'Margin structure not yet resolved for this segment.'
    : st.weightedGross >= 70 ? `High gross margin (${st.weightedGross.toFixed(0)}%) — value sits in IP or software, not in the cost base.`
    : st.weightedGross >= 40 ? `Mid gross margin (${st.weightedGross.toFixed(0)}%) — real product economics, real cost of goods.`
    : `Thin gross margin (${st.weightedGross.toFixed(0)}%) — dollars pass through rather than pool here.`

  const med = growth.length ? d3.median(growth) : null
  const changing = med == null ? 'Growth not yet measured across this segment.'
    : med >= 100 ? `Growing ${med.toFixed(0)}% — demand is outrunning the ability to supply it.`
    : med >= 30 ? `Growing ${med.toFixed(0)}% — expanding well ahead of the wider economy.`
    : med >= 0 ? `Growing ${med.toFixed(0)}% — steady rather than explosive.`
    : `Contracting ${Math.abs(med).toFixed(0)}%.`

  const constraint = worst
    ? `${worst.name} is the chokepoint here (${bn(worst).computed_criticality}/5): ${(bn(worst).qualified_suppliers === 1 ? 'sole source' : `${bn(worst).qualified_suppliers} qualified suppliers`)}, ${bn(worst).substitution_lead_time_months} months to substitute.`
    : capState === 'sold_out' ? 'Capacity is sold out, but no single supplier holds the constraint.'
    : capState === 'constrained' ? 'Capacity is tight without any one supplier being irreplaceable.'
    : 'No structural chokepoint — buyers have real choice.'

  return {
    what: seg.supplies,
    who: `${members.length} ${members.length === 1 ? 'company' : 'companies'} · ${fmtB(st.revenue)} across the ${st.revenueCovered} with a reported figure` +
         (st.revenueMissing ? ` (${st.revenueMissing} unpriced)` : '') +
         (top.length ? ` · ${top.join(', ')}${members.length > 3 ? '…' : ''}` : ''),
    earns,
    changing,
    constraint,
  }
}

export { CAPACITY_LABEL }
