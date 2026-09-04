import { useMemo, useState, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import { cells, quadrantStats, bn, SUPPLIER_TICKS, LEAD_TICKS, CAPACITY_LABEL, POSITION_LABEL } from '../lib/bottleneck.js'
import { PALETTE, fmtUSD, fmtPct, val } from '../lib/scales.js'

/**
 * Why the chokepoints are chokepoints.
 *
 * The two axes are ORDINAL with heavy ties — 93 companies occupy 26 distinct
 * (suppliers, lead-time) pairs, 12 of them on one pair. A scatter would draw 26
 * marks and imply 93, so each cell instead holds a dot matrix: one dot per
 * company, every company visible, density that is real rather than asserted.
 *
 * The axes are also correlated (Spearman -0.60) — scarce things are scarce
 * BECAUSE they take years to replace. So the honest reading is not four
 * quadrants but a diagonal, drawn explicitly. The interesting companies are the
 * ones off it.
 */
const M = { top: 58, right: 30, bottom: 62, left: 132 }

export default function SubstitutabilityMatrix({ nodes, taxonomy, selected, onSelect, theme }) {
  const P = PALETTE[theme]
  const wrapRef = useRef(null)
  const [dims, setDims] = useState({ w: 900, h: 620 })
  const [hover, setHover] = useState(null)
  const [openCell, setOpenCell] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 200 && height > 200) setDims({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const grid = useMemo(() => cells(nodes), [nodes])
  const quads = useMemo(() => quadrantStats(nodes), [nodes])

  const iw = Math.max(240, dims.w - M.left - M.right)
  const ih = Math.max(220, dims.h - M.top - M.bottom)
  const x = d3.scalePoint().domain(SUPPLIER_TICKS).range([0, iw]).padding(0.62)
  const y = d3.scalePoint().domain([...LEAD_TICKS].reverse()).range([0, ih]).padding(0.62)
  const cw = iw / (SUPPLIER_TICKS.length + 0.6)
  const ch = ih / (LEAD_TICKS.length + 0.6)

  const critColor = (c) =>
    c == null ? P.ink3 : c >= 4.5 ? P.divNeg : c >= 3.5 ? P.compute : c >= 2.5 ? P.ink2 : P.ink3

  const active = openCell ?? hover
  const activeCell = grid.find((c) => c.key === active) ?? null

  return (
    <div className="matrix-view">
      <header className="mx-head">
        <h2>Why the chokepoints are chokepoints</h2>
        <p>
          Criticality is a judgment, so here is the evidence behind it. Each dot is one company,
          placed by how many firms could supply its <em>function</em> and how long replacing it takes.
          <strong> Up and to the left is where power sits.</strong>
        </p>
        <div className="mx-legend">
          <span><i style={{ background: P.divNeg }} />sole source 4.5+</span>
          <span><i style={{ background: P.compute }} />bottleneck 3.5+</span>
          <span><i style={{ background: P.ink2 }} />moderate</span>
          <span><i style={{ background: P.ink3 }} />no constraint</span>
          <span className="lg-sep"><i className="ring" style={{ borderColor: P.ink3 }} />low confidence</span>
        </div>
      </header>

      <div className="mx-body">
        <div className="mx-canvas" ref={wrapRef}>
          <svg width={dims.w} height={dims.h} role="img"
               aria-label="Substitutability matrix: qualified suppliers against months to substitute">
            <defs>
              <linearGradient id="diag" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={P.divNeg} stopOpacity="0.16" />
                <stop offset="55%" stopColor={P.compute} stopOpacity="0.06" />
                <stop offset="100%" stopColor={P.ink3} stopOpacity="0" />
              </linearGradient>
            </defs>

            <g transform={`translate(${M.left},${M.top})`}>
              {/* the scarcity gradient — few suppliers + long lead is the corner that matters */}
              <rect x={-cw / 2} y={-ch / 2} width={iw + cw} height={ih + ch} fill="url(#diag)" />
              {/* The two axes correlate at -0.60: scarce things are scarce BECAUSE they take
                  years to replace. Drawing the diagonal makes that the finding rather than a
                  quirk of an oddly empty quadrant. */}
              <line x1={x(1)} y1={y(120)} x2={x(12)} y2={y(6)}
                    stroke={P.ink3} strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.35} />
              <text x={x(6)} y={y(24) - 8} className="mx-cornersub" fill={P.ink3} opacity={0.55}
                    transform={`rotate(21 ${x(6)} ${y(24) - 8})`}>the scarcity diagonal</text>

              {/* ordinal gridlines */}
              {SUPPLIER_TICKS.map((s) => (
                <line key={`v${s}`} x1={x(s)} x2={x(s)} y1={-ch / 2} y2={ih + ch / 2}
                      stroke={P.grid} strokeWidth={1} strokeOpacity={0.5} />
              ))}
              {LEAD_TICKS.map((l) => (
                <line key={`h${l}`} x1={-cw / 2} x2={iw + cw / 2} y1={y(l)} y2={y(l)}
                      stroke={P.grid} strokeWidth={1} strokeOpacity={0.5} />
              ))}

              {/* corner annotation — the conclusion, not the axis names */}
              <text x={2} y={-22} className="mx-corner" fill={P.divNeg}>SOLE SOURCE</text>
              <text x={2} y={-9} className="mx-cornersub" fill={P.ink3}>no alternative exists</text>
              <text x={iw - 4} y={ih - 16} textAnchor="end" className="mx-corner" fill={P.ink3}
                    opacity={0.5}>COMPETITIVE</text>
              <text x={iw - 4} y={ih - 4} textAnchor="end" className="mx-cornersub" fill={P.ink3}
                    opacity={0.5}>buyers have real choice</text>

              {/* cells as dot matrices */}
              {grid.map((c) => {
                const cx = x(c.suppliers), cy = y(c.lead)
                const cols = Math.ceil(Math.sqrt(c.count))
                const rows = Math.ceil(c.count / cols)
                const r = Math.max(2.6, Math.min(5.2, (Math.min(cw, ch) * 0.72) / (cols * 2.1)))
                const gap = r * 2.5
                const isActive = active === c.key
                const dimmed = active && !isActive
                return (
                  <g key={c.key} opacity={dimmed ? 0.22 : 1}
                     onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}
                     onClick={() => setOpenCell(openCell === c.key ? null : c.key)}
                     style={{ cursor: 'pointer' }}>
                    <rect x={cx - cw / 2} y={cy - ch / 2} width={cw} height={ch} rx={5}
                          fill={isActive ? P.surface3 ?? P.grid : 'transparent'}
                          stroke={isActive ? critColor(c.maxCriticality) : 'transparent'} strokeWidth={1.4} />
                    {c.members.map((n, i) => {
                      const col = i % cols, row = Math.floor(i / cols)
                      const dx = cx + (col - (cols - 1) / 2) * gap
                      const dy = cy + (row - (rows - 1) / 2) * gap
                      const b = bn(n)
                      const isSel = selected === n.id
                      const low = b.confidence === 'low'
                      return (
                        <circle key={n.id} cx={dx} cy={dy} r={isSel ? r + 1.6 : r}
                                fill={low ? 'none' : critColor(b.computed_criticality)}
                                stroke={isSel ? P.ink : low ? critColor(b.computed_criticality) : 'none'}
                                strokeWidth={isSel ? 1.8 : low ? 1.2 : 0}
                                onClick={(e) => { e.stopPropagation(); onSelect(n.id) }}>
                          <title>{`${n.name} — criticality ${b.computed_criticality}/5${low ? ' (low confidence)' : ''}`}</title>
                        </circle>
                      )
                    })}
                  </g>
                )
              })}

              {/* axes */}
              {SUPPLIER_TICKS.map((s) => (
                <text key={`xt${s}`} x={x(s)} y={ih + ch / 2 + 15} textAnchor="middle"
                      className="mx-tick" fill={P.ink3}>{s}</text>
              ))}
              {LEAD_TICKS.map((l) => (
                <text key={`yt${l}`} x={-cw / 2 - 10} y={y(l) + 3.5} textAnchor="end"
                      className="mx-tick" fill={P.ink3}>{l >= 12 ? `${l / 12}y` : `${l}m`}</text>
              ))}
              <text x={iw / 2} y={ih + ch / 2 + 36} textAnchor="middle" className="mx-axis" fill={P.ink2}>
                QUALIFIED SUPPLIERS OF THE FUNCTION →
              </text>
              <text transform={`translate(${-M.left + 22},${ih / 2}) rotate(-90)`} textAnchor="middle"
                    className="mx-axis" fill={P.ink2}>← TIME TO SUBSTITUTE</text>
            </g>
          </svg>
        </div>

        <aside className="mx-side">
          {activeCell ? <CellDetail cell={activeCell} P={P} critColor={critColor}
                                     selected={selected} onSelect={onSelect} /> : <QuadSummary quads={quads} P={P} />}
        </aside>
      </div>
    </div>
  )
}

