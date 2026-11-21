"""
Silero TTS v5 -> ONNX, по частям (v3: слои пересобраны на обычном PyTorch).

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


# ---------------------------------------------------------------- 3. Нейросети заново на обычном PyTorch
# Части Silero скомпилированы (TorchScript). Экспорт скомпилированного графа в ONNX тащит за собой
# служебный код PyTorch и ломается. Поэтому пересобираем те же слои обычным PyTorch, переносим веса
# один в один, сверяем с оригиналом и экспортируем уже их — это стандартный, надёжный путь.
import torch.nn as nn  # noqa: E402

try:   # «быстрый» нативный путь внимания ONNX не понимает — выключаем, считаем обычным
    torch.backends.mha.set_fastpath_enabled(False)
except Exception:
    pass


def _first(v):
    return v[0] if isinstance(v, (tuple, list)) else v


def leaf(m):
    kind = m.original_name
    sd = {k: v.detach().clone() for k, v in m.state_dict().items()}
    if kind == "Conv1d":
        w = sd["weight"]
        c = nn.Conv1d(int(m.in_channels), int(m.out_channels), int(_first(m.kernel_size)), stride=int(_first(m.stride)),
                      padding=int(_first(m.padding)), dilation=int(_first(m.dilation)), groups=int(m.groups), bias="bias" in sd)
    elif kind in ("Linear", "NonDynamicallyQuantizableLinear"):
        w = sd["weight"]
        c = nn.Linear(w.shape[1], w.shape[0], bias="bias" in sd)
    elif kind == "LayerNorm":
        c = nn.LayerNorm(tuple(m.normalized_shape), eps=float(m.eps))
    elif kind == "Embedding":
        w = sd["weight"]
        c = nn.Embedding(w.shape[0], w.shape[1])
    elif kind == "ReLU":
        return nn.ReLU()
    elif kind == "Dropout":
        return nn.Identity()
    elif kind == "AvgPool1d":
        return nn.AvgPool1d(int(_first(m.kernel_size)), int(_first(m.stride)), int(_first(m.padding)),
                            ceil_mode=bool(m.ceil_mode), count_include_pad=bool(m.count_include_pad))
    else:
        raise RuntimeError("unknown layer " + kind)
    c.load_state_dict(sd)
    return c.eval()


def kids(m):
    return [c for _, c in m.named_children()]


class MHA(nn.Module):
    """Самовнимание, расписанное вручную: без «зашитых» длин (батч всегда 1, длина любая)."""

    def __init__(self, m):
        super().__init__()
        if m.bias_k is not None or not m._qkv_same_embed_dim:
            raise RuntimeError("unsupported attention variant")
        self.h = int(m.num_heads)
        self.c = int(m.embed_dim)
        self.d = self.c // self.h
        self.in_proj = nn.Linear(self.c, 3 * self.c)
        self.out_proj = nn.Linear(self.c, self.c)
        with torch.no_grad():
            self.in_proj.weight.copy_(m.in_proj_weight)
            self.in_proj.bias.copy_(m.in_proj_bias)
            self.out_proj.weight.copy_(m.out_proj.weight)
            self.out_proj.bias.copy_(m.out_proj.bias)

    def forward(self, x):            # x: [1, T, C]
        qkv = self.in_proj(x)
        q = qkv[..., : self.c].reshape(1, -1, self.h, self.d).transpose(1, 2)
        k = qkv[..., self.c: 2 * self.c].reshape(1, -1, self.h, self.d).transpose(1, 2)
        v = qkv[..., 2 * self.c:].reshape(1, -1, self.h, self.d).transpose(1, 2)
        att = torch.softmax(torch.matmul(q, k.transpose(2, 3)) * (self.d ** -0.5), dim=-1)
        y = torch.matmul(att, v).transpose(1, 2).reshape(1, -1, self.c)
        return self.out_proj(y)


class PosEnc(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.scale = nn.Parameter(m.scale.detach().clone())
        self.register_buffer("pe", m.pe.detach().clone())

    def forward(self, x):            # x: [T, B, C]
        idx = torch.cumsum(torch.ones_like(x[:, 0, 0], dtype=torch.long), 0) - 1   # 0..T-1 без «зашитой» длины
        return x + self.scale * self.pe.index_select(0, idx)


class FFT(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.attn = MHA(m.self_attn)
        self.conv1, self.conv2 = leaf(m.conv1), leaf(m.conv2)
        self.norm1, self.norm2 = leaf(m.norm1), leaf(m.norm2)
        self.use_linear = bool(m.use_linear)
        self.pitch_pred = bool(m.pitch_pred)

    def forward(self, src):
        src = self.norm1(src + self.attn(src))
        s3 = src if self.use_linear else src.transpose(1, 2)
        s26 = self.conv2(torch.relu(self.conv1(s3)))
        if self.pitch_pred:
            s28 = torch.relu(s26)
            s7 = s3 + s28 + s28
        else:
            s7 = s3 + s26
        s6 = s7 if self.use_linear else s7.transpose(1, 2)
        return self.norm2(s6)


class Transformer(nn.Module):        # ForwardTransformer
    def __init__(self, m):
        super().__init__()
        self.pos = PosEnc(m.pos_encoder)
        self.layers = nn.ModuleList([FFT(l) for l in kids(m.layers)])
        self.norm = leaf(m.norm)

    def forward(self, x):            # x: [B, T, C]
        x = self.pos(x.transpose(0, 1)).transpose(0, 1)
        for layer in self.layers:
            x = layer(x)
        return self.norm(x)


class Predictor(nn.Module):          # TransformerSeriesPredictor
    def __init__(self, m, use_focus, use_type=True):
        super().__init__()
        self.embedding = leaf(m.embedding)
        self.speaker_embedding = leaf(m.speaker_embedding)
        self.use_type = bool(m.utt_type_emb) and use_type
        self.use_focus = bool(m.focus_emb) and use_focus
        self.type_embedding = leaf(m.type_embedding)
        self.focus_embedding = leaf(m.focus_embedding)
        self.transformer = Transformer(m.transformer)
        self.lin = leaf(m.lin)

    def forward(self, x, spk, type_ids, focus):
        e = self.embedding(x)
        e = e + self.speaker_embedding(spk).unsqueeze(1)
        if self.use_type:
            e = e + self.type_embedding(type_ids)
        if self.use_focus:
            e = e + self.focus_embedding(focus)
        return self.lin(self.transformer(e))


class Dur(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.p = Predictor(m.dur_pred, False, False)   # оригинал не передаёт сюда тип фразы и фокус

    def forward(self, seq, spk):
        z = torch.zeros_like(seq)
        return self.p(seq, spk, z, z).squeeze(-1)


class Pitch(nn.Module):
    def __init__(self, m, focus):
        super().__init__()
        self.p = Predictor(m.pitch_pred, focus)

    def forward(self, seq, spk, type_ids, focus):
        return self.p(seq, spk, type_ids, focus).transpose(1, 2)


class Encoder(nn.Module):
    def __init__(self, t):
        super().__init__()
        if t.pitch_emb_type != "default":
            raise RuntimeError("pitch_emb_type " + t.pitch_emb_type + " is not supported yet")
        self.embedding = leaf(t.embedding)
        self.encoder = Transformer(t.encoder)
        self.speaker_embedding = leaf(t.speaker_embedding)
        self.pitch_proj = leaf(t.pitch_proj)
        self.strength = float(t.pitch_strength)

    def forward(self, seq, spk, pitch):
        x = self.encoder(self.embedding(seq))
        x = x + self.speaker_embedding(spk).unsqueeze(1)
        return x + self.pitch_proj(pitch).transpose(1, 2) * self.strength


class DecPre(nn.Module):             # позиции + первый слой «песочных часов»
    def __init__(self, d):
        super().__init__()
        self.pos = PosEnc(d.pos_encoder)
        self.layer = FFT(kids(d.pre_vanilla_layers)[0])

    def forward(self, x):
        return self.layer(self.pos(x.transpose(0, 1)).transpose(0, 1))


class DecMid(nn.Module):             # сжатие по времени -> слой -> обратно; вход уже дополнен до кратной длины
    def __init__(self, d):
        super().__init__()
        self.pool = leaf(d.downsample.avg_pool)
        self.layer = FFT(kids(d.shorten_layers)[1])   # как в оригинале: используется второй слой
        self.proj = leaf(d.upsample.proj)
        self.dim = int(d.upsample.dim)

    def forward(self, xp):
        down = self.pool(xp.transpose(1, 2)).transpose(1, 2)
        up = self.proj(self.layer(down))
        return up.reshape(1, -1, self.dim) + xp


class DecPost(nn.Module):
    def __init__(self, d, lin):
        super().__init__()
        self.layer = FFT(kids(d.post_vanilla_layers)[0])
        self.norm = leaf(d.norm)
        self.lin = leaf(lin)

    def forward(self, x):
        return self.lin(self.norm(self.layer(x))).transpose(1, 2)


class Vocoder(torch.nn.Module):
    """сеть вокодера до iSTFT: амплитуда и фаза; обратное FFT делает приложение (экспорт уже работал)."""

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


SHORTEN = int(tac.decoder.shorten_factor)
cfg["decoder_multiple"] = SHORTEN
(APP / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


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

def feeds(sess, names, arrays):
    have = {i.name for i in sess.get_inputs()}
    return {n: a for n, a in zip(names, arrays) if n in have}


def export(name, module, args, in_names, out_names, dyn, tol=1e-3, script=False, more=()):
    path = APP / f"{name}.onnx"
    t0 = time.time()
    try:
        # Части Silero — скомпилированные TorchScript-модули: их нельзя «трассировать» насквозь,
        # поэтому обёртку тоже компилируем и отдаём в ONNX готовый граф.
        module = module.eval()
        if script:
            module = torch.jit.script(module)
            module.eval()
        torch.onnx.export(module, args, str(path), input_names=in_names, output_names=out_names,
                          dynamic_axes=dyn, opset_version=17, dynamo=False)
        onnx.checker.check_model(str(path))
        sessions[name] = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        diff = 0.0
        for a in (args, *more):       # другая длина входа — ловим «зашитые» размеры
            with torch.no_grad():
                want = module(*a)
            want = [want] if isinstance(want, torch.Tensor) else list(want)
            got = sessions[name].run(None, feeds(sessions[name], in_names, [t.detach().numpy() for t in a]))
            diff = max(diff, max(maxdiff(g, w.detach().numpy()) for g, w in zip(got, want)))
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

def check(name, got, ref, tol=1e-3):
    d = maxdiff(got.detach().numpy(), ref.detach().numpy())
    step(f"rebuild {name}", d < tol, max_diff=d)
    return d < tol


mask = probe_seq.eq(0)
ok = True
try:
    dur_m, pitch_m, pitchf_m = Dur(tts.dur_predictor), Pitch(tts.pitch_predictor, False), Pitch(tts.pitch_predictor, True)
    enc_m, pre_m, mid_m, post_m = Encoder(tac), DecPre(tac.decoder), DecMid(tac.decoder), DecPost(tac.decoder, tac.lin)
    focus_probe = torch.zeros_like(probe_seq)
    focus_probe[0, 2:5] = 3
    ok &= check("dur", dur_m(probe_seq, spk_t), tts.dur_predictor(probe_seq, spk_t, mask, 1.0, None))
    ok &= check("pitch", pitch_m(probe_seq, spk_t, zeros_T, zeros_T), tts.pitch_predictor(probe_seq, spk_t, mask, zeros_T, None))
    ok &= check("pitch_focus", pitchf_m(probe_seq, spk_t, zeros_T, focus_probe),
                tts.pitch_predictor(probe_seq, spk_t, mask, zeros_T, focus_probe))
    probe_pitch = tts.pitch_predictor(probe_seq, spk_t, mask, zeros_T, None)
    ref_enc = tac.encoder(tac.embedding(probe_seq), mask, None)
    ref_enc = ref_enc + tac.speaker_embedding(spk_t).unsqueeze(1).expand(-1, T_, -1)
    ref_enc = ref_enc + tac.pitch_proj(probe_pitch).transpose(1, 2) * float(tac.pitch_strength)
    ok &= check("encoder", enc_m(probe_seq, spk_t, probe_pitch), ref_enc)
    probe_exp = torch.repeat_interleave(ref_enc, 4, dim=1).contiguous()   # длина 4*T — не кратна? проверим и дополнение
    L = probe_exp.shape[1] - 1
    probe_exp = probe_exp[:, :L].contiguous()
    pre = pre_m(probe_exp)
    padn = (-L) % SHORTEN
    xp = torch.nn.functional.pad(pre, (0, 0, 0, padn))
    mel_eager = post_m(mid_m(xp)[:, :L])
    ok &= check("decoder", mel_eager, tac.lin(tac.decoder(probe_exp, None, None)).transpose(1, 2))
except Exception as e:
    ok = False
    step("rebuild", False, error=str(e).splitlines()[0][:300])
    (OUT / "rebuild.error.txt").write_text(traceback.format_exc(), encoding="utf-8")

if ok:
    seq2 = torch.from_numpy(text_to_ids(prepare_text("ну что, пойдём сегодня вечером гулять в парк у реки?"))).unsqueeze(0)
    z2 = torch.zeros_like(seq2)
    f2 = torch.zeros_like(seq2)
    f2[0, 5:9] = 3
    pitch2 = tts.pitch_predictor(seq2, spk_t, seq2.eq(0), z2, None)
    exp2 = torch.repeat_interleave(enc_m(seq2, spk_t, pitch2), 3, dim=1)[:, :-2].contiguous()
    L2 = exp2.shape[1]
    xp2 = torch.nn.functional.pad(pre_m(exp2), (0, 0, 0, (-L2) % SHORTEN))
    export("dur", dur_m, (probe_seq, spk_t), ["seq", "spk"], ["log_dur"], {"seq": {1: "T"}, "log_dur": {1: "T"}},
           more=[(seq2, spk_t)])
    for nm, mod in (("pitch", pitch_m), ("pitch_focus", pitchf_m)):
        export(nm, mod, (probe_seq, spk_t, zeros_T, focus_probe), ["seq", "spk", "type_ids", "focus"], ["pitch"],
               {"seq": {1: "T"}, "type_ids": {1: "T"}, "focus": {1: "T"}, "pitch": {2: "T"}}, more=[(seq2, spk_t, z2, f2)])
    export("encoder", enc_m, (probe_seq, spk_t, probe_pitch), ["seq", "spk", "pitch"], ["enc"],
           {"seq": {1: "T"}, "pitch": {2: "T"}, "enc": {1: "T"}}, more=[(seq2, spk_t, pitch2)])
    export("dec_pre", pre_m, (probe_exp,), ["x"], ["y"], {"x": {1: "F"}, "y": {1: "F"}}, more=[(exp2,)])
    export("dec_mid", mid_m, (xp,), ["x"], ["y"], {"x": {1: "F"}, "y": {1: "F"}}, more=[(xp2,)])
    export("dec_post", post_m, (mid_m(xp)[:, :L].contiguous(),), ["x"], ["mel"], {"x": {1: "F"}, "mel": {2: "F"}},
           more=[(mid_m(xp2)[:, :L2].contiguous(),)])
    probe_mel = mel_eager
else:
    probe_mel = tac.lin(tac.decoder(torch.repeat_interleave(Encoder(tac)(probe_seq, spk_t, tts.pitch_predictor(probe_seq, spk_t, mask, zeros_T, None)), 4, dim=1), None, None)).transpose(1, 2)
export("vocoder", Vocoder(voc), (probe_mel.detach(),), ["mel"], ["mag", "phase"], {"mel": {2: "F"}, "mag": {2: "F"}, "phase": {2: "F"}}, script=True)

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
               {"emb": {0: "N"}, "stress": {0: "N"}, "yo": {0: "N"}}, tol=2e-2, script=True)
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
    pitch = sessions[pname].run(None, feeds(sessions[pname], ["seq", "spk", "type_ids", "focus"],
                                            [seq, spk, tids, fm if fm is not None else np.zeros((1, T), np.int64)]))[0]
    pitch[np.abs(pitch) < 0.001] = 0      # update_pitch_coef при коэффициенте 1
    enc = sessions["encoder"].run(None, {"seq": seq, "spk": spk, "pitch": pitch.astype(np.float32)})[0]
    expanded = length_regulate(enc, dur[0])
    L = expanded.shape[1]
    pre = sessions["dec_pre"].run(None, {"x": expanded.astype(np.float32)})[0]
    xp = np.pad(pre, ((0, 0), (0, (-L) % SHORTEN), (0, 0)))
    mid = sessions["dec_mid"].run(None, {"x": xp.astype(np.float32)})[0][:, :L]
    mel = sessions["dec_post"].run(None, {"x": np.ascontiguousarray(mid, dtype=np.float32)})[0]
    mag, phase = sessions["vocoder"].run(None, {"mel": mel})
    audio = istft_np(mag, phase)
    return audio, {"accented": accented, "seq": seq, "dur": dur, "mel": mel, "sec": time.time() - t0}


# ---------------------------------------------------------------- 8. Проверка
if all(k in sessions for k in ("dur", "pitch", "pitch_focus", "encoder", "dec_pre", "dec_mid", "dec_post", "vocoder", "accent_heads")):
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
lines = ["# Silero -> ONNX v3", "", "| Шаг | Итог | Детали |", "| --- | --- | --- |"]
for k, v in report["steps"].items():
    d = {kk: vv for kk, vv in v.items() if kk != "ok"}
    lines.append(f"| {k} | {'да' if v['ok'] else 'НЕТ'} | {json.dumps(d, ensure_ascii=False)[:160]} |")
total = sum(f.stat().st_size for f in APP.iterdir()) / 1e6
lines += ["", f"Файлы для приложения: app-assets ({total:.0f} МБ).",
          "Послушать: N-original.wav, N-original-no-homographs.wav, N-onnx.wav."]
(OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
log("\n".join(lines))
log("DONE")
