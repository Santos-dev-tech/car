"""
MotoKE - lift the car off its studio background.

    python tools/cutout-photos.py [ids...]        report
    python tools/cutout-photos.py 29 47 --apply   write the cut-outs and repoint the rows

The generated photographs are studio shots: matte black room, dark reflective floor, car
lit from above. On the dark storefront that read fine. On the light showcase stage the
photo is a black rectangle sitting on top of the model name, which is exactly what the
name is set enormous to avoid.

So the background comes out and the car is left on transparency, like the reference.

HOW, and why not a threshold. A plain "darker than X is background" mask also eats the
tyres, the glass and the shadowed flank - they are darker than the floor. What separates
background from car is not darkness, it is CONNECTION: the room and the floor touch the
border of the frame, and the tyres do not. So this floods inward from the edges through
dark pixels and keeps everything the flood cannot reach. A tyre enclosed by bodywork
survives; the floor under the car does not, which is correct - the car should float with
a cast shadow, and the showcase draws that shadow itself.

The mask is then feathered, because a hard alpha edge on a photograph looks cut out with
scissors, and the result is cropped to the car so it centres on the stage instead of
sitting inside a box of leftover transparency.
"""
import json
import os
import sqlite3
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARS = os.path.join(ROOT, "public", "img", "cars")
DB = os.path.join(ROOT, "data", "motoke.db")

# Measured off the images rather than guessed: the border luminance median is 16 and two
# thirds of every frame sits under 30, because these are near-black studio rooms. 34 is
# just above that floor.
#
# There is deliberately NO relative tolerance. The first version let the flood cross into
# any pixel within 26 of its neighbour, which on a gradient means each step raises the bar
# for the next one — the flood walks all the way up the bodywork and eats the car. It took
# 99.6% of the frame. An absolute ceiling cannot run away.
DARK = 34
FEATHER = 2.5

# Everything above is only half the job. At DARK=34 the car came out cleanly and so did a
# lot of things that are not the car: the lit reflective floor survives as ragged blobs
# because it is brighter than the threshold, and so does the spotlight in the corner.
#
# The car is one large connected blob and the debris is many small ones, so the answer is
# not another threshold - it is to keep only the biggest piece of foreground and drop the
# rest. That removes the floor, the lamp and the speckle around the wheels in one step,
# and it cannot accidentally remove the car.
KEEP_LARGEST_ONLY = True

# The alpha ramp. Below RAMP_LO is background and goes fully transparent; above RAMP_HI is
# bodywork and stays fully opaque; between the two the tyres and the shadowed flanks fade
# rather than disappear. RAMP_LO sits just above the room's own luminance (border median
# 16) so the background clears completely.
#
# The window between them is deliberately NARROW. A wide one (26-96 on the first go) left
# the whole car looking bleached - every mid-tone was part-transparent, so a dark grey
# Mercedes read as a pencil sketch of itself. 20-54 clears the room just as completely and
# lets the bodywork go solid, leaving only the genuinely near-black parts to fade.
RAMP_LO = 20
RAMP_HI = 54
# What counts as the car's solid body when looking for the largest blob. Well above the
# floor so a lit reflection cannot win.
BODY_LUM = 96
# How far below the body to keep, as a fraction of its height. The wheels hang under the
# sills and would otherwise be cropped off with the floor.
WHEEL_DROP = 0.20


