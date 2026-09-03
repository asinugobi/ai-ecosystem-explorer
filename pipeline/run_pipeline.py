#!/usr/bin/env python3
"""Orchestrate Monitor -> Classifier -> Committer.

  Mock run (no credentials, no model call, deterministic):
      .venv/bin/python pipeline/run_pipeline.py --demo

  Live run against a real filer:
      .venv/bin/python pipeline/run_pipeline.py --ticker GFS --live

  Live run, private company from press evidence:
      .venv/bin/python pipeline/run_pipeline.py --private "Databricks" --evidence-file notes.txt --live
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from state import PipelineState
from agents import monitor, classifier, committer
from tools.graph import load

TODAY = "2026-09-03"

# The spec asks for a mock run against a hypothetical startup. This one is
# deliberately shaped to exercise every guard: it is private (no filings), its
# figures are estimates with press citations, and it creates a link to a real
# existing node.
DEMO_EVIDENCE = """COMPANY: Meridian Compute, Inc. (private, Delaware C-corp)
SOURCE: TechCrunch, "Meridian Compute raises $340M Series C to build inference-optimised
        edge clusters", 2026-08-28. https://techcrunch.com/2026/08/28/meridian-compute-series-c/

REPORTED IN COVERAGE:
- Annualized revenue run-rate: approximately $190M as of July 2026, up from ~$45M a year prior
- Series C: $340M at a $2.8B post-money valuation, led by an unnamed growth fund
- Business: rents inference-optimised GPU capacity at metro edge sites, targeting
  low-latency serving rather than training
- Named customers include Anthropic for a portion of inference capacity
- Company states gross margin "in the mid-40s" — below hyperscale peers because
  edge sites carry higher per-site fixed cost
- Not profitable; the company declined to disclose operating margin or burn
"""

DEMO_MOCK_RESULT = {
    "node": {
        "id": "meridian_compute",
        "name": "Meridian Compute",
        "ticker": None,
        "is_public": False,
        "hq": "US",
        "layer": 6,
        "segment": "gpu_cloud",
        "also_operates": [],
        "verticals": ["developer"],
        "period": "July 2026 annualized run-rate (press-reported)",
        "revenue_total": {
            "value": 190.0, "unit": "usd_millions", "is_estimate": True, "confidence": "medium",
            "basis": "Press-reported annualized run-rate of ~$190M as of July 2026. Private company: unaudited, not a filed figure.",
            "source": {"publisher": "TechCrunch", "title": "Meridian Compute raises $340M Series C",
                        "url": "https://techcrunch.com/2026/08/28/meridian-compute-series-c/", "as_of": "2026-08-28"},
        },
        "gross_margin_pct": {
            "value": 45.0, "unit": "percent", "is_estimate": True, "confidence": "low",
            "basis": "Company characterised gross margin as 'in the mid-40s'; 45% taken as the midpoint. Not an audited figure.",
            "source": {"publisher": "TechCrunch", "url": "https://techcrunch.com/2026/08/28/meridian-compute-series-c/", "as_of": "2026-08-28"},
        },
        "operating_margin_pct": {
            "value": None, "unit": "percent", "is_estimate": True, "confidence": "low",
            "basis": "Not disclosed. Company confirmed it is unprofitable but declined to quantify.",
        },
        "revenue_growth_yoy_pct": {
            "value": 322.2, "unit": "percent", "is_estimate": True, "confidence": "medium",
            "basis": "Run-rate of ~$190M (Jul 2026) vs ~$45M a year prior. Run-rate comparison, not audited periods.",
            "source": {"publisher": "TechCrunch", "url": "https://techcrunch.com/2026/08/28/meridian-compute-series-c/", "as_of": "2026-08-28"},
        },
        "moat": {
            "summary": "Edge-sited inference capacity rather than centralised training capacity. The bet is that serving latency, not training throughput, becomes the binding constraint as inference volume overtakes training. Structurally disadvantaged on gross margin against hyperscale peers because metro sites carry higher fixed cost per megawatt, so the thesis rests on winning latency-sensitive workloads that cannot be served centrally at any price.",
            "type": ["capital", "switching_costs"],
            "strength": 2,
            "risks": ["Hyperscalers are building their own edge tiers",
                       "Gross margin below peers with no disclosed path to operating profit",
                       "Customer concentration in a small number of model labs"],
        },
        "bottleneck": {"is_bottleneck": False, "criticality": 1,
                        "rationale": "Capacity reseller in a well-supplied segment; no structural chokepoint."},
    },
    "links": [{
        "id": "meridian_anthropic_compute",
        "source": "anthropic", "target": "meridian_compute",
        "type": "compute_contract", "value_usd_m": None, "announced": "2026-08-28",
        "term": None, "is_estimate": True,
        "description": "Anthropic named as a customer for a portion of Meridian's edge inference capacity.",
        "exposure_note": "Early evidence that model labs are splitting inference away from their primary training clouds toward latency-optimised providers. Undisclosed value, so it renders dashed.",
        "citation": {"publisher": "TechCrunch", "url": "https://techcrunch.com/2026/08/28/meridian-compute-series-c/", "as_of": "2026-08-28"},
    }],
}


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--demo", action="store_true", help="canned run against a hypothetical startup")
    g.add_argument("--ticker", help="run against a real SEC filer")
    g.add_argument("--private", metavar="NAME", help="run against a private company")
    ap.add_argument("--evidence-file", type=Path, help="press evidence for --private")
    ap.add_argument("--live", action="store_true", help="call the model (default is mock)")
    ap.add_argument("--no-commit", action="store_true")
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--since", help="only filings on/after this date (YYYY-MM-DD)")
    ap.add_argument("--save-state", type=Path)
    a = ap.parse_args()

    if a.demo:
        st = PipelineState(target="Meridian Compute", trigger="demo run", is_public=False,
                            mode="live" if a.live else "mock")
        st.evidence = DEMO_EVIDENCE
    elif a.ticker:
        st = PipelineState(target=a.ticker.upper(), trigger=f"EDGAR poll {TODAY}",
                            is_public=True, mode="live" if a.live else "mock")
    else:
        st = PipelineState(target=a.private, trigger="manual press update", is_public=False,
                            mode="live" if a.live else "mock")
        if a.evidence_file:
            st.evidence = a.evidence_file.read_text()

    if st.mode == "mock" and not a.demo:
        print("mock mode has no canned extraction for a non-demo target; pass --live", file=sys.stderr)
        return 2

    print(f"\n{'='*74}\nAI ECOSYSTEM PIPELINE — target={st.target}  mode={st.mode}\n{'='*74}")

    monitor.run(st, since=a.since)
    if not st.ok:
        print(f"\nhalted after monitor: {st.errors}"); return 1

    existing = [n["id"] for n in load("nodes.json")]
    await classifier.run(st, existing, mock_result=DEMO_MOCK_RESULT if a.demo else None)
    if not st.ok:
        print(f"\nhalted after classifier: {st.errors}"); return 1

    committer.run(st, do_commit=not a.no_commit, push=a.push)

    print(f"\n{'='*74}")
    print("RESULT:", "SUCCESS" if st.ok else "FAILED")
    if st.commit:
        print("commit:", st.commit["sha"], "-", st.commit["subject"])
    for e in st.errors:
        print(" ", e)
    if a.save_state:
        a.save_state.write_text(st.to_json())
        print("state written to", a.save_state)
    return 0 if st.ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
