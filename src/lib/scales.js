import * as d3 from 'd3'

/* Palette: validated instance from the dataviz reference.
   Link groups use only the first three categorical slots — those are the ones
   that clear the all-pairs CVD gate in both light and dark. Nine raw link types
   would fail it badly, so types collapse into three semantic groups and dash
   pattern carries the "value undisclosed" distinction as secondary encoding. */
export const PALETTE = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', ink3: '#8a8880',
           grid: '#e6e5e0', capital: '#2a78d6', compute: '#eb6834', operational: '#1baf7a',
           divMid: '#f0efec', divNeg: '#e34948', divPos: '#2a78d6' },
  dark:  { surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7', ink3: '#8a8880',
           grid: '#2e2e2b', capital: '#3987e5', compute: '#d95926', operational: '#199e70',
           divMid: '#383835', divNeg: '#e66767', divPos: '#3987e5' },
}

/* Three tiers, mapped onto the three categorical slots that clear the all-pairs
   CVD gate. Subsidised compute gets its own tier because in-kind and equity-
   linked compute is the mechanism behind most apparent AI-native gross margin —
   it deserves to be visually separable from an arm's-length contract. */
export const LINK_GROUP = {
  investment: 'capital', equity_stake: 'capital', corporate_venture: 'capital',
  compute_contract: 'compute', compute_for_equity: 'compute', compute_credits: 'compute',
  supply: 'operational', foundry: 'operational', power_purchase: 'operational',
  data_license: 'operational', partnership: 'operational',
  customer_concentration: 'operational', operational_integration: 'operational',
}
export const GROUP_LABEL = {
  capital: 'Capital flow',
  compute: 'Subsidised compute',
  operational: 'Operational integration',
}

export const val = (m) => (m && m.value != null ? m.value : null)

/* RADIUS — sqrt, never linear.
   Amazon ~$802B vs Recursion ~$0.06B is >13,000x. Linear scaling gives one
   planet and 77 invisible dots, and forceCollide on that radius throws nodes
   off-canvas. Area proportional to revenue is also what the eye actually reads. */
export const ventureVal = (n, k) => (n.venture ? n.venture[k] ?? null : null)

/** Absolute scale: market cap for public, last post-money for private.
 *  A private mark is a last-round price, not a live quote — the panel says so. */
export const absoluteScale = (n) =>
  (n.valuation && n.valuation.market_cap_usd_m) ?? ventureVal(n, 'post_money_usd_m') ?? null

/** Capital efficiency, unified across public and private.
 *  Public : revenue earned per dollar of capex.
 *  Private: ARR built per dollar of capital raised (the inverse of capital
 *           consumed per ARR dollar), so both read "output per dollar in". */
export function capitalEfficiency(n) {
  const pub = n.capital_efficiency && n.capital_efficiency.revenue_per_capex_dollar
  if (pub != null) return pub
  const perArr = ventureVal(n, 'capital_consumed_per_arr_dollar')
  return perArr ? 1 / perArr : null
}

export function radiusScale(nodes, mode = 'revenue') {
  if (mode === 'margin') {
    // Margin goes deeply negative, so radius encodes profitability rank rather
    // than magnitude. Clamped: below -50% every company is simply "burning cash"
    // and the distinction stops being visually useful.
    const s = d3.scaleLinear().domain([-50, 100]).range([5, 40]).clamp(true)
    return (n) => {
      const m = val(n.operating_margin_pct)
      return m == null ? 4 : s(m)
    }
  }
  if (mode === 'valuation') {
    const vals = nodes.map(absoluteScale).filter((v) => v != null)
    const s = d3.scaleSqrt().domain([0, d3.max(vals) || 1]).range([3, 44])
    return (n) => { const v = absoluteScale(n); return v == null ? 4 : s(v) }
  }
  if (mode === 'capital_efficiency') {
    // Spans 0.005 (Figure AI) to 25,649 (AppLovin) — seven orders of magnitude.
    // Log, or the entire map is one dot and one disc.
    const s = d3.scaleLog().domain([0.005, 500]).range([5, 40]).clamp(true)
    return (n) => { const v = capitalEfficiency(n); return v == null ? 4 : s(Math.max(0.005, v)) }
  }
  const vals = nodes.map((n) => val(n.revenue_total) || 0)
  const s = d3.scaleSqrt().domain([0, d3.max(vals) || 1]).range([3, 44])
  return (n) => s(val(n.revenue_total) || 0)
}

