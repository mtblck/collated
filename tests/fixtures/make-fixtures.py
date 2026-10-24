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

# Colour encodes position (red = across, green = down), so a raster test can
# tell where any point of the image landed, not just which quadrant.
gradient = Image.new("RGB", (240, 160))
gradient.putdata([(round(255 * x / 239), round(255 * y / 159), 128) for y in range(160) for x in range(240)])
gradient.save(HERE / "gradient.png")
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

# The document photo shot 4 degrees off: rotated clockwise (PIL's angle is
# counter-clockwise, hence -4) onto a darker table, as a phone snap would be.
skewed = doc.rotate(-4, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(70, 62, 55))
skewed.save(HERE / "doc-skewed-4deg.jpg", quality=88)

# A page of real printed text for OCR, stored sideways (as a phone photo of a
# page held landscape would be) so the test also covers reading after a turn.
from PIL import ImageFont

font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
text_page = Image.new("RGB", (1275, 1650), (250, 249, 245))
td = ImageDraw.Draw(text_page)
for i, line in enumerate(
    [
        "Collated verification page",
        "The quick brown fox jumps over the lazy dog.",
        "Invoice number 4417, total due 1,234.56",
        "Searchable text should land on these words.",
    ]
):
    td.text((110, 160 + i * 70), line, font=font, fill=(25, 25, 30))
text_page.transpose(Image.Transpose.ROTATE_90).save(HERE / "text-page-sideways.jpg", quality=90)

# The same kind of page in French (#79): words OCR only gets right with the
# French data, and accented letters the text layer must keep.
fr_page = Image.new("RGB", (1275, 1650), (250, 249, 245))
fd = ImageDraw.Draw(fr_page)
for i, line in enumerate(
    [
        "Facture numéro 4417, à régler en août",
        "Le cœur de l’élève bat très fort.",
        "Où est la clé du garçon ? Déjà payé.",
        "Reçu : crème brûlée et thé glacé.",
    ]
):
    fd.text((110, 160 + i * 70), line, font=font, fill=(25, 25, 30))
fr_page.save(HERE / "text-page-fr.jpg", quality=90)

# A full page of body text, for orientation detection (#70), saved turned
# 0/90/180/270 degrees clockwise from upright. 1-bit, so four copies stay small.
serif = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 26)
letter = Image.new("L", (1275, 1650), 255)
ld = ImageDraw.Draw(letter)
body = (
    "Thank you for your order. The items below were shipped on the date shown and "
    "should arrive within five working days. Please keep this letter for your records, "
    "and check each item against the list when the parcel arrives. If anything is "
    "missing or damaged, write to us within thirty days and we will replace it or "
    "refund the full amount, including postage. Returns are free of charge. "
).split()
line, lines = [], []
for word in body * 5:
    if ld.textlength(" ".join(line + [word]), font=serif) > 1055:
        lines.append(" ".join(line))
        line = []
    line.append(word)
for i, text in enumerate(lines[:38]):
    ld.text((110, 120 + i * 38), text, font=serif, fill=0)
letter = letter.point(lambda v: 255 if v > 128 else 0, "1")
for degrees, turn in [(0, None), (90, Image.Transpose.ROTATE_270), (180, Image.Transpose.ROTATE_180), (270, Image.Transpose.ROTATE_90)]:
    (letter if turn is None else letter.transpose(turn)).save(HERE / f"text-letter-cw{degrees}.png", optimize=True)

from PIL import ImageFilter

# The back of a single-sided sheet, scanned (#68): nothing printed, but faint
# show-through of the front (mirrored), two punch holes, dust and the lid's
# shadow down one edge. Blank-page detection must still call it blank.
back = Image.new("RGB", (827, 1169), (238, 236, 230))
bd = ImageDraw.Draw(back)
for i in range(18):
    bd.text((90, 120 + i * 52), "Show-through of the printed front side.", font=font, fill=(214, 212, 207))
back = back.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
bd = ImageDraw.Draw(back)
for cy in (409, 760):
    bd.ellipse((35, cy - 12, 59, cy + 12), fill=(30, 30, 32))
for x, y in ((300, 222), (512, 640), (190, 1001), (701, 377)):
    bd.rectangle((x, y, x + 1, y + 1), fill=(60, 60, 60))
bd.rectangle((809, 0, 826, 1168), fill=(120, 118, 114))
back = back.filter(ImageFilter.GaussianBlur(0.6))
back.save(HERE / "scan-blank-back.jpg", quality=85)

# An iPhone-style HEIC of the quadrant image. Needs pillow-heif; skipped (and
# the committed file kept) when it isn't installed.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    upright.save(HERE / "quad-landscape.heic", quality=90)
except ImportError:
    print("pillow-heif not installed; keeping existing quad-landscape.heic")

# Header-size fixtures for AVIF and a HEIF grid image (needs pillow-heif; CI's
# Pillow can't write either, so the files are committed).
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    Image.new("RGB", (321, 123)).save(HERE / "blank-321x123.avif", "AVIF")
    Image.new("RGB", (1100, 700)).save(HERE / "grid-1100x700.heic", "HEIF", quality=50)
except ImportError:
    print("pillow-heif not installed: skipped the AVIF and HEIF size fixtures")

# Phone photos of the document page lying on a table, for finding the paper's
# corners (#69): on dark wood, on a light desk (low contrast), and shot at an
# angle (turned and foreshortened). The paper's true corners, as fractions of
# the photo, go to paper-corners.json for the tests to check against.
import json
from PIL import ImageFilter


