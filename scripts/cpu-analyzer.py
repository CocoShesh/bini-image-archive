#!/usr/bin/env python3

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import cv2
from PIL import Image, ImageStat


# ============================================================
# BINI CPU ANALYZER V4 FINAL
# LOCAL + R2 CACHE
# ============================================================

LIBRARY_FILE = Path("data/library.json")

OUTPUT_DIR = Path("data/analysis")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "cpu-results.json"

R2_CACHE_DIR = Path.home() / "Downloads" / "bini-r2-cache" / "images"


BINI_NAMES = {
    "aiah",
    "colet",
    "gwen",
    "jhoanna",
    "maloi",
    "mikha",
    "stacey",
    "sheena",
}

GROUP_TERMS = {
    "bini",
    "ot8",
    "bini members",
    "bini member",
}

EVENT_TERMS = {
    "concert",
    "performance",
    "festival",
    "tour",
    "mall show",
    "fan meet",
    "fan meeting",
    "fan event",
    "event",
    "events",
    "appearance",
    "public appearance",
    "interview",
    "backstage",
    "photoshoot",
    "photoshoot photos",
    "concept",
    "editorial",
    "magazine",
    "red carpet",
    "award",
    "awards",
    "press",
    "media",
    "press photos",
    "music video",
    "mv",
    "teaser",
    "promo",
    "promotion",
    "birthday",
    "comeback",
    "album",
    "single",
}

WEAK_TERMS = {
    "photo",
    "photos",
    "pics",
    "pictures",
    "hd photos",
    "hq photos",
    "high resolution",
}

OBJECT_TERMS = {
    "microphone",
    "mic",
    "headphones",
    "headset",
    "laptop",
    "tablet",
    "camera",
    "tripod",
    "recording equipment",
    "studio equipment",
    "audio equipment",
    "equipment",
}

SCENE_HINTS = {
    "concert": "concert",
    "performance": "performance",
    "festival": "festival",
    "backstage": "backstage",
    "photoshoot": "photoshoot",
    "concept": "concept shoot",
    "magazine": "editorial / magazine",
    "red carpet": "red carpet",
    "airport": "airport",
    "mall show": "mall show",
    "fan meet": "fan meeting",
    "interview": "interview",
    "radio": "radio / studio",
    "podcast": "podcast / studio",
    "studio": "studio",
}


HOG = cv2.HOGDescriptor()
HOG.setSVMDetector(
    cv2.HOGDescriptor_getDefaultPeopleDetector()
)


def clamp(value: float) -> int:
    return max(0, min(100, int(round(value))))


def normalize_item(item: dict[str, Any]) -> str:
    values = [
        item.get("title", ""),
        item.get("member", ""),
        item.get("category", ""),
        item.get("source", ""),
        item.get("pinUrl", ""),
        item.get("sourceUrl", ""),
    ]

    tags = item.get("tags") or []

    if isinstance(tags, list):
        values.extend(str(x) for x in tags)

    return " ".join(
        str(v) for v in values if v
    ).lower()


def term_hits(
    text: str,
    terms: set[str],
) -> list[str]:
    return [
        term
        for term in sorted(
            terms,
            key=len,
            reverse=True,
        )
        if re.search(
            rf"(?<!\w){re.escape(term)}(?!\w)",
            text,
        )
    ]


def detect_scene(text: str) -> str | None:
    for term, scene_name in sorted(
        SCENE_HINTS.items(),
        key=lambda x: len(x[0]),
        reverse=True,
    ):
        if re.search(
            rf"(?<!\w){re.escape(term)}(?!\w)",
            text,
        ):
            return scene_name

    return None


# ============================================================
# FILE RESOLUTION
# ============================================================

def local_path_for(item: dict[str, Any]) -> Path | None:
    raw = str(
        item.get("localPath") or ""
    ).strip()

    if not raw:
        return None

    if raw.startswith("/library/"):
        raw = str(
            Path("public") / raw.lstrip("/")
        )

    path = Path(raw)

    if path.is_file():
        return path

    return None