def background_mask(rgb):
    """True where the pixel is room, found by flooding inward from the frame edge."""
    h, w, _ = rgb.shape
    lum = (0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]).astype(np.int16)

    seen = np.zeros((h, w), dtype=bool)
    q = deque()

    def push(y, x):
        if not seen[y, x] and lum[y, x] < DARK:
            seen[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and lum[ny, nx] < DARK:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def largest_blob(fg):
    """Keep only the biggest connected run of foreground; drop every other island."""
    h, w = fg.shape
    label = np.zeros((h, w), dtype=np.int32)
    best_id, best_n = 0, 0
    cur = 0
    for sy in range(h):
        row = fg[sy]
        for sx in range(w):
            if not row[sx] or label[sy, sx]:
                continue
            cur += 1
            n = 0
            q = deque([(sy, sx)])
            label[sy, sx] = cur
            while q:
                y, x = q.popleft()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not label[ny, nx]:
                        label[ny, nx] = cur
                        q.append((ny, nx))
            if n > best_n:
                best_id, best_n = cur, n
    return label == best_id


def cut(src, dest):
    """
    A hard mask cannot do this job, and it took two attempts to see why.

    A black tyre on a black floor has no edge. Flood the background loosely and the tyres
    survive but so does the lit floor; flood it tightly and the floor goes but the tyres
    go with it, through the few pixels where rubber meets ground. The first run gave the
    Mercedes no wheels. The second decided the FLOOR was the largest object in the Land
    Cruiser frame and kept that instead of the car.

    So the alpha is a RAMP on luminance rather than a threshold. Black background falls to
    fully transparent, bodywork stays fully opaque, and the tyres - genuinely dark - come
    out semi-transparent instead of missing. They read as a car settling into its own
    shadow, which is what the reference looks like anyway.

    The ramp alone would keep the lit floor and the spotlight, so it is confined to the
    bounding box of the car's bright body (the largest solid blob), grown downward to take
    in the wheels underneath it. Everything outside that box is dropped.
    """
    im = Image.open(src).convert("RGB")
    rgb = np.asarray(im).astype(np.float32)
    lum = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]

    ramp = np.clip((lum - RAMP_LO) / float(RAMP_HI - RAMP_LO), 0.0, 1.0)

    # The car's solid body: bright, and not reachable from the frame edge through black.
    body = largest_blob((~background_mask(np.asarray(im))) & (lum > BODY_LUM))
    ys, xs = np.nonzero(body)
    if ys.size:
        h, w = lum.shape
        y0, y1 = ys.min(), ys.max()
        x0, x1 = xs.min(), xs.max()
        drop = int((y1 - y0) * WHEEL_DROP)          # room below the sills for the wheels
        pad = int((x1 - x0) * 0.03)
        keep = np.zeros_like(ramp, dtype=bool)
        keep[max(0, y0 - pad):min(h, y1 + drop), max(0, x0 - pad):min(w, x1 + pad)] = True
        ramp = np.where(keep, ramp, 0.0)

    alpha = (ramp * 255).astype(np.uint8)
    a = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(FEATHER))

    out = im.convert("RGBA")
    out.putalpha(a)

    # Crop to the car. Without this the PNG keeps the empty room around it and the
    # showcase centres the BOX, which puts the car off to one side.
    box = out.getbbox() if out.getbbox() else None
    solid = np.argwhere(alpha > 40)
    if solid.size:
        y0, x0 = solid.min(axis=0)
        y1, x1 = solid.max(axis=0)
        pad = 12
        box = (max(0, x0 - pad), max(0, y0 - pad),
               min(out.width, x1 + pad), min(out.height, y1 + pad))
        out = out.crop(box)

    kept = 100.0 * (alpha > 40).sum() / alpha.size
    out.save(dest, "PNG", optimize=True)
    return kept, out.size, os.path.getsize(dest)


def main():
    args = [a for a in sys.argv[1:] if a != "--apply"]
    apply = "--apply" in sys.argv
    ids = [int(a) for a in args if a.isdigit()]
    if not ids:
        print("  usage: python tools/cutout-photos.py 29 47 [--apply]")
        return

    con = sqlite3.connect(DB)
    cur = con.cursor()

    for vid in ids:
        src = os.path.join(CARS, "%d.jpg" % vid)
        if not os.path.exists(src):
            print("  #%d: no %d.jpg on disk, skipped" % (vid, vid))
            continue
        dest = os.path.join(CARS, "%d-cut.png" % vid)
        kept, size, nbytes = cut(src, dest)
        print("  #%-3d %-14s car is %4.1f%% of the frame  ->  %dx%d  %d KB"
              % (vid, "%d-cut.png" % vid, kept, size[0], size[1], nbytes // 1024))

        # A car shot to fill the frame is roughly a fifth to a half of it. Far outside
        # that and the mask has either eaten the car or kept the room, and repointing the
        # row would put a broken hero on the stage.
        if kept < 8 or kept > 70:
            print("       ! %.1f%% is not a car on a background - not repointing" % kept)
            continue

        if apply:
            row = cur.execute("SELECT images FROM vehicles WHERE id=?", (vid,)).fetchone()
            stored = json.loads(row[0] or "[]") if row else []
            url = "/img/cars/%d-cut.png" % vid
            # Hero becomes the cut-out; the original stays in the gallery behind it,
            # because the detail page wants the photograph with its studio background.
            rest = [s for s in stored if s != url]
            cur.execute("UPDATE vehicles SET images=? WHERE id=?",
                        (json.dumps([url] + rest), vid))

    if apply:
        con.commit()
        print("\n  Written.")
    else:
        print("\n  Re-run with --apply to repoint the rows.")
    con.close()


main()