/* MARGIN COLOR
   Gross margin is a magnitude -> sequential, one hue, light to dark.
   Operating margin has polarity (loss vs profit) -> diverging, two hues, gray
   midpoint at exactly zero. Never a rainbow, never a hue at the midpoint.

   Symlog, not linear: the observed range is -1760% (Recursion) to +80% (Micron).
   A linear diverging domain would paint 77 nodes one shade and one an outlier.
   Symlog keeps resolution near zero, where almost every company actually sits. */
export function marginColor(metric, theme = 'dark') {
  const P = PALETTE[theme]
  if (metric === 'growth') {
    // Top-line velocity is a magnitude, not a polarity -> sequential, one hue.
    const seq = d3.scaleSequential().domain([0, 200])
      .interpolator(d3.interpolateRgbBasis(['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#0d366b']))
      .clamp(true)
    return (n) => {
      const v = val(n.revenue_growth_yoy_pct) ?? ventureVal(n, 'arr_growth_yoy_pct')
      return v == null ? P.grid : seq(v)
    }
  }
  if (metric === 'gross_margin_pct') {
    const seq = d3.scaleSequential()
      .domain([0, 90])
      .interpolator(d3.interpolateRgbBasis(['#cde2fb', '#86b6ef', '#3987e5', '#256abf', '#0d366b']))
      .clamp(true)
    return (n) => { const v = val(n.gross_margin_pct); return v == null ? P.grid : seq(v) }
  }
  const div = d3.scaleDivergingSymlog()
    .domain([-100, 0, 100])
    .interpolator(d3.interpolateRgbBasis([P.divNeg, P.divMid, P.divPos]))
    .clamp(true)
  return (n) => { const v = val(n.operating_margin_pct); return v == null ? P.grid : div(v) }
}

/** Layer bands. Layer 1 renders at the BOTTOM — megawatts underneath models. */
export function layerY(height, pad = { top: 46, bottom: 34 }) {
  const band = d3.scaleBand().domain(d3.range(11, 0, -1))
    .range([pad.top, height - pad.bottom]).paddingInner(0)
  return { y: (l) => band(l) + band.bandwidth() / 2, bandwidth: band.bandwidth(), band }
}

/** Aggregate a segment into the comp-set stats an analyst would actually screen on. */
export function segmentStats(nodes) {
  const rev = nodes.map((n) => val(n.revenue_total)).filter((v) => v != null)
  const om = nodes.map((n) => val(n.operating_margin_pct)).filter((v) => v != null)
  const gm = nodes.map((n) => val(n.gross_margin_pct)).filter((v) => v != null)
  const gr = nodes.map((n) => val(n.revenue_growth_yoy_pct)).filter((v) => v != null)
  const total = d3.sum(rev)
  // Revenue-weighted, not simple mean: a segment's margin is what the dollars earn.
  const wsum = (key) => {
    const pairs = nodes.map((n) => [val(n[key]), val(n.revenue_total)]).filter(([a, b]) => a != null && b != null)
    const w = d3.sum(pairs, (p) => p[1])
    return w ? d3.sum(pairs, (p) => p[0] * p[1]) / w : null
  }
  return {
    count: nodes.length, revenue: total,
    medianGross: gm.length ? d3.median(gm) : null,
    medianOperating: om.length ? d3.median(om) : null,
    weightedOperating: wsum('operating_margin_pct'),
    weightedGross: wsum('gross_margin_pct'),
    medianGrowth: gr.length ? d3.median(gr) : null,
  }
}

export const fmtUSD = (m) => {
  if (m == null) return '—'
  const b = m / 1000
  if (Math.abs(b) >= 1000) return `$${(b / 1000).toFixed(2)}T`
  if (Math.abs(b) >= 1) return `$${b.toFixed(1)}B`
  return `$${m.toFixed(0)}M`
}
export const fmtPct = (v, d = 1) => (v == null ? '—' : `${v.toFixed(d)}%`)
