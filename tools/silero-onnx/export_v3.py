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
    "Мы увидели старинный замок на холме, а на двери висел тяжёлый замок.",
    "Все мои друзья любят этот город, а я пока нет.",
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
            if have_stress:      # ударение уже поставил решатель омографов: «ё» только если совпадает с ним
                marks = [k for k, ch in enumerate(raw) if ch == "+"]
                word = raw.replace("+", "")
                if y_pos != -1 and (y_pos + 1) in marks:
                    word = word[:y_pos] + ("ё" if word[y_pos].islower() else "Ё") + word[y_pos + 1:]
                for m in marks:
                    word = word[:m] + "+" + word[m:]
                out.append(word)
                continue
            if y_pos != -1:
                raw = raw[:y_pos] + ("ё" if raw[y_pos].islower() else "Ё") + raw[y_pos + 1:]
            out.append(raw[:s_pos] + "+" + raw[s_pos:])
            continue
        s_idx = int(sp[i].argmax())
        set_stress = sp[i][s_idx] > 0.5 and not have_stress
        y_idx = int(yp[i].argmax())
        set_yo = yp[i][y_idx] > 0.5
        stressed_ids = [s_idx]
        if have_stress:
            stressed_ids = [sum(part.count(v) for v in VOWELS) for part in low.split("+")]
        vowel_ids = [k for k, ch in enumerate(low) if ch in VOWELS]
        ye_ids = [k for k, ch in enumerate(low) if ch == "е"]
        stress_pos = [vowel_ids[k] for k in stressed_ids if k < len(vowel_ids)]
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


# ---------------------------------------------------------------- 6b. Омографы (замо́к / за́мок): маленький BERT
class Bert(nn.Module):
    """BertModelJIT без маски внимания (как в оригинале: attention_mask = None, паддинг тоже участвует)."""

    def __init__(self, b, vocab_size):
        super().__init__()
        e = b.embeddings
        try:
            self.word = leaf(e.word_embeddings)
        except Exception:                       # квантованная таблица: достаём значения прогоном
            with torch.no_grad():
                table = e.word_embeddings(torch.arange(vocab_size)).float()
            self.word = nn.Embedding.from_pretrained(table, freeze=True)
        self.pos = leaf(e.position_embeddings)
        self.tok = leaf(e.token_type_embeddings)
        self.norm = leaf(e.LayerNorm)
        layers = kids(b.encoder.layer)
        self.q = nn.ModuleList([leaf(l.attention.self.query) for l in layers])
        self.k = nn.ModuleList([leaf(l.attention.self.key) for l in layers])
        self.v = nn.ModuleList([leaf(l.attention.self.value) for l in layers])
        self.o = nn.ModuleList([leaf(l.attention.output.dense) for l in layers])
        self.n1 = nn.ModuleList([leaf(l.attention.output.LayerNorm) for l in layers])
        self.i = nn.ModuleList([leaf(l.intermediate.dense) for l in layers])
        self.out = nn.ModuleList([leaf(l.output.dense) for l in layers])
        self.n2 = nn.ModuleList([leaf(l.output.LayerNorm) for l in layers])
        self.h = int(layers[0].attention.self.num_attention_heads)
        self.d = int(layers[0].attention.self.attention_head_size)

    def heads(self, x):              # [N, L, H*D] -> [N, H, L, D] без «зашитых» размеров
        return x.unflatten(-1, (self.h, self.d)).transpose(1, 2)

    def forward(self, ids):
        pos = torch.cumsum(torch.ones_like(ids), 1) - 1
        x = self.norm(self.word(ids) + self.tok(torch.zeros_like(ids)) + self.pos(pos))
        for l in range(len(self.q)):
            q, k, v = self.heads(self.q[l](x)), self.heads(self.k[l](x)), self.heads(self.v[l](x))
            att = torch.softmax(torch.matmul(q, k.transpose(-1, -2)) / (self.d ** 0.5), dim=-1)
            ctx = torch.matmul(att, v).transpose(1, 2).flatten(2)
            x = self.n1[l](self.o[l](ctx) + x)
            x = self.n2[l](self.out[l](torch.nn.functional.gelu(self.i[l](x))) + x)
        return x


class Homo(nn.Module):
    """HomoSolverClean: вектор метки [HOMO] + среднее по словам омографа -> классификатор."""

    def __init__(self, m, vocab_size):
        super().__init__()
        self.bert = Bert(m.bert, vocab_size)
        self.clf = nn.Sequential(*[leaf(c) for c in kids(m.homo_clf)])

    def forward(self, ids, starts, ends):
        hidden = self.bert(ids)
        hsize = hidden.size(2)
        marker = hidden.gather(1, starts.view(-1, 1, 1).expand(-1, 1, hsize)).squeeze(1)
        pos = torch.cumsum(torch.ones_like(ids), 1) - 1
        mask = ((pos > starts.view(-1, 1)) & (pos < ends.view(-1, 1))).to(hidden.dtype).unsqueeze(-1)
        word = (hidden * mask).sum(1) / mask.sum(1)
        return self.clf(torch.cat([marker, word], dim=1))


