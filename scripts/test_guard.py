#!/usr/bin/env python3
"""Adversarial test: does the Committer actually stop a hallucinating model?

Each case is a plausible-looking output an LLM could produce. All of them must
be REJECTED. If any is accepted, the provenance guard is decorative.
"""
import copy, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from tools.graph import validate_node, validate_link, load

from run_pipeline import DEMO_MOCK_RESULT
good = copy.deepcopy(DEMO_MOCK_RESULT["node"])
node_ids = {n["id"] for n in load("nodes.json")} | {good["id"]}

cases = []
c = copy.deepcopy(good); del c["revenue_total"]["source"]
cases.append(("figure with NO citation", c, None))
c = copy.deepcopy(good); c["revenue_total"]["is_estimate"] = False
cases.append(("press figure claiming is_estimate=false", c, None))
c = copy.deepcopy(good); c["segment"] = "quantum_computing"
cases.append(("invented segment", c, None))
c = copy.deepcopy(good); c["layer"] = 3
cases.append(("segment/layer mismatch", c, None))
c = copy.deepcopy(good); c["verticals"] = ["cryptocurrency"]
cases.append(("invented vertical", c, None))
c = copy.deepcopy(good); c["revenue_total"]["basis"] = "revenue"
cases.append(("basis too short to be meaningful", c, None))
c = copy.deepcopy(good); del c["moat"]
cases.append(("missing required moat", c, None))
cases.append(("link to a node that does not exist", None,
              {"id":"x1","source":"meridian_compute","target":"acme_fictional",
               "type":"supply","description":"a relationship with a company that is not on the map"}))
cases.append(("self-loop link", None,
              {"id":"x2","source":"nvidia","target":"nvidia","type":"supply",
               "description":"a company supplying itself, which is not a relationship"}))

print(f"{'case':<44} {'verdict':<10} first error")
print("-"*118)
failures = 0
for name, node, link in cases:
    errs = validate_node(node) if node else validate_link(link, node_ids)
    ok = not errs
    if ok: failures += 1
    print(f"{name:<44} {'ACCEPTED!!' if ok else 'rejected':<10} {errs[0] if errs else '— GUARD FAILED'}")

print()
clean = validate_node(good)
print(f"{'control: the well-formed node':<44} {'rejected' if clean else 'accepted':<10} {clean[0] if clean else 'correct — good data passes'}")
if clean: failures += 1
print()
print(f"{'ALL GUARDS HELD' if not failures else str(failures)+' GUARD FAILURE(S)'}")
sys.exit(1 if failures else 0)
