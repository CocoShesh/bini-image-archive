#!/usr/bin/env python3

import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(".")
LIBRARY_FILE = ROOT / "data/library.json"
RESULT_FILE = ROOT / "data/analysis/cpu-results.json"

OUTPUT_DIR = ROOT / "data/analysis/duplicates"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

EXACT_OUTPUT = OUTPUT_DIR / "exact-duplicates.json"
NEAR_OUTPUT = OUTPUT_DIR / "near-duplicates.json"
SUMMARY_OUTPUT = OUTPUT_DIR / "duplicate-summary.json"

R2_CACHE = (
    Path.home()
    / "Downloads"
    / "bini-r2-cache"
    / "images"
)

# Conservative thresholds.
PHASH_NEAR_THRESHOLD = 10
DHASH_NEAR_THRESHOLD = 14
PHASH_STRONG_THRESHOLD = 6


# ============================================================
# FILE RESOLUTION
# ============================================================

def resolve_file(item):
    path = Path(str(item.get("filePath") or ""))

    if path.is_file():
        return path

    storage_key = str(
        item.get("storageKey") or ""
    ).strip()

    if storage_key:
        candidate = (
            R2_CACHE / Path(storage_key).name
        )

        if candidate.is_file():
            return candidate

    local_path = str(
        item.get("localPath") or ""
    ).strip()

    if local_path.startswith("/library/"):
        candidate = ROOT / "public" / local_path.lstrip("/")

        if candidate.is_file():
            return candidate

    return None


# ============================================================
# EXACT HASH
# ============================================================

def sha256_file(path):
    digest = hashlib.sha256()

    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)

            if not chunk:
                break

            digest.update(chunk)

    return digest.hexdigest()


# ============================================================
# PERCEPTUAL HASHES
# ============================================================

def image_hashes(path):
    img = cv2.imread(
        str(path),
        cv2.IMREAD_GRAYSCALE
    )

    if img is None:
        raise RuntimeError(
            "OpenCV could not decode image"
        )

    # --------------------------------------------------------
    # pHash
    # --------------------------------------------------------

    ph = cv2.resize(
        img,
        (32, 32),
        interpolation=cv2.INTER_AREA
    ).astype(np.float32)

    dct = cv2.dct(ph)

    low = dct[:8, :8]
    median = np.median(low[1:, 1:])

    phash_bits = (
        low >= median
    ).flatten()

    # --------------------------------------------------------
    # dHash
    # --------------------------------------------------------

    dh = cv2.resize(
        img,
        (9, 8),
        interpolation=cv2.INTER_AREA
    )

    dhash_bits = (
        dh[:, 1:] >= dh[:, :-1]
    ).flatten()

    # --------------------------------------------------------
    # aHash
    # --------------------------------------------------------

    ah = cv2.resize(
        img,
        (8, 8),
        interpolation=cv2.INTER_AREA
    )

    avg = float(ah.mean())

    ahash_bits = (
        ah >= avg
    ).flatten()

    return (
        bits_to_int(phash_bits),
        bits_to_int(dhash_bits),
        bits_to_int(ahash_bits),
    )


def bits_to_int(bits):
    value = 0

    for bit in bits:
        value = (
            (value << 1)
            | int(bool(bit))
        )

    return value


def hamming(a, b):
    return (a ^ b).bit_count()


# ============================================================
# BK TREE
# ============================================================

class BKTree:

    def __init__(self):
        self.root = None

    def add(self, value, index):
        if self.root is None:
            self.root = [
                value,
                [index],
                {}
            ]
            return

        node = self.root

        while True:
            distance = hamming(
                value,
                node[0]
            )

            if distance == 0:
                node[1].append(index)
                return

            child = node[2].get(distance)

            if child is None:
                node[2][distance] = [
                    value,
                    [index],
                    {}
                ]
                return

            node = child

    def search(self, value, radius):
        if self.root is None:
            return []

        output = []

        def walk(node):
            distance = hamming(
                value,
                node[0]
            )

            if distance <= radius:
                output.extend(node[1])

            low = max(
                0,
                distance - radius
            )

            high = distance + radius

            for d, child in node[2].items():
                if low <= d <= high:
                    walk(child)

        walk(self.root)

        return output


# ============================================================
# UNION FIND
# ============================================================

class UnionFind:

    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = (
                self.parent[
                    self.parent[x]
                ]
            )
            x = self.parent[x]

        return x

    def union(self, a, b):
        ra = self.find(a)
        rb = self.find(b)

        if ra == rb:
            return

        if self.rank[ra] < self.rank[rb]:
            self.parent[ra] = rb

        elif self.rank[ra] > self.rank[rb]:
            self.parent[rb] = ra

        else:
            self.parent[rb] = ra
            self.rank[ra] += 1


# ============================================================
# MAIN
# ============================================================