def cache_path_for(item: dict[str, Any]) -> Path | None:
    """
    Resolve archived R2 object from the local cache.

    Example storageKey:
        images/abc123.webp

    Cache:
        ~/Downloads/bini-r2-cache/images/abc123.webp
    """

    storage_key = str(
        item.get("storageKey") or ""
    ).strip()

    if not storage_key:
        return None

    filename = Path(storage_key).name

    if not filename:
        return None

    candidate = (
        R2_CACHE_DIR / filename
    )

    if candidate.is_file():
        return candidate

    return None


def resolve_image(
    item: dict[str, Any],
) -> tuple[Path | None, str]:
    """
    Resolution priority:

    1. Existing localPath
    2. Local R2 cache using storageKey
    3. unavailable

    No network downloads are performed during analysis.
    """

    local = local_path_for(item)

    if local is not None:
        return local, "local"

    cached = cache_path_for(item)

    if cached is not None:
        return cached, "r2-cache"

    return None, "missing"


# ============================================================
# COMPUTER VISION
# ============================================================

def detect_people(
    img,
    width: int,
    height: int,
) -> int:

    max_dimension = 900

    scale = min(
        1.0,
        max_dimension /
        max(width, height),
    )

    if scale < 1:
        img = cv2.resize(
            img,
            (
                max(
                    1,
                    int(width * scale),
                ),
                max(
                    1,
                    int(height * scale),
                ),
            ),
            interpolation=cv2.INTER_AREA,
        )

    try:
        boxes, weights = (
            HOG.detectMultiScale(
                img,
                winStride=(8, 8),
                padding=(8, 8),
                scale=1.05,
            )
        )

        return len(boxes)

    except Exception:
        return 0


# ============================================================
# ANALYSIS
# ============================================================

