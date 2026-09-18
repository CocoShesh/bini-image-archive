#!/usr/bin/env python3

import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(".")
INPUT = ROOT / "data/analysis/cpu-results.json"
OUTPUT = ROOT / "data/analysis/review-priority-v6.json"
CONTACT_DIR = ROOT / "data/analysis/review-v6-contact"

CONTACT_DIR.mkdir(parents=True, exist_ok=True)

R2_CACHE = (
    Path.home()
    / "Downloads"
    / "bini-r2-cache"
    / "images"
)

# These are only PRIORITY signals, never automatic rejection rules.
NOISY_QUERY_TERMS = {
    "promo",
    "podcast",
    "media",
    "merch",
    "merchandise",
    "product",
    "logo",
    "logos",
    "poster",
    "posters",
    "icon",
    "icons",
    "equipment",
    "camera",
    "microphone",
    "mic",
    "shirt",
    "t-shirt",
    "stationery",
    "toy",
    "doll",
    "diorama",
}

def resolve_file(item):
    p = Path(str(item.get("filePath") or ""))

    if p.is_file():
        return p

    storage_key = str(item.get("storageKey") or "").strip()

    if storage_key:
        cached = R2_CACHE / Path(storage_key).name
        if cached.is_file():
            return cached

    return None


def query_tokens(text):
    text = (text or "").lower()
    return {
        token.strip()
        for token in text.replace("-", " ").split()
        if token.strip()
    }


def calculate_risk(item):
    people = int(item.get("peopleDetected") or 0)

    ctx = item.get("context") or {}
    member_hits = ctx.get("memberHits") or []
    group_hits = ctx.get("groupHits") or []
    event_hits = ctx.get("eventHits") or []
    object_hits = ctx.get("objectHits") or []

    query = str(item.get("query") or "")
    tokens = query_tokens(query)

    v5 = item.get("v5") or {}
    metrics = v5.get("visualMetrics") or {}

    risk = 0
    reasons = []

    # ---------------------------------------------------------
    # No people
    # ---------------------------------------------------------
    if people == 0:
        risk += 20
        reasons.append("no_person_detected")

    # ---------------------------------------------------------
    # Generic group context without member-specific context
    # ---------------------------------------------------------
    if group_hits and not member_hits:
        risk += 20
        reasons.append("group_only_context")

    # ---------------------------------------------------------
    # Noisy query vocabulary
    # ---------------------------------------------------------
    noisy_hits = sorted(
        token for token in NOISY_QUERY_TERMS
        if token in tokens or token in query.lower()
    )

    if noisy_hits:
        risk += min(30, 10 + len(noisy_hits) * 5)
        reasons.append(
            "noisy_query:" + ",".join(noisy_hits)
        )

    # ---------------------------------------------------------
    # Product/object metadata
    # ---------------------------------------------------------
    if object_hits:
        risk += 20
        reasons.append("object_metadata")

    # ---------------------------------------------------------
    # Event-only context without member
    # ---------------------------------------------------------
    if event_hits and not member_hits:
        risk += 10
        reasons.append("event_without_member")

    # ---------------------------------------------------------
    # Very low V5 photo-likeness
    # ---------------------------------------------------------
    photo_score = int(v5.get("photoScore") or 0)

    if photo_score <= 20:
        risk += 20
        reasons.append("very_low_photo_score")
    elif photo_score <= 40:
        risk += 10
        reasons.append("low_photo_score")

    # ---------------------------------------------------------
    # Visual metrics from V5
    # ---------------------------------------------------------
    white_ratio = float(metrics.get("whiteRatio") or 0)
    color_std = float(metrics.get("colorStd") or 0)
    entropy = float(metrics.get("entropy") or 0)
    edge_density = float(metrics.get("edgeDensity") or 0)

    if white_ratio >= 0.55:
        risk += 10
        reasons.append("strong_white_background")

    if color_std < 10:
        risk += 10
        reasons.append("very_low_color_variation")

    if entropy < 4.0:
        risk += 10
        reasons.append("low_visual_entropy")

    if edge_density >= 0.09:
        risk += 5
        reasons.append("high_edge_density")

    # ---------------------------------------------------------
    # Confirmed-weak combination
    # ---------------------------------------------------------
    if (
        people == 0
        and not member_hits
        and group_hits
        and photo_score <= 40
    ):
        risk += 15
        reasons.append(
            "generic_group_context_plus_weak_visual"
        )

    risk = min(100, risk)

    if risk >= 75:
        priority = "HIGH"
    elif risk >= 50:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    return risk, priority, reasons


def make_contact_sheet(items, output, max_items=120):
    items = items[:max_items]

    if not items:
        return

    cols = 4
    tw, th = 320, 270
    rows = math.ceil(len(items) / cols)

    sheet = Image.new(
        "RGB",
        (cols * tw, rows * th),
        "white",
    )

    draw = ImageDraw.Draw(sheet)

    for i, item in enumerate(items, 1):
        x = ((i - 1) % cols) * tw
        y = ((i - 1) // cols) * th

        path = resolve_file(item)

        if path:
            try:
                img = Image.open(path).convert("RGB")
                img.thumbnail((295, 210))
                sheet.paste(img, (x + 10, y + 8))
            except Exception:
                pass

        label = (
            f"#{i}  RISK={item['v6']['risk']}"
            f"  SCORE={item['score']}"
        )

        draw.text(
            (x + 10, y + 225),
            label,
            fill="black",
        )

        draw.text(
            (x + 10, y + 245),
            item["v6"]["priority"],
            fill="black",
        )

    sheet.save(output, quality=92)


def main():
    if not INPUT.exists():
        raise SystemExit(f"Missing {INPUT}")

    data = json.loads(
        INPUT.read_text(encoding="utf-8")
    )

    review = [
        x for x in data
        if x.get("status") == "review"
    ]

    print("=" * 60)
    print(" BINI REVIEW PRIORITY V6")
    print("=" * 60)
    print(f"Review input: {len(review)}")

    output = []

    counts = {
        "HIGH": 0,
        "MEDIUM": 0,
        "LOW": 0,
    }

    for i, item in enumerate(review, 1):
        result = dict(item)

        risk, priority, reasons = calculate_risk(
            item
        )

        result["v6"] = {
            "risk": risk,
            "priority": priority,
            "reasons": reasons,
        }

        output.append(result)
        counts[priority] += 1

    output.sort(
        key=lambda x: (
            -x["v6"]["risk"],
            -int(x.get("score", 0)),
        )
    )

    OUTPUT.write_text(
        json.dumps(
            output,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    high = [
        x for x in output
        if x["v6"]["priority"] == "HIGH"
    ]

    medium = [
        x for x in output
        if x["v6"]["priority"] == "MEDIUM"
    ]

    make_contact_sheet(
        high,
        CONTACT_DIR / "high-risk.jpg",
        max_items=120,
    )

    make_contact_sheet(
        medium,
        CONTACT_DIR / "medium-risk.jpg",
        max_items=120,
    )

    print()
    print("--- REVIEW PRIORITY V6 COMPLETE ---")
    print(f"Input:  {len(review)}")
    print(f"HIGH:   {counts['HIGH']}")
    print(f"MEDIUM: {counts['MEDIUM']}")
    print(f"LOW:    {counts['LOW']}")
    print()
    print(f"Output: {OUTPUT}")
    print(
        f"High sheet: {CONTACT_DIR / 'high-risk.jpg'}"
    )
    print(
        f"Medium sheet: {CONTACT_DIR / 'medium-risk.jpg'}"
    )


if __name__ == "__main__":
    main()
