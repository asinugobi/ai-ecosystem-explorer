import { useMemo } from 'react'
import { val, fmtUSD, fmtPct } from '../lib/scales.js'
import { exposure, moneyEdge } from '../lib/flow.js'

/** Progressive disclosure: nothing qualitative renders until a node is chosen. */
export default function IntelligencePanel({ node, nodes, links, taxonomy, onSelect }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const layer = useMemo(() => new Map(taxonomy.layers.map((l) => [l.layer, l])), [taxonomy])
  const seg = useMemo(() => new Map(taxonomy.segments.map((s) => [s.id, s])), [taxonomy])

  const rel = useMemo(() => {
    if (!node) return []
    return links.filter((l) => l.source === node.id || l.target === node.id)
  }, [node, links])

  const reach = useMemo(() => {
    if (!node) return []
    const m = exposure(node.id, links, 2)
    return [...m.entries()].filter(([id, d]) => d > 0).sort((a, b) => a[1] - b[1])
  }, [node, links])

  if (!node) {
    return (
      <aside className="panel panel-empty">
        <h2>Intelligence panel</h2>
        <p>Select a company to load its research note — positioning, moat, exact financials with sources, and read-across exposure.</p>
        <p className="muted">Hover isolates a company's relationships. Scroll to zoom from layers into segments into companies.</p>
      </aside>
    )
  }

  const cite = (m) => m?.source?.url
  const Metric = ({ label, m, pct }) => (
    <div className="metric">
      <div className="m-label">{label}</div>
      <div className="m-value">
        {pct ? fmtPct(val(m)) : fmtUSD(val(m))}
        {m?.is_estimate && val(m) != null && <span className="est" title={m.basis}>est</span>}
      </div>
      {m?.basis && <div className="m-basis">{m.basis}</div>}
      {cite(m) && <a className="m-cite" href={cite(m)} target="_blank" rel="noreferrer">
        {m.source.publisher} · {m.source.as_of} ↗</a>}
    </div>
  )

  return (
    <aside className="panel">
      <header className="p-head">
        <div className="p-title">
          <h2>{node.name}</h2>
          {node.ticker ? <span className="tick">{node.ticker}</span> : <span className="tick private">PRIVATE</span>}
        </div>
        <div className="p-sub">
          {layer.get(node.layer)?.name} · {seg.get(node.segment)?.name}
          {node.hq && <span className="hq">{node.hq}</span>}
        </div>
        {node.period && <div className="p-period">{node.period}</div>}
      </header>

      {node.bottleneck?.is_bottleneck && (
        <section className="bottleneck">
          <div className="b-head">CHOKEPOINT · criticality {node.bottleneck.criticality}/5</div>
          <p>{node.bottleneck.rationale}</p>
        </section>
      )}

      <section>
        <h3>Financials</h3>
        <div className="metrics">
          <Metric label="Revenue (run-rate)" m={node.revenue_total} />
          <Metric label="Gross margin" m={node.gross_margin_pct} pct />
          <Metric label="Operating margin" m={node.operating_margin_pct} pct />
          <Metric label="Revenue growth YoY" m={node.revenue_growth_yoy_pct} pct />
          {node.capex && <Metric label="Capex (annualized)" m={node.capex} />}
        </div>
        {node.revenue_ai && val(node.revenue_ai) == null && (
          <p className="gap-note">AI-attributable revenue not yet apportioned — {node.revenue_ai.basis}</p>
        )}
      </section>

      <section>
        <h3>Positioning &amp; moat</h3>
        <p className="moat">{node.moat?.summary}</p>
        {node.moat?.strength != null && (
          <div className="strength">
            <span>Moat strength</span>
            <div className="pips">{[1,2,3,4,5].map((i) => (
              <i key={i} className={i <= node.moat.strength ? 'on' : ''} />))}</div>
            <b>{node.moat.strength}/5</b>
          </div>
        )}
      </section>

      {rel.length > 0 && (
        <section>
          <h3>Relationships <span className="count">{rel.length}</span></h3>
          <ul className="rels">
            {rel.map((l) => {
              const other = l.source === node.id ? l.target : l.source
              const m = moneyEdge(l)
              const pays = m.from === node.id
              return (
                <li key={l.id}>
                  <button className="rel-name" onClick={() => onSelect(other)}>{byId.get(other)?.name ?? other}</button>
                  <span className={`rel-type t-${l.type}`}>{l.type.replace(/_/g, ' ')}</span>
                  {l.value_usd_m && <span className="rel-val">{fmtUSD(l.value_usd_m)}</span>}
                  <span className="rel-dir">{pays ? '→ pays' : '← paid by'}</span>
                  {l.exposure_note && <p className="rel-note">{l.exposure_note}</p>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {reach.length > 0 && (
        <section>
          <h3>Read-across <span className="count">{reach.length} within 2 hops</span></h3>
          <p className="muted small">If {node.ticker ?? node.name} moves, look here next.</p>
          <div className="reach">
            {reach.map(([id, d]) => (
              <button key={id} className={`chip hop-${d}`} onClick={() => onSelect(id)}>
                {byId.get(id)?.ticker ?? byId.get(id)?.name ?? id}<i>{d}</i>
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  )
}
