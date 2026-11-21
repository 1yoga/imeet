"""
Проба: перевести Silero TTS v5 (русский) в ONNX и проверить, что ONNX звучит так же, как оригинал.

Как работает (модель — чёрный ящик, исходников у нас нет):
1. Загружаем официальный пакет v5_5_ru.pt и синтезируем две разные фразы, как обычно.
2. По пути «подслушиваем» все внутренние нейросети модели: какие тензоры им подали и что они вернули.
3. Каждую такую нейросеть экспортируем в ONNX на подслушанных входах; длины, которые
   отличаются между двумя фразами, делаем переменными.
4. Запускаем ONNX в onnxruntime на тех же входах и сравниваем с оригиналом.
5. Пишем отчёт report.md + report.json и WAV-файлы для прослушивания.

Запуск: tools\\silero-onnx\\run.cmd (сам ставит Python-пакеты и скачивает модель).
Модели Silero — CC BY-NC-SA 4.0: результат только для проверки, не для релиза без лицензии.
"""
from __future__ import annotations

import json
import sys
import time
import traceback
import wave
from pathlib import Path

import numpy as np
import torch

OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("silero-onnx-out")
MODEL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("v5_5_ru.pt")
OUT.mkdir(parents=True, exist_ok=True)
LOG = OUT / "log.txt"
SPEAKER = "xenia"
RATE = 48000
TEXTS = [
    "Привет! Я помогу тебе найти интересных людей. Расскажешь немного о себе?",
    "Понятно. А чем ты любишь заниматься по выходным, если не секрет?",
]