function QuadSummary({ quads, P }) {
  return (
    <>
      <h3>How to read this</h3>
      <p className="mx-note">
        The two axes are <strong>correlated</strong> — Spearman −0.60. Scarce things are scarce
        because they take years to replace, so the data sits on a diagonal rather than spreading
        across four quadrants. That is why only one company is few-supplier <em>and</em> quick to
        replace.
      </p>
      <p className="mx-note">
        Hover a cell for its members. Every company has a dot, so the density you see is real.
      </p>
      {quads.map((q) => (
        <div key={q.id} className="quad">
          <div className="quad-h">
            {q.title}<i>{q.count}</i>
            {q.bottlenecks > 0 && <em>{q.bottlenecks} chokepoint{q.bottlenecks > 1 ? 's' : ''}</em>}
          </div>
          <p>{q.blurb}</p>
          {q.top.length > 0 && (
            <div className="quad-top">{q.top.map((n) => (
              <span key={n.id}>{n.ticker ?? n.name}</span>
            ))}</div>
          )}
        </div>
      ))}
    </>
  )
}

function CellDetail({ cell, P, critColor, selected, onSelect }) {
  return (
    <>
      <h3>{cell.suppliers} supplier{cell.suppliers > 1 ? 's' : ''} · {cell.lead} months to substitute</h3>
      <p className="mx-note">
        {cell.count} {cell.count === 1 ? 'company shares' : 'companies share'} this evidence profile
        {cell.physical > 0 && cell.physical < cell.count
          ? ` — ${cell.physical} facing a physical constraint, ${cell.count - cell.physical} a commercial one.`
          : cell.physical === cell.count ? ' — all physical constraints.' : ' — all commercial constraints.'}
      </p>
      <div className="cell-list">
        {cell.members.map((n) => {
          const b = bn(n)
          return (
            <button key={n.id} className={`cell-row${selected === n.id ? ' on' : ''}`}
                    onClick={() => onSelect(n.id)}>
              <span className="cr-dot" style={{
                background: b.confidence === 'low' ? 'transparent' : critColor(b.computed_criticality),
                borderColor: critColor(b.computed_criticality) }} />
              <span className="cr-name">{n.name}<i>{n.ticker ?? 'PRIVATE'}</i></span>
              <span className="cr-pos">{POSITION_LABEL[b.market_position] ?? '—'}</span>
              <span className="cr-cap">{CAPACITY_LABEL[b.capacity_state] ?? '—'}</span>
              <span className="cr-crit" style={{ color: critColor(b.computed_criticality) }}>
                {b.computed_criticality}
              </span>
            </button>
          )
        })}
      </div>
      {cell.anyLowConfidence && (
        <p className="mx-caveat">Hollow dots are low-confidence ratings — a plausible reading, not a researched one.</p>
      )}
    </>
  )
}
