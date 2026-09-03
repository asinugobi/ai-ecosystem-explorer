#!/usr/bin/env python3
"""Populate node.valuation for every public company.

Market data has its own cadence — it stales within a day, unlike the quarterly
fundamentals — so this runs separately from build_seed.py and stamps its own
as_of. Re-run it whenever you want fresh multiples; it does not touch anything
else on the node.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from tools.valuation import compute  # noqa: E402

nodes = json.loads((ROOT / "data/seed/nodes.json").read_text())


def v(n, k):
    m = n.get(k)
    return m.get("value") if isinstance(m, dict) else None


ok = skipped = 0
for i, n in enumerate(nodes, 1):
    if not n["is_public"] or not n.get("ticker"):
        continue
    rev = v(n, "revenue_total")
    gm, om = v(n, "gross_margin_pct"), v(n, "operating_margin_pct")
    gp = rev * gm / 100 if rev and gm is not None else None
    oi = rev * om / 100 if rev and om is not None else None
    try:
        val = compute(n["ticker"], rev, gp, oi)
    except Exception as e:
        print(f"  ! {n['ticker']}: {e}", flush=True)
        val = None
    if not val or val.get("market_cap_usd_m") is None:
        # Clear any prior valuation. The first run mispriced TSMC at $10.8T via
        # the ADR-ratio bug; only writing on success left that stale figure in
        # place and it rendered as the largest node on the map. A wrong number
        # that survives a fix is worse than no number.
        n.pop("valuation", None)
        skipped += 1
        why = (val or {}).get("_rejected") or ((val or {}).get("notes") or ["no price or share count"])[0]
        print(f"[{i:>2}] {n['ticker']:<6} skipped — {why[:82]}", flush=True)
        continue
    val.pop("_rejected", None)
    n["valuation"] = val
    ok += 1
    print(f"[{i:>2}] {n['ticker']:<6} mcap {val['market_cap_usd_m']/1e6:>7.2f}T  "
          f"EV/S {str(val['ev_revenue'] or '—'):>7}  EV/EBITDA {str(val['ev_ebitda'] or '—'):>7}", flush=True)

(ROOT / "data/seed/nodes.json").write_text(json.dumps(nodes, indent=2) + "\n")
print(f"\nvaluations written: {ok} priced, {skipped} skipped")
