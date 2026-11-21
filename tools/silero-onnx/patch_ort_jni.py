"""
Подгоняет JNI-прослойку onnxruntime (libonnxruntime4j_jni.so из onnxruntime-android) под libonnxruntime.so,
которую приносит sherpa-onnx («Наслух»): меняет требуемую метку версии функций (VERS_x.y.z) и её хеш.
Длины меток должны совпадать (1.27.0 -> 1.27.1). Запуск: python patch_ort_jni.py <jni.so> <out.so> <было> <стало>
"""
import struct
import sys

src, dst, old, new = sys.argv[1:5]
assert len(old) == len(new), "метки должны быть одной длины"
b = bytearray(open(src, "rb").read())
shoff, = struct.unpack_from("<Q", b, 0x28)
shentsize, shnum, _ = struct.unpack_from("<HHH", b, 0x3A)
secs = [struct.unpack_from("<IIQQQQIIQQ", b, shoff + i * shentsize) for i in range(shnum)]
verneed = next(s for s in secs if s[1] == 0x6FFFFFFE)
dynstr_off = secs[verneed[6]][4]


def elf_hash(name):
    h = 0
    for c in name.encode():
        h = ((h << 4) + c) & 0xFFFFFFFF
        g = h & 0xF0000000
        if g:
            h ^= g >> 24
        h &= ~g & 0xFFFFFFFF
    return h


off, patched = verneed[4], 0
for _ in range(verneed[7]):
    _, cnt, _, aux, nxt = struct.unpack_from("<HHIII", b, off)
    a = off + aux
    for _ in range(cnt):
        _, _, _, nm, an = struct.unpack_from("<IHHII", b, a)
        start = dynstr_off + nm
        if b[start:b.index(b"\0", start)].decode() == old:
            b[start:start + len(new)] = new.encode()
            struct.pack_into("<I", b, a, elf_hash(new))
            patched += 1
        if an == 0:
            break
        a += an
    if nxt == 0:
        break
    off += nxt
assert patched, f"метка {old} не найдена"
open(dst, "wb").write(b)
print("patched", patched)
