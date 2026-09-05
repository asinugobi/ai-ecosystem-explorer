import { useState, useMemo, useRef, useEffect } from 'react'
import { fmtUSD, val } from '../lib/scales.js'

/**
 * Find a company without already knowing where it sits.
 *
 * The stack is browsable three ways and none of them helps a reader who
 * arrives with a name in mind. Matches are ranked rather than merely filtered:
 * an exact ticker outranks a substring, so typing "ARM" surfaces Arm Holdings
 * before every company whose segment happens to contain those letters.
 */
export default function CompanySearch({ nodes, taxonomy, onSelect }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  const meta = useMemo(() => ({
    layer: new Map(taxonomy.layers.map((l) => [l.layer, l.name])),
    seg: new Map(taxonomy.segments.map((s) => [s.id, s.name])),
  }), [taxonomy])

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return []
    return nodes
      .map((n) => ({ n, rank: rankOf(n, term, meta) }))
      .filter((r) => r.rank < Infinity)
      .sort((a, b) => a.rank - b.rank || (val(b.n.revenue_total) ?? 0) - (val(a.n.revenue_total) ?? 0))
      .slice(0, 8)
      .map((r) => r.n)
  }, [q, nodes, meta])

  useEffect(() => { setActive(0) }, [q])

  /* "/" and ⌘K are the two shortcuts readers already try. Neither may steal a
     keystroke that was meant for a field the reader is currently typing into. */
  useEffect(() => {
    const onKey = (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      const palette = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)
      if (palette || (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pick = (n) => {
    if (!n) return
    onSelect(n.id)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setQ(''); setOpen(false); inputRef.current?.blur(); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
  }

  const showList = open && q.trim().length > 0

  return (
    <div className="search" role="search">
      <span className="search-icon" aria-hidden>⌕</span>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="Search companies"
        aria-label="Search companies"
        aria-expanded={showList}
        aria-controls="search-results"
        autoComplete="off"
        spellCheck="false"
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {!q && <kbd className="search-kbd">/</kbd>}

      {showList && (
        <ul className="search-results" id="search-results" role="listbox">
          {results.length === 0 && <li className="search-none">No company matches “{q.trim()}”</li>}
          {results.map((n, i) => (
            <li key={n.id}>
              {/* mousedown, not click: blur would tear the list down first */}
              <button role="option" aria-selected={i === active}
                      className={i === active ? 'on' : ''}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); pick(n) }}>
                <span className="sr-name">
                  {n.name}
                  <i className={n.is_public ? 'tk' : 'tk priv'}>{n.ticker ?? 'PRIVATE'}</i>
                </span>
                <span className="sr-rev">{fmtUSD(val(n.revenue_total))}</span>
                <span className="sr-where">
                  {String(n.layer).padStart(2, '0')} · {meta.seg.get(n.segment) ?? n.segment}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Lower is better; Infinity means no match. */
function rankOf(n, term, meta) {
  const ticker = (n.ticker ?? '').toLowerCase()
  const name = n.name.toLowerCase()
  if (ticker && ticker === term) return 0
  if (ticker && ticker.startsWith(term)) return 1
  if (name.startsWith(term)) return 2
  if (name.includes(term)) return 3
  const where = `${meta.seg.get(n.segment) ?? ''} ${meta.layer.get(n.layer) ?? ''}`.toLowerCase()
  if (where.includes(term)) return 4
  return Infinity
}
