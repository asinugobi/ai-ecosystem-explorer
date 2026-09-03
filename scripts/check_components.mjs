/* A no-op patch or a rename leaves <Foo/> referenced with no Foo in scope.
   Vite builds it happily and it explodes at runtime, which is how the
   CapitalView blank-screen happened. Fail the build instead. */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
const files = []
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.jsx') && files.push(join(d, e.name)))
walk('src')
let bad = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const used = new Set([...src.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]))
  for (const c of used) {
    const defined = new RegExp(`(function\\s+${c}\\b|const\\s+${c}\\s*=|import\\s+${c}\\b|,\\s*${c}\\s*[,}])`).test(src)
    if (!defined) { console.error(`  FAIL ${f}: <${c}> used but not defined or imported`); bad++ }
  }
}
console.log(bad ? `${bad} undefined component reference(s)` : '  ok   every JSX component reference resolves')
process.exit(bad ? 1 : 0)
