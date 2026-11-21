"""Numpy-прототип шейдера волны: та же математика, что в SkSL, чтобы посмотреть кадры до сборки."""
import sys
import numpy as np
from PIL import Image

W, H, S = 605, 222, 2  # dp и масштаб рендера


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def fract(x):
    return x - np.floor(x)


def hash1(n):
    return fract(np.sin(n * 12.9898 + 4.1414) * 43758.5453)


def shape(u, t, seed, level, speak):
    h = np.zeros_like(u)
    centers = (0.2, 0.35, 0.5, 0.66, 0.81)
    widths = (0.07, 0.065, 0.1, 0.075, 0.065)
    base = (0.42, 0.55, 1.0, 0.68, 0.5)
    for i in range(5):
        fi = float(i)
        c = centers[i] + 0.03 * np.sin(t * (0.45 + 0.13 * fi) + seed * 2.1 + fi * 1.7)
        osc = 0.5 + 0.5 * np.sin(t * (1.1 + 0.37 * fi + seed * 0.3) + fi * 2.3 + seed)
        syl = 0.5 + 0.5 * np.sin(t * (7.0 + 1.9 * fi) + seed * 3.0) * np.sin(t * (2.3 + 0.7 * fi) + fi)
        a = base[i] * (0.62 + 0.38 * osc) * (1.0 + level * (0.5 + 1.1 * syl) + speak * (0.2 + 1.0 * syl))
        w = widths[i] * (1.0 + 0.25 * np.sin(t * 0.7 + fi + seed))
        d = (u - c) / w
        h += a * np.exp(-d * d)
    ripple = 0.05 * np.sin(u * 46.0 - t * (3.0 + 6.0 * level) + seed * 5.0)
    return h * (1.0 + ripple)