def perspective_coeffs(src, dst):
    """PIL's PERSPECTIVE takes the map from output (dst) back to input (src)."""
    rows, rhs = [], []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs += [u, v]
    n = 8
    a = [row[:] + [b] for row, b in zip(rows, rhs)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(a[r][c]))
        a[c], a[p] = a[p], a[c]
        for r in range(n):
            if r != c:
                f = a[r][c] / a[c][c]
                a[r] = [x - f * y for x, y in zip(a[r], a[c])]
    return [a[i][n] / a[i][i] for i in range(n)]


def table(size, base, grain, seed):
    """A table top: a base colour with long soft streaks of grain and noise."""
    random.seed(seed)
    w, h = size
    im = Image.new("RGB", size, base)
    d = ImageDraw.Draw(im)
    for _ in range(140):
        y = random.uniform(-50, h + 50)
        k = random.uniform(-grain, grain)
        c = tuple(max(0, min(255, int(ch + k))) for ch in base)
        d.line([(0, y), (w, y + random.uniform(-40, 40))], fill=c, width=random.randint(2, 9))
    im = im.filter(ImageFilter.GaussianBlur(2))
    return Image.blend(im, Image.effect_noise(size, 40).convert("RGB"), 0.04)


def lit(im, strength):
    """Uneven light: brighter at the top left, falling off to the bottom right."""
    w, h = im.size
    ramp = Image.new("L", (64, 64))
    ramp.putdata([(x + y) * 255 // 126 for y in range(64) for x in range(64)])
    ramp = ramp.resize((w, h), Image.Resampling.BILINEAR)
    dark = Image.new("RGB", (w, h), (0, 0, 0))
    return Image.composite(dark, im, ramp.point(lambda v: int(v * strength)))


def photo(name, size, corners, base, grain, light, seed):
    w, h = size
    shot = table(size, base, grain, seed)
    page = doc.resize((900, 1200))
    src = [(0, 0), (900, 0), (900, 1200), (0, 1200)]
    pixels = [(x * w, y * h) for x, y in corners]
    coeffs = perspective_coeffs(src, pixels)
    warped = page.transform(size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(pixels, fill=255)
    # A soft shadow below and right of the sheet, then the sheet itself.
    shadow = mask.transform(size, Image.Transform.AFFINE, (1, 0, -6, 0, 1, -9))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.45))
    shot = Image.composite(Image.new("RGB", size, (0, 0, 0)), shot, shadow)
    shot = Image.composite(warped, shot, mask.filter(ImageFilter.GaussianBlur(0.8)))
    shot = lit(shot, light).filter(ImageFilter.GaussianBlur(0.6))
    shot = Image.blend(shot, Image.effect_noise(size, 60).convert("RGB"), 0.03)
    shot.save(HERE / name, quality=85)
    return [[round(x, 4), round(y, 4)] for x, y in corners]


truth = {
    "paper-dark-table.jpg": photo(
        "paper-dark-table.jpg",
        (900, 1200),
        [(0.17, 0.14), (0.84, 0.12), (0.89, 0.88), (0.12, 0.9)],
        base=(72, 52, 40),
        grain=22,
        light=0.35,
        seed=21,
    ),
    "paper-light-table.jpg": photo(
        "paper-light-table.jpg",
        (900, 1200),
        [(0.13, 0.1), (0.87, 0.11), (0.86, 0.9), (0.14, 0.89)],
        base=(214, 208, 196),
        grain=6,
        light=0.25,
        seed=22,
    ),
    # Turned about 15° and shot from below: the far edge is much shorter.
    "paper-skewed.jpg": photo(
        "paper-skewed.jpg",
        (1200, 900),
        [(0.36, 0.08), (0.73, 0.15), (0.79, 0.93), (0.16, 0.8)],
        base=(120, 96, 70),
        grain=14,
        light=0.3,
        seed=23,
    ),
}
# Laid out as Prettier would, one corner per line.
entries = [
    f"  {json.dumps(name)}: [\n" + ",\n".join(f"    {json.dumps(c)}" for c in corners) + "\n  ]"
    for name, corners in truth.items()
]
(HERE / "paper-corners.json").write_text("{\n" + ",\n".join(entries) + "\n}\n")

# A phone photo of a colour document: the same warm paper and shadow as
# doc-photo.jpg, with a yellow highlight over a line, a red round stamp and a
# blue logo block. What the Enhance filter is for: white paper, colours kept.
random.seed(31)
colour_doc = Image.new("RGB", (900, 1200))
px = colour_doc.load()


def colour_shade(x, y):
    return 1.0 - 0.55 * max(0.0, (x / 900 + y / 1200) - 0.9)


for y in range(1200):
    for x in range(900):
        s = colour_shade(x, y)
        n = random.randint(-6, 6)
        px[x, y] = (int(236 * s) + n, int(228 * s) + n, int(212 * s) + n)
marks = Image.new("RGB", (900, 1200), (255, 255, 255))
d = ImageDraw.Draw(marks)
d.rectangle([90, 90, 250, 170], fill=(40, 80, 190))  # logo
d.rectangle([84, 456, 640, 484], fill=(250, 230, 70))  # highlight
for i, y in enumerate(range(230, 1100, 46)):
    x = 90
    for w in range(6 + (i % 4)):
        width = 40 + ((i * 7 + w * 13) % 70)
        if x + width > 820:
            break
        d.rectangle([x, y, x + width, y + 14], fill=(60, 60, 70))
        x += width + 18
d.ellipse([560, 820, 760, 1020], outline=(200, 30, 40), width=14)  # stamp
d.line([600, 900, 720, 940], fill=(200, 30, 40), width=12)
# Marks multiply the lit paper, so they take the same light and cast.
for y in range(1200):
    for x in range(900):
        p, m = px[x, y], marks.getpixel((x, y))
        px[x, y] = tuple(p[k] * m[k] // 255 for k in range(3))
colour_doc.save(HERE / "doc-colour.jpg", quality=88)
