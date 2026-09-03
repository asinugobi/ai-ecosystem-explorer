"""State schema threaded through the three agents.

The pipeline is a linear pass — Monitor -> Classifier -> Committer — with each
stage reading what the previous one wrote and appending to the log. Keeping it
one explicit dataclass rather than implicit kwargs means a run can be dumped to
JSON, diffed, and replayed, which matters when the Classifier is an LLM and you
need to know exactly what it saw.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


@dataclass
class PipelineState:
    # --- input ---
    target: str                                   # ticker, or a name for private cos
    trigger: str = "manual"                       # what caused this run
    is_public: bool = True

    # --- Agent 1: Monitor ---
    filings: list[dict[str, Any]] = field(default_factory=list)
    facts: dict[str, Any] | None = None           # EDGAR XBRL figures + citations
    evidence: str = ""                            # text handed to the Classifier

    # --- Agent 2: Classifier ---
    proposed_node: dict[str, Any] | None = None
    proposed_links: list[dict[str, Any]] = field(default_factory=list)
    classifier_raw: str = ""                      # kept for auditability

    # --- Agent 3: Committer ---
    validation: dict[str, Any] = field(default_factory=dict)
    diff_summary: dict[str, Any] = field(default_factory=dict)
    commit: dict[str, Any] | None = None

    # --- bookkeeping ---
    mode: str = "mock"                            # mock | live
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    log: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def say(self, stage: str, msg: str) -> None:
        line = f"[{stage}] {msg}"
        self.log.append(line)
        print(line, flush=True)

    def fail(self, stage: str, msg: str) -> None:
        self.errors.append(f"[{stage}] {msg}")
        print(f"[{stage}] ERROR {msg}", flush=True)

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2, default=str)
