#!/usr/bin/env python3

import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any

import cv2
from PIL import Image, ImageStat


# ============================================================
# BINI CPU ANALYZER V4 FINAL
# ============================================================

LIBRARY_FILE = Path("data/library.json")

OUTPUT_DIR = Path("data/analysis")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_FILE = OUTPUT_DIR / "cpu-results.json"

# Persistent local cache for R2-backed images.
# Kept outside the repo by default because this can grow very large.
CACHE_DIR = Path(
    os.environ.get(
        "BINI_R2_CACHE_DIR",
        str(Path.home() / "Downloads" / "bini-r2-cache" / "images"),
    )
)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

CHECKPOINT_FILE = OUTPUT_DIR / "cpu-checkpoint.json"
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

# CPU-friendly person detector
HOG = cv2.HOGDescriptor()
HOG.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())


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

    return " ".join(str(v) for v in values if v).lower()


def term_hits(text: str, terms: set[str]) -> list[str]:
    return [
        term
        for term in sorted(terms, key=len, reverse=True)
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text)
    ]


def detect_scene(text: str) -> str | None:
    for term, scene_name in sorted(
        SCENE_HINTS.items(),
        key=lambda x: len(x[0]),
        reverse=True,
    ):
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text):
            return scene_name

    return None


# ============================================================
# FILE RESOLUTION
# ============================================================

def path_for(item: dict[str, Any]) -> Path | None:
    """
    Resolve an existing local file.

    Priority:
      1. localPath
      2. nothing

    R2 fallback is handled separately.
    """

    raw_path = str(item.get("localPath") or "").strip()

    if not raw_path:
        return None

    if raw_path.startswith("/library/"):
        raw_path = str(Path("public") / raw_path.lstrip("/"))

    path = Path(raw_path)

    if path.is_file():
        return path

    return None


def cache_key_for(item: dict[str, Any]) -> str | None:
    """
    Return a stable cache key.

    The crawler already stores both id and sha256. Prefer sha256,
    then fall back to id.
    """

    value = str(
        item.get("sha256")
        or item.get("id")
        or ""
    ).strip()

    if not value:
        return None

    if re.fullmatch(r"[0-9a-fA-F]{64}", value):
        return value.lower()

    return hashlib.sha256(
        value.encode("utf-8")
    ).hexdigest()


def download_r2_cached(item: dict[str, Any]) -> Path | None:
    """
    Resolve an R2-backed image through persistent local cache.

    Priority:
      1. existing cache file
      2. storageUrl
      3. src
      4. imageUrl

    Downloads are written to a .part file and atomically renamed.
    """

    cache_key = cache_key_for(item)

    if not cache_key:
        return None

    cache_path = CACHE_DIR / f"{cache_key}.webp"

    # Cache hit: no R2 request.
    if cache_path.is_file() and cache_path.stat().st_size > 0:
        print(f"[CACHE] hit {cache_key[:12]}")
        return cache_path

    urls = [
        item.get("storageUrl"),
        item.get("src"),
        item.get("imageUrl"),
    ]

    url = next(
        (
            str(value).strip()
            for value in urls
            if value and str(value).strip()
        ),
        "",
    )

    if not url:
        return None

    partial_path = CACHE_DIR / f".{cache_key}.webp.part"

    try:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 "
                    "(X11; Linux x86_64) "
                    "AppleWebKit/537.36 "
                    "Chrome/153 Safari/537.36"
                )
            },
        )

        with urllib.request.urlopen(
            request,
            timeout=45,
        ) as response:
            data = response.read()

        if not data:
            return None

        partial_path.write_bytes(data)
        partial_path.replace(cache_path)

        print(
            f"[CACHE] miss/download "
            f"{cache_key[:12]}"
        )

        return cache_path

    except Exception as error:
        print(
            f"[CACHE] download failed "
            f"{cache_key[:12]}: {error}"
        )

        try:
            partial_path.unlink(
                missing_ok=True
            )
        except Exception:
            pass

        return None


def resolve_image(
    item: dict[str, Any],
) -> Path | None:
    """
    Resolve an image.

    Priority:
      1. existing localPath
      2. persistent R2 cache
      3. download into persistent R2 cache
    """

    local_path = path_for(item)

    if local_path is not None:
        return local_path

    return download_r2_cached(item)


