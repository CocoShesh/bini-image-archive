#!/usr/bin/env python3

import json
from pathlib import Path

ROOT = Path(".")
INPUT = ROOT / "data/analysis/duplicates/near-duplicates.json"
OUTPUT = ROOT / "data/analysis/duplicates/canonical-report.json"

with INPUT.open("r", encoding="utf-8") as f:
    data = json.load(f)

groups = data.get("groups", [])

report = []

for group_index, group in enumerate(groups, 1):
    items = group.get("items", [])

    def rank(item):
        width = int(item.get("width") or 0)
        height = int(item.get("height") or 0)
        pixels = width * height
        score = int(item.get("score") or 0)
        status = item.get("status") or ""

        status_bonus = {
            "accept": 2,
            "review": 1,
        }.get(status, 0)

        return (
            pixels,
            score,
            status_bonus,
            1 if str(item.get("path", "")).lower().endswith(".jpg") else 0,
        )

    ranked = sorted(
        items,
        key=rank,
        reverse=True,
    )

    canonical = ranked[0] if ranked else None

    variants = ranked[1:] if len(ranked) > 1 else []

    report.append({
        "group": group_index,
        "count": len(items),
        "canonical": canonical,
        "variants": variants,
    })

OUTPUT.write_text(
    json.dumps(
        report,
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print("=" * 70)
print(" CANONICAL DUPLICATE REPORT")
print("=" * 70)
print(f"Groups: {len(report)}")
print(f"Output: {OUTPUT}")
