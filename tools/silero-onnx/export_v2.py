"""
Silero TTS v5 -> ONNX, по частям (v2).

Модель Silero состоит из:
  dur_predictor   — длительность каждого символа (в кадрах);
  pitch_predictor — интонация по символам (с учётом типа фразы и логического ударения *слово*);
  tacotron        — акустика: encoder (символы) -> растяжка по длительностям -> decoder (кадры мел-спектра);
  vocoder         — из мел-спектра в звук (Vocos: сеть + обратное FFT);
  accentor        — ударения и «ё» (n-граммы + маленькие классификаторы).

В ONNX уходят только чистые нейросети. Склейка (длительности, растяжка, iSTFT, текст -> символы,
ударения) — простой код; здесь он написан на numpy, ровно так, как будет на телефоне (Kotlin).
Скрипт сверяет каждую часть и итоговый звук с оригиналом и пишет отчёт.

Аргументы: <v5_5_ru.pt> <папка результата>
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
import wave
from pathlib import Path

import numpy as np
import torch

MODEL = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
APP = OUT / "app-assets"          # то, что поедет в приложение
APP.mkdir(exist_ok=True)
LOG = OUT / "log.txt"
LOG.write_text("", encoding="utf-8")
SPEAKER = "xenia"
SR = 48000
TEXTS = [
    "Привет! Я помогу тебе найти интересных людей. Расскажешь немного о себе?",
    "Понятно. А чем ты любишь заниматься по выходным, если не секрет?",
    "Валерия любит *грузинскую* кухню и сама неплохо готовит хинкали.",
]
report: dict = {"steps": {}}


def log(*parts):
    line = " ".join(str(p) for p in parts)
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def step(name, ok, **info):
    report["steps"][name] = {"ok": bool(ok), **info}
    log(f"[{'OK ' if ok else 'BAD'}] {name}", json.dumps(info, ensure_ascii=False)[:400])


def save_wav(path: Path, audio, rate=SR):
    a = np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def maxdiff(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    if a.shape != b.shape:
        return float("inf")
    return float(np.max(np.abs(a - b))) if a.size else 0.0


def snr_db(ref, got):
    ref = np.asarray(ref, dtype=np.float64).reshape(-1)
    got = np.asarray(got, dtype=np.float64).reshape(-1)
    n = min(len(ref), len(got))
    if n == 0:
        return -999.0
    noise = np.sum((ref[:n] - got[:n]) ** 2) + 1e-12
    return float(10 * np.log10(np.sum(ref[:n] ** 2) / noise + 1e-12))


torch.set_grad_enabled(False)
log("torch", torch.__version__, "| python", sys.version.split()[0])

# ---------------------------------------------------------------- 1. Модель
importer = torch.package.PackageImporter(str(MODEL))
model = importer.load_pickle("tts_models", "model")
pack = model.packages[model.speaker_to_package[SPEAKER]]
if not pack.q_model_unpacked:
    torch._C._jit_set_profiling_mode(False)
    pack.unpack_q_model()
    pack.q_model_unpacked = True
speaker_ids, model_id = pack.get_speakers(SPEAKER)
tts = pack.models[model_id]
tac = tts.tacotron
voc = tts.vocoder
log("pack:", type(pack).__name__, "| tts:", type(tts).__name__, "| speaker ids:", speaker_ids, "model", model_id)
log("accentor:", type(pack.accentor).__name__, "| attrs:", {k: type(v).__name__ for k, v in vars(pack.accentor).items()})

# Найти n-граммный акцентор (ударения + ё) внутри обёртки акцентора.
ngram_acc = None
homo = None
for cand in [pack.accentor, *vars(pack.accentor).values()]:
    if hasattr(cand, "_get_model_preds") and ngram_acc is None:
        ngram_acc = cand
    if type(cand).__name__.lower().startswith("homo") and homo is None:
        homo = cand
log("ngram accentor:", type(ngram_acc).__name__ if ngram_acc else None, "| homosolver:", type(homo).__name__ if homo else None)

# ---------------------------------------------------------------- 2. Конфиг для телефона
head = voc.head
istft = head.istft
cfg = {
    "speaker": SPEAKER,
    "speakers": {sp: {"ids": pack.get_speakers(sp)[0], "model": pack.get_speakers(sp)[1]} for sp in pack.speakers},
    "symbols": pack.symbols,
    "symbol_to_id": pack.symbol_to_id,
    "sos": pack.sos_token, "eos": pack.eos_token,
    "alphabet": "".join(pack.alphabet) if not pack.phons else None,
    "punkt_symbols": list(tts.punkt_symbols), "comma_ids": list(tts.comma_ids), "point_id": int(tts.point_id),
    "mean_std_coef": list(tts.mean_std_coef), "sil_value": float(tts.sil_value),
    "pitch_emb_type": tac.pitch_emb_type, "pitch_strength": float(tac.pitch_strength),
    "n_mel": int(tac.n_mel_channels),
    "istft": {"padding": istft.padding, "n_fft": int(istft.n_fft), "hop": int(istft.hop_length), "win": int(istft.win_length)},
    "type2id": {"st": 0, "wh_q": 1, "general_q": 2, "alternative_q": 3, "tag_q": 4, "exclam": 5},
    "sample_rate": SR,
}
np.asarray(istft.window.detach().numpy(), dtype=np.float32).tofile(APP / "istft_window.f32")
(APP / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
log("config:", json.dumps({k: v for k, v in cfg.items() if k not in ("symbol_to_id", "speakers")}, ensure_ascii=False))


# ---------------------------------------------------------------- 3. Обёртки нейросетей
class Dur(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, seq, spk):
        return self.m(seq, spk, seq.eq(0), 1.0, None)


class Pitch(torch.nn.Module):
    def __init__(self, m, focus):
        super().__init__()
        self.m = m
        self.focus = focus

    def forward(self, seq, spk, type_ids, focus_mask):
        if self.focus:
            return self.m(seq, spk, seq.eq(0), type_ids, focus_mask)
        return self.m(seq, spk, seq.eq(0), type_ids, None)


class Encoder(torch.nn.Module):
    """embedding + encoder + голос + интонация; растяжку по длительностям делает приложение."""

    def __init__(self, t):
        super().__init__()
        if t.pitch_emb_type != "default":
            raise RuntimeError("pitch_emb_type " + t.pitch_emb_type + " is not supported yet")
        self.embedding = t.embedding
        self.encoder = t.encoder
        self.speaker_embedding = t.speaker_embedding
        self.pitch_proj = t.pitch_proj
        self.strength = float(t.pitch_strength)

    def forward(self, seq, spk, pitch):
        x = self.embedding(seq)
        enc = self.encoder(x, seq.eq(0), None)
        enc = enc + self.speaker_embedding(spk).unsqueeze(1).expand(-1, x.shape[1], -1)
        pp = self.pitch_proj(pitch).transpose(1, 2)
        return enc + pp * self.strength


class Decoder(torch.nn.Module):
    def __init__(self, t):
        super().__init__()
        self.decoder = t.decoder
        self.lin = t.lin

    def forward(self, expanded):
        return self.lin(self.decoder(expanded, None, None)).transpose(1, 2)


class Vocoder(torch.nn.Module):
    """сеть вокодера до iSTFT: амплитуда и фаза; обратное FFT делает приложение."""

    def __init__(self, v):
        super().__init__()
        self.backbone = v.backbone
        self.out = v.head.out

    def forward(self, mel):
        x = self.backbone(mel)
        o = self.out(x).transpose(1, 2)
        half = o.shape[1] // 2
        mag = o[:, :half, :]
        p = o[:, half:, :]
        return torch.clamp(torch.exp(mag), max=100.0), p


# ---------------------------------------------------------------- 4. Склейка на numpy (как будет в Kotlin)
SYMBOLS = pack.symbols
S2I = pack.symbol_to_id
VOWELS = "аоуыэиеяёю"


def prepare_text(text: str) -> str:
    text = text.lower().replace("—", "–").replace("‑", "-")
    text = re.sub(r"[^{}]".format(SYMBOLS[3:] + r"\^"), "", text)
    text = text.replace("^", " ^")
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("^ ", "^")
    text = re.sub(r"\^+", "^", text).strip()
    if text and text[-1] == "^":
        text = text[:-1].strip()
    return text


def text_to_ids(text: str) -> np.ndarray:
    return np.array([S2I[c] for c in pack.sos_token + text + pack.eos_token], dtype=np.int64)


def length_regulate(enc: np.ndarray, dur: np.ndarray) -> np.ndarray:
    reps = np.floor(np.maximum(dur, 0) + 0.5).astype(np.int64)
    return np.repeat(enc, reps, axis=1)


def post_durations(log_dur: np.ndarray) -> np.ndarray:
    d = np.exp(log_dur) - 1
    d[d < 0] = 0
    d = np.round(d)
    if d[0, 0] > 5:
        d[0, 0] = 5
    d = np.round(d / 1.0)
    if d[0, 0] > 5:
        d[0, 0] = 5
    if d[0, -1] > 7:
        d[0, -1] = 7
    d[0, -2] = 13
    if d[0, -3] > 13:
        d[0, -3] = 13
    return d


def istft_np(mag: np.ndarray, phase: np.ndarray) -> np.ndarray:
    c = cfg["istft"]
    n_fft, hop, win = c["n_fft"], c["hop"], c["win"]
    window = np.fromfile(APP / "istft_window.f32", dtype=np.float32).astype(np.float64)
    spec = mag[0].astype(np.float64) * (np.cos(phase[0]) + 1j * np.sin(phase[0]))
    frames = np.fft.irfft(spec, n=n_fft, axis=0)            # [n_fft, T]
    T = frames.shape[1]
    if c["padding"] == "same":
        pad = (win - hop) // 2
        frames = frames[:win] * window[:, None]
        size = (T - 1) * hop + win
        y = np.zeros(size)
        env = np.zeros(size)
        for t in range(T):
            y[t * hop: t * hop + win] += frames[:, t]
            env[t * hop: t * hop + win] += window ** 2
        return (y[pad: size - pad] / env[pad: size - pad]).astype(np.float32)
    # center (torch.istft default)
    frames = frames * window[:, None]
    size = n_fft + hop * (T - 1)
    y = np.zeros(size)
    env = np.zeros(size)
    for t in range(T):
        y[t * hop: t * hop + n_fft] += frames[:, t]
        env[t * hop: t * hop + n_fft] += window ** 2
    half = n_fft // 2
    y = y[half: size - half]
    env = env[half: size - half]
    env[env < 1e-11] = 1
    return (y / env).astype(np.float32)


# ---------------------------------------------------------------- 5. Экспорт
import onnx  # noqa: E402
import onnxruntime as ort  # noqa: E402

sessions = {}

# Служебные проверки «быстрого режима» внутри стандартного трансформера PyTorch. ONNX их не знает,
# а для синтеза они не нужны: подменяем константами так, чтобы всегда шёл обычный путь вычислений.
FASTPATH_FLAGS = [("prim::is_nested", False), ("aten::is_autocast_enabled", False),
                  ("aten::is_autocast_cpu_enabled", False), ("aten::is_grad_enabled", True)]


def strip_fastpaths(module):
    try:
        module = torch.jit.freeze(module)
    except Exception as e:
        log("   freeze failed, continue unfrozen:", str(e).splitlines()[0][:200])
    g = module.graph
    torch._C._jit_pass_inline(g)
    replaced = 0
    for kind, value in FASTPATH_FLAGS:
        for node in g.findAllNodes(kind, recurse=True):
            const = g.insertConstant(value)
            const.node().moveBefore(node)
            node.output().replaceAllUsesWith(const)
            node.destroy()
            replaced += 1
    torch._C._jit_pass_constant_propagation(g)
    torch._C._jit_pass_dce(g)
    log(f"   fast-path checks removed: {replaced}")
    return module


def export(name, module, args, in_names, out_names, dyn, tol=1e-3):
    path = APP / f"{name}.onnx"
    t0 = time.time()
    try:
        # Части Silero — скомпилированные TorchScript-модули: их нельзя «трассировать» насквозь,
        # поэтому обёртку тоже компилируем и отдаём в ONNX готовый граф.
        module = torch.jit.script(module.eval())
        module.eval()
        module = strip_fastpaths(module)
        torch.onnx.export(module, args, str(path), input_names=in_names, output_names=out_names,
                          dynamic_axes=dyn, opset_version=17, dynamo=False)
        onnx.checker.check_model(str(path))
        sessions[name] = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        want = module(*args)
        want = [want] if isinstance(want, torch.Tensor) else list(want)
        got = sessions[name].run(None, {n: a.detach().numpy() for n, a in zip(in_names, args)})
        diff = max(maxdiff(g, w.detach().numpy()) for g, w in zip(got, want))
        step(f"export {name}", diff < tol, mb=round(path.stat().st_size / 1e6, 1), sec=round(time.time() - t0, 1), max_diff=diff)
    except Exception as e:
        (OUT / f"{name}.export-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        step(f"export {name}", False, error=str(e).splitlines()[0][:300])


spk_t = torch.LongTensor(speaker_ids)
probe_seq = torch.from_numpy(text_to_ids(prepare_text("привет, как дела?"))).unsqueeze(0)
T_ = probe_seq.shape[1]
zeros_T = torch.zeros(1, T_, dtype=torch.long)
focus_row0 = tts.pitch_predictor.pitch_pred.focus_embedding.weight[0].abs().max().item()
need_focus_model = focus_row0 > 0
log("focus embedding row 0 max:", focus_row0, "-> separate focus model:", need_focus_model)

export("dur", Dur(tts.dur_predictor), (probe_seq, spk_t), ["seq", "spk"], ["log_dur"],
       {"seq": {1: "T"}, "log_dur": {1: "T"}})
export("pitch", Pitch(tts.pitch_predictor, False), (probe_seq, spk_t, zeros_T, zeros_T),
       ["seq", "spk", "type_ids", "focus"], ["pitch"], {"seq": {1: "T"}, "type_ids": {1: "T"}, "focus": {1: "T"}, "pitch": {2: "T"}})
export("pitch_focus", Pitch(tts.pitch_predictor, True), (probe_seq, spk_t, zeros_T, zeros_T),
       ["seq", "spk", "type_ids", "focus"], ["pitch"], {"seq": {1: "T"}, "type_ids": {1: "T"}, "focus": {1: "T"}, "pitch": {2: "T"}})
probe_pitch = tts.pitch_predictor(probe_seq, spk_t, probe_seq.eq(0), zeros_T, None)
export("encoder", Encoder(tac), (probe_seq, spk_t, probe_pitch), ["seq", "spk", "pitch"], ["enc"],
       {"seq": {1: "T"}, "pitch": {2: "T"}, "enc": {1: "T"}})
probe_enc = Encoder(tac)(probe_seq, spk_t, probe_pitch)
probe_exp = torch.repeat_interleave(probe_enc, 4, dim=1).contiguous()
export("decoder", Decoder(tac), (probe_exp,), ["expanded"], ["mel"], {"expanded": {1: "F"}, "mel": {2: "F"}})
probe_mel = Decoder(tac)(probe_exp)
export("vocoder", Vocoder(voc), (probe_mel,), ["mel"], ["mag", "phase"], {"mel": {2: "F"}, "mag": {2: "F"}, "phase": {2: "F"}})

# Акцентор: таблица n-грамм + классификаторы.
if ngram_acc is not None:
    try:
        emb = ngram_acc.model.embedding
        ngram_dict = emb.ngram_dict
        grams = sorted(ngram_dict.items(), key=lambda kv: kv[1])
        (APP / "accent_ngrams.txt").write_text("\n".join(g for g, _ in grams), encoding="utf-8")
        emb.weight.detach().numpy().astype(np.float32).tofile(APP / "accent_emb.f32")
        exc = getattr(ngram_acc, "exceptions", {}) or {}
        (APP / "accent_exceptions.tsv").write_text("\n".join(f"{w}\t{s}\t{y}" for w, (s, y) in exc.items()), encoding="utf-8")
        log("accentor: ngrams", len(grams), "| emb", tuple(emb.weight.shape), "| exceptions", len(exc))

        class Heads(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.stress_clf = m.stress_clf
                self.yo_clf = m.yo_clf

            def forward(self, e):
                return self.stress_clf(e), self.yo_clf(e)

        export("accent_heads", Heads(ngram_acc.model), (torch.zeros(3, emb.weight.shape[1]),), ["emb"], ["stress", "yo"],
               {"emb": {0: "N"}, "stress": {0: "N"}, "yo": {0: "N"}}, tol=2e-2)
    except Exception as e:
        step("export accentor", False, error=str(e)[:300])
        (OUT / "accentor.export-error.txt").write_text(traceback.format_exc(), encoding="utf-8")


# ---------------------------------------------------------------- 6. Акцентор на numpy (как будет в Kotlin)
def ngrams_of(word: str):
    out = []
    t = "<" + word + ">"
    for n in range(1, len(word) + 3 + 1):
        out += [t[i:i + n] for i in range(len(t) - n + 1)]
    if len(word) < 1:
        out.append(word)
    return out


_emb = None
_g2i = None


def accent_np(sentence: str) -> str:
    """Порт AccentorNgram.__call__ (put_stress=True, put_yo=True, stress_single_vowel=True)."""
    global _emb, _g2i
    if _emb is None:
        names = (APP / "accent_ngrams.txt").read_text(encoding="utf-8").split("\n")
        _g2i = {g: i for i, g in enumerate(names)}
        _emb = np.fromfile(APP / "accent_emb.f32", dtype=np.float32).reshape(len(names), -1)
    exc = {}
    p = APP / "accent_exceptions.tsv"
    if p.stat().st_size:
        for line in p.read_text(encoding="utf-8").split("\n"):
            w, s, y = line.split("\t")
            exc[w] = (int(s), int(y))
    tokens, clean, mask = [], [], []
    for word in re.split(r"([\s.,!?;:<>=()/\\]+)", sentence):
        parts = word.split("-")
        if len(parts) == 1:
            cur, cm = parts, [True]
        else:
            cur = [x + "-" for x in parts[:-1]] + [parts[-1]]
            cm = [True for _ in parts[:-1]] + [parts[-1] != "то"]
        ci = [re.sub(r"[^А-Яа-яёЁ]", "", t.lower()) for t in cur]
        cm = [len(x) > 0 and m for x, m in zip(ci, cm)]
        tokens += cur
        clean += ci
        mask += cm
    vecs = []
    for w in clean:
        ids = [_g2i[g] for g in ngrams_of(w) if g in _g2i] or [_g2i["UNK"]]
        vecs.append(_emb[ids].mean(axis=0))
    st, yo = sessions["accent_heads"].run(None, {"emb": np.stack(vecs).astype(np.float32)})

    def softmax(x):
        e = np.exp(x - x.max(axis=1, keepdims=True))
        return e / e.sum(axis=1, keepdims=True)
    sp, yp = softmax(st), softmax(yo)
    out = []
    for i, (raw, cw, need) in enumerate(zip(tokens, clean, mask)):
        low = raw.lower()
        if not need:
            out.append(raw)
            continue
        have_stress, have_yo = "+" in low, "ё" in low
        if have_stress and have_yo:
            out.append(raw)
            continue
        if not have_stress and have_yo:
            pos = [k for k, ch in enumerate(low) if ch == "ё"]
            for k, yp_ in enumerate(pos):
                raw = raw[:yp_ + k] + "+" + raw[yp_ + k:]
            out.append(raw)
            continue
        if cw in exc:
            s_pos, y_pos = exc[cw]
            if y_pos != -1:
                raw = raw[:y_pos] + ("ё" if raw[y_pos].islower() else "Ё") + raw[y_pos + 1:]
            out.append(raw[:s_pos] + "+" + raw[s_pos:])
            continue
        s_idx = int(sp[i].argmax())
        set_stress = sp[i][s_idx] > 0.5 and not have_stress
        y_idx = int(yp[i].argmax())
        set_yo = yp[i][y_idx] > 0.5
        vowel_ids = [k for k, ch in enumerate(low) if ch in VOWELS]
        ye_ids = [k for k, ch in enumerate(low) if ch == "е"]
        stress_pos = [vowel_ids[s_idx]] if s_idx < len(vowel_ids) else []
        yo_pos = [ye_ids[y_idx - 1]] if 0 < y_idx and y_idx - 1 < len(ye_ids) else []
        if not vowel_ids:
            out.append(raw)
            continue
        for y in yo_pos:
            if y in stress_pos and set_yo and low[y] == "е":
                raw = raw[:y] + ("ё" if raw[y].islower() else "Ё") + raw[y + 1:]
        if len(vowel_ids) == 1:
            stress_pos = [vowel_ids[0]]
            set_stress = True
        if not have_stress and set_stress:
            for k, s in enumerate(stress_pos):
                raw = raw[:s + k] + "+" + raw[s + k:]
        out.append(raw)
    return "".join(out)


# ---------------------------------------------------------------- 7. Синтез целиком из ONNX
pkg_mod = importer.import_module(type(pack).__module__)
classify_text = pkg_mod.classify_text


def type_ids_for(text: str, T: int) -> np.ndarray:
    t = pack.build_type_ids_inference(text, classify_text(text), T)
    return t.numpy().astype(np.int64)


def focus_for(accented: str, original: str, T: int):
    if "*" not in original:
        return None
    focus_words = [w.replace("*", "").replace("+", "").lower() for w in original.split() if "*" in w]
    marked = []
    for w in accented.split():
        cw = w.replace("+", "").lower()
        if cw in focus_words:
            marked.append("*" + w + "*")
            focus_words.remove(cw)
        else:
            marked.append(w)
    _, fm = pack.parse_focus_from_text(" ".join(marked), T, intensity=3)
    return fm.numpy().astype(np.int64)


def synth_onnx(text: str):
    t0 = time.time()
    plain = text.replace("*", "")
    sentence = prepare_text(plain)
    accented = accent_np(sentence)
    seq = text_to_ids(accented)[None, :]
    spk = np.array(speaker_ids, dtype=np.int64)
    T = seq.shape[1]
    log_dur = sessions["dur"].run(None, {"seq": seq, "spk": spk})[0]
    dur = post_durations(log_dur)
    tids = type_ids_for(plain, T)
    fm = focus_for(accent_np(prepare_text(plain)), text, T)
    pname = "pitch_focus" if fm is not None else "pitch"
    pitch = sessions[pname].run(None, {"seq": seq, "spk": spk, "type_ids": tids,
                                       "focus": fm if fm is not None else np.zeros((1, T), np.int64)})[0]
    pitch[np.abs(pitch) < 0.001] = 0      # update_pitch_coef при коэффициенте 1
    enc = sessions["encoder"].run(None, {"seq": seq, "spk": spk, "pitch": pitch.astype(np.float32)})[0]
    expanded = length_regulate(enc, dur[0])
    mel = sessions["decoder"].run(None, {"expanded": expanded.astype(np.float32)})[0]
    mag, phase = sessions["vocoder"].run(None, {"mel": mel})
    audio = istft_np(mag, phase)
    return audio, {"accented": accented, "seq": seq, "dur": dur, "mel": mel, "sec": time.time() - t0}


# ---------------------------------------------------------------- 8. Проверка
if all(k in sessions for k in ("dur", "pitch", "encoder", "decoder", "vocoder", "accent_heads")):
    for i, text in enumerate(TEXTS, 1):
        try:
            plain = text.replace("*", "")
            # Оригинал без омографов (их BERT пока не переносим) — честное сравнение.
            t0 = time.time()
            ref = model.apply_tts(text=text, speaker=SPEAKER, sample_rate=SR, put_accent=True, put_yo=True,
                                  put_stress_homo=False, put_yo_homo=False)
            ref_sec = time.time() - t0
            ref_full = model.apply_tts(text=text, speaker=SPEAKER, sample_rate=SR)
            save_wav(OUT / f"{i}-original.wav", ref_full)
            save_wav(OUT / f"{i}-original-no-homographs.wav", ref)

            orig_acc = ngram_acc(prepare_text(plain), put_stress=True, put_yo=True, stress_single_vowel=True)
            my_acc = accent_np(prepare_text(plain))
            step(f"phrase {i}: accents", orig_acc == my_acc, original=orig_acc, ours=my_acc)

            audio, info = synth_onnx(text)
            save_wav(OUT / f"{i}-onnx.wav", audio)
            ref_np = ref.numpy()
            step(f"phrase {i}: audio", snr_db(ref_np, audio) > 30, snr_db=round(snr_db(ref_np, audio), 1),
                 len_ref=len(ref_np), len_onnx=len(audio), sec_onnx=round(info["sec"], 2), sec_torch=round(ref_sec, 2))
        except Exception as e:
            step(f"phrase {i}", False, error=str(e)[:300])
            (OUT / f"phrase{i}.error.txt").write_text(traceback.format_exc(), encoding="utf-8")
else:
    step("full synthesis", False, error="не все части экспортировались")

# ---------------------------------------------------------------- 9. Отчёт
(OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
lines = ["# Silero -> ONNX v2", "", "| Шаг | Итог | Детали |", "| --- | --- | --- |"]
for k, v in report["steps"].items():
    d = {kk: vv for kk, vv in v.items() if kk != "ok"}
    lines.append(f"| {k} | {'да' if v['ok'] else 'НЕТ'} | {json.dumps(d, ensure_ascii=False)[:160]} |")
total = sum(f.stat().st_size for f in APP.iterdir()) / 1e6
lines += ["", f"Файлы для приложения: app-assets ({total:.0f} МБ).",
          "Послушать: N-original.wav, N-original-no-homographs.wav, N-onnx.wav."]
(OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
log("\n".join(lines))
log("DONE")