def analyze(
    item: dict[str, Any],
) -> dict[str, Any]:

    base = {
        "id": item.get("id"),
        "source": item.get("source"),
        "query": item.get("title", ""),
        "member_hint": item.get("member") or "",
        "year": item.get("year"),
        "category": item.get("category", ""),
        "tags": item.get("tags", []),
        "pinUrl": item.get("pinUrl", ""),
        "sourceUrl": item.get("sourceUrl", ""),
        "imageUrl": item.get("imageUrl", ""),
        "storageKey": item.get("storageKey", ""),
        "storageUrl": item.get("storageUrl", ""),
        "filePath": "",
        "fileSource": "",
        "status": "failed",
        "score": 0,
        "scoreBreakdown": {},
        "peopleDetected": 0,
        "peopleLikely": False,
        "sceneHint": None,
        "objectOnlyCandidate": False,
        "quality": {},
        "context": {},
        "description": "",
        "reasons": [],
        "analyzedAt": time.strftime(
            "%Y-%m-%dT%H:%M:%SZ",
            time.gmtime(),
        ),
    }

    try:

        # ----------------------------------------------------
        # Resolve local / cached R2 file
        # ----------------------------------------------------

        image_path, file_source = (
            resolve_image(item)
        )

        if image_path is None:
            base.update(
                {
                    "status": "skipped",
                    "fileSource": "missing",
                    "reasons": [
                        "local_and_r2_cache_file_unavailable"
                    ],
                }
            )

            return base

        base["filePath"] = str(
            image_path
        )

        base["fileSource"] = file_source

        # ----------------------------------------------------
        # Open image
        # ----------------------------------------------------

        pil = Image.open(
            image_path
        ).convert("RGB")

        width, height = pil.size

        img = cv2.imread(
            str(image_path)
        )

        if img is None:
            raise RuntimeError(
                "OpenCV could not decode image"
            )

        # ----------------------------------------------------
        # Image quality metrics
        # ----------------------------------------------------

        gray = cv2.cvtColor(
            img,
            cv2.COLOR_BGR2GRAY,
        )

        blur_score = float(
            cv2.Laplacian(
                gray,
                cv2.CV_64F,
            ).var()
        )

        contrast = float(
            cv2.meanStdDev(
                gray
            )[1][0][0]
        )

        brightness = float(
            sum(
                ImageStat.Stat(
                    pil
                ).mean
            ) / 3
        )

        # ----------------------------------------------------
        # Metadata context
        # ----------------------------------------------------

        text = normalize_item(item)

        member_hits = term_hits(
            text,
            BINI_NAMES,
        )

        group_hits = term_hits(
            text,
            GROUP_TERMS,
        )

        event_hits = term_hits(
            text,
            EVENT_TERMS,
        )

        weak_hits = term_hits(
            text,
            WEAK_TERMS,
        )

        object_hits = term_hits(
            text,
            OBJECT_TERMS,
        )

        # ----------------------------------------------------
        # People
        # ----------------------------------------------------

        people_count = detect_people(
            img,
            width,
            height,
        )

        # ----------------------------------------------------
        # Metadata context score
        # ----------------------------------------------------

        context_score = 0

        if member_hits:
            context_score += 15

        if group_hits:
            context_score += 14

        if event_hits:
            context_score += min(
                8,
                4 + len(event_hits),
            )

        if (
            weak_hits
            and not (
                member_hits
                or group_hits
                or event_hits
            )
        ):
            context_score += 1

        # ----------------------------------------------------
        # People score
        # ----------------------------------------------------

        people_score = {
            0: 0,
            1: 38,
            2: 42,
        }.get(
            people_count,
            48,
        )

        # ----------------------------------------------------
        # Quality
        # ----------------------------------------------------

        quality_score = 0

        min_dimension = min(
            width,
            height,
        )

        if min_dimension >= 1200:
            quality_score += 8

        elif min_dimension >= 800:
            quality_score += 6

        elif min_dimension >= 500:
            quality_score += 3

        else:
            quality_score -= 5

        if blur_score >= 120:
            quality_score += 5

        elif blur_score >= 60:
            quality_score += 3

        elif blur_score < 20:
            quality_score -= 8

        if 20 <= brightness <= 245:
            quality_score += 2

        else:
            quality_score -= 2

        if contrast >= 25:
            quality_score += 2

        elif contrast < 10:
            quality_score -= 2

        # ----------------------------------------------------
        # Visual context
        # ----------------------------------------------------

        if member_hits:
            visual_context = 15

        elif group_hits:
            visual_context = 12

        elif (
            event_hits
            and people_count > 0
        ):
            visual_context = 7

        else:
            visual_context = 0

        # ----------------------------------------------------
        # Object penalty
        # ----------------------------------------------------

        object_penalty = 0

        if people_count == 0:
            object_penalty -= 18

        if (
            object_hits
            and people_count == 0
        ):
            object_penalty -= 20

        # ----------------------------------------------------
        # Final score
        # ----------------------------------------------------

        score = clamp(
            45
            + people_score
            + quality_score
            + visual_context
            + context_score
            + object_penalty
        )

        object_only = (
            people_count == 0
        )

        scene_hint = detect_scene(
            text
        )

        # ----------------------------------------------------
        # Reasons
        # ----------------------------------------------------

        reasons = []

        if people_count > 0:
            reasons.append(
                "person_detected"
            )
        else:
            reasons.append(
                "no_person_detected"
            )

        if people_count >= 3:
            reasons.append(
                "group_photo_signal"
            )

        if member_hits:
            reasons.append(
                "member_context"
            )

        if group_hits:
            reasons.append(
                "group_context"
            )

        if event_hits:
            reasons.append(
                "event_context"
            )

        if object_hits:
            reasons.append(
                "object_terms_present"
            )

        if object_only:
            reasons.append(
                "object_only_candidate"
            )

        if blur_score < 20:
            reasons.append(
                "very_blurry"
            )

        if min_dimension < 500:
            reasons.append(
                "low_resolution"
            )

        reasons.append(
            f"file_source:{file_source}"
        )

        # ----------------------------------------------------
        # Status
        #
        # HOG is supporting evidence only.
        # It does NOT gate ACCEPT.
        # ----------------------------------------------------

        status = (
            "accept"
            if score >= 78
            else "review"
            if score >= 45
            else "reject"
        )

        # Hard reject object-only images
        # when there is no BINI/member/group context.
        if object_only and not (
            member_hits
            or group_hits
        ):
            status = "reject"

        # ----------------------------------------------------
        # Description
        # ----------------------------------------------------

        if people_count == 1:
            subject_text = (
                "single-person image"
            )

        elif people_count > 1:
            subject_text = (
                "group/person image with "
                f"about {people_count} "
                "detected people"
            )

        else:
            subject_text = (
                "image with no confidently "
                "detected person"
            )

        orientation = (
            "portrait"
            if height > width
            else "landscape"
            if width > height
            else "square"
        )

        scene_text = (
            f" in a {scene_hint} setting"
            if scene_hint
            else ""
        )

        description = (
            f"This is a {subject_text}"
            f"{scene_text}. "
            f"The image is {orientation} "
            f"({width}×{height})."
        )

        # ----------------------------------------------------
        # Output
        # ----------------------------------------------------

        base.update(
            {
                "status": status,
                "score": score,
                "scoreBreakdown": {
                    "baseline": 45,
                    "people": people_score,
                    "quality": quality_score,
                    "visualContext": visual_context,
                    "metadataContext": context_score,
                    "objectPenalty": object_penalty,
                },
                "peopleDetected": people_count,
                "peopleLikely": (
                    people_count > 0
                ),
                "sceneHint": scene_hint,
                "objectOnlyCandidate": object_only,
                "quality": {
                    "width": width,
                    "height": height,
                    "blurScore": round(
                        blur_score,
                        2,
                    ),
                    "brightness": round(
                        brightness,
                        2,
                    ),
                    "contrast": round(
                        contrast,
                        2,
                    ),
                    "resolutionClass": (
                        "high"
                        if min_dimension >= 1200
                        else "medium"
                        if min_dimension >= 800
                        else "low"
                    ),
                },
                "context": {
                    "memberHits": member_hits,
                    "groupHits": group_hits,
                    "eventHits": event_hits,
                    "weakHits": weak_hits,
                    "objectHits": object_hits,
                    "contextScore": context_score,
                },
                "description": description,
                "reasons": reasons,
            }
        )

        return base

    except Exception as error:

        base["status"] = "failed"

        base["reasons"] = [
            f"analysis_error: {error}"
        ]

        return base


