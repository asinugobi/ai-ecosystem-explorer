"""Agent 3 — the Committer.

Deliberately NOT an LLM. This is the gate between a model's output and the
committed dataset, so it is deterministic: validate against JSON Schema, enforce
the provenance rule, refuse on any error, write, commit.

A model that hallucinates a revenue figure produces a node whose metric has no
resolving citation, and that node never lands. The guard only works if this
stage cannot be talked out of it.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from state import PipelineState
from tools.graph import validate_node, validate_link, upsert, load, git


def run(state: PipelineState, *, do_commit: bool = True, push: bool = False) -> PipelineState:
    stage = "committer"
    if not state.proposed_node and not state.proposed_links:
        state.fail(stage, "nothing proposed")
        return state

    node_ids = {n["id"] for n in load("nodes.json")}
    if state.proposed_node:
        node_ids.add(state.proposed_node["id"])

    node_errs = validate_node(state.proposed_node) if state.proposed_node else []
    link_errs = {l.get("id", f"<{i}>"): validate_link(l, node_ids)
                 for i, l in enumerate(state.proposed_links)}
    link_errs = {k: v for k, v in link_errs.items() if v}

    state.validation = {"node_errors": node_errs, "link_errors": link_errs}
    if node_errs or link_errs:
        state.fail(stage, f"REJECTED — {len(node_errs)} node errors, {len(link_errs)} link(s) with errors")
        for e in node_errs:
            print(f"           node: {e}")
        for lid, errs in link_errs.items():
            for e in errs:
                print(f"           link {lid}: {e}")
        return state
    state.say(stage, "validation passed — schema, taxonomy, and provenance all clean")

    if state.proposed_node:
        state.proposed_node.setdefault("updated_at", date.today().isoformat())
        state.proposed_node["updated_by"] = "agent_pipeline"
    for l in state.proposed_links:
        l.setdefault("updated_at", date.today().isoformat())
        l["updated_by"] = "agent_pipeline"

    state.diff_summary = upsert(state.proposed_node, state.proposed_links)
    state.say(stage, f"wrote: {state.diff_summary['node']}, "
                     f"+{len(state.diff_summary['links_added'])} links "
                     f"(skipped {len(state.diff_summary['links_skipped'])} duplicates) — "
                     f"totals {state.diff_summary['totals']}")

    if not do_commit:
        state.say(stage, "--no-commit — files written, leaving git alone")
        return state

    rc, out = git("status", "--porcelain", "data/seed")
    if not out:
        state.say(stage, "no net change to commit")
        return state

    subject = f"data({state.target.lower()}): {state.diff_summary['node'] or 'link update'} via agent pipeline"
    body = (
        f"Automated update from the AI ecosystem pipeline.\n\n"
        f"Trigger : {state.trigger}\n"
        f"Source  : {state.facts['url'] if state.facts else 'press evidence (private company)'}\n"
        f"Period  : {state.facts['period'] if state.facts else 'n/a'}\n"
        f"Links   : +{len(state.diff_summary['links_added'])}\n\n"
        f"Validated against nodes.schema.json and links.schema.json, including the\n"
        f"provenance rule that every non-null figure carries a resolving citation.\n\n"
        f"Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
    )
    git("add", "data/seed/nodes.json", "data/seed/links.json")
    rc, out = git("commit", "-m", subject, "-m", body)
    if rc != 0:
        state.fail(stage, f"git commit failed: {out}")
        return state
    _, sha = git("rev-parse", "--short", "HEAD")
    state.commit = {"sha": sha, "subject": subject}
    state.say(stage, f"committed {sha}: {subject}")

    if push:
        # Placeholder per spec: real deployments push to a branch and open a PR
        # rather than committing straight to the default branch.
        rc, out = git("push", "origin", "HEAD")
        state.say(stage, f"push {'ok' if rc == 0 else 'FAILED: ' + out}")
    else:
        state.say(stage, "push skipped (no remote configured — set one and pass --push)")
    return state
