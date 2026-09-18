#!/usr/bin/env python3

import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(".")
INPUT = ROOT / "data/analysis/cpu-results.json"
OUTPUT = ROOT / "data/analysis/review-v5-results.json"

CONTACT_DIR = ROOT / "data/analysis/review-v5-contact"
CONTACT_DIR.mkdir(parents=True, exist_ok=True)

R2_CACHE = (
    Path.home()
    / "Downloads"
    / "bini-r2-cache"
    / "images"
)


def clamp(v):
    return max(0, min(100, int(round(v))))


def resolve_file(item):
    path = Path(str(item.get("filePath") or ""))

    if path.is_file():
        return path

    storage_key = str(
        item.get("storageKey") or ""
    ).strip()

    if storage_key:
        candidate = (
            R2_CACHE
            / Path(storage_key).name
        )

        if candidate.is_file():
            return candidate

    return None


def visual_metrics(path):
    img = cv2.imread(str(path))

    if img is None:
        raise RuntimeError(
            "OpenCV could not decode image"
        )

    h, w = img.shape[:2]

    rgb = cv2.cvtColor(
        img,
        cv2.COLOR_BGR2RGB
    )

    gray = cv2.cvtColor(
        img,
        cv2.COLOR_BGR2GRAY
    )

    # --------------------------------------------------------
    # White / near-white background ratio
    # --------------------------------------------------------

    white_mask = (
        (rgb[:, :, 0] >= 245)
        & (rgb[:, :, 1] >= 245)
        & (rgb[:, :, 2] >= 245)
    )

    white_ratio = float(
        white_mask.mean()
    )

    # --------------------------------------------------------
    # Colorfulness
    # --------------------------------------------------------

    rgb_float = rgb.astype(np.float32)

    color_std = float(
        np.mean(
            np.std(
                rgb_float,
                axis=2
            )
        )
    )

    # --------------------------------------------------------
    # Edge density
    # --------------------------------------------------------

    edges = cv2.Canny(
        gray,
        80,
        160
    )

    edge_density = float(
        np.mean(edges > 0)
    )

    # --------------------------------------------------------
    # Texture / blur
    # --------------------------------------------------------

    texture = float(
        cv2.Laplacian(
            gray,
            cv2.CV_64F
        ).var()
    )

    # --------------------------------------------------------
    # Brightness
    # --------------------------------------------------------

    brightness = float(
        np.mean(gray)
    )

    # --------------------------------------------------------
    # Contrast
    # --------------------------------------------------------

    contrast = float(
        np.std(gray)
    )

    # --------------------------------------------------------
    # Saturation
    # --------------------------------------------------------

    hsv = cv2.cvtColor(
        img,
        cv2.COLOR_BGR2HSV
    )

    saturation = float(
        np.mean(hsv[:, :, 1])
    )

    # --------------------------------------------------------
    # Grayscale histogram entropy
    # --------------------------------------------------------

    hist = cv2.calcHist(
        [gray],
        [0],
        None,
        [256],
        [0, 256]
    ).flatten()

    hist_sum = hist.sum()

    if hist_sum > 0:
        probs = hist / hist_sum
        probs = probs[probs > 0]
        entropy = float(
            -(probs * np.log2(probs)).sum()
        )
    else:
        entropy = 0.0

    return {
        "width": w,
        "height": h,
        "whiteRatio": round(white_ratio, 4),
        "colorStd": round(color_std, 2),
        "edgeDensity": round(edge_density, 4),
        "texture": round(texture, 2),
        "brightness": round(brightness, 2),
        "contrast": round(contrast, 2),
        "saturation": round(saturation, 2),
        "entropy": round(entropy, 2),
    }


