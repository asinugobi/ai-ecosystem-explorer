import * as d3 from 'd3'
import { layerY } from './scales.js'

/**
 * Force layout for a hierarchical stack map.
 *
 * Deliberately NO forceCenter: a central gravity point fights the layer bands
 * and drags everything toward the middle of the canvas. Vertical position is
 * owned by forceY (the layer lane); horizontal position is owned by a weak
 * forceX toward the node's segment lane, which is what gives the segment
 * containers something coherent to wrap.
 */
export function buildSimulation({ nodes, links, width, height, radius, segmentOrder }) {
  const { y: laneY } = layerY(height)

  // Horizontal target: segments spread across the width within their own layer,
  // so a container is a contiguous region rather than a scatter.
  const xTarget = new Map()
  const xSpan = new Map()
  const countBy = d3.rollup(nodes, (v) => v.length, (d) => `${d.layer}:${d.segment}`)
  for (const [layer, segs] of segmentOrder) {
    // Width share proportional to node count (floored at 1) so a 5-company
    // segment is not squeezed into the same slot as a 1-company segment.
    const weights = segs.map((sid) => Math.max(1, countBy.get(`${layer}:${sid}`) || 0))
    const total = d3.sum(weights)
    const margin = 46
    const usable = width - margin * 2
    let cursor = margin
    segs.forEach((sid, i) => {
      const w = (weights[i] / total) * usable
      xTarget.set(`${layer}:${sid}`, cursor + w / 2)
      xSpan.set(`${layer}:${sid}`, w)
      cursor += w
    })
  }
  const tx = (d) => xTarget.get(`${d.layer}:${d.segment}`) ?? width / 2

  // Seed positions near the target so the pre-settle converges fast and the
  // layout is deterministic across reloads.
  nodes.forEach((d, i) => {
    d.x = tx(d) + (i % 7 - 3) * 6
    d.y = laneY(d.layer) + (i % 5 - 2) * 4
  })

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance(70).strength(0.12))
    .force('charge', d3.forceManyBody().strength(-30))          // per spec
    .force('collide', d3.forceCollide().radius((d) => radius(d) + 2.5).iterations(3))
    .force('y', d3.forceY((d) => laneY(d.layer)).strength(0.9)) // lane discipline
    .force('x', d3.forceX(tx).strength(0.42))                   // segment clustering
    .stop()

  return { sim, laneY, xTarget, xSpan }
}

/**
 * Run the simulation to rest BEFORE the first paint.
 *
 * The spec requires no visual jitter on load, which rules out painting each
 * tick. d3's own recommended headless pattern: compute the tick count from
 * alphaMin/alphaDecay and advance manually, then render once. The sim is left
 * stopped and only reheated on drag.
 */
export function settle(sim, ticks) {
  const n = ticks ?? Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()))
  for (let i = 0; i < n; i++) sim.tick()
  return n
}

/** Bounding box per segment, for the container heatmap. */
export function segmentBoxes(nodes, radius, height, pad = 12) {
  const { band } = layerY(height)
  const groups = d3.group(nodes, (d) => `${d.layer}:${d.segment}`)
  const out = []
  for (const [key, ns] of groups) {
    const layer = Number(key.split(':')[0])
    const segment = key.split(':').slice(1).join(':')
    // Vertical extent is clamped to the layer's own band. A box represents a
    // segment's region WITHIN its layer, so it must never bleed into the one
    // above or below even when a large node's radius would push it there.
    const top = band(layer) + 3
    const bot = band(layer) + band.bandwidth() - 3
    out.push({
      key, layer, segment, nodes: ns,
      x0: d3.min(ns, (d) => d.x - radius(d)) - pad,
      x1: d3.max(ns, (d) => d.x + radius(d)) + pad,
      y0: Math.max(top, d3.min(ns, (d) => d.y - radius(d)) - pad),
      y1: Math.min(bot, d3.max(ns, (d) => d.y + radius(d)) + pad),
    })
  }
  return out
}

/** Curved cross-layer edge. Straight lines through a dense band are unreadable. */
export function linkPath(l) {
  const sx = l.source.x, sy = l.source.y, tx = l.target.x, ty = l.target.y
  const dx = tx - sx, dy = ty - sy
  const dr = Math.hypot(dx, dy) * 1.6 || 1
  const sweep = sx < tx ? 1 : 0
  return `M${sx},${sy}A${dr},${dr} 0 0,${sweep} ${tx},${ty}`
}
