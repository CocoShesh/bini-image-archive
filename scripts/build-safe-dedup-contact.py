import json
from pathlib import Path
from PIL import Image, ImageDraw
import math

INPUT = Path("data/analysis/duplicates/final-dedup-preview.json")
OUT = Path("data/analysis/duplicates/safe-preview")
OUT.mkdir(parents=True, exist_ok=True)

with INPUT.open("r", encoding="utf-8") as f:
    data = json.load(f)

groups = data["safeGroupsData"]

# Show first 100 groups in manageable sheets.
for batch_start in range(0, len(groups), 25):
    batch = groups[batch_start:batch_start + 25]

    cols = 2
    tw, th = 620, 300
    rows = len(batch)

    sheet = Image.new(
        "RGB",
        (cols * tw, rows * th),
        "white"
    )

    draw = ImageDraw.Draw(sheet)

    for row, group in enumerate(batch):
        canonical = group["canonical"]
        variant = group["proposedVariants"][0]

        y = row * th

        for col, item in enumerate([canonical, variant]):
            x = col * tw

            try:
                img = Image.open(
                    item["path"]
                ).convert("RGB")

                img.thumbnail((280, 220))

                sheet.paste(
                    img,
                    (x + 15, y + 35)
                )
            except Exception:
                pass

            label = (
                "CANONICAL"
                if col == 0
                else "DUPLICATE"
            )

            draw.text(
                (x + 15, y + 10),
                f"{label} | GROUP {group['group']}",
                fill="black"
            )

            draw.text(
                (x + 15, y + 265),
                f"{item.get('width')}x{item.get('height')}",
                fill="black"
            )

    output = (
        OUT /
        f"safe-{batch_start + 1:03d}-"
        f"{batch_start + len(batch):03d}.jpg"
    )

    sheet.save(output, quality=92)

    print(output)