def classify(item, metrics):
    people = int(
        item.get("peopleDetected") or 0
    )

    member_hits = item.get(
        "context", {}
    ).get("memberHits", [])

    group_hits = item.get(
        "context", {}
    ).get("groupHits", [])

    event_hits = item.get(
        "context", {}
    ).get("eventHits", [])

    object_hits = item.get(
        "context", {}
    ).get("objectHits", [])

    member_context = bool(member_hits)
    group_context = bool(group_hits)

    white = metrics["whiteRatio"]
    color = metrics["colorStd"]
    edges = metrics["edgeDensity"]
    texture = metrics["texture"]
    contrast = metrics["contrast"]
    saturation = metrics["saturation"]
    entropy = metrics["entropy"]

    # ========================================================
    # GRAPHIC SCORE
    # ========================================================

    graphic_score = 0

    if people == 0:
        graphic_score += 20

    if white >= 0.55:
        graphic_score += 25
    elif white >= 0.40:
        graphic_score += 15
    elif white >= 0.28:
        graphic_score += 8

    if color < 20:
        graphic_score += 15
    elif color < 35:
        graphic_score += 8

    if edges >= 0.045:
        graphic_score += 20
    elif edges >= 0.030:
        graphic_score += 10

    if entropy < 5.0:
        graphic_score += 10

    if saturation < 45:
        graphic_score += 5

    # ========================================================
    # PRODUCT / OBJECT SCORE
    # ========================================================

    product_score = 0

    if people == 0:
        product_score += 20

    if white >= 0.35:
        product_score += 20

    if contrast >= 25:
        product_score += 10

    if texture >= 40:
        product_score += 10

    if object_hits:
        product_score += 30

    # Product/object images are especially suspicious when
    # only generic GROUP / OT8 context exists.
    if group_context and not member_context:
        product_score += 10

    product_score = clamp(product_score)

    # ========================================================
    # PHOTO-LIKE SCORE
    # ========================================================

    photo_score = 0

    if people > 0:
        photo_score += 45

    if color >= 35:
        photo_score += 15

    if saturation >= 55:
        photo_score += 10

    if entropy >= 6.0:
        photo_score += 10

    if texture >= 60:
        photo_score += 10

    if white < 0.45:
        photo_score += 10

    photo_score = clamp(photo_score)

    # ========================================================
    # DECISION
    # ========================================================

    reasons = []

    if people > 0:
        reasons.append(
            "person_detected"
        )

    if member_context:
        reasons.append(
            "member_context"
        )

    if group_context:
        reasons.append(
            "group_context"
        )

    if event_hits:
        reasons.append(
            "event_context"
        )

    if object_hits:
        reasons.append(
            "object_metadata"
        )

    if white >= 0.55:
        reasons.append(
            "strong_white_background"
        )

    if color < 20:
        reasons.append(
            "low_color_variation"
        )

    if edges >= 0.045:
        reasons.append(
            "high_edge_density"
        )

    # --------------------------------------------------------
    # Strong graphic/product candidate
    # --------------------------------------------------------

    strong_false_positive = (
        people == 0
        and not member_context
        and (
            graphic_score >= 65
            or product_score >= 70
        )
    )

    # --------------------------------------------------------
    # Moderate candidate
    # --------------------------------------------------------

    moderate_false_positive = (
        people == 0
        and not member_context
        and (
            graphic_score >= 50
            or product_score >= 55
        )
    )

    if strong_false_positive:
        decision = "reject_candidate"
        priority = "high"

    elif moderate_false_positive:
        decision = "review_candidate"
        priority = "medium"

    else:
        decision = "keep_review"
        priority = "low"

    return {
        "decision": decision,
        "priority": priority,
        "graphicScore": graphic_score,
        "productScore": product_score,
        "photoScore": photo_score,
        "reasons": reasons,
    }


