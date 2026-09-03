"""Agent 2 — the Classifier.

The only LLM stage. Takes the Monitor's primary-source evidence and emits JSON
matching nodes.schema.json / links.schema.json exactly.

Two guardrails matter more than the prompt:
  1. It is told never to invent a figure, and every metric must carry the source
     URL the Monitor supplied. The Committer enforces this — a value without a
     resolving citation is rejected, not warned about.
  2. Taxonomy placement is constrained to the 24 real segment ids, so it cannot
     invent a category.

Runs via the Claude Agent SDK. `mock=True` skips the model entirely and returns
a deterministic extraction, so the pipeline is demonstrable without credentials.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from state import PipelineState
from tools.graph import taxonomy

MODEL = "claude-opus-5"

SYSTEM = """You are a research analyst maintaining a structured map of the AI ecosystem.

You convert primary-source filing evidence into JSON that matches a strict schema.

HARD RULES — violating any of these invalidates the output:
1. NEVER invent a number. Every figure you emit must appear in the evidence you
   were given. If a figure is absent, emit null and say why in `basis`.
2. Every metric object with a non-null value MUST carry `source.url` set to the
   filing URL from the evidence, and a `basis` describing exactly what the number
   counts and how it was derived.
3. `is_estimate` is false ONLY for figures reported directly in an SEC filing.
   Anything analyst-derived or press-reported is true.
4. `segment` must be one of the exact ids listed below, and `layer` must match
   that segment's layer.
5. Output ONE JSON object and nothing else. No prose, no markdown fence.

Output shape:
{"node": { ...matching nodes.schema.json... },
 "links": [ ...matching links.schema.json, may be empty... ]}"""


def _segment_catalogue() -> str:
    tax = taxonomy()
    layers = {l["layer"]: l["name"] for l in tax["layers"]}
    rows = [f'  {s["id"]:<20} layer {s["layer"]:>2} ({layers[s["layer"]]}) — {s["supplies"][:80]}'
            for s in tax["segments"]]
    return "VALID SEGMENTS (id, layer, description):\n" + "\n".join(rows)


def _prompt(state: PipelineState, existing_ids: list[str]) -> str:
    return f"""{_segment_catalogue()}

EXISTING NODE IDS (use these exact ids when creating links):
{', '.join(sorted(existing_ids))}

EVIDENCE:
{state.evidence}

TASK:
Produce the node object for {state.target}, plus any links to EXISTING node ids
that the evidence directly supports. Do not invent relationships — only encode
ones the evidence states. Write `moat.summary` as a research note for a reader
who already knows the company, not a description of what it does."""


def _extract_json(text: str) -> dict:
    """Models occasionally wrap JSON in a fence despite instructions."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object in classifier output")
    depth, in_str, esc = 0, False, False
    for i, ch in enumerate(text[start:], start):
        if in_str:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': in_str = False
        elif ch == '"': in_str = True
        elif ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    raise ValueError("unbalanced JSON in classifier output")


async def run(state: PipelineState, existing_ids: list[str], mock_result: dict | None = None) -> PipelineState:
    stage = "classifier"
    if not state.evidence:
        state.fail(stage, "no evidence to classify")
        return state

    if state.mode == "mock":
        if mock_result is None:
            state.fail(stage, "mock mode requires a canned result")
            return state
        state.say(stage, "MOCK — using canned extraction, no model call")
        state.proposed_node = mock_result.get("node")
        state.proposed_links = mock_result.get("links", [])
        state.classifier_raw = json.dumps(mock_result)
        return state

    from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, TextBlock, ResultMessage

    state.say(stage, f"calling {MODEL} with {len(state.evidence)} chars of primary-source evidence…")
    options = ClaudeAgentOptions(
        system_prompt=SYSTEM,
        model=MODEL,
        allowed_tools=[],            # extraction only — no filesystem, no network
        permission_mode="dontAsk",
        max_turns=1,
        effort="high",
    )
    out, cost = [], None
    async for msg in query(prompt=_prompt(state, existing_ids), options=options):
        if isinstance(msg, AssistantMessage):
            for b in msg.content:
                if isinstance(b, TextBlock):
                    out.append(b.text)
        elif isinstance(msg, ResultMessage):
            cost = getattr(msg, "total_cost_usd", None)

    state.classifier_raw = "".join(out)
    if cost is not None:
        state.say(stage, f"model returned {len(state.classifier_raw)} chars (${cost:.4f})")
    try:
        parsed = _extract_json(state.classifier_raw)
    except Exception as e:
        state.fail(stage, f"could not parse model output as JSON: {e}")
        return state
    state.proposed_node = parsed.get("node")
    state.proposed_links = parsed.get("links", [])
    state.say(stage, f"extracted node={state.proposed_node and state.proposed_node.get('id')} "
                     f"links={len(state.proposed_links)}")
    return state
