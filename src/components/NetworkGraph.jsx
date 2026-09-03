import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { radiusScale, marginColor, layerY, segmentStats, PALETTE, LINK_GROUP, val, fmtUSD, fmtPct } from '../lib/scales.js'
import { buildSimulation, settle, segmentBoxes, linkPath } from '../lib/simulation.js'
import { exposure } from '../lib/flow.js'

/** Zoom thresholds for progressive disclosure — layers, then segments, then companies. */
const Z = { SEGMENT: 1.25, COMPANY: 1.9 }

/** Private companies carry a funding tier instead of a ticker. */
const TIER_LABEL = {
  seed: 'SEED', series_a: 'A', series_b: 'B', series_c: 'C',
  series_d: 'D', growth: 'GROWTH', pre_ipo: 'PRE-IPO',
}

export default function NetworkGraph({
  nodes: rawNodes, links: rawLinks, taxonomy, theme = 'dark',
  sizeBy, colorBy, verticalFilter, selected, onSelect, highlightCycle,
}) {
  const svgRef = useRef(null)
  const gRef = useRef(null)
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: 1400, h: 900 })
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState(null)
  const P = PALETTE[theme]

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 100 && height > 100) setDims({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layerMeta = useMemo(() => new Map(taxonomy.layers.map((l) => [l.layer, l])), [taxonomy])
  const segMeta = useMemo(() => new Map(taxonomy.segments.map((s) => [s.id, s])), [taxonomy])

  /* Layout is computed once per (data, size, sizeBy) and settled headlessly
     before the first paint — the spec forbids visible jitter on load. */
  const layout = useMemo(() => {
    const nodes = rawNodes.map((d) => ({ ...d }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links = rawLinks.filter((l) => byId.has(l.source) && byId.has(l.target)).map((d) => ({ ...d }))
    const radius = radiusScale(nodes, sizeBy)
    const order = d3.groups(taxonomy.segments, (s) => s.layer)
      .sort((a, b) => a[0] - b[0]).map(([l, ss]) => [l, ss.map((s) => s.id)])
    const { sim, xSpan, xTarget } = buildSimulation({ nodes, links, width: dims.w, height: dims.h, radius, segmentOrder: order })
    settle(sim)
    sim.stop()
    return { nodes, links, radius, boxes: segmentBoxes(nodes, radius, dims.h, 12, xSpan, xTarget), byId }
  }, [rawNodes, rawLinks, taxonomy, dims.w, dims.h, sizeBy])

  const color = useMemo(() => marginColor(colorBy, theme), [colorBy, theme])
  const { y: laneY, band } = useMemo(() => layerY(dims.h), [dims.h])

  /* Connected set for hover isolation. Everything outside drops to 0.1. */
  const connected = useMemo(() => {
    const focus = hover || selected
    if (!focus) return null
    const s = new Set([focus])
    for (const l of layout.links) {
      if (l.source.id === focus) s.add(l.target.id)
      if (l.target.id === focus) s.add(l.source.id)
    }
    return s
  }, [hover, selected, layout])

  const cycleSet = useMemo(() => (highlightCycle ? new Set(highlightCycle.nodes) : null), [highlightCycle])
  const cycleLinks = useMemo(() => (highlightCycle ? new Set(highlightCycle.links.map((l) => l.id)) : null), [highlightCycle])

  const dimmed = useCallback((id) => {
    if (cycleSet) return !cycleSet.has(id)
    if (verticalFilter && !nodeMatchesVertical(layout.byId.get(id), verticalFilter)) return true
    return connected ? !connected.has(id) : false
  }, [connected, cycleSet, verticalFilter, layout])

  useEffect(() => {
    const svg = d3.select(svgRef.current)
    const z = d3.zoom().scaleExtent([0.55, 5])
      .on('zoom', (e) => { d3.select(gRef.current).attr('transform', e.transform); setZoom(e.transform.k) })
    svg.call(z)
    return () => svg.on('.zoom', null)
  }, [])

  const showSeg = zoom >= Z.SEGMENT
  const showCo = zoom >= Z.COMPANY

  return (
    <div className="graph-wrap" ref={wrapRef}>
      <svg ref={svgRef} width={dims.w} height={dims.h} role="img"
           aria-label="AI ecosystem stack — companies grouped into 11 layers and 24 segments, with directed relationships">
        <defs>
          <marker id="arrow" viewBox="0 -4 8 8" refX="8" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,-3L7,0L0,3" fill={P.ink3} />
          </marker>
        </defs>
        <rect width={dims.w} height={dims.h} fill={P.surface} />
        <g ref={gRef}>
          {/* Layer bands — the vertical axis, bottom = megawatts, top = apps */}
          {taxonomy.layers.map((L) => (
            <g key={L.layer}>
              <rect x={0} y={band(L.layer)} width={dims.w} height={band.bandwidth()}
                    fill={L.layer % 2 ? 'transparent' : P.ink} opacity={L.layer % 2 ? 0 : 0.022} />
              <line x1={0} x2={dims.w} y1={band(L.layer)} y2={band(L.layer)} stroke={P.grid} strokeWidth={1} />
              <text x={10} y={band(L.layer) + 15} className="layer-label" fill={P.ink3}>
                {L.layer}. {L.name.toUpperCase()}
              </text>
            </g>
          ))}

          {/* Segment containers — comp sets, filled by revenue-weighted margin */}
          {layout.boxes.map((b) => {
            const st = segmentStats(b.nodes)
            const v = colorBy === 'gross_margin_pct' ? st.weightedGross : st.weightedOperating
            const fill = v == null ? 'transparent' : color({ [colorBy]: { value: v } })
            const anyLit = !cycleSet && !connected
            return (
              <g key={b.key} opacity={anyLit ? 1 : 0.35}>
                <rect x={b.x0} y={b.y0} width={Math.max(0, b.x1 - b.x0)} height={Math.max(0, b.y1 - b.y0)}
                      rx={6} fill={fill} fillOpacity={showSeg ? 0.16 : 0.09}
                      stroke={P.grid} strokeWidth={1} strokeOpacity={showSeg ? 0.9 : 0.35} />
                {showSeg && (
                  <text x={b.x0 + 7} y={b.y0 + 13} className="seg-label" fill={P.ink2}>
                    {segMeta.get(b.segment)?.name ?? b.segment}
                    <tspan fill={P.ink3}>{'  '}{b.nodes.length} · {fmtUSD(st.revenue)} · {fmtPct(v, 0)}</tspan>
                  </text>
                )}
              </g>
            )
          })}

          {/* Relationships — curved, grouped by capital flow / subsidised compute / operational */}
          <g fill="none">
            {layout.links.map((l) => {
              const grp = LINK_GROUP[l.type] ?? 'operational'
              const inCycle = cycleLinks?.has(l.id)
              const lit = cycleLinks ? inCycle
                : connected ? (connected.has(l.source.id) && connected.has(l.target.id)) : true
              return (
                <path key={l.id} d={linkPath(l)} stroke={P[grp]}
                      strokeWidth={inCycle ? 3 : l.value_usd_m ? Math.min(4, 1 + Math.sqrt(l.value_usd_m) / 90) : 1.1}
                      strokeDasharray={l.value_usd_m ? null : '4 3'}
                      opacity={lit ? (inCycle ? 0.95 : 0.5) : 0.1}
                      markerEnd={lit ? 'url(#arrow)' : null} />
              )
            })}
          </g>

          {/* Companies */}
          <g>
            {layout.nodes.map((n) => {
              const r = layout.radius(n)
              const off = dimmed(n.id)
              const isSel = selected === n.id
              return (
                <g key={n.id} opacity={off ? 0.1 : 1} style={{ cursor: 'pointer' }}
                   onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                   onClick={() => onSelect(n.id === selected ? null : n.id)}>
                  <circle cx={n.x} cy={n.y} r={r} fill={color(n)}
                          stroke={isSel ? P.ink : n.is_public ? P.surface : P.compute}
                          strokeWidth={isSel ? 2.5 : n.is_public ? 2 : 1.6}
                          strokeDasharray={n.is_public ? null : '3 2'} />
                  {!n.is_public && r > 9 && (
                    <text x={n.x} y={n.y - r - 4} textAnchor="middle" className="tier-badge"
                          fill={P.compute} stroke={P.surface} strokeWidth={2.5} paintOrder="stroke">
                      {TIER_LABEL[n.venture?.funding_tier] ?? 'PRIVATE'}
                    </text>
                  )}
                  {n.bottleneck?.is_bottleneck && n.bottleneck.criticality >= 4 && (
                    <circle cx={n.x} cy={n.y} r={r + 3.5} fill="none"
                            stroke={P.divNeg} strokeWidth={1.4} strokeDasharray="2 2" opacity={0.9} />
                  )}
                  {(showCo || r > 17 || isSel || cycleSet?.has(n.id) || (connected?.has(n.id) && !off)) && (
                    <text x={n.x} y={n.y + r + 11} textAnchor="middle" className="node-label"
                          fill={P.ink2} stroke={P.surface} strokeWidth={3} paintOrder="stroke">
                      {n.ticker ?? n.name}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="zoom-hint">
        {zoom < Z.SEGMENT ? 'Layers · scroll to expand segments'
          : zoom < Z.COMPANY ? 'Segments · scroll again for companies' : 'Companies'}
        <span className="zoom-k">{zoom.toFixed(1)}×</span>
      </div>

      {hover && <Tooltip node={layout.byId.get(hover)} seg={segMeta} layer={layerMeta} theme={theme} />}
    </div>
  )
}

function nodeMatchesVertical(n, v) {
  if (!n || !v) return true
  return (n.verticals ?? []).includes(v)
}

function Tooltip({ node: n, seg, layer, theme }) {
  if (!n) return null
  return (
    <div className="tooltip" data-theme={theme}>
      <div className="tt-name">{n.name} {n.ticker && <span className="tt-tick">{n.ticker}</span>}</div>
      <div className="tt-seg">{layer.get(n.layer)?.name} · {seg.get(n.segment)?.name}</div>
      <div className="tt-rows">
        <span>{n.is_public ? 'Revenue' : 'Est. ARR'}</span><b>{fmtUSD(val(n.revenue_total))}</b>
        {n.is_public ? <>
          <span>Gross</span><b>{fmtPct(val(n.gross_margin_pct))}</b>
          <span>Operating</span><b>{fmtPct(val(n.operating_margin_pct))}</b>
          <span>Rev / $capex</span><b>{n.capital_efficiency?.revenue_per_capex_dollar?.toFixed(1) ?? '—'}</b>
        </> : <>
          <span>Post-money</span><b>{fmtUSD(n.venture?.post_money_usd_m)}</b>
          <span>Raised</span><b>{fmtUSD(n.venture?.total_raised_usd_m)}</b>
          <span>$raised / $ARR</span><b>{n.venture?.capital_consumed_per_arr_dollar?.toFixed(1) ?? '—'}</b>
        </>}
        <span>Growth</span><b>{fmtPct(val(n.revenue_growth_yoy_pct) ?? n.venture?.arr_growth_yoy_pct)}</b>
      </div>
      <div className="tt-moat">{n.moat?.summary}</div>
      <div className="tt-hint">Click for the full note</div>
    </div>
  )
}
