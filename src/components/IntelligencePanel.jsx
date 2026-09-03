import { useMemo, useState, useEffect } from 'react'
import { val, fmtUSD, fmtPct, capitalEfficiency } from '../lib/scales.js'
import { exposure, moneyEdge } from '../lib/flow.js'

/** Progressive disclosure: nothing qualitative renders until a node is chosen. */
export default function IntelligencePanel({ node, nodes, links, taxonomy, onSelect }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const layer = useMemo(() => new Map(taxonomy.layers.map((l) => [l.layer, l])), [taxonomy])
  const seg = useMemo(() => new Map(taxonomy.segments.map((s) => [s.id, s])), [taxonomy])

  const [pane, setPane] = useState('fundamentals')
  useEffect(() => { setPane('fundamentals') }, [node?.id])

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

      <div className="pane-tabs">
        <button className={pane === 'fundamentals' ? 'on' : ''} onClick={() => setPane('fundamentals')}>
          {node.is_public ? 'Public entity' : 'Private entity'}
        </button>
        <button className={pane === 'capital' ? 'on' : ''} onClick={() => setPane('capital')}>Capital &amp; efficiency</button>
      </div>

      {pane === 'capital' ? (
        <CapitalView node={node} />
      ) : (
      <>
      <section>
        <h3>{node.is_public ? 'Financials' : 'Estimated economics'}</h3>
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

      </>
      )}

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

/** The growth-equity pane: where cash pools, and whether margin is earned or borrowed. */
function CapitalView({ node }) {
  const v = node.venture
  const ce = node.capital_efficiency
  const INTENSITY = {
    capital_heavy: 'Capital-heavy toll-collector — revenue is currently being bought with capital.',
    pass_through: 'Pass-through integrator — asset-light, but thin margin. Moves the dollars without keeping them.',
    ip_light: 'IP-light — earns margin without a matching capital base. This is where cash actually pools.',
    balanced: 'Balanced — a meaningful capital base against a healthy margin.',
  }
  return (
    <>
      <section>
        <h3>Capital efficiency</h3>
        {node.is_public ? (
          <div className="metrics">
            <div className="metric">
              <div className="m-label">Revenue per $1 of capex</div>
              <div className="m-value">{ce?.revenue_per_capex_dollar?.toFixed(2) ?? '—'}</div>
              <div className="m-basis">Annualised revenue over annualised cash capex. Below 1.0 means the business
                is spending more on capacity than it currently earns — gross margin alone cannot show you this.</div>
            </div>
            <div className="metric">
              <div className="m-label">Capex as % of revenue</div>
              <div className="m-value">{fmtPct(ce?.capex_pct_revenue, 0)}</div>
              <div className="m-basis">Cash PP&amp;E only — excludes finance leases, so it reads below headline capex
                for filers that lease heavily. A cyclical peak compresses this: a company whose revenue just tripled
                looks asset-light even when it structurally is not.</div>
            </div>
          </div>
        ) : (
          <div className="metrics">
            <div className="metric">
              <div className="m-label">Capital consumed per $1 of ARR</div>
              <div className="m-value">{v?.capital_consumed_per_arr_dollar?.toFixed(2) ?? '—'}</div>
              <div className="m-basis">Total raised over estimated ARR. Net burn is not disclosed for any private
                company here, so this stands in for burn multiple. Under ~3x is efficient; above ~20x the mark is
                pricing an outcome rather than a business.</div>
            </div>
            <div className="metric">
              <div className="m-label">Implied revenue multiple</div>
              <div className="m-value">{v?.post_money_usd_m && v?.estimated_arr_usd_m
                ? `${(v.post_money_usd_m / v.estimated_arr_usd_m).toFixed(0)}x` : '—'}</div>
              <div className="m-basis">Last post-money over estimated ARR. A last-priced-round mark, not a live
                quote — read it together with the round date.</div>
            </div>
          </div>
        )}
        {ce?.asset_intensity && <p className="eff-note">{INTENSITY[ce.asset_intensity]}</p>}
      </section>

      {v && (
        <section>
          <h3>Cap table &amp; financing</h3>
          <div className="metrics">
            <div className="metric">
              <div className="m-label">Post-money · {v.funding_tier?.replace(/_/g, ' ') ?? 'private'}</div>
              <div className="m-value">{fmtUSD(v.post_money_usd_m)}
                {v.last_round_date && <span className="est">{v.last_round_date}</span>}</div>
            </div>
            <div className="metric">
              <div className="m-label">Total raised</div>
              <div className="m-value">{fmtUSD(v.total_raised_usd_m)}</div>
            </div>
            <div className="metric">
              <div className="m-label">Estimated ARR · YoY</div>
              <div className="m-value">{fmtUSD(v.estimated_arr_usd_m)}
                {v.arr_growth_yoy_pct != null && <span className="est">{fmtPct(v.arr_growth_yoy_pct, 0)}</span>}</div>
            </div>
            {v.nrr_pct != null && (
              <div className="metric">
                <div className="m-label">Net revenue retention</div>
                <div className="m-value">{fmtPct(v.nrr_pct, 0)}</div>
                <div className="m-basis">Self-reported and defined inconsistently between companies.</div>
              </div>
            )}
          </div>
          {v.lead_investors?.length > 0 && (
            <>
              <h3>Lead backers</h3>
              <div className="investors">{v.lead_investors.map((i) => <span key={i}>{i}</span>)}</div>
            </>
          )}
          {v.compute_subsidy_note && (
            <div className="subsidy">
              <div className="s-head">COMPUTE ARBITRAGE CHECK</div>
              <p>{v.compute_subsidy_note}</p>
            </div>
          )}
        </section>
      )}
    </>
  )
}
