"""Regenerates the test images. Run: python3 tests/fixtures/make-fixtures.py (needs Pillow).

Each image is split into four coloured quadrants (TL red, TR green, BL blue,
BR yellow) so a rendered page reveals exactly how it was rotated and placed.
"""
import zlib
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
COLOURS = {"tl": (220, 30, 30), "tr": (30, 170, 60), "bl": (30, 60, 220), "br": (240, 200, 20)}


def quad(w, h):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=COLOURS["tl"])
    d.rectangle([w // 2, 0, w - 1, h // 2 - 1], fill=COLOURS["tr"])
    d.rectangle([0, h // 2, w // 2 - 1, h - 1], fill=COLOURS["bl"])
    d.rectangle([w // 2, h // 2, w - 1, h - 1], fill=COLOURS["br"])
    return im


def with_orientation(value):
    exif = Image.Exif()
    exif[0x0112] = value
    return exif


upright = quad(240, 160)
upright.save(HERE / "quad-landscape.jpg", quality=95)
upright.save(HERE / "quad-landscape.png")
quad(160, 240).save(HERE / "quad-portrait.jpg", quality=95)

# Stored sideways with EXIF orientation 6 ("rotate 90 CW to display"):
# displays exactly like quad-landscape.jpg. PIL's ROTATE_90 is counter-clockwise.
upright.transpose(Image.Transpose.ROTATE_90).save(
    HERE / "quad-exif6.jpg", quality=95, exif=with_orientation(6)
)
# Orientation 3 (180) and a mirrored one (2) that must be re-encoded.
upright.transpose(Image.Transpose.ROTATE_180).save(
    HERE / "quad-exif3.jpg", quality=95, exif=with_orientation(3)
)
upright.transpose(Image.Transpose.FLIP_LEFT_RIGHT).save(
    HERE / "quad-exif2.jpg", quality=95, exif=with_orientation(2)
)
upright.convert("CMYK").save(HERE / "quad-cmyk.jpg", quality=95)
upright.save(HERE / "quad-landscape.webp", quality=95)
# Pillow can't write Adam7 PNGs, so flip the IHDR interlace flag (and its CRC).
# Only the header is read in tests; the pixel data is never decoded.
png = bytearray(open(HERE / "quad-landscape.png", "rb").read())
png[28] = 1
png[29:33] = zlib.crc32(bytes(png[12:29])).to_bytes(4, "big")
(HERE / "interlaced-header.png").write_bytes(bytes(png))
(HERE / "not-an-image.txt").write_text("hello\n")

# A phone photo of a printed page: warm off-white paper, a shadow falling
# across the lower right, slight noise, and lines of "text". The case the B&W
# filter is for: a single global threshold turns the shadow black.
import random

random.seed(7)
doc = Image.new("RGB", (900, 1200))
px = doc.load()
for y in range(1200):
    for x in range(900):
        shade = 1.0 - 0.55 * max(0.0, (x / 900 + y / 1200) - 0.9)
        n = random.randint(-6, 6)
        px[x, y] = (int(236 * shade) + n, int(228 * shade) + n, int(212 * shade) + n)
d = ImageDraw.Draw(doc)
for i, y in enumerate(range(140, 1100, 46)):
    words = 6 + (i % 4)
    x = 90
    for w in range(words):
        width = 40 + ((i * 7 + w * 13) % 70)
        if x + width > 820:
            break
        top_shade = 1.0 - 0.55 * max(0.0, (x / 900 + y / 1200) - 0.9)
        ink = int(70 * top_shade)
        d.rectangle([x, y, x + width, y + 14], fill=(ink, ink, ink + 6))
        x += width + 18
doc.save(HERE / "doc-photo.jpg", quality=88)

# The same page as a 300 dpi US Letter scan (2550 x 3300), with sensor-like
# grain so it compresses like a real photo rather than a flat test card.
random.seed(11)
large = doc.resize((2550, 3300), Image.Resampling.LANCZOS)
grain = Image.effect_noise((2550, 3300), 10).convert("RGB")
large = Image.blend(large, grain, 0.06)
large.save(HERE / "scan-letter-300dpi.jpg", quality=92)

# An iPhone-style HEIC of the quadrant image. Needs pillow-heif; skipped (and
# the committed file kept) when it isn't installed.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    upright.save(HERE / "quad-landscape.heic", quality=90)
except ImportError:
    print("pillow-heif not installed; keeping existing quad-landscape.heic")