def make_contact_sheet(
    items,
    output,
    title
):
    if not items:
        return

    cols = 4
    tw = 320
    th = 270

    rows = math.ceil(
        len(items) / cols
    )

    sheet = Image.new(
        "RGB",
        (
            cols * tw,
            rows * th
        ),
        "white"
    )

    draw = ImageDraw.Draw(
        sheet
    )

    for index, item in enumerate(
        items,
        1
    ):
        x = (
            (index - 1) % cols
        ) * tw

        y = (
            (index - 1) // cols
        ) * th

        path = resolve_file(
            item
        )

        if path:
            try:
                img = Image.open(
                    path
                ).convert("RGB")

                img.thumbnail(
                    (295, 215)
                )

                sheet.paste(
                    img,
                    (
                        x + 12,
                        y + 8
                    )
                )

            except Exception:
                pass

        label = (
            f"#{index} "
            f"v5={item['v5']['decision']} "
            f"g={item['v5']['graphicScore']} "
            f"p={item['v5']['productScore']}"
        )

        draw.text(
            (
                x + 12,
                y + 232
            ),
            label,
            fill="black"
        )

    sheet.save(
        output,
        quality=92
    )


def main():
    if not INPUT.exists():
        raise SystemExit(
            f"Missing {INPUT}"
        )

    data = json.loads(
        INPUT.read_text(
            encoding="utf-8"
        )
    )

    review = [
        item for item in data
        if item.get("status") == "review"
    ]

    print("=" * 60)
    print(" BINI REVIEW FILTER V5")
    print("=" * 60)
    print(
        f"Review input: {len(review)}"
    )

    output = []

    counts = {
        "reject_candidate": 0,
        "review_candidate": 0,
        "keep_review": 0,
        "failed": 0,
    }

    for index, item in enumerate(
        review,
        1
    ):
        result = dict(item)

        path = resolve_file(
            item
        )

        if path is None:
            result["v5"] = {
                "decision": "keep_review",
                "priority": "high",
                "graphicScore": 0,
                "productScore": 0,
                "photoScore": 0,
                "reasons": [
                    "image_file_unavailable"
                ],
            }

            counts["keep_review"] += 1
            output.append(result)
            continue

        try:
            metrics = visual_metrics(
                path
            )

            classification = classify(
                item,
                metrics
            )

            result["v5"] = {
                **classification,
                "visualMetrics": metrics,
            }

            counts[
                classification["decision"]
            ] += 1

        except Exception as error:
            result["v5"] = {
                "decision": "keep_review",
                "priority": "high",
                "graphicScore": 0,
                "productScore": 0,
                "photoScore": 0,
                "reasons": [
                    f"analysis_error: {error}"
                ],
            }

            counts["failed"] += 1

        output.append(result)

        if index % 100 == 0:
            print(
                f"[V5] {index}/{len(review)}"
            )

    OUTPUT.write_text(
        json.dumps(
            output,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )

    reject_candidates = [
        x for x in output
        if x["v5"]["decision"]
        == "reject_candidate"
    ]

    review_candidates = [
        x for x in output
        if x["v5"]["decision"]
        == "review_candidate"
    ]

    make_contact_sheet(
        reject_candidates,
        CONTACT_DIR
        / "reject-candidates.jpg",
        "Reject Candidates"
    )

    make_contact_sheet(
        review_candidates,
        CONTACT_DIR
        / "review-candidates.jpg",
        "Review Candidates"
    )

    print()
    print(
        "--- REVIEW FILTER V5 COMPLETE ---"
    )
    print(
        f"Input review:       {len(review)}"
    )
    print(
        f"Reject candidates:  {counts['reject_candidate']}"
    )
    print(
        f"Review candidates:  {counts['review_candidate']}"
    )
    print(
        f"Keep review:        {counts['keep_review']}"
    )
    print(
        f"Failed:             {counts['failed']}"
    )
    print()
    print(
        f"Output: {OUTPUT}"
    )
    print(
        f"Reject sheet: "
        f"{CONTACT_DIR / 'reject-candidates.jpg'}"
    )
    print(
        f"Review sheet: "
        f"{CONTACT_DIR / 'review-candidates.jpg'}"
    )


if __name__ == "__main__":
    main()
