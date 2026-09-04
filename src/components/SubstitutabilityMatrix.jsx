import { useMemo, useState, useRef, useEffect } from 'react'
import * as d3 from 'd3'
import { cells, quadrantStats, bn, SUPPLIER_TICKS, LEAD_TICKS, CAPACITY_LABEL, POSITION_LABEL,
         permittedAt, scoreParts, ceilingAt, CEILING_THRESHOLD } from '../lib/bottleneck.js'
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
  const [ctFilter, setCtFilter] = useState('all')   // physical | commercial | all
  const [lowOnly, setLowOnly] = useState(false)
  const [ledger, setLedger] = useState(null)

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
          <span><i className="dash" style={{ borderColor: P.ink3 }} />cell inherits a segment default</span>
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

              {/* The model's own shape, rendered behind the data. Seeing what the
                  formula PERMITS at each coordinate — separately from where companies
                  actually sit — is what makes the method inspectable rather than
                  something to take on trust. */}
              {SUPPLIER_TICKS.map((sv) => LEAD_TICKS.map((lv) => {
                const permitted = permittedAt(sv, lv)
                return (
                  <rect key={`relief-${sv}-${lv}`} x={x(sv) - cw / 2} y={y(lv) - ch / 2}
                        width={cw} height={ch} rx={3} fill={P.ink}
                        opacity={0.015 + (permitted / 5) * 0.075} />
                )
              }))}

              {/* THE CEILING. Right of this line the model cannot produce a
                  bottleneck at any capacity, position or constraint type — 49 of
                  93 companies sit there. Verified: columns 1-3 qualify at every
                  lead time, 4-5 only at >=12 months, 6+ never. */}
              {(() => {
                const xb = (a, b) => (x(a) + x(b)) / 2
                const yb = (a, b) => (y(a) + y(b)) / 2
                const d = `M ${xb(5, 6)},${y(120) - ch / 2} V ${yb(12, 9)} H ${xb(3, 4)} V ${ih + ch / 2}`
                return (
                  <g>
                    <path d={d} fill="none" stroke={P.compute} strokeWidth={1.6} strokeOpacity={0.75} />
                    <text x={xb(5, 6) + 7} y={y(120) - ch / 2 + 12} className="mx-cornersub"
                          fill={P.compute} opacity={0.85}>the model&rsquo;s ceiling →</text>
                    <text x={xb(5, 6) + 7} y={y(120) - ch / 2 + 24} className="mx-cornersub"
                          fill={P.ink3} opacity={0.7}>49 companies here cannot score 3.5</text>
                  </g>
                )
              })()}

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
                const r = Math.max(3.5, Math.min(5.4, (Math.min(cw, ch) * 0.72) / (cols * 2.1)))
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
                          stroke={isActive ? critColor(c.maxCriticality)
                                  : c.allInherited && c.count > 2 ? P.ink3 : 'transparent'}
                          strokeWidth={isActive ? 1.4 : 1}
                          strokeDasharray={!isActive && c.allInherited ? '2 3' : undefined}
                          strokeOpacity={isActive ? 1 : 0.3} />
                    {c.members.map((n, i) => {
                      const col = i % cols, row = Math.floor(i / cols)
                      const dx = cx + (col - (cols - 1) / 2) * gap
                      const dy = cy + (row - (rows - 1) / 2) * gap
                      const b = bn(n)
                      const isSel = selected === n.id
                      const low = b.confidence === 'low'
                      const filteredOut =
                        (ctFilter !== 'all' && b.constraint_type !== ctFilter) || (lowOnly && !low)
                      return (
                        <circle key={n.id} cx={dx} cy={dy} r={isSel ? r + 1.6 : r}
                                opacity={filteredOut ? 0.12 : 1}
                                fill={low ? 'none' : critColor(b.computed_criticality)}
                                stroke={isSel ? P.ink : low ? critColor(b.computed_criticality) : 'none'}
                                strokeWidth={isSel ? 1.8 : low ? 1.2 : 0}
                                style={{ transition: 'opacity .18s' }}
                                onClick={(e) => { e.stopPropagation(); onSelect(n.id); setLedger(n) }}>
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
          <div className="mx-filters">
            <div className="seg-ctl">
              {[['all', 'All'], ['physical', 'Physical'], ['commercial', 'Commercial']].map(([k, l]) => (
                <button key={k} className={ctFilter === k ? 'on' : ''} onClick={() => setCtFilter(k)}
                        title="Is the long lead time a physics problem or a contract problem?">{l}</button>
              ))}
            </div>
            <button className={`lowbtn${lowOnly ? ' on' : ''}`} onClick={() => setLowOnly(!lowOnly)}
                    title="How much of the upper-left is actually load-bearing?">Low confidence only</button>
          </div>
          {ledger ? <Ledger node={ledger} P={P} critColor={critColor} onBack={() => setLedger(null)} />
            : activeCell ? <CellDetail cell={activeCell} P={P} critColor={critColor}
                                       selected={selected} onSelect={(id) => { onSelect(id); }} />
            : <QuadSummary quads={quads} P={P} />}
        </aside>
      </div>
    </div>
  )
}

/** The derivation, shown as arithmetic. A score you can audit beats one you must trust. */
function Ledger({ node, P, critColor, onBack }) {
  const b = bn(node)
  const p = scoreParts(b.qualified_suppliers, b.substitution_lead_time_months,
                       b.capacity_state, b.market_position, b.constraint_type)
  const Row = ({ label, val, note }) => (
    <div className="ldg-row"><span>{label}</span><b>{val}</b>{note && <em>{note}</em>}</div>
  )
  return (
    <>
      <button className="ldg-back" onClick={onBack}>← back</button>
      <h3>{node.name} <i className="ldg-crit" style={{ color: critColor(p.final) }}>{p.final}/5</i></h3>
      <p className="mx-note">How that number was derived — every term is a stated field, not a vibe.</p>
      <div className="ledger">
        <Row label={`${b.qualified_suppliers} qualified supplier${b.qualified_suppliers > 1 ? 's' : ''}`}
             val={p.base.toFixed(1)} note="base" />
        <Row label={`${b.substitution_lead_time_months} months to substitute`}
             val={`${p.leadAdj >= 0 ? '+' : ''}${p.leadAdj.toFixed(1)}`} />
        <Row label={CAPACITY_LABEL[b.capacity_state] ?? 'capacity unknown'}
             val={`${p.capAdj >= 0 ? '+' : ''}${p.capAdj.toFixed(1)}`} />
        <div className="ldg-sub"><span>subtotal</span><b>{p.subtotal.toFixed(1)}</b></div>
        <Row label={POSITION_LABEL[b.market_position] ?? 'position unknown'}
             val={`× ${p.pMult.toFixed(2)}`} note="share of the constraint" />
        <Row label={b.constraint_type === 'commercial' ? 'Commercial constraint' : 'Physical constraint'}
             val={`× ${p.cMult.toFixed(2)}`} note={b.constraint_type === 'commercial' ? 'can be paid around' : 'cannot be paid around'} />
        {!p.clamped && <div className="ldg-sub"><span>product</span><b>{p.product}</b></div>}
        {p.clamped && (
          <div className="ldg-row ldg-clamp">
            <span>{p.product} {p.clamped === 'ceiling' ? 'exceeds the 5.0 ceiling' : 'falls below the 1.0 floor'}</span>
            <b>clamped</b>
            <em>{p.clamped === 'ceiling'
              ? 'The scale tops out, so this reads 5.0 — the model rates it further above the bar than the number can show.'
              : 'The scale bottoms out. This is censored at the floor, not measured at it — 21 of the 26 companies showing 1.0 are in this position.'}</em>
          </div>
        )}
        <div className="ldg-total"><span>criticality</span><b style={{ color: critColor(p.final) }}>{p.final}</b></div>
      </div>
      <p className="mx-note">{b.rationale}</p>
      {b.evidence_source === 'segment' && (
        <p className="mx-caveat prov">Inherited from the {node.segment} segment default — not rated individually.</p>
      )}
      {b.confidence === 'low' && (
        <p className="mx-caveat prov">Low confidence: a plausible reading, not a researched one.</p>
      )}
    </>
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
        Hover a cell for its members. Every company has a dot, so the density you see is real —
        but <strong>only 27 of 93 were rated individually</strong>. The other 66 inherit their
        segment's evidence, so dashed cells are one judgment repeated, not independent readings.
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
      {cell.allInherited && cell.count > 1 && (
        <p className="mx-caveat prov">
          All {cell.count} inherit the {cell.segments.join(' / ')} segment default — this is one
          judgment applied {cell.count} times, not {cell.count} separate measurements.
        </p>
      )}
      {!cell.allInherited && cell.ownEvidence < cell.count && (
        <p className="mx-caveat prov">
          {cell.ownEvidence} of {cell.count} were rated individually; the rest inherit a segment default.
        </p>
      )}
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
