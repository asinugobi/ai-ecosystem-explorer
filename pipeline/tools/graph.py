"""Read, validate and write the node/link graph.

Validation is strict on purpose: the Classifier is an LLM, and the only thing
standing between a hallucinated figure and the committed dataset is the schema
plus the citation requirement. A node whose metrics carry no source is rejected,
not warned about.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"
SCHEMA = ROOT / "data" / "schema"


def load(name: str) -> Any:
    return json.loads((SEED / name).read_text())


def load_schema(name: str) -> dict:
    return json.loads((SCHEMA / name).read_text())


def taxonomy() -> dict:
    return json.loads((SCHEMA / "taxonomy.json").read_text())


def validate_node(node: dict) -> list[str]:
    """Schema validation plus the rules a JSON Schema cannot express."""
    errs: list[str] = []
    schema = load_schema("nodes.schema.json")
    v = Draft202012Validator(schema["$defs"]["node"])
    # resolve the local $refs by inlining $defs
    v = Draft202012Validator({**schema["$defs"]["node"], "$defs": schema["$defs"]})
    for e in sorted(v.iter_errors(node), key=lambda e: list(e.path)):
        errs.append(f"schema: {'/'.join(map(str, e.path)) or '(root)'}: {e.message}")

    tax = taxonomy()
    segs = {s["id"]: s for s in tax["segments"]}
    if node.get("segment") not in segs:
        errs.append(f"taxonomy: unknown segment {node.get('segment')!r}")
    elif segs[node["segment"]]["layer"] != node.get("layer"):
        errs.append(
            f"taxonomy: segment {node['segment']!r} belongs to layer "
            f"{segs[node['segment']]['layer']}, node claims {node.get('layer')}")

    known_verticals = {v["id"] for v in tax["verticals"]}
    for vert in node.get("verticals", []):
        if vert not in known_verticals:
            errs.append(f"taxonomy: unknown vertical {vert!r}")

    # The rule that actually protects the dataset: a number without provenance
    # does not get committed. An LLM can invent a figure; it cannot invent an
    # accession number that resolves.
    for key in ("revenue_total", "revenue_ai", "gross_margin_pct",
                "operating_margin_pct", "capex", "revenue_growth_yoy_pct"):
        m = node.get(key)
        if not isinstance(m, dict) or m.get("value") is None:
            continue
        if not m.get("basis"):
            errs.append(f"provenance: {key} has a value but no basis")
        if not m.get("source", {}).get("url"):
            errs.append(f"provenance: {key} has a value but no source URL")
        if m.get("is_estimate") is False and "sec.gov" not in m.get("source", {}).get("url", ""):
            errs.append(f"provenance: {key} claims is_estimate=false but is not SEC-sourced")
    return errs


def validate_link(link: dict, node_ids: set[str]) -> list[str]:
    errs: list[str] = []
    schema = load_schema("links.schema.json")
    v = Draft202012Validator({**schema["items"], "$defs": schema["$defs"]})
    for e in sorted(v.iter_errors(link), key=lambda e: list(e.path)):
        errs.append(f"schema: {'/'.join(map(str, e.path)) or '(root)'}: {e.message}")
    for end in ("source", "target"):
        if link.get(end) not in node_ids:
            errs.append(f"dangling: {end}={link.get(end)!r} is not a known node")
    if link.get("source") == link.get("target"):
        errs.append("self-loop: source == target")
    return errs


def upsert(node: dict | None, links: list[dict]) -> dict:
    """Merge into the seed files. Returns a summary of what changed."""
    nodes = load("nodes.json")
    existing = load("links.json")
    by_id = {n["id"]: i for i, n in enumerate(nodes)}
    link_ids = {l["id"] for l in existing}
    summary = {"node": None, "links_added": [], "links_skipped": []}

    if node:
        if node["id"] in by_id:
            nodes[by_id[node["id"]]] = node
            summary["node"] = f"updated {node['id']}"
        else:
            nodes.append(node)
            summary["node"] = f"added {node['id']}"

    for l in links:
        if l["id"] in link_ids:
            summary["links_skipped"].append(l["id"])
        else:
            existing.append(l)
            summary["links_added"].append(l["id"])

    (SEED / "nodes.json").write_text(json.dumps(nodes, indent=2) + "\n")
    (SEED / "links.json").write_text(json.dumps(existing, indent=2) + "\n")
    summary["totals"] = {"nodes": len(nodes), "links": len(existing)}
    return summary


def git(*args: str) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip()
