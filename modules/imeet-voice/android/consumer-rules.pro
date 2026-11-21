# onnxruntime вызывает Java-классы из нативного кода: R8 не должен их переименовывать или выкидывать.
-keep class ai.onnxruntime.** { *; }

# JTransforms (FFT для вокодера) тянет JLargeArrays, а та ссылается на sun.misc.Cleaner из обычной Java.
# На Android этого класса нет, и нам он не нужен: используются только обычные массивы.
-dontwarn sun.misc.**
