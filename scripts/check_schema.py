#!/usr/bin/env python3
"""Fail loudly on duplicate JSON keys — json.load() silently keeps the last one,
which is how the links `source` endpoint got destroyed by a citation field."""
import json, sys, pathlib

def no_dupes(pairs):
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError(f"duplicate key {k!r}")
        seen[k] = v
    return seen

bad = 0
for f in sorted(pathlib.Path("data").rglob("*.json")):
    try:
        json.load(open(f), object_pairs_hook=no_dupes)
        print(f"  ok   {f}")
    except ValueError as e:
        print(f"  FAIL {f}: {e}", file=sys.stderr); bad += 1
sys.exit(1 if bad else 0)