homo_tok = None
if homo is not None:
    try:
        tk = homo.tokenizer
        vocab = {tok: int(i) for tok, i in tk.vocab.items()}
        homo_tok = {
            "vocab": vocab, "never_split": sorted(tk.never_split),
            "cls": tk.cls_token_id, "sep": tk.sep_token_id, "pad": tk.pad_token_id, "unk": tk.unk_token_id,
            "homo_start": tk.homo_start_id, "homo_end": tk.homo_end_id,
        }
        (APP / "homo_tokenizer.json").write_text(json.dumps(homo_tok, ensure_ascii=False, indent=1), encoding="utf-8")
        (APP / "homodict.json").write_text(json.dumps(homo.homodict, ensure_ascii=False), encoding="utf-8")
        log("homosolver: vocab", len(vocab), "| homographs", len(homo.homodict), "| never_split", homo_tok["never_split"][:6],
            "| [HOMO] id", tk.homo_start_id)
        homo_m = Homo(homo.model, max(vocab.values()) + 1)
        probe = [torch.tensor(tk(s)) for s in ["мы увидели старинный  [HOMO] замок [/HOMO]  на холме",
                                                 "на двери висел  [HOMO] замок [/HOMO] , а мы ушли домой"]]
        ids_p = torch.nn.utils.rnn.pad_sequence(probe, batch_first=True, padding_value=tk.pad_token_id)
        st_p = torch.LongTensor([int(torch.where(p == tk.homo_start_id)[0][0]) for p in probe])
        en_p = torch.LongTensor([int(torch.where(p == tk.homo_end_id)[0][0]) for p in probe])
        if check("homo", homo_m(ids_p, st_p, en_p), homo.model(ids_p, st_p, en_p), tol=1e-3):
            single = ids_p[:1, : len(probe[0])]
            export("homo", homo_m, (ids_p, st_p, en_p), ["ids", "starts", "ends"], ["logits"],
                   {"ids": {0: "N", 1: "L"}, "starts": {0: "N"}, "ends": {0: "N"}, "logits": {0: "N"}},
                   more=[(single, st_p[:1], en_p[:1])])
    except Exception as e:
        step("export homo", False, error=str(e).splitlines()[0][:300])
        (OUT / "homo.export-error.txt").write_text(traceback.format_exc(), encoding="utf-8")

HOMO_RE = re.compile(r"(?=.*[а-яё])[а-яё+]+", re.IGNORECASE)


def bert_tokens(text: str):
    """SimpleBertTokenizer: чистка, разбиение по пробелам и знакам препинания, WordPiece."""
    import unicodedata
    never = set(homo_tok["never_split"])
    vocab = homo_tok["vocab"]
    clean = []
    for ch in text:
        cp = ord(ch)
        if cp == 0 or cp == 0xFFFD or (ch not in "\t\n\r" and unicodedata.category(ch).startswith("C")):
            continue
        clean.append(" " if ch in " \t\n\r" or unicodedata.category(ch) == "Zs" else ch)
    words = []
    for tok in "".join(clean).strip().split():
        if tok in never:
            words.append(tok)
            continue
        cur = []
        for ch in tok:
            cp = ord(ch)
            punct = 33 <= cp <= 47 or 58 <= cp <= 64 or 91 <= cp <= 96 or 123 <= cp <= 126 or unicodedata.category(ch).startswith("P")
            if punct:
                if cur:
                    words.append("".join(cur))
                    cur = []
                words.append(ch)
            else:
                cur.append(ch)
        if cur:
            words.append("".join(cur))
    ids = [homo_tok["cls"]]
    for w in words:
        if len(w) > 100:
            ids.append(homo_tok["unk"])
            continue
        start, sub = 0, []
        while start < len(w):
            end, found = len(w), None
            while start < end:
                piece = ("##" if start > 0 else "") + w[start:end]
                if piece in vocab:
                    found = piece
                    break
                end -= 1
            if found is None:
                sub = None
                break
            sub.append(vocab[found])
            start = end
        ids += sub if sub is not None else [homo_tok["unk"]]
    return ids + [homo_tok["sep"]]


