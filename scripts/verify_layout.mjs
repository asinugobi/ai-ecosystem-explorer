/* Headless layout check. The validator covers color; geometry needs its own
   pass, and catching overlap/overflow here is cheaper than in the browser. */
import { readFileSync } from 'fs'
import * as d3 from 'd3'
import { radiusScale } from '../src/lib/scales.js'
import { buildSimulation, settle, segmentBoxes } from '../src/lib/simulation.js'

const nodes = JSON.parse(readFileSync('data/seed/nodes.json')).map(d => ({ ...d }))
const links = JSON.parse(readFileSync('data/seed/links.json')).map(d => ({ ...d }))
const tax = JSON.parse(readFileSync('data/schema/taxonomy.json'))
const W = 1500, H = 950

const order = d3.groups(tax.segments, s => s.layer).map(([l, ss]) => [l, ss.map(s => s.id)])
const radius = radiusScale(nodes, 'revenue')
const { sim } = buildSimulation({ nodes, links, width: W, height: H, radius, segmentOrder: order })
const t0 = Date.now()
const ticks = settle(sim)
const ms = Date.now() - t0

let overlap = 0, worst = 0
for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
  const a = nodes[i], b = nodes[j]
  const need = radius(a) + radius(b), got = Math.hypot(a.x - b.x, a.y - b.y)
  if (got < need - 1) { overlap++; worst = Math.max(worst, need - got) }
}
const off = nodes.filter(n => n.x - radius(n) < 0 || n.x + radius(n) > W || n.y - radius(n) < 0 || n.y + radius(n) > H)
const lanes = d3.rollup(nodes, v => [Math.round(d3.min(v, d => d.y)), Math.round(d3.max(v, d => d.y))], d => d.layer)
const boxes = segmentBoxes(nodes, radius, H)
let boxOverlap = 0
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j]
  if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) boxOverlap++
}
console.log(`settle: ${ticks} ticks in ${ms}ms  (${nodes.length} nodes, ${links.length} links)`)
console.log(`node overlaps: ${overlap}  worst ${worst.toFixed(1)}px`)
console.log(`off-canvas   : ${off.length} ${off.length ? off.map(n=>n.name).slice(0,5) : ''}`)
console.log(`segment box overlaps: ${boxOverlap}/${boxes.length} boxes`)
console.log('layer y-extents (1=bottom, should be monotonic decreasing):')
for (const l of [...lanes.keys()].sort((a,b)=>b-a)) console.log(`  L${String(l).padStart(2)}  y ${lanes.get(l)[0]}..${lanes.get(l)[1]}`)

console.log('\noverlapping box pairs:')
for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
  const a = boxes[i], b = boxes[j]
  if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) {
    const ox = Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0), oy = Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)
    console.log(`  L${a.layer}:${a.segment} (n=${a.nodes.length}) <-> L${b.layer}:${b.segment} (n=${b.nodes.length})  overlap ${ox.toFixed(0)}x${oy.toFixed(0)}px  ${a.layer===b.layer?'SAME layer':'ADJACENT layers'}`)
  }
}
