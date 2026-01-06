import json
import re
from pathlib import Path

import pandas as pd

# ---------------- CONFIG ----------------

EXCEL_PATH = Path("docs/Eton Cadences Log.xlsx")
IMAGES_DIR = Path("docs/images")
OUT_JSON = Path("docs/cadences.json")

# Matches filenames like:
# e2_kellyk_gaude_flore_virginali_4_2.jpg
# → E2, bar 4, beat 2
IMAGE_RE = re.compile(
    r"^e(\d+)_.*_(\d+)_(\d+)\.(jpg|jpeg|png)$",
    re.IGNORECASE
)

# ---------------- HELPERS ----------------

def normalise_cell(value):
    """Convert Excel cells to clean Python values."""
    if pd.isna(value):
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def safe_int_str(value):
    """
    Return integer as string if possible.
    Return None for ranges (e.g. '62-65') or non-numeric cells.
    """
    try:
        return str(int(value))
    except (ValueError, TypeError):
        return None


def build_image_index(images_dir):
    """
    Build a lookup:
    (E-number, bar, beat) → filename
    """
    index = {}

    for img in images_dir.iterdir():
        if not img.is_file():
            continue

        match = IMAGE_RE.match(img.name)
        if not match:
            continue

        e_num, bar, beat, _ext = match.groups()
        key = (f"E{int(e_num)}", str(int(bar)), str(int(beat)))
        index[key] = img.name

    return index


# ---------------- MAIN ----------------

def main():
    if not EXCEL_PATH.exists():
        raise FileNotFoundError(f"Excel file not found: {EXCEL_PATH}")

    if not IMAGES_DIR.exists():
        raise FileNotFoundError(f"Images folder not found: {IMAGES_DIR}")

    df = pd.read_excel(EXCEL_PATH)

    image_index = build_image_index(IMAGES_DIR)

    records = []
    matched = 0
    unmatched = 0

    for i, row in df.iterrows():
        record = {col: normalise_cell(row[col]) for col in df.columns}
        record["_id"] = i + 1

        # --- Normalise E number ---
        e_raw = record.get("E Number")
        if e_raw is not None:
            e_str = str(e_raw).strip().upper()
            if not e_str.startswith("E"):
                e_str = "E" + e_str
        else:
            e_str = None

        # --- Normalise bar / beat ---
        bar_str = safe_int_str(record.get("Bar"))
        beat_str = safe_int_str(record.get("Beat"))

        # --- Image lookup ---
        image_file = None
        if e_str and bar_str and beat_str:
            image_file = image_index.get((e_str, bar_str, beat_str))

        if image_file:
            record["ImageFile"] = image_file
            matched += 1
        else:
            record["ImageFile"] = ""
            unmatched += 1

        records.append(record)

    OUT_JSON.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"✅ cadences.json written with {len(records)} entries")
    print(f"🖼️ Images matched: {matched}")
    print(f"⚠️ No image (ranges / none): {unmatched}")
    print("✔ Done. Safe to commit the JSON file.")


if __name__ == "__main__":
    main()
