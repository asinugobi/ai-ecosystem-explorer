#!/bin/sh
# Full data rebuild, in dependency order. build_seed.py rewrites nodes.json from
# scratch, so the enrichment passes must follow it every time — running them out
# of order silently drops capital_efficiency, venture and valuation blocks.
set -e
cd "$(dirname "$0")/.."
echo "1/4 EDGAR seed";        .venv/bin/python scripts/build_seed.py            | tail -1
echo "2/4 capital efficiency"; .venv/bin/python scripts/enrich_capital_efficiency.py | head -1
echo "3/4 venture layer";      .venv/bin/python scripts/merge_venture.py         | head -1
echo "4/4 valuations";         .venv/bin/python scripts/build_valuations.py      | tail -1
echo "validating…"
python3 scripts/check_schema.py > /dev/null && echo "  json ok"
.venv/bin/python - <<'PY'
import sys, json; sys.path.insert(0, "pipeline")
from tools.graph import validate_node
n = json.load(open("data/seed/nodes.json"))
bad = [x["id"] for x in n if validate_node(x)]
print(f"  {len(n)} nodes, {len(bad)} invalid" + (f": {bad[:5]}" if bad else " — all validate"))
PY