def homo_np(sentence: str) -> str:
    """Порт HomoSolver.__call__ (put_stress=True, put_yo=True, stress_single_vowel=True)."""
    if homo_tok is None or "homo" not in sessions:
        return sentence
    hd = homo.homodict
    found = []
    for m in HOMO_RE.finditer(sentence):
        word = m.group()
        if word.lower() in hd:
            mark = sentence[:m.start()] + " [HOMO] " + word + " [/HOMO] " + sentence[m.end():]
            found.append((m.start(), m.end(), word, bert_tokens(mark)))
    if not found:
        return sentence
    L = max(len(f[3]) for f in found)
    ids = np.full((len(found), L), homo_tok["pad"], dtype=np.int64)
    for i, f in enumerate(found):
        ids[i, : len(f[3])] = f[3]
    starts = np.array([f[3].index(homo_tok["homo_start"]) for f in found], dtype=np.int64)
    ends = np.array([f[3].index(homo_tok["homo_end"]) for f in found], dtype=np.int64)
    logits = sessions["homo"].run(None, {"ids": ids, "starts": starts, "ends": ends})[0].reshape(len(found))
    preds = np.round(1 / (1 + np.exp(-logits))).astype(int)
    out, offset = sentence, 0
    for (start, end, word, _), pred in zip(found, preds):
        start, end = start + offset, end + offset
        variant = sorted(hd[word.lower()])[pred]
        n_vowels = sum(c.lower() in VOWELS for c in variant)
        stress_idx = variant.index("+")
        variant = variant.replace("+", "")
        variant = "".join(c2.lower() if c1.islower() else c2.upper() for c1, c2 in zip(word, variant))
        if n_vowels > 1 or True:
            variant = variant[:stress_idx] + "+" + variant[stress_idx:]
            offset += 1
        out = out[:start] + variant + out[end:]
    return out


def stress_np(sentence: str) -> str:
    """SileroStress: сначала омографы, потом n-граммный акцентор."""
    return accent_np(homo_np(sentence))


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
    accented = stress_np(sentence)
    seq = text_to_ids(accented)[None, :]
    spk = np.array(speaker_ids, dtype=np.int64)
    T = seq.shape[1]
    log_dur = sessions["dur"].run(None, {"seq": seq, "spk": spk})[0]
    dur = post_durations(log_dur)
    tids = type_ids_for(plain, T)
    fm = focus_for(accented, text, T)
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
if all(k in sessions for k in ("dur", "pitch", "pitch_focus", "encoder", "dec_pre", "dec_mid", "dec_post", "vocoder", "accent_heads", "homo")):
    for i, text in enumerate(TEXTS, 1):
        try:
            plain = text.replace("*", "")
            t0 = time.time()
            ref = model.apply_tts(text=text, speaker=SPEAKER, sample_rate=SR)      # полный оригинал, с омографами
            ref_sec = time.time() - t0
            save_wav(OUT / f"{i}-original.wav", ref)

            orig_acc = pack.accentor(prepare_text(plain))
            my_acc = stress_np(prepare_text(plain))
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

# ---------------------------------------------------------------- 8b. Сжатие модели омографов (117 МБ -> ~30 МБ, int8)
HOMO_CHECK = TEXTS + [
    "Старинный замок стоял на холме.", "Ключ не подходил к замку на двери.", "Все пришли вовремя.", "Я знаю всё.",
    "Мука для блинов закончилась.", "Это была настоящая мука.", "Он плачет, а она смеётся.", "Плачу за кофе я.",
    "Белки едят орехи.", "В яйце много белка.", "Атлас мира лежал на столе.", "Платье из атласа блестело.",
    "Ирис цвёл у дома.", "Я купил ирис в магазине.", "Он вошёл в дом и сел.", "Духи пахли розой.",
    "Мы долго стояли у берега.", "Она стоит на стоянке.", "Покажи мне свой орган.", "В церкви играл орган.",
]
if "homo" in sessions:
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        fp32 = OUT / "homo_fp32.onnx"
        q = APP / "homo_int8.onnx"
        import shutil
        shutil.copyfile(APP / "homo.onnx", fp32)
        quantize_dynamic(str(fp32), str(q), weight_type=QuantType.QInt8)
        full = sessions["homo"]
        sessions["homo"] = ort.InferenceSession(str(q), providers=["CPUExecutionProvider"])
        bad = []
        for t in HOMO_CHECK:
            p = prepare_text(t)
            want = pack.accentor(p)
            got = stress_np(p)
            if got != want:
                bad.append({"text": t, "original": want, "int8": got})
        ok_q = not bad
        step("homo int8", ok_q, mb=round(q.stat().st_size / 1e6, 1), checked=len(HOMO_CHECK), mismatches=bad[:3])
        if ok_q:
            (APP / "homo.onnx").unlink()
            q.rename(APP / "homo.onnx")
        else:
            q.unlink()
            sessions["homo"] = full
    except Exception as e:
        step("homo int8", False, error=str(e).splitlines()[0][:300])
        (OUT / "homo-int8.error.txt").write_text(traceback.format_exc(), encoding="utf-8")

# ---------------------------------------------------------------- 9. Отчёт
(OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
lines = ["# Silero -> ONNX v3", "", "| Шаг | Итог | Детали |", "| --- | --- | --- |"]
for k, v in report["steps"].items():
    d = {kk: vv for kk, vv in v.items() if kk != "ok"}
    lines.append(f"| {k} | {'да' if v['ok'] else 'НЕТ'} | {json.dumps(d, ensure_ascii=False)[:160]} |")
total = sum(f.stat().st_size for f in APP.iterdir()) / 1e6
lines += ["", f"Файлы для приложения: app-assets ({total:.0f} МБ).",
          "Послушать: N-original.wav (оригинал) и N-onnx.wav (наш)."]
(OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
log("\n".join(lines))
log("DONE")
