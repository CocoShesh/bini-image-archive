#!/usr/bin/env python3

import json
from pathlib import Path

INPUT = Path("data/analysis/duplicates/final-dedup-manifest.json")
OUTPUT = Path("data/analysis/duplicates/final-dedup-preview.json")

with INPUT.open("r", encoding="utf-8") as f:
    manifest = json.load(f)

safe_groups = manifest["safe_groups"]
variant_groups = manifest["possible_variant_groups_data"]
manual_groups = manifest["manual_review_groups_data"]

def process_groups(groups, category):
    rows = []

    for group in groups:
        canonical = group.get("canonical")
        variants = group.get("variants", [])

        rows.append({
            "group": group["group"],
            "category": category,
            "count": group["count"],
            "canonical": canonical,
            "proposedVariants": variants,
        })

    return rows

safe_rows = process_groups(
    safe_groups,
    "safe_duplicate"
)

variant_rows = process_groups(
    variant_groups,
    "possible_variant"
)

manual_rows = process_groups(
    manual_groups,
    "manual_review"
)

proposed_remove = sum(
    len(x["proposedVariants"])
    for x in safe_rows
)

possible_variant_files = sum(
    len(x["proposedVariants"])
    for x in variant_rows
)

manual_files = sum(
    x["count"]
    for x in manual_rows
)

preview = {
    "safeGroups": len(safe_rows),
    "possibleVariantGroups": len(variant_rows),
    "manualReviewGroups": len(manual_rows),

    "safeCanonicalCount": len(safe_rows),
    "safeProposedVariantCount": proposed_remove,

    "possibleVariantFileCount": possible_variant_files,

    "manualReviewFileCount": manual_files,

    "safeGroupsData": safe_rows,
    "possibleVariantGroupsData": variant_rows,
    "manualReviewGroupsData": manual_rows,
}

OUTPUT.write_text(
    json.dumps(
        preview,
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)

print("=" * 70)
print(" FINAL DEDUP PREVIEW")
print("=" * 70)
print(
    f"Safe duplicate groups:     {len(safe_rows)}"
)
print(
    f"Safe proposed variants:    {proposed_remove}"
)
print(
    f"Possible variant groups:   {len(variant_rows)}"
)
print(
    f"Possible variant files:    {possible_variant_files}"
)
print(
    f"Manual review groups:      {len(manual_rows)}"
)
print(
    f"Manual review files:       {manual_files}"
)
print()
print(
    f"Preview: {OUTPUT}"
)
