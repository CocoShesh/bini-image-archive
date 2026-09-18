#!/usr/bin/env python3

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(".").resolve()

LIBRARY_FILE = ROOT / "data/library.json"
ANALYZER_FILE = ROOT / "scripts/cpu-analyzer.py"

ANALYSIS_DIR = ROOT / "data/analysis"
ANALYSIS_DIR.mkdir(parents=True, exist_ok=True)

FINAL_OUTPUT = ANALYSIS_DIR / "cpu-results.json"
CHECKPOINT_FILE = ANALYSIS_DIR / "cpu-batch-checkpoint.json"

BATCH_SIZE = 250


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path, data):
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def load_analyzer():
    spec = importlib.util.spec_from_file_location(
        "bini_cpu_analyzer",
        ANALYZER_FILE,
    )

    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load cpu-analyzer.py")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    if not LIBRARY_FILE.exists():
        raise SystemExit(f"Missing {LIBRARY_FILE}")

    library = load_json(LIBRARY_FILE)
    total = len(library)

    # Start exclusively from checkpoint.
    # No inference from result-file length.
    start_index = 0

    if CHECKPOINT_FILE.exists():
        checkpoint = load_json(CHECKPOINT_FILE)
        start_index = int(checkpoint.get("nextIndex", 0))

    start_index = max(0, min(start_index, total))

    results = []

    if FINAL_OUTPUT.exists():
        existing = load_json(FINAL_OUTPUT)
        if isinstance(existing, list):
            results = existing

    # Safety: result count must exactly match checkpoint.
    if len(results) != start_index:
        print(
            f"Resetting inconsistent state: "
            f"checkpoint={start_index}, results={len(results)}"
        )
        start_index = 0
        results = []

        FINAL_OUTPUT.unlink(missing_ok=True)
        CHECKPOINT_FILE.unlink(missing_ok=True)

    print("=" * 70)
    print(" BINI CPU BATCH RUNNER")
    print("=" * 70)
    print(f"Library : {total}")
    print(f"Batch   : {BATCH_SIZE}")
    print(f"Starting: {start_index + 1 if start_index < total else total}")
    print()

    analyzer = load_analyzer()

    while start_index < total:

        batch_start = start_index
        batch_end = min(
            batch_start + BATCH_SIZE,
            total,
        )

        batch = library[batch_start:batch_end]

        print("=" * 70)
        print(
            f"BATCH {batch_start + 1}-{batch_end} / {total}"
        )
        print("=" * 70)

        batch_library = (
            ANALYSIS_DIR / "_cpu_batch_library.json"
        )

        batch_output = (
            ANALYSIS_DIR / "_cpu_batch_results.json"
        )

        save_json(batch_library, batch)

        try:
            analyzer.LIBRARY_FILE = batch_library
            analyzer.OUTPUT_FILE = batch_output

            batch_output.unlink(missing_ok=True)

            old_argv = sys.argv

            try:
                sys.argv = [
                    str(ANALYZER_FILE),
                    str(len(batch)),
                ]
                analyzer.main()

            finally:
                sys.argv = old_argv

            if not batch_output.exists():
                raise RuntimeError(
                    "Analyzer did not create batch output."
                )

            batch_results = load_json(batch_output)

            if len(batch_results) != len(batch):
                raise RuntimeError(
                    f"Expected {len(batch)} results, "
                    f"got {len(batch_results)}"
                )

            results.extend(batch_results)

            # Permanent save after EVERY batch.
            save_json(FINAL_OUTPUT, results)

            start_index = batch_end

            save_json(
                CHECKPOINT_FILE,
                {
                    "nextIndex": start_index,
                    "total": total,
                    "batchSize": BATCH_SIZE,
                },
            )

            print()
            print(
                f"CHECKPOINT SAVED: "
                f"{start_index}/{total}"
            )
            print(
                f"Remaining: {total - start_index}"
            )
            print()

        finally:
            batch_library.unlink(missing_ok=True)
            batch_output.unlink(missing_ok=True)

    counts = {
        "accept": 0,
        "review": 0,
        "reject": 0,
        "failed": 0,
        "skipped": 0,
    }

    for result in results:
        status = result.get("status", "failed")
        counts[status] = counts.get(status, 0) + 1

    print("=" * 70)
    print(" BINI CPU BATCH ANALYSIS COMPLETE")
    print("=" * 70)
    print(f"Analyzed: {len(results)}")
    print(f"Accept:   {counts['accept']}")
    print(f"Review:   {counts['review']}")
    print(f"Reject:   {counts['reject']}")
    print(f"Failed:   {counts['failed']}")
    print(f"Skipped:  {counts['skipped']}")
    print(f"Output:   {FINAL_OUTPUT}")


if __name__ == "__main__":
    main()
