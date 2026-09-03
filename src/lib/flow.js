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

/** Read-across: everything reachable from a node within N hops, either way. */
export function exposure(nodeId, links, depth = 2) {
  const nbr = new Map()
  const add = (a, b, l) => { if (!nbr.has(a)) nbr.set(a, []); nbr.get(a).push({ id: b, link: l }) }
  for (const l of links) { add(l.source, l.target, l); add(l.target, l.source, l) }
  const out = new Map([[nodeId, 0]])
  let frontier = [nodeId]
  for (let d = 1; d <= depth; d++) {
    const next = []
    for (const id of frontier) for (const { id: n } of nbr.get(id) || []) {
      if (!out.has(n)) { out.set(n, d); next.push(n) }
    }
    frontier = next
  }
  return out  // Map<nodeId, hopDistance>
}