# ============================================================
# MAIN
# ============================================================

def main():

    limit = (
        int(sys.argv[1])
        if len(sys.argv) > 1
        else 50
    )

    if not LIBRARY_FILE.exists():
        raise SystemExit(
            f"Missing {LIBRARY_FILE}"
        )

    library = json.loads(
        LIBRARY_FILE.read_text(
            encoding="utf-8"
        )
    )

    total = min(
        limit,
        len(library),
    )

    results = []

    counts = {
        "accept": 0,
        "review": 0,
        "reject": 0,
        "failed": 0,
        "skipped": 0,
    }

    print(
        "========================================"
    )

    print(
        " BINI CPU ANALYZER V4 FINAL"
    )

    print(
        "========================================"
    )

    print(
        f"Library : {len(library)}"
    )

    print(
        f"Testing : {total}"
    )

    print()

    for index, item in enumerate(
        library[:total],
        1,
    ):

        result = analyze(item)

        results.append(result)

        status = result["status"]

        counts[status] = (
            counts.get(status, 0) + 1
        )

        print(
            f"[CPU] "
            f"{index}/{total} "
            f"{status:<7} "
            f"score={result['score']:>3} "
            f"people={result['peopleDetected']} "
            f"member="
            f"{len(result['context'].get('memberHits', []))} "
            f"group="
            f"{len(result['context'].get('groupHits', []))} "
            f"source="
            f"{result['fileSource']}"
        )

        # Save periodic batch output
        if index % 25 == 0:
            OUTPUT_FILE.write_text(
                json.dumps(
                    results,
                    indent=2,
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

    OUTPUT_FILE.write_text(
        json.dumps(
            results,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    print()

    print(
        "--- CPU ANALYSIS V4 FINAL COMPLETE ---"
    )

    print(
        f"Analyzed: {len(results)}"
    )

    print(
        f"Accept:   {counts['accept']}"
    )

    print(
        f"Review:   {counts['review']}"
    )

    print(
        f"Reject:   {counts['reject']}"
    )

    print(
        f"Failed:   {counts['failed']}"
    )

    print(
        f"Skipped:  {counts['skipped']}"
    )

    print(
        f"Output:   {OUTPUT_FILE}"
    )


if __name__ == "__main__":
    main()