def log(*parts):
    line = " ".join(str(p) for p in parts)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def save_wav(path: Path, audio, rate=RATE):
    a = np.asarray(audio, dtype=np.float32).reshape(-1)
    a = np.clip(a, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def describe(x):
    if isinstance(x, torch.Tensor):
        return {"tensor": list(x.shape), "dtype": str(x.dtype)}
    if isinstance(x, (list, tuple)):
        return [describe(i) for i in x]
    if isinstance(x, dict):
        return {k: describe(v) for k, v in x.items()}
    return repr(x)[:80]


def flat_tensors(x):
    if isinstance(x, torch.Tensor):
        return [x]
    if isinstance(x, (list, tuple)):
        return [t for i in x for t in flat_tensors(i)]
    if isinstance(x, dict):
        return [t for v in x.values() for t in flat_tensors(v)]
    return []


# ---------- 1. Загрузка ----------
LOG.write_text("", encoding="utf-8")
log("torch", torch.__version__, "| python", sys.version.split()[0])
# Исходники и данные пакета: по ним перенесём подготовку текста (ударения, символы) на телефон.
import zipfile  # noqa: E402

src_dir = OUT / "package-src"
src_dir.mkdir(exist_ok=True)
with zipfile.ZipFile(MODEL) as z, (OUT / "package-files.txt").open("w", encoding="utf-8") as listing:
    for info in z.infolist():
        listing.write(f"{info.file_size:>12}  {info.filename}\n")
        if info.filename.endswith((".py", ".txt", ".json", ".yml", ".yaml")) and info.file_size < 5_000_000:
            target = src_dir / info.filename.replace("/", "__")
            target.write_bytes(z.read(info))
log("package sources extracted to", src_dir)

importer = torch.package.PackageImporter(str(MODEL))
model = importer.load_pickle("tts_models", "model")
log("model type:", type(model).__name__)
attrs = {k: type(v).__name__ for k, v in vars(model).items()}
log("model attributes:", json.dumps(attrs, ensure_ascii=False))

def small(v):
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    if isinstance(v, (list, tuple)) and len(v) <= 5000 and all(isinstance(i, (str, int, float)) for i in v):
        return list(v)
    if isinstance(v, dict) and len(v) <= 5000:
        out = {}
        for k, i in v.items():
            si = small(i)
            if si is not None or i is None:
                out[str(k)] = si
        return out
    return None


plain = {k: small(v) for k, v in vars(model).items() if not isinstance(v, torch.nn.Module)}
(OUT / "model-attrs.json").write_text(json.dumps({k: v for k, v in plain.items() if v is not None}, ensure_ascii=False, indent=1), encoding="utf-8")
log("plain attributes saved: model-attrs.json")

speakers = getattr(model, "speakers", None)
if speakers and SPEAKER not in speakers:
    SPEAKER = list(speakers)[0]
log("speaker:", SPEAKER, "| all:", speakers)


# ---------- 2. Подслушиваем внутренние сети ----------
calls: dict[str, list] = {}


class Spy(torch.nn.Module):
    def __init__(self, name, inner):
        super().__init__()
        self.name = name
        self.inner = inner

    def forward(self, *args, **kwargs):
        out = self.inner(*args, **kwargs)
        calls.setdefault(self.name, []).append({"args": args, "kwargs": kwargs, "out": out})
        return out

    def __getattr__(self, item):
        try:
            return super().__getattr__(item)
        except AttributeError:
            pass
        inner = super().__getattr__("inner")
        attr = getattr(inner, item)
        if callable(attr) and not item.startswith("_") and not isinstance(attr, torch.nn.Module):
            key = f"{self.name}.{item}"

            def record(*args, **kwargs):
                out = attr(*args, **kwargs)
                calls.setdefault(key, []).append({"args": args, "kwargs": kwargs, "out": out})
                return out
            return record
        return attr


spied = {}
for name, value in list(vars(model).items()):
    if isinstance(value, torch.nn.Module):
        spied[name] = value
        setattr(model, name, Spy(name, value))
log("spied submodules:", list(spied))

reference = []
for i, text in enumerate(TEXTS):
    t0 = time.time()
    audio = model.apply_tts(text=text, speaker=SPEAKER, sample_rate=RATE, put_accent=True, put_yo=True)
    dt = time.time() - t0
    reference.append(audio)
    save_wav(OUT / f"original-{i + 1}.wav", audio)
    log(f"phrase {i + 1}: {len(audio) / RATE:.2f} s audio in {dt:.2f} s (PC CPU)")

class Method(torch.nn.Module):
    """Обёртка, чтобы экспортировать не forward, а другой метод скриптовой модели."""

    def __init__(self, inner, method):
        super().__init__()
        self.inner = inner
        self.method = method

    def forward(self, *args):
        return getattr(self.inner, self.method)(*args)


def target(key):
    owner, _, method = key.partition(".")
    return spied[owner] if not method else Method(spied[owner], method)


report = {"torch": torch.__version__, "speaker": SPEAKER, "submodules": {}}
for name, recs in calls.items():
    report["submodules"][name] = {
        "calls": len(recs),
        "first_call": {"args": describe(recs[0]["args"]), "kwargs": describe(recs[0]["kwargs"]), "out": describe(recs[0]["out"])},
        "scripted": isinstance(spied[name.partition(".")[0]], torch.jit.ScriptModule),
    }
    log(f"[{name}] calls={len(recs)} scripted={report['submodules'][name]['scripted']}")
    log("   in :", json.dumps(describe(recs[0]["args"]), ensure_ascii=False)[:600])
    log("   out:", json.dumps(describe(recs[0]["out"]), ensure_ascii=False)[:600])

for owner, module in spied.items():
    if isinstance(module, torch.jit.ScriptModule):
        try:
            names = module._c._method_names()
        except Exception:
            names = ["forward"]
        parts = []
        for m in names:
            try:
                parts.append(f"# ===== {m} =====\n" + getattr(module, m).code)
            except Exception as e:
                parts.append(f"# ===== {m} ===== (no code: {e})")
        (OUT / f"{owner}.code.txt").write_text("\n\n".join(parts), encoding="utf-8")
        log(f"[{owner}] methods:", names)

# ---------- 3–4. Экспорт и проверка ----------
import onnx  # noqa: E402
import onnxruntime as ort  # noqa: E402


def dynamic_axes_for(recs, n_inputs):
    """Оси, длина которых различается между вызовами (разные фразы), делаем переменными."""
    axes = {}
    shapes = [[tuple(t.shape) for t in flat_tensors(r["args"])] for r in recs]
    for idx in range(n_inputs):
        dims = {}
        for d in range(len(shapes[0][idx])):
            if len({s[idx][d] for s in shapes if idx < len(s) and d < len(s[idx])}) > 1:
                dims[d] = f"in{idx}_d{d}"
        if dims:
            axes[f"in{idx}"] = dims
    return axes


for name, recs in calls.items():
    entry = report["submodules"][name]
    if recs[0]["kwargs"]:
        entry["onnx"] = "skipped: called with keyword arguments"
        log(f"[{name}] skip: kwargs")
        continue
    args = recs[0]["args"]
    if not all(isinstance(a, torch.Tensor) for a in args):
        entry["onnx"] = "skipped: non-tensor arguments " + json.dumps(describe(args), ensure_ascii=False)[:300]
        log(f"[{name}] skip: non-tensor args")
        continue
    path = OUT / f"{name.replace('.', '_')}.onnx"
    in_names = [f"in{i}" for i in range(len(args))]
    out_list = flat_tensors(recs[0]["out"])
    out_names = [f"out{i}" for i in range(len(out_list))]
    axes = dynamic_axes_for(recs, len(args))
    for o in out_names:
        axes[o] = {d: f"{o}_d{d}" for d in range(out_list[int(o[3:])].dim())}
    t0 = time.time()
    try:
        with torch.no_grad():
            torch.onnx.export(
                target(name), tuple(args), str(path),
                input_names=in_names, output_names=out_names, dynamic_axes=axes,
                opset_version=17, dynamo=False,
            )
        onnx.checker.check_model(str(path))
        size_mb = path.stat().st_size / 1e6
        log(f"[{name}] exported {size_mb:.1f} MB in {time.time() - t0:.1f} s")
        entry["onnx"] = {"file": path.name, "size_mb": round(size_mb, 1)}
    except Exception as e:
        entry["onnx"] = "export failed: " + str(e).splitlines()[0][:400]
        (OUT / f"{name.replace('.', '_')}.export-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        log(f"[{name}] EXPORT FAILED:", str(e).splitlines()[0][:300])
        continue

    # Сверка на всех подслушанных вызовах (обе фразы).
    try:
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        diffs = []
        for k, rec in enumerate(recs):
            feeds = {n: t.detach().cpu().numpy() for n, t in zip(in_names, rec["args"])}
            t0 = time.time()
            got = sess.run(None, feeds)
            dt = time.time() - t0
            want = [t.detach().cpu().numpy() for t in flat_tensors(rec["out"])]
            same_shape = all(g.shape == w.shape for g, w in zip(got, want))
            diff = max(float(np.max(np.abs(g.astype(np.float64) - w.astype(np.float64)))) if g.shape == w.shape and g.size else float("inf")
                       for g, w in zip(got, want))
            diffs.append({"call": k + 1, "same_shape": same_shape, "max_abs_diff": diff, "ort_seconds": round(dt, 3)})
            big = [g for g in got if g.dtype.kind == "f" and g.size > RATE // 4]
            if big:
                save_wav(OUT / f"onnx-{name.replace('.', '_')}-{k + 1}.wav", big[0])
        entry["verify"] = diffs
        log(f"[{name}] verify:", json.dumps(diffs))
    except Exception as e:
        entry["verify"] = "onnxruntime failed: " + str(e).splitlines()[0][:400]
        log(f"[{name}] ONNXRUNTIME FAILED:", str(e).splitlines()[0][:300])

# ---------- 5. Итог ----------
ok = [n for n, e in report["submodules"].items() if isinstance(e.get("onnx"), dict)
      and isinstance(e.get("verify"), list) and all(v["same_shape"] and v["max_abs_diff"] < 1e-3 for v in e["verify"])]
report["verdict"] = {"converted_and_matching": ok, "total": len(calls)}
(OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

lines = ["# Silero → ONNX: отчёт", "", f"torch {torch.__version__}, голос {SPEAKER}", "",
         "| Часть модели | Экспорт | Совпадение с оригиналом |", "| --- | --- | --- |"]
for n, e in report["submodules"].items():
    ex = f"{e['onnx']['size_mb']} МБ" if isinstance(e.get("onnx"), dict) else str(e.get("onnx", "—"))[:80]
    ver = e.get("verify")
    if isinstance(ver, list):
        ver = ", ".join(f"фраза {v['call']}: {'да' if v['same_shape'] and v['max_abs_diff'] < 1e-3 else 'нет'} (Δ={v['max_abs_diff']:.1e})" for v in ver)
    lines.append(f"| {n} | {ex} | {ver or '—'} |")
lines += ["", f"Итого совпало: {len(ok)} из {len(calls)}.",
          "Послушать: original-*.wav (оригинал) и onnx-*.wav (ONNX), если есть."]
(OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
log("\n".join(lines))
log("DONE")
