#!/usr/bin/env python3

import json
from pathlib import Path

ROOT = Path(".")
INPUT = ROOT / "data/analysis/duplicates/near-duplicates.json"
OUTPUT = ROOT / "data/analysis/duplicates/dedup-plan.json"

with INPUT.open("r", encoding="utf-8") as f:
    data = json.load(f)

groups = data.get("groups", [])

plan = []

for group_no, group in enumerate(groups, 1):
    items = group.get("items", [])

    if len(items) < 2:
        continue

    # Pick canonical candidate using existing report logic:
    ranked = sorted(
        items,
        key=lambda x: (
            int(x.get("width") or 0)
            * int(x.get("height") or 0),
            int(x.get("score") or 0),
            1 if str(x.get("path", "")).lower().endswith(".jpg") else 0,
        ),
        reverse=True,
    )

    canonical = ranked[0]
    variants = ranked[1:]

    # Inspect pair distances from the near-duplicate pair list.
    pair_distances = []

    ids = {
        x.get("id"): x
        for x in items
    }

    for pair in data.get("pairs", []):
        a = pair.get("a", {}).get("id")
        b = pair.get("b", {}).get("id")

        if a in ids and b in ids:
            pair_distances.append(
                (
                    pair.get("phashDistance", 999),
                    pair.get("dhashDistance", 999),
                )
            )

    min_phash = min(
        (x[0] for x in pair_distances),
        default=999,
    )

    max_phash = max(
        (x[0] for x in pair_distances),
        default=999,
    )

    min_dhash = min(
        (x[1] for x in pair_distances),
        default=999,
    )

    # Conservative classification.
    if min_phash <= 4 and max_phash <= 6:
        classification = "safe_duplicate_candidate"

    elif min_phash <= 6 and max_phash <= 10:
        classification = "possible_variant"

    else:
        classification = "manual_review"

    plan.append(
        {
            "group": group_no,
            "count": len(items),
            "classification": classification,
            "canonical": canonical,
            "variants": variants,
            "distanceSummary": {
                "minPhash": min_phash,
                "maxPhash": max_phash,
                "minDhash": min_dhash,
            },
        }
    )

summary = {
    "groups": len(plan),
    "safeDuplicateCandidates": sum(
        1
        for x in plan
        if x["classification"]
        == "safe_duplicate_candidate"
    ),
    "possibleVariants": sum(
        1
        for x in plan
        if x["classification"]
        == "possible_variant"
    ),
    "manualReview": sum(
        1
        for x in plan
        if x["classification"]
        == "manual_review"
    ),
}

OUTPUT.write_text(
    json.dumps(
        {
            "summary": summary,
            "groups": plan,
        },
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print("========================================")
print(" DEDUPLICATION PLAN")
print("========================================")
print("Groups:", summary["groups"])
print(
    "Safe duplicate candidates:",
    summary["safeDuplicateCandidates"],
)
print(
    "Possible variants:",
    summary["possibleVariants"],
)
print(
    "Manual review:",
    summary["manualReview"],
)
print("Output:", OUTPUT)
