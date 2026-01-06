from pathlib import Path
from PIL import Image, ImageChops, ImageOps

INPUT_DIR = Path("docs/images")
OUTPUT_DIR = Path("docs/images_cropped")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

PADDING = 15            # pixels of breathing room around content
WHITE_FUZZ = 12         # tolerate near-white noise. Higher = more aggressive trim.

def trim_whitespace(im: Image.Image) -> Image.Image:
    # Convert to RGB; flatten alpha if present
    if im.mode in ("RGBA", "LA"):
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im.convert("RGBA")).convert("RGB")
    else:
        im = im.convert("RGB")

    # Assume background colour from top-left pixel (usually whitespace)
    bg_color = im.getpixel((0, 0))
    bg = Image.new("RGB", im.size, bg_color)

    # Difference highlights ink/content
    diff = ImageChops.difference(im, bg)
    diff = ImageOps.grayscale(diff)

    # Apply fuzz threshold: treat small differences as background
    diff = diff.point(lambda p: 0 if p <= WHITE_FUZZ else 255)

    bbox = diff.getbbox()
    if not bbox:
        return im

    left, top, right, bottom = bbox
    left = max(0, left - PADDING)
    top = max(0, top - PADDING)
    right = min(im.size[0], right + PADDING)
    bottom = min(im.size[1], bottom + PADDING)

    return im.crop((left, top, right, bottom))

def main():
    images = sorted(INPUT_DIR.glob("*.png"))
    print(f"Found {len(images)} images in {INPUT_DIR}", flush=True)

    cropped = 0
    skipped = 0

    for i, p in enumerate(images, start=1):
        try:
            with Image.open(p) as im:
                out = trim_whitespace(im)
                if out.size != im.size:
                    cropped += 1
                out.save(OUTPUT_DIR / p.name)
        except Exception as e:
            skipped += 1
            print(f"SKIP ({i}/{len(images)}): {p.name} — {e}", flush=True)
            continue

        if i % 25 == 0 or i == len(images):
            print(f"Progress: {i}/{len(images)} (cropped: {cropped}, skipped: {skipped})", flush=True)

    print(f"DONE. Cropped: {cropped}. Skipped: {skipped}. Output: {OUTPUT_DIR}", flush=True)

if __name__ == "__main__":
    main()
