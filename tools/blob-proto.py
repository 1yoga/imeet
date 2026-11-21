"""Прототип фона с глянцевыми «каплями» (numpy) — та же математика, что в SkSL."""
import sys
import numpy as np
from PIL import Image

W, H, S = 412, 852, 1


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def blobs(t):
    """Центры (доли ширины/высоты) и радиусы (доли ширины) капель в момент t."""
    out = []
    # кластер справа сверху
    for i, (cx, cy, r, sp, ph) in enumerate([(0.88, 0.07, 0.20, 0.35, 0.0), (0.70, 0.03, 0.13, 0.5, 1.7), (0.98, 0.20, 0.12, 0.42, 3.1)]):
        out.append((cx + 0.06 * np.sin(t * sp + ph), cy + 0.035 * np.cos(t * sp * 1.3 + ph), r * (1 + 0.12 * np.sin(t * 0.9 + ph))))
    # кластер слева снизу
    for i, (cx, cy, r, sp, ph) in enumerate([(0.06, 0.86, 0.17, 0.38, 0.6), (0.20, 0.97, 0.15, 0.47, 2.2), (-0.03, 0.74, 0.10, 0.55, 4.0)]):
        out.append((cx + 0.05 * np.sin(t * sp + ph), cy + 0.03 * np.cos(t * sp * 1.2 + ph), r * (1 + 0.12 * np.sin(t * 0.8 + ph))))
    return out


def card_sdf(px, py):
    # карточка: x 16..396, y 66..746 (dp), радиус 36
    cx, cy, hw, hh, r = 206, 406, 190 - 36, 340 - 36, 36
    qx = np.abs(px - cx) - hw
    qy = np.abs(py - cy) - hh
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def frame(t):
    ys, xs = np.mgrid[0:H * S, 0:W * S].astype(float) / S
    p = np.stack([xs / W, ys / W], -1)  # единицы — ширина экрана
    field = np.zeros(xs.shape)
    gx = np.zeros(xs.shape)
    gy = np.zeros(xs.shape)
    for cx, cy, r in blobs(t):
        dx = p[..., 0] - cx
        dy = p[..., 1] - cy * H / W
        d2 = dx * dx + dy * dy + 1e-4
        f = r * r / d2
        field += f
        gx += -2 * f * dx / d2
        gy += -2 * f * dy / d2
    # внутри карточки — мягче край (как под матовым стеклом)
    inside = 1 - smoothstep(-6, 6, card_sdf(xs, ys))
    soft = mix(0.06, 0.45, inside)
    body = smoothstep(1 - soft, 1 + soft, field)
    # общая «высота» жидкости h = 1 - 1/field (0 на краю, к 1 в толще); нормаль из её градиента —
    # капли сливаются в одну массу, без отдельного блика на каждой.
    f2 = np.maximum(field, 1e-3) ** 2
    hx = gx / f2 * 0.35
    hy = gy / f2 * 0.35
    inv = 1.0 / np.sqrt(hx * hx + hy * hy + 1.0)
    nx, ny, nz = -hx * inv, -hy * inv, inv
    # переливы: центр сиренево-белый, середина розоватая, бока сине-фиолетовые
    center = np.array([0.88, 0.84, 1.0])
    pink = np.array([0.96, 0.76, 0.97])
    violet = np.array([0.58, 0.52, 1.0])
    deep = np.array([0.34, 0.26, 0.96])
    shimmer = 0.5 + 0.5 * np.sin(5.0 * nx + 3.0 * ny + 0.5 * t)
    col = mix(deep, violet, smoothstep(0.0, 0.35, nz)[..., None])
    col = mix(col, mix(pink, center, shimmer[..., None]), smoothstep(0.35, 0.85, nz)[..., None])
    # свет слева сверху + блик
    lx, ly, lz = -0.45, -0.55, 0.70
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
    col = col * (0.72 + 0.4 * diff)[..., None]
    spec = np.clip(nx * lx + ny * ly + nz * lz, 0, 1) ** 12
    col = col + spec[..., None] * 0.35
    # светлая кайма (френель) по краю
    fres = (1 - nz) ** 4
    col = mix(col, np.array([0.92, 0.86, 1.0]), (fres * 0.6)[..., None])
    alpha = body * mix(1.0, 0.55, inside)
    bg = mix(np.array([7, 5, 30]) / 255, np.array([12, 8, 40]) / 255, (ys / H)[..., None])
    out = mix(bg, np.clip(col, 0, 1), alpha[..., None])
    # карточка поверх: тёмное стекло
    out = mix(out, np.array([0.17, 0.16, 0.27]), (inside * 0.72)[..., None])
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


if __name__ == '__main__':
    ims = [Image.fromarray(frame(t)) for t in (0, 2, 4, 6)]
    sheet = Image.new('RGB', (W * 4, H))
    for i, im in enumerate(ims):
        sheet.paste(im, (i * W, 0))
    sheet.resize((W * 2, H // 2)).save(sys.argv[1] if len(sys.argv) > 1 else '/tmp/blobs.png')
