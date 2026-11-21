"""Сводка журнала замеров голоса (voice-metrics.jsonl с телефона).

Запуск: py -3 tools\\voice_metrics_report.py artifacts\\metrics\\voice-metrics.jsonl
Пишет рядом: voice-metrics-report.md (сводка) и voice-metrics.csv (все запуски, для таблиц).
Только стандартная библиотека Python.
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def pct(values, q):
    vals = sorted(v for v in values if isinstance(v, (int, float)) and v >= 0)
    if not vals:
        return None
    k = (len(vals) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


def fmt(v, unit=""):
    if v is None:
        return "—"
    if isinstance(v, float) and v < 10:
        return f"{v:.2f}{unit}"
    return f"{round(v):,}{unit}".replace(",", " ")


def mb(kb):
    return None if kb is None else kb / 1024


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/metrics/voice-metrics.jsonl")
    rows = []
    for line in src.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    out_md = src.with_name("voice-metrics-report.md")
    out_csv = src.with_name("voice-metrics.csv")

    md = [f"# Замеры голоса", "", f"Файл: {src.name}, записей: {len(rows)}"]
    if rows:
        md.append(f"Период: {rows[0].get('time')} — {rows[-1].get('time')}; устройство: {rows[-1].get('device')}, Android API {rows[-1].get('android')}")

    loads = [r for r in rows if r.get("event") == "silero_load" and r.get("state") == "ok"]
    if loads:
        md += ["", "## Загрузка встроенного Silero", "",
               "| запусков | загрузка, мс (медиана / макс) | PSS до → после, МБ | пик нативной кучи, МБ |", "|---|---|---|---|"]
        md.append(f"| {len(loads)} | {fmt(pct([r['loadMs'] for r in loads], .5))} / {fmt(max(r['loadMs'] for r in loads))} | "
                  f"{fmt(mb(pct([r['memoryBefore']['pssKb'] for r in loads], .5)))} → {fmt(mb(pct([r['memoryAfter']['pssKb'] for r in loads], .5)))} | "
                  f"{fmt(mb(max(r.get('peakNativeHeapKb', 0) for r in loads)))} |")

    speaks = [r for r in rows if r.get("event") == "silero_speak" and r.get("state") == "completed"]
    if speaks:
        groups = defaultdict(list)
        for r in speaks:
            mode = {2: "по фразам", 1: "по предложениям"}.get(r.get("mode"), "по предложениям" if r.get("chunked") else "целиком")
            groups[(r.get("speaker"), mode)].append(r)
        md += ["", "## Встроенный Silero: задержка и скорость", "",
               "Задержка — от нажатия до первого звука. RTF — синтез / длительность звука (меньше 1 — быстрее реального времени).", "",
               "| голос | режим | n | задержка медиана / p90, мс | RTF медиана | паузы из-за синтеза, мс (сумма / макс) | PSS после, МБ (медиана / макс) | пик нативной кучи, МБ |",
               "|---|---|---|---|---|---|---|---|"]
        for (spk, mode), g in sorted(groups.items()):
            md.append(f"| {spk} | {mode} | {len(g)} | {fmt(pct([r['firstFrameMs'] for r in g], .5))} / {fmt(pct([r['firstFrameMs'] for r in g], .9))} | "
                      f"{fmt(pct([r.get('rtf') for r in g], .5))} | {fmt(sum(r.get('gapMs', 0) for r in g))} / {fmt(max(r.get('gapMs', 0) for r in g))} | "
                      f"{fmt(mb(pct([r['memoryAfter']['pssKb'] for r in g], .5)))} / {fmt(mb(max(r['memoryAfter']['pssKb'] for r in g)))} | "
                      f"{fmt(mb(max(r.get('peakNativeHeapKb', 0) for r in g)))} |")
        # Одинаковые тексты в двух режимах — прямое сравнение.
        by_text = defaultdict(dict)
        for r in speaks:
            m = r.get("mode", 1 if r.get("chunked") else 0)
            by_text[r["text"]].setdefault(m, []).append(r["firstFrameMs"])
        pairs = [(t, d) for t, d in by_text.items() if 0 in d and (1 in d or 2 in d)]
        if pairs:
            md += ["", "### Одна и та же реплика (медиана задержки до звука, мс)", "",
                   "| реплика | целиком | по предложениям | по фразам |", "|---|---|---|---|"]
            for t, d in pairs:
                med = lambda k: fmt(statistics.median(d[k])) if k in d else "—"
                md.append(f"| {t[:60]} | {med(0)} | {med(1)} | {med(2)} |")
        focus = [r for r in speaks if "*" in r.get("text", "")]
        if focus:
            zero = [r for r in focus if not r.get("focusSymbols")]
            md += ["", f"Фразы со звёздочками: {len(focus)}, из них выделение не дошло до модели: {len(zero)}."]

    turns = [r for r in rows if r.get("event") == "conversation_turn" and r.get("replyMs") is not None]
    if turns:
        def col(key):
            vals = [r.get(key) for r in turns if isinstance(r.get(key), (int, float))]
            return f"{fmt(pct(vals, .5))} / {fmt(pct(vals, .9))}" if vals else "—"
        md += ["", "## Разговор целиком (заглушка LLM)", "",
               "Ожидание человека = тишина до конца фразы + распознавание + ответ до первого звука. Медиана / p90, мс.", "",
               "| что | медиана / p90 |", "|---|---|",
               f"| тишина до конца фразы (настройка) | {col('endOfPhraseMs')} |",
               f"| распознавание | {col('asrMs')} |",
               f"| из них Наслух: от конца речи до текста (finalizeMs) | {col('asrFinalizeMs')} |",
               f"| кусков, расшифрованных по ходу речи | {col('asrSegments')} |",
               f"| LLM: первый токен (заглушка) | {col('llmFirstTokenMs')} |",
               f"| голос: от первого токена до звука | {col('firstAudioAfterLlmTokenMs')} |",
               f"| ответ: от распознанного текста до звука | {col('replyMs')} |",
               f"| **ожидание человека всего** | **{col('perceivedMs')}** |",
               f"| память процесса после ответа, МБ | {fmt(mb(pct([r.get('memory', {}).get('pssKb') for r in turns], .5)))} / {fmt(mb(pct([r.get('memory', {}).get('pssKb') for r in turns], .9)))} |",
               "", f"Реплик: {len(turns)}; перебиваний: {sum(1 for r in turns if r.get('interrupted'))}."]
    streams = [r for r in rows if r.get("event") == "silero_stream" and r.get("state") == "completed"]
    if streams:
        md += ["", "## Потоковая озвучка", "",
               f"Ответов: {len(streams)}; от первой порции текста до звука медиана {fmt(pct([r.get('sinceTextMs') for r in streams], .5))} мс; "
               f"паузы из-за синтеза всего {fmt(sum(r.get('waitSynthMs', 0) for r in streams))} мс; "
               f"ожидание текста от LLM внутри ответа всего {fmt(sum(r.get('waitTextMs', 0) for r in streams))} мс; "
               f"пик нативной кучи {fmt(mb(max(r.get('peakNativeHeapKb', 0) for r in streams)))} МБ."]

    errors = [r for r in rows if r.get("state") == "error"]
    if errors:
        md += ["", "## Ошибки", ""] + [f"- {r.get('time')} {r.get('event')}: {r.get('error')}" for r in errors[-20:]]

    lab = [r for r in rows if r.get("event") == "voicelab_run" and r.get("state") == "completed"]
    if lab:
        groups = defaultdict(list)
        for r in lab:
            mode = {"phrases": " · по фразам", "sentences": " · по предл.", "whole": " · целиком"}.get(
                r.get("split"), "" if r.get("chunked") is None else (" · по предл." if r["chunked"] else " · целиком"))
            groups[f"{r.get('voice')}{mode}"].append(r)
        md += ["", "## Все голоса Voice Lab (замер из приложения)", "",
               "| голос | n | задержка медиана / p90, мс | PSS процесса после, МБ (медиана) |", "|---|---|---|---|"]
        for name, g in sorted(groups.items(), key=lambda kv: pct([r.get('firstFrameMs') for r in kv[1]], .5) or 1e9):
            md.append(f"| {name} | {len(g)} | {fmt(pct([r.get('firstFrameMs') for r in g], .5))} / {fmt(pct([r.get('firstFrameMs') for r in g], .9))} | "
                      f"{fmt(mb(pct([r.get('memory', {}).get('pssKb') for r in g], .5)))} |")

    out_md.write_text("\n".join(md) + "\n", encoding="utf-8")

    cols = ["time", "event", "state", "voice", "speaker", "engine", "chunked", "phrase", "textChars", "firstFrameMs", "synthMs",
            "audioMs", "rtf", "gapMs", "chunks", "focusSymbols", "homographs", "loadMs", "peakNativeHeapKb", "pssKb", "nativeHeapKb",
            "javaHeapKb", "error", "text"]
    with out_csv.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(cols)
        for r in rows:
            mem = r.get("memoryAfter") or r.get("memory") or {}
            flat = {**r, "pssKb": mem.get("pssKb"), "nativeHeapKb": mem.get("nativeHeapKb"), "javaHeapKb": mem.get("javaHeapKb")}
            w.writerow(["" if flat.get(c) is None else flat.get(c) for c in cols])
    print(f"OK: {out_md}")
    print(f"OK: {out_csv}")


if __name__ == "__main__":
    main()