# ============================================================
# COMPUTER VISION
# ============================================================

def detect_people(img, width: int, height: int) -> int:
    max_dimension = 900

    scale = min(
        1.0,
        max_dimension / max(width, height),
    )

    if scale < 1:
        img = cv2.resize(
            img,
            (
                max(1, int(width * scale)),
                max(1, int(height * scale)),
            ),
            interpolation=cv2.INTER_AREA,
        )

    try:
        boxes, weights = HOG.detectMultiScale(
            img,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )

        return len(boxes)

    except Exception:
        return 0


# ============================================================
# ANALYSIS
# ============================================================

def analyze(item: dict[str, Any]) -> dict[str, Any]:

    base = {
        "id": item.get("id"),
        "source": item.get("source"),
        "query": item.get("title", ""),
        "member_hint": item.get("member") or "",
        "year": item.get("year"),
        "category": item.get("category", ""),
        "tags": item.get("tags", []),
        "pinUrl": item.get("pinUrl", ""),
        "filePath": str(item.get("localPath") or ""),
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

    image_path = None

    try:

        # ----------------------------------------------------
        # Resolve local or R2 image
        # ----------------------------------------------------

        image_path = resolve_image(item)

        if image_path is None:
            base.update(
                {
                    "status": "skipped",
                    "reasons": [
                        "local_and_r2_file_unavailable"
                    ],
                }
            )

            return base

        base["filePath"] = str(image_path)

        # ----------------------------------------------------
        # Load image
        # ----------------------------------------------------

        pil = Image.open(image_path).convert("RGB")

        width, height = pil.size

        img = cv2.imread(str(image_path))

        if img is None:
            raise RuntimeError(
                "OpenCV could not decode image"
            )

        # ----------------------------------------------------
        # Image metrics
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
            cv2.meanStdDev(gray)[1][0][0]
        )

        brightness = float(
            sum(ImageStat.Stat(pil).mean) / 3
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
        # Person detection
        # ----------------------------------------------------

        people_count = detect_people(
            img,
            width,
            height,
        )

        # ----------------------------------------------------
        # Context score
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

        if weak_hits and not (
            member_hits
            or group_hits
            or event_hits
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

        elif event_hits and people_count > 0:
            visual_context = 7

        else:
            visual_context = 0

        # ----------------------------------------------------
        # Object penalty
        # ----------------------------------------------------

        object_penalty = 0

        if people_count == 0:
            object_penalty -= 18

        if object_hits and people_count == 0:
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

        object_only = people_count == 0

        scene_hint = detect_scene(text)

        # ----------------------------------------------------
        # Reasons
        # ----------------------------------------------------

        reasons = []

        if people_count > 0:
            reasons.append("person_detected")
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
            reasons.append("very_blurry")

        if min_dimension < 500:
            reasons.append(
                "low_resolution"
            )

        # ----------------------------------------------------
        # Status
        #
        # People detection is ONLY a supporting signal.
        # It does NOT gate ACCEPT.
        # ----------------------------------------------------

        status = (
            "accept"
            if score >= 78
            else "review"
            if score >= 45
            else "reject"
        )

        # Hard reject only if:
        #   no person
        #   AND no member/group context
        #
        # This prevents unrelated object-only images.
        if object_only and not (
            member_hits or group_hits
        ):
            status = "reject"

        # ----------------------------------------------------
        # Description
        # ----------------------------------------------------

        if people_count == 1:
            subject_text = "single-person image"

        elif people_count > 1:
            subject_text = (
                f"group/person image with about "
                f"{people_count} detected people"
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
        # Result
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
                "peopleLikely": people_count > 0,
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

def library_signature(
    library: list[dict[str, Any]],
) -> str:
    """
    Stable signature for the current library ordering.

    This prevents a checkpoint from being reused against a
    materially different library.
    """

    ids = [
        str(
            item.get("id")
            or item.get("sha256")
            or ""
        )
        for item in library
    ]

    payload = json.dumps(
        ids,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    return hashlib.sha256(
        payload.encode("utf-8")
    ).hexdigest()


def save_checkpoint(
    signature: str,
    next_index: int,
) -> None:
    CHECKPOINT_FILE.write_text(
        json.dumps(
            {
                "version": 1,
                "signature": signature,
                "nextIndex": next_index,
                "updatedAt": time.strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                    time.gmtime(),
                ),
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def save_results(
    results: list[dict[str, Any]],
) -> None:
    OUTPUT_FILE.write_text(
        json.dumps(
            results,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def rebuild_counts(
    results: list[dict[str, Any]],
) -> dict[str, int]:
    counts = {
        "accept": 0,
        "review": 0,
        "reject": 0,
        "failed": 0,
        "skipped": 0,
    }

    for result in results:
        status = result.get("status")
        if status in counts:
            counts[status] += 1

    return counts


def main():

    # Preserve the original CLI behavior:
    #   python script.py 50
    # analyzes the first 50 library items.
    # On a later run, the checkpoint resumes from where
    # the previous run safely saved.
    limit = (
        int(sys.argv[1])
        if len(sys.argv) > 1
        else 50
    )

    if limit < 1:
        raise SystemExit(
            "Limit must be >= 1"
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

    if not isinstance(library, list):
        raise SystemExit(
            f"{LIBRARY_FILE} must contain a JSON array"
        )

    total = min(
        limit,
        len(library),
    )

    signature = library_signature(
        library
    )

    results: list[dict[str, Any]] = []
    checkpoint_next = 0

    # --------------------------------------------------------
    # Resume existing checkpoint only when it matches the
    # current library ordering.
    # --------------------------------------------------------

    if (
        OUTPUT_FILE.exists()
        and CHECKPOINT_FILE.exists()
    ):
        try:
            previous_checkpoint = json.loads(
                CHECKPOINT_FILE.read_text(
                    encoding="utf-8"
                )
            )

            previous_results = json.loads(
                OUTPUT_FILE.read_text(
                    encoding="utf-8"
                )
            )

            if (
                previous_checkpoint.get(
                    "signature"
                )
                == signature
                and isinstance(
                    previous_results,
                    list,
                )
            ):
                results = previous_results

                checkpoint_next = int(
                    previous_checkpoint.get(
                        "nextIndex",
                        0,
                    )
                )

                print(
                    f"[CHECKPOINT] resume "
                    f"at {checkpoint_next}"
                )

            else:
                print(
                    "[CHECKPOINT] library changed; "
                    "starting from 0"
                )

        except Exception as error:
            print(
                f"[CHECKPOINT] invalid/ignored: "
                f"{error}"
            )

    # Never let the result list contain more records than
    # the verified checkpoint or requested total.
    checkpoint_next = min(
        checkpoint_next,
        total,
    )

    if len(results) > checkpoint_next:
        results = results[:checkpoint_next]

    start_index = checkpoint_next

    counts = rebuild_counts(
        results
    )

    print("========================================")
    print(" BINI CPU ANALYZER V4 FINAL")
    print("========================================")
    print(f"Library : {len(library)}")
    print(f"Testing : {total}")
    print(f"Resume  : {start_index}")
    print(f"Cache   : {CACHE_DIR}")
    print()

    if start_index >= total:
        print(
            "Nothing new to analyze for this limit."
        )
        print(
            f"Output: {OUTPUT_FILE}"
        )
        print(
            f"Cache : {CACHE_DIR}"
        )
        return

    for index in range(
        start_index,
        total,
    ):

        item = library[index]

        result = analyze(item)

        results.append(result)

        status = result["status"]

        counts.setdefault(status, 0)
        counts[status] += 1

        print(
            f"[CPU] "
            f"{index + 1}/{total} "
            f"{status:<7} "
            f"score={result['score']:>3} "
            f"people={result['peopleDetected']} "
            f"member="
            f"{len(result['context'].get('memberHits', []))} "
            f"group="
            f"{len(result['context'].get('groupHits', []))}"
        )

        # Save output + checkpoint together every 25 items.
        if (index + 1) % 25 == 0:
            save_results(
                results
            )

            save_checkpoint(
                signature,
                index + 1,
            )

            print(
                f"[CHECKPOINT] saved "
                f"at {index + 1}"
            )

    # Final save + final checkpoint.
    save_results(
        results
    )

    save_checkpoint(
        signature,
        total,
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

    print(
        f"Cache:    {CACHE_DIR}"
    )


if __name__ == "__main__":
    main()
