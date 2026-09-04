import { useState, useMemo, useEffect } from 'react'
import NetworkGraph from './components/NetworkGraph.jsx'
import IntelligencePanel from './components/IntelligencePanel.jsx'
import { financingCycles } from './lib/flow.js'
import SubstitutabilityMatrix from './components/SubstitutabilityMatrix.jsx'
import SegmentRail from './components/SegmentRail.jsx'
import { PALETTE, GROUP_LABEL, fmtUSD, val } from './lib/scales.js'
import nodesData from '../data/seed/nodes.json'
import linksData from '../data/seed/links.json'
import taxonomy from '../data/schema/taxonomy.json'
import overrides from '../data/seed/overrides.json'

/** Merge press-sourced overrides over the EDGAR-generated seed. */
function applyOverrides(nodes) {
  const o = overrides.overrides ?? {}
  return nodes.map((n) => (o[n.id] ? { ...n, ...o[n.id], moat: n.moat } : n))
}

export default function App() {
  const [theme, setTheme] = useState('dark')
  const [sizeBy, setSizeBy] = useState('revenue')
  const [colorBy, setColorBy] = useState('operating_margin_pct')
  const [vertical, setVertical] = useState(null)
  const [selected, setSelected] = useState(null)
  const [cycleIdx, setCycleIdx] = useState(null)
  const [view, setView] = useState('map')

  const nodes = useMemo(() => applyOverrides(nodesData), [])
  const cycles = useMemo(() => financingCycles(linksData), [])
  const cycle = cycleIdx == null ? null : cycles[cycleIdx]
  const selNode = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected])

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  const coverage = useMemo(() => {
    const withRev = nodes.filter((n) => val(n.revenue_total) != null)
    return {
      total: nodes.length,
      private: nodes.filter((n) => !n.is_public).length,
      sourced: nodes.filter((n) => n.revenue_total?.is_estimate === false).length,
      gaps: nodes.length - withRev.length,
      revenue: withRev.reduce((s, n) => s + val(n.revenue_total), 0),
    }
  }, [nodes])

  const P = PALETTE[theme]

  return (
    <div className="app" data-theme={theme}>
      <header className="top">
        <div className="brand">
          <h1>The AI Ecosystem Stack</h1>
          <p>Where the constraints sit — from megawatts to models.</p>
        </div>
        <div className="stats">
          <Stat k={coverage.total} l="companies" />
          <Stat k={taxonomy.layers.length} l="layers" />
          <Stat k={taxonomy.segments.length} l="segments" />
          <Stat k={linksData.length} l="relationships" />
          <Stat k={coverage.sourced} l="SEC-sourced" />
          <Stat k={coverage.private} l="private" />
          <Stat k={fmtUSD(coverage.revenue)} l="mapped revenue" />
        </div>
        <button className="theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <nav className="views" role="tablist" aria-label="Views">
        {[['map', 'Stack map', 'Where each company sits, and what connects to what'],
          ['matrix', 'Substitutability', 'Why the chokepoints are chokepoints'],
          ['segments', 'Layers & segments', 'What each of the 24 comp sets actually is']].map(([k, label, hint]) => (
          <button key={k} role="tab" aria-selected={view === k}
                  className={view === k ? 'on' : ''} onClick={() => setView(k)}>
            {label}<em>{hint}</em>
          </button>
        ))}
      </nav>

      <div className="controls" hidden={view !== 'map'}>
        <div className="ctl">
          <label>Size by</label>
          <div className="seg-ctl">
            {[['revenue','Revenue'],['valuation','Absolute scale'],['capital_efficiency','Capital efficiency'],['margin','Operating margin']].map(([k,l]) => (
              <button key={k} className={sizeBy === k ? 'on' : ''} onClick={() => setSizeBy(k)} title={SIZE_HINT[k]}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ctl">
          <label>Colour by</label>
          <div className="seg-ctl">
            {[['operating_margin_pct','Operating'],['gross_margin_pct','Gross'],['growth','Top-line velocity']].map(([k,l]) => (
              <button key={k} className={colorBy === k ? 'on' : ''} onClick={() => setColorBy(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ctl">
          <label>Isolate vertical</label>
          <select value={vertical ?? ''} onChange={(e) => setVertical(e.target.value || null)}>
            <option value="">All sectors</option>
            {taxonomy.verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div className="ctl">
          <label>Circular financing <span className="count">{cycles.length}</span></label>
          <div className="seg-ctl">
            <button className={cycleIdx == null ? 'on' : ''} onClick={() => setCycleIdx(null)}>Off</button>
            {cycles.map((c, i) => (
              <button key={i} className={cycleIdx === i ? 'on' : ''} onClick={() => setCycleIdx(i)}
                      title={c.nodes.join(' → ')}>Loop {i + 1}</button>
            ))}
          </div>
        </div>
        <Legend theme={theme} colorBy={colorBy} />
      </div>

      <main>
        {view === 'matrix' && (
          <SubstitutabilityMatrix nodes={nodes} taxonomy={taxonomy}
                                  selected={selected} onSelect={setSelected} theme={theme} />
        )}
        {view === 'segments' && (
          <SegmentRail nodes={nodes} taxonomy={taxonomy}
                       selected={selected} onSelect={setSelected} theme={theme} />
        )}
        {view === 'map' && <NetworkGraph
          nodes={nodes} links={linksData} taxonomy={taxonomy} theme={theme}
          sizeBy={sizeBy} colorBy={colorBy} verticalFilter={vertical}
          selected={selected} onSelect={setSelected} highlightCycle={cycle} />}
        {view !== 'matrix' && (
          <IntelligencePanel node={selNode} nodes={nodes} links={linksData}
                             taxonomy={taxonomy} onSelect={setSelected} />
        )}
      </main>

      {cycle && (
        <div className="cycle-bar">
          <b>Circular financing</b>
          {cycle.nodes.map((id, i) => (
            <span key={i}>{nodes.find((n) => n.id === id)?.name ?? id}{i < cycle.nodes.length - 1 ? ' → ' : ''}</span>
          ))}
          <button onClick={() => setCycleIdx(null)}>clear</button>
        </div>
      )}
    </div>
  )
}

const Stat = ({ k, l }) => (<div className="stat"><b>{k}</b><span>{l}</span></div>)

const SIZE_HINT = {
  revenue: 'Reported revenue run-rate (public) or estimated ARR (private)',
  valuation: 'Market cap for public companies; last post-money mark for private — a priced round, not a live quote',
  capital_efficiency: 'Revenue per dollar of capex (public) or ARR per dollar raised (private). Separates toll-collectors from IP.',
  margin: 'Operating margin. Radius encodes profitability rank, since margin goes deeply negative.',
}

function Legend({ theme, colorBy }) {
  const P = PALETTE[theme]
  return (
    <div className="legend">
      <div className="lg-row">
        {['capital', 'compute', 'operational'].map((g) => (
          <span key={g} className="lg-item"><i style={{ background: P[g] }} />{GROUP_LABEL[g]}</span>
        ))}
        <span className="lg-item"><i className="dashed" style={{ borderColor: P.ink3 }} />value undisclosed</span>
      </div>
      <div className="lg-row">
        <span className="lg-scale-label">{colorBy === 'gross_margin_pct' ? 'Gross margin' : colorBy === 'growth' ? 'YoY growth' : 'Operating margin'}</span>
        <span className="lg-ramp" data-metric={colorBy} />
        <span className="lg-ends">{colorBy === 'gross_margin_pct' ? '0% → 90%' : colorBy === 'growth' ? '0% → 200%+' : 'loss → profit'}</span>
        <span className="lg-item lg-priv"><i className="dashed-ring" />private</span>
      </div>
    </div>
  )
}