def frame(t, level=0.0, energy=0.75, speak=0.0, think=0.0, dim=0.0, px=1.0 / S):
    ys, xs = np.mgrid[0:H * S, 0:W * S].astype(np.float64) / S
    x = xs / W
    py = ys / H
    base = 0.6
    maxh = 0.5
    u = (x - 0.055) / 0.89
    inside = ((u > 0) & (u < 1)).astype(float)
    env = inside * np.sin(np.pi * np.clip(u, 0, 1)) ** 1.5
    aa = px / H * 1.2
    activity = np.clip(level + speak * 0.7, 0, 1)

    scan_x = 0.5 + 0.47 * np.sin(t * 1.7)
    scan = think * np.exp(-((x - scan_x) / 0.07) ** 2)

    amp = energy + level * 0.6 + speak * 0.25 + scan * 0.6
    col = np.zeros(xs.shape + (3,))

    bar_pitch = 5.4 / W
    bx = fract(x / bar_pitch)
    bar_id = np.floor(x / bar_pitch)
    bar = 1.0 - smoothstep(0.16, 0.16 + 1.2 * px / 5.4, np.abs(bx - 0.5))

    deep = mix(np.array([0.16, 0.10, 0.75]), np.array([0.32, 0.08, 0.7]), speak * 0.8)
    violet = mix(np.array([0.42, 0.30, 1.0]), np.array([0.7, 0.3, 1.0]), speak * 0.8)
    lilac = np.array([0.78, 0.66, 1.0])
    pink = np.array([1.0, 0.78, 0.95])
    cyan = np.array([0.35, 0.85, 1.0])

    front_top = None
    for seed, scale, strength, bars in ((2.6, 1.12, 0.35, 0), (1.3, 0.92, 0.55, 0), (0.0, 1.0, 1.0, 1)):
        hn = amp * scale * 0.8 * shape(u, t * (0.92 + 0.06 * seed), seed, level, speak)
        hn = np.minimum(hn / (1.0 + 0.45 * hn) * 0.95, 1.0)
        hgt = maxh * hn * env
        top = base - hgt - 0.004 * env
        rel = hgt / maxh
        below = smoothstep(top - aa, top + aa, py) * (1 - smoothstep(base - aa, base + aa, py))
        depth = np.clip((py - top) / np.maximum(hgt, 1e-3), 0, 1)
        dist = np.abs(py - top) * H
        edge = smoothstep(0.0, 0.06, env)
        if bars:
            fill_col = mix(violet[None, None], deep[None, None], depth[..., None])
            fill_col = mix(fill_col, lilac[None, None], (np.clip(1 - depth * 3, 0, 1) * rel)[..., None] * 0.7)
            body = below * (0.16 + 0.84 * bar) * (1.0 - 0.45 * depth)
            rh = hgt * 0.62
            refl_in = smoothstep(base - aa, base + aa, py) * (1 - smoothstep(base + rh - aa, base + rh + aa, py))
            rdepth = np.clip((py - base) / np.maximum(rh, 1e-3), 0, 1)
            refl = refl_in * bar * (1 - rdepth) ** 2 * 0.4
            col += fill_col * (body * strength)[..., None] + violet[None, None] * (refl * strength)[..., None]
            rim_col = mix(lilac[None, None], pink[None, None], smoothstep(0.35, 0.9, rel)[..., None])
            rim = (np.exp(-dist / 1.0) * 1.1 + 0.32 * np.exp(-dist / 6.0) + 0.1 * np.exp(-dist / 22.0)) * edge
            col += rim_col * rim[..., None]
            front_top = top
        else:
            body = below * 0.22 * (1 - depth) ** 1.5
            rim = (np.exp(-dist / 1.3) * 0.7 + 0.2 * np.exp(-dist / 8.0)) * edge
            c = violet if scale < 1 else deep * 1.6
            col += c[None, None] * ((body + rim) * strength)[..., None]

    r = hash1(bar_id)
    life = fract(t * (0.35 + 0.4 * r) + r * 7.0)
    on = (r > 0.72).astype(float)
    yp = front_top - life * (0.25 + 0.2 * r)
    dy = (py - yp) * H
    dx = (bx - 0.5) * 5.4
    dx = dx + np.sin(life * 6.0 + r * 30.0) * 1.2
    spark = on * np.exp(-(dx * dx + dy * dy) / 2.6) * (1 - life) ** 1.5 * (0.15 + 0.85 * activity) * smoothstep(0.05, 0.3, env)
    col += pink[None, None] * (spark * 2.2)[..., None]

    bl = np.exp(-np.abs(py - base) * H / 0.8) * smoothstep(0.0, 0.05, env + 0.02 * inside)
    col += np.array([0.5, 0.45, 1.0])[None, None] * (bl * 0.5)[..., None]

    col = mix(col, col.mean(-1, keepdims=True) * cyan[None, None] * 2.2, np.clip(scan, 0, 1)[..., None] * 0.85)
    col *= 1.0 - 0.55 * dim
    col = 1.0 - np.exp(-col * 1.2)
    bg = np.array([7, 5, 30]) / 255.0
    out = np.clip(bg + col, 0, 1)
    return (out * 255).astype(np.uint8)


STATES = {
    'idle': dict(energy=0.6),
    'listen': dict(energy=0.8),
    'user': dict(energy=0.8, level=0.75),
    'think': dict(energy=0.45, think=1.0),
    'agent': dict(energy=0.8, speak=1.0),
}

if __name__ == '__main__':
    imgs = []
    for name, kw in STATES.items():
        for t in (1.0, 2.3):
            imgs.append(Image.fromarray(frame(t, **kw)))
    w, h = imgs[0].size
    sheet = Image.new('RGB', (w * 2, h * len(STATES)))
    for i, im in enumerate(imgs):
        sheet.paste(im, ((i % 2) * w, (i // 2) * h))
    sheet.resize((w, h * len(STATES) // 2)).save(sys.argv[1] if len(sys.argv) > 1 else '/tmp/sheet.png')
