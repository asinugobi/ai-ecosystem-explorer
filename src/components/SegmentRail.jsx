import { useState, useMemo, useRef, useEffect } from 'react'
import { buildTree } from '../lib/taxonomyTree.js'
import { PALETTE, fmtUSD, fmtPct, val } from '../lib/scales.js'
import { bn, CAPACITY_LABEL, POSITION_LABEL } from '../lib/bottleneck.js'

/**
 * The stack, read as strata.
 *
 * 11 layers ordered exactly as the map orders them — 11 at the top, 1 at the
 * bottom — so the two views share one spatial model and a reader never has to
 * re-learn where anything is.
 *
 * Progressive disclosure is enforced structurally: one layer open, and within
 * it one segment. There is no state in which four levels are visible at once,
 * which is the failure mode that makes taxonomy browsers exhausting.
 */
export default function SegmentRail({ nodes, taxonomy, selected, onSelect, theme }) {
  const [openLayer, setOpenLayer] = useState(3)   // Semiconductors: the densest, best default
  const [openSeg, setOpenSeg] = useState(null)
  const P = PALETTE[theme]
  const tree = useMemo(() => buildTree(nodes, taxonomy), [nodes, taxonomy])
  const maxRev = useMemo(() => Math.max(...tree.layers.map((l) => l.revenue)), [tree])

  // Low values previously used P.grid, which is the track colour — the fill
  // vanished and every low-criticality company looked like it had no rating.
  const critColor = (c) => {
    if (c == null) return P.grid
    if (c >= 4.5) return P.divNeg      // sole source
    if (c >= 3.5) return P.compute     // bottleneck threshold
    if (c >= 2.5) return P.ink2
    return P.ink3
  }

  return (
    <div className="rail">
      <header className="rail-head">
        <h2>The stack, layer by layer</h2>
        <p>
          Eleven layers, twenty-four segments. Ordered by physical dependency — megawatts at the
          bottom, applications at the top — so a constraint anywhere caps everything above it.
          <strong> Open a layer, then a segment.</strong>
        </p>
      </header>

      <div className="strata">
        {tree.layers.map((layer) => {
          const open = openLayer === layer.layer
          return (
            <section key={layer.layer} className={`stratum${open ? ' open' : ''}`}>
              <button className="stratum-head" aria-expanded={open}
                      onClick={() => { setOpenLayer(open ? null : layer.layer); setOpenSeg(null) }}>
                <span className="spine" style={{ background: critColor(layer.maxCriticality) }} />
                <span className="lnum">{String(layer.layer).padStart(2, '0')}</span>
                <span className="lbody">
                  <span className="lname">
                    {layer.name}
                    {layer.bottleneckCount > 0 && (
                      <i className="chokebadge">{layer.bottleneckCount} chokepoint{layer.bottleneckCount > 1 ? 's' : ''}</i>
                    )}
                  </span>
                  <span className="lconstraint">{layer.constraint}</span>
                </span>
                <span className="lmeta">
                  <b>{layer.count}</b><em>companies</em>
                </span>
                <span className="lmeta">
                  <b>{fmtUSD(layer.revenue)}</b><em>revenue</em>
                </span>
                <span className="lbar" aria-hidden>
                  <i style={{ width: `${Math.max(2, (layer.revenue / maxRev) * 100)}%`,
                              background: critColor(layer.maxCriticality) }} />
                </span>
                <span className="chev">{open ? '−' : '+'}</span>
              </button>

              {open && (
                <div className="segs">
                  {layer.segments.map((seg) => (
                    <SegmentCard key={seg.id} seg={seg} theme={theme}
                                 open={openSeg === seg.id}
                                 onToggle={() => setOpenSeg(openSeg === seg.id ? null : seg.id)}
                                 selected={selected} onSelect={onSelect} critColor={critColor} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function SegmentCard({ seg, open, onToggle, selected, onSelect, theme, critColor }) {
  const P = PALETTE[theme]
  const ref = useRef(null)
  useEffect(() => { if (open && ref.current) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [open])

  const st = seg.stats
  return (
    <article ref={ref} className={`segcard${open ? ' open' : ''}`}>
      <button className="seg-head" aria-expanded={open} onClick={onToggle}>
        <span className="seg-dot" style={{ background: critColor(seg.maxCriticality) }} />
        <span className="seg-name">{seg.name}</span>
        <span className="seg-stat"><b>{seg.members.length}</b> cos</span>
        <span className="seg-stat"><b>{fmtUSD(st.revenue)}</b></span>
        <span className="seg-stat"><b>{fmtPct(st.weightedGross, 0)}</b> gross</span>
        {seg.bottleneck && <span className="seg-choke">{bn(seg.bottleneck).computed_criticality}/5</span>}
        <span className="chev">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="seg-body">
          <dl className="answers">
            <div><dt>What is it</dt><dd>{seg.answers.what}</dd></div>
            <div><dt>Who is in it</dt><dd>{seg.answers.who}</dd></div>
            <div><dt>How it earns</dt><dd>{seg.answers.earns}</dd></div>
            <div><dt>How it is changing</dt><dd>{seg.answers.changing}</dd></div>
            <div className="ans-constraint"><dt>The constraint</dt><dd>{seg.answers.constraint}</dd></div>
          </dl>

          <div className="seg-members">
            <div className="mem-head">
              <span>Company</span><span>Revenue</span><span>Gross</span><span>Oper</span><span>Crit</span>
            </div>
            {seg.members.map((n) => {
              const b = bn(n)
              return (
                <button key={n.id} className={`mem${selected === n.id ? ' on' : ''}`}
                        onClick={() => onSelect(n.id)}
                        title={b.rationale || ''}>
                  <span className="mem-name">
                    {n.name}
                    <i className={n.is_public ? 'tk' : 'tk priv'}>{n.ticker ?? 'PRIVATE'}</i>
                  </span>
                  <span className="mono">{fmtUSD(val(n.revenue_total))}</span>
                  <span className="mono">{fmtPct(val(n.gross_margin_pct), 0)}</span>
                  <span className="mono">{fmtPct(val(n.operating_margin_pct), 0)}</span>
                  <span className="mem-crit">
                    <span className="crit-track">
                      <i style={{ width: `${((b.computed_criticality ?? 0) / 5) * 100}%`,
                                  background: critColor(b.computed_criticality) }} />
                    </span>
                    <em className={b.confidence === 'low' ? 'low' : ''}
                        title={b.confidence === 'low' ? 'Low confidence — a plausible reading, not a researched one' : ''}>
                      {b.computed_criticality ?? '—'}
                    </em>
                  </span>
                </button>
              )
            })}
          </div>
          {seg.lowConfidence > 0 && (
            <p className="seg-caveat">
              {seg.lowConfidence} of {seg.members.length} chokepoint ratings here are low-confidence —
              a plausible reading rather than a researched one. Shown dimmed.
            </p>
          )}
        </div>
      )}
    </article>
  )
}
