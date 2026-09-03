/**
 * Goods and money flow in OPPOSITE directions, and conflating them is the
 * easiest way to get a market map wrong.
 *
 * Every link is authored as "source provides X to target" — Nvidia provides
 * chips to Oracle, so the edge is nvidia -> oracle. But the CASH runs the other
 * way: Oracle pays Nvidia. Circular-financing analysis is about cash, so it has
 * to traverse the money direction, not the authored direction.
 *
 * Get this wrong and the Nvidia -> OpenAI -> Oracle -> Nvidia loop is invisible,
 * which is exactly what happened on the first pass.
 */

// true  = money flows source -> target (source is paying)
// false = money flows target -> source (source is supplying, target is paying)
export const MONEY_FORWARD = {
  investment: true,
  equity_stake: true,
  compute_contract: true,        // customer commits spend to the provider
  customer_concentration: true,  // authored as customer -> vendor
  partnership: true,
  supply: false,                 // supplier -> customer; cash comes back
  foundry: false,
  power_purchase: false,         // generator -> offtaker; offtaker pays
  data_license: false,           // licensor -> licensee; licensee pays
}

/** Orient a link along the direction cash actually travels. */
export function moneyEdge(link) {
  const fwd = MONEY_FORWARD[link.type] ?? true
  return fwd
    ? { from: link.source, to: link.target, link }
    : { from: link.target, to: link.source, link }
}

/**
 * Find cycles in the money graph — capital that leaves a company and returns to
 * it through the ecosystem. Vendor financing is the thesis this exists to test.
 */
export function financingCycles(links, { maxLen = 5 } = {}) {
  const adj = new Map()
  for (const l of links) {
    const { from, to } = moneyEdge(l)
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from).push({ to, link: l })
  }
  const found = new Map()
  const walk = (start, path, edges, seen) => {
    for (const { to, link } of adj.get(path[path.length - 1]) || []) {
      if (to === start && path.length > 2) {
        const key = [...path].sort().join('|')
        if (!found.has(key)) found.set(key, { nodes: [...path, to], links: [...edges, link] })
      } else if (!seen.has(to) && path.length < maxLen) {
        walk(start, [...path, to], [...edges, link], new Set([...seen, to]))
      }
    }
  }
  for (const start of adj.keys()) walk(start, [start], [], new Set([start]))
  return [...found.values()].sort((a, b) => a.nodes.length - b.nodes.length)
}

/**
 * Read-across WITH the sign — the Python mirror of this lives in
 * pipeline/tools/analysis.py and the two must agree.
 *
 * Goods direction is dependency direction: on a link, `source` supplies
 * `target`. Composition over multiple hops is the part a plain neighbourhood
 * list hides — down-then-up does not reach a dependent, it reaches a
 * CO-SUPPLIER into a shared customer. Micron is two hops from TSMC via Nvidia
 * but does not depend on TSMC; they share a customer. Correlated, not
 * dependent, and it trades differently.
 */
/* Goods direction is NOT the same as money direction, and it is not uniform
   across link types: for supply/foundry the source is the supplier, but for
   compute_contract/customer_concentration the source is the CUSTOMER. Mirror of
   GOODS_FORWARD in pipeline/tools/analysis.py — the two must agree. */
export const GOODS_FORWARD = {
  supply: true, foundry: true, power_purchase: true, data_license: true,
  operational_integration: true,
  investment: true, equity_stake: true, corporate_venture: true,
  compute_for_equity: true, compute_credits: true,
  compute_contract: false, customer_concentration: false,
  partnership: true,
}

export function exposureDirected(nodeId, links, depth = 2) {
  const adj = new Map()
  const add = (from, to, move, link) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from).push({ to, move, link })
  }
  for (const l of links) {
    const fwd = GOODS_FORWARD[l.type] ?? true
    const [supplier, customer] = fwd ? [l.source, l.target] : [l.target, l.source]
    add(supplier, customer, 'down', l)
    add(customer, supplier, 'up', l)
  }
  const out = new Map([[nodeId, { hop: 0, relation: 'self' }]])
  let frontier = [{ id: nodeId, moves: [] }]
  for (let d = 1; d <= depth; d++) {
    const next = []
    for (const { id: cur, moves } of frontier) {
      for (const { to, move, link } of adj.get(cur) || []) {
        if (out.has(to)) continue
        const m = [...moves, move]
        const kinds = new Set(m)
        const relation =
          kinds.size === 1 ? (kinds.has('down') ? 'downstream' : 'upstream')
          : m.join(',') === 'down,up' ? 'co_supplier'   // rivals for a customer
          : m.join(',') === 'up,down' ? 'co_customer'   // rivals for allocation
          : 'lateral' 
        out.set(to, { hop: d, relation, through: d > 1 ? cur : null, link: d === 1 ? link : null })
        next.push({ id: to, moves: m })
      }
    }
    frontier = next
  }
  return out
}

/** Hop distance only. Prefer exposureDirected — the sign flips the trade. */
export function exposure(nodeId, links, depth = 2) {
  const m = exposureDirected(nodeId, links, depth)
  return new Map([...m].map(([k, v]) => [k, v.hop]))
}