def main():

    if not LIBRARY_FILE.exists():
        raise SystemExit(
            f"Missing {LIBRARY_FILE}"
        )

    if not RESULT_FILE.exists():
        raise SystemExit(
            f"Missing {RESULT_FILE}"
        )

    library = json.loads(
        LIBRARY_FILE.read_text(
            encoding="utf-8"
        )
    )

    cpu_results = json.loads(
        RESULT_FILE.read_text(
            encoding="utf-8"
        )
    )

    result_by_id = {
        item.get("id"): item
        for item in cpu_results
    }

    print("=" * 70)
    print(" BINI DUPLICATE ANALYZER")
    print("=" * 70)
    print(
        f"Library : {len(library)}"
    )

    # --------------------------------------------------------
    # Build working records
    # --------------------------------------------------------

    records = []
    exact_groups = {}
    skipped = []

    for index, item in enumerate(
        library,
        1
    ):

        item_id = item.get("id")

        analysis = result_by_id.get(
            item_id,
            {}
        )

        # Only analyze images that were successfully
        # processed by the CPU stage.
        if analysis.get("status") not in {
            "accept",
            "review",
        }:
            skipped.append({
                "id": item_id,
                "reason": "not_in_final_cpu_set"
            })
            continue

        path = resolve_file(
            analysis
        )

        if path is None:
            skipped.append({
                "id": item_id,
                "reason": "file_not_found"
            })
            continue

        try:
            sha = sha256_file(path)

            phash, dhash, ahash = (
                image_hashes(path)
            )

            record = {
                "index": index - 1,
                "id": item_id,
                "path": str(path),
                "sha256": sha,
                "phash": phash,
                "dhash": dhash,
                "ahash": ahash,
                "width": analysis.get(
                    "quality",
                    {}
                ).get("width"),
                "height": analysis.get(
                    "quality",
                    {}
                ).get("height"),
                "score": analysis.get(
                    "score"
                ),
                "status": analysis.get(
                    "status"
                ),
                "query": analysis.get(
                    "query"
                ),
            }

            records.append(record)

            exact_groups.setdefault(
                sha,
                []
            ).append(record)

        except Exception as error:
            skipped.append({
                "id": item_id,
                "reason": f"hash_error: {error}"
            })

        if index % 250 == 0:
            print(
                f"[HASH] {index}/{len(library)}"
            )

    # --------------------------------------------------------
    # Exact duplicates
    # --------------------------------------------------------

    exact = []

    for sha, group in exact_groups.items():

        if len(group) <= 1:
            continue

        exact.append({
            "sha256": sha,
            "count": len(group),
            "items": group,
        })

    exact.sort(
        key=lambda x: x["count"],
        reverse=True
    )

    print()
    print(
        f"Exact duplicate groups: {len(exact)}"
    )

    # --------------------------------------------------------
    # Near duplicates
    # --------------------------------------------------------

    uf = UnionFind(
        len(records)
    )

    phash_tree = BKTree()

    for i, record in enumerate(records):
        phash_tree.add(
            record["phash"],
            i
        )

    near_pairs = []

    seen_pairs = set()

    for i, record in enumerate(records):

        candidates = phash_tree.search(
            record["phash"],
            PHASH_NEAR_THRESHOLD
        )

        for j in candidates:

            if i == j:
                continue

            a = min(i, j)
            b = max(i, j)

            pair = (a, b)

            if pair in seen_pairs:
                continue

            seen_pairs.add(pair)

            other = records[j]

            p_dist = hamming(
                record["phash"],
                other["phash"]
            )

            d_dist = hamming(
                record["dhash"],
                other["dhash"]
            )

            # Conservative acceptance.
            is_near = (
                (
                    p_dist
                    <= PHASH_STRONG_THRESHOLD
                )
                or
                (
                    p_dist
                    <= PHASH_NEAR_THRESHOLD
                    and
                    d_dist
                    <= DHASH_NEAR_THRESHOLD
                )
            )

            if not is_near:
                continue

            uf.union(i, j)

            near_pairs.append({
                "a": record,
                "b": other,
                "phashDistance": p_dist,
                "dhashDistance": d_dist,
            })

    # --------------------------------------------------------
    # Build near-duplicate groups
    # --------------------------------------------------------

    grouped = {}

    for i in range(len(records)):

        root = uf.find(i)

        grouped.setdefault(
            root,
            []
        ).append(records[i])

    near_groups = []

    for members in grouped.values():

        if len(members) <= 1:
            continue

        # Separate groups that are already exact-only.
        hashes = {
            x["sha256"]
            for x in members
        }

        near_groups.append({
            "count": len(members),
            "items": members,
            "exactHashCount": len(hashes),
        })

    near_groups.sort(
        key=lambda x: x["count"],
        reverse=True
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    duplicate_members = sum(
        group["count"]
        for group in exact
    )

    near_members = sum(
        group["count"]
        for group in near_groups
    )

    summary = {
        "libraryCount": len(library),
        "analyzedRecords": len(records),
        "skippedRecords": len(skipped),

        "exactDuplicateGroups": len(exact),
        "exactDuplicateMembers": duplicate_members,

        "nearDuplicateGroups": len(
            near_groups
        ),
        "nearDuplicateMembers": near_members,

        "nearPairCount": len(
            near_pairs
        ),

        "thresholds": {
            "phashStrong": PHASH_STRONG_THRESHOLD,
            "phashNear": PHASH_NEAR_THRESHOLD,
            "dhashNear": DHASH_NEAR_THRESHOLD,
        },
    }

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    EXACT_OUTPUT.write_text(
        json.dumps(
            exact,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8"
    )

    NEAR_OUTPUT.write_text(
        json.dumps(
            {
                "groups": near_groups,
                "pairs": near_pairs,
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8"
    )

    SUMMARY_OUTPUT.write_text(
        json.dumps(
            summary,
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8"
    )

    print()
    print("=" * 70)
    print(" DUPLICATE ANALYSIS COMPLETE")
    print("=" * 70)
    print(
        f"Analyzed records:     {len(records)}"
    )
    print(
        f"Skipped records:      {len(skipped)}"
    )
    print(
        f"Exact groups:         {len(exact)}"
    )
    print(
        f"Near groups:          {len(near_groups)}"
    )
    print(
        f"Near pairs:           {len(near_pairs)}"
    )
    print()
    print(
        f"Exact output: {EXACT_OUTPUT}"
    )
    print(
        f"Near output:  {NEAR_OUTPUT}"
    )
    print(
        f"Summary:      {SUMMARY_OUTPUT}"
    )


if __name__ == "__main__":
    main()
