# onnxruntime для встроенного Silero

В APK может быть только одна `libonnxruntime.so`. Её приносит sherpa-onnx (библиотека «Наслух»):
sherpa-onnx 1.13.5 -> onnxruntime **1.27.1**. В Maven такой версии `onnxruntime-android` нет (последняя 1.27.0),
а функции onnxruntime помечены точной версией (`OrtGetApiBase@@VERS_1.27.1`), поэтому прослойка от 1.27.0
не загружалась: `cannot locate symbol "OrtGetApiBase"`.

Что сделано (modules/imeet-voice/android):
- `libs/onnxruntime-android-1.27.0-classes.jar` — Java-классы `ai.onnxruntime` из `onnxruntime-android-1.27.0.aar`;
- `src/main/jniLibs/arm64-v8a/libonnxruntime4j_jni.so` — JNI-прослойка из того же пакета, метка `VERS_1.27.0`
  заменена на `VERS_1.27.1` скриптом `patch_ort_jni.py` (интерфейс onnxruntime в пределах ветки 1.27 один);
- своей `libonnxruntime.so` модуль не везёт.

Если «Наслух» обновит sherpa-onnx: `tools\silero-onnx\grab-ort.cmd` -> взять `onnxruntime-android` той же ветки,
повторить замену меткой новой версии (`readelf -V libonnxruntime.so` из пакета sherpa-onnx покажет её).
