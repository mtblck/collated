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
