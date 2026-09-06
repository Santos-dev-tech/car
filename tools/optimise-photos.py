"""
MotoKE - shrink generated showroom photos for the web.

The image models return ~3 MB PNGs at 2048px. A gallery of five of those is 15 MB per
car, which is unusable on a Kenyan mobile connection. This resizes to a sensible width and
re-encodes as progressive JPEG, then points the database at the smaller files.

    python tools/optimise-photos.py [max_width] [quality]

Handles both shapes on disk:

    12.png          the hero shot          -> 12.jpg
    12-rear.png     a gallery angle        -> 12-rear.jpg

Safe to re-run: it skips anything already converted and never deletes an original until
the replacement exists. Gallery order is rebuilt deterministically - hero, then the angles
in a fixed order, then the SVG fallbacks - so a re-run never shuffles a car's photos.
"""
import io, json, os, re, sqlite3, sys, glob

try:
    from PIL import Image
except ImportError:
    print("Pillow is required:  python -m pip install Pillow")
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARS = os.path.join(ROOT, "public", "img", "cars")
DB = os.path.join(ROOT, "data", "motoke.db")

MAX_W = int(sys.argv[1]) if len(sys.argv) > 1 else 1600
QUALITY = int(sys.argv[2]) if len(sys.argv) > 2 else 82

# The order a gallery reads in. Exterior first, then inside, then the detail.
ANGLE_ORDER = ["rear", "interior", "cabin", "wheel"]
NAME = re.compile(r"^(\d+)(?:-([a-z]+))?$")

pngs = sorted(glob.glob(os.path.join(CARS, "*.png")))
if not pngs:
    print("\n  No PNGs to optimise.\n")
    sys.exit(0)

con = sqlite3.connect(DB)
cur = con.cursor()

saved_before = saved_after = 0
converted = 0
touched = set()

for src in pngs:
    stem = os.path.splitext(os.path.basename(src))[0]
    m = NAME.match(stem)
    if not m:
        print("  skip  %s  (unrecognised name)" % stem)
        continue
    vid = int(m.group(1))

    dest = os.path.join(CARS, stem + ".jpg")
    before = os.path.getsize(src)
    with Image.open(src) as im:
        im = im.convert("RGB")
        if im.width > MAX_W:
            h = round(im.height * MAX_W / im.width)
            im = im.resize((MAX_W, h), Image.LANCZOS)
        im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    after = os.path.getsize(dest)

    os.remove(src)
    saved_before += before
    saved_after += after
    converted += 1
    touched.add(vid)
    print("  %-16s %6.2f MB -> %5.0f KB" % (stem + ".jpg", before / 1048576, after / 1024))


def gallery_for(vid, stored):
    """Hero, then angles in ANGLE_ORDER, then whatever SVG views were there."""
    hero = [s for s in stored if re.match(r"^/img/cars/%d\.(png|jpg)$" % vid, s)]
    if not hero:
        for ext in ("jpg", "png"):
            if os.path.exists(os.path.join(CARS, "%d.%s" % (vid, ext))):
                hero = ["/img/cars/%d.%s" % (vid, ext)]
                break

    angles = []
    for key in ANGLE_ORDER:
        for ext in ("jpg", "png"):
            name = "%d-%s.%s" % (vid, key, ext)
            if os.path.exists(os.path.join(CARS, name)):
                angles.append("/img/cars/" + name)
                break

    # The SVG views exist so a car with no photography still has a gallery. Once real
    # angles exist they only duplicate them - a real rear shot followed by a cartoon rear
    # shot reads as broken - so they are dropped as soon as there is anything to drop for.
    svgs = [] if angles else [s for s in stored if s.startswith("/img/vehicle.svg")]
    return hero + angles + svgs


for vid in sorted(touched):
    row = cur.execute("SELECT images FROM vehicles WHERE id=?", (vid,)).fetchone()
    if not row:
        continue
    try:
        stored = json.loads(row[0] or "[]")
    except ValueError:
        stored = []
    cur.execute("UPDATE vehicles SET images=? WHERE id=?", (json.dumps(gallery_for(vid, stored)), vid))

con.commit()
con.close()

print(
    "\n  %d images: %.1f MB -> %.1f MB  (%.0f%% smaller).  %d galleries repointed.\n"
    % (
        converted,
        saved_before / 1048576,
        saved_after / 1048576,
        100 * (1 - saved_after / saved_before) if saved_before else 0,
        len(touched),
    )
)
