"""Bake the granite detail tile the site's stones sample (site/img/granite-detail.webp).

The same recipe as the Blender granite in assets/stones/scripts/stone_materials.py (make_granite):
Voronoi crystals at three sizes plus dark mica, clustered by a slow noise, on a dark body. Baked once
here so the browser does one texture read per pixel instead of computing Voronoi live.

The tile is seamless and covers TILE metres of stone. Channels:
  R  albedo of the grains, gamma 2.2, scaled so 1.0 = ALB_MAX linear (the shader adds the body mottling)
  G  fine relief of the dressed face (grains + fine noise), for the bump
  B  broken-rock relief from the tiger_rock scan the renders use on the chipped sides

Run with Blender (it has numpy and writes WebP):
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/gen-granite.py
"""
import os
import numpy as np
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "site", "img", "granite-detail.webp")
TIGER = os.path.join(ROOT, "assets", "stones", "_src", "tex", "tiger_rock_Displacement.png")

N = 1024          # texels per side
TILE = 0.2        # metres of stone per tile (0.2 mm per texel)
ALB_MAX = 0.13    # linear albedo stored as R = 1.0
rng = np.random.default_rng(7)

yy, xx = np.mgrid[0:N, 0:N].astype(np.float64)
U0, V0 = (xx + 0.5) / N, (yy + 0.5) / N          # 0..1 across the tile


def vnoise(g, u=U0, v=V0):
    """Seamless value noise with g cells per tile."""
    grid = rng.random((g, g))
    x, y = u * g, v * g
    i, j = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - i, y - j
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = grid[j % g, i % g]; b = grid[j % g, (i + 1) % g]
    c = grid[(j + 1) % g, i % g]; d = grid[(j + 1) % g, (i + 1) % g]
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


def fbm(g, octaves, u=U0, v=V0):
    s, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + vnoise(g * 2 ** o, u, v) * amp; tot += amp; amp *= 0.5
    return s / tot


def voronoi(cells_per_m, u, v):
    """Seamless Voronoi: nearest-point distance (in cells) and a random value per cell."""
    c = max(1, round(cells_per_m * TILE))
    pts = rng.random((c, c, 2)); rnd = rng.random((c, c))
    x, y = u * c, v * c
    ci, cj = np.floor(x).astype(int), np.floor(y).astype(int)
    best = np.full(x.shape, 1e9); val = np.zeros(x.shape)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ii, jj = ci + di, cj + dj
            px = ii + pts[jj % c, ii % c, 0]; py = jj + pts[jj % c, ii % c, 1]
            d = (x - px) ** 2 + (y - py) ** 2
            m = d < best
            best = np.where(m, d, best); val = np.where(m, rnd[jj % c, ii % c], val)
    return np.sqrt(best), val


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# warp the crystal lattice a little (the recipe offsets by noise * 4 mm)
wu = (fbm(8, 2) - 0.5) * (0.004 / TILE) * 2
wv = (fbm(8, 2) - 0.5) * (0.004 / TILE) * 2
U, V = (U0 + wu) % 1.0, (V0 + wv) % 1.0

cluster = np.clip((fbm(2, 3) - 0.38) / 0.24, 0, 1)
mott = fbm(4, 4)


def grains(cells_per_m, lo, hi, clustered=True):
    dist, cell = voronoi(cells_per_m, U, V)
    k = cluster if clustered else np.clip((mott - 0.0) / 1.0, 0, 1)
    th = hi - (hi - lo) * k
    return smoothstep(th, th + 0.012, cell), dist


gA, dA = grains(170, 0.975, 0.998)          # big pale quartz/feldspar crystals
gB, _ = grains(420, 0.90, 0.975)            # mid grey grains
gC, _ = grains(1100, 0.78, 0.92)            # fine pale salt
gM, _ = grains(650, 0.80, 0.90, False)      # dark mica

body = 0.034
col = np.full((N, N), body)
col = col + (0.05 - col) * gC
col = col + (0.085 - col) * gB
tintA = 0.06 + (0.12 - 0.06) * np.clip(dA, 0, 1)
col = col + (tintA - col) * gA
col = col + (0.004 - col) * gM

R = np.clip(col / ALB_MAX, 0, 1) ** (1 / 2.2)
G = np.clip(0.5 * fbm(36, 3) + 0.35 * (gA + 0.6 * gB) - 0.25 * gM + 0.15, 0, 1)

# tiger_rock displacement → B, resampled to N
timg = bpy.data.images.load(TIGER)
tw, th_ = timg.size
tpx = np.array(timg.pixels[:], dtype=np.float32).reshape(th_, tw, 4)[::-1, :, 0]   # top-down
step = tw // N
B = tpx[:N * step:step, :N * step:step] if step >= 1 else tpx
B = (B - B.min()) / max(1e-6, B.max() - B.min())

img = bpy.data.images.new("granite_detail", N, N, alpha=False, float_buffer=False)
img.colorspace_settings.name = "Non-Color"
px = np.stack([R, G, B, np.ones_like(R)], axis=-1)[::-1].astype(np.float32)   # Blender stores bottom-up
img.pixels.foreach_set(px.ravel())
img.filepath_raw = OUT
img.file_format = "WEBP"
try:
    img.save(quality=92)
except TypeError:
    img.save()
print("wrote", OUT, os.path.getsize(OUT), "bytes")
