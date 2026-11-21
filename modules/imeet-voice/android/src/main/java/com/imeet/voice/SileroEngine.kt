package com.imeet.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import org.jtransforms.fft.FloatFFT_1D
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.LongBuffer
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.round
import kotlin.math.sin

/**
 * Встроенный Silero v5_5 (ONNX, из APK): текст -> ударения -> длительности/интонация ->
 * акустика -> вокодер -> iSTFT. Порядок шагов и числа — как в tools/silero-onnx/export_v3.py,
 * где этот конвейер дал звук, совпавший с оригиналом (сигнал/шум 91–98 дБ).
 */
class SileroEngine private constructor(
  private val env: OrtEnvironment,
  private val sessions: Map<String, OrtSession>,
  private val text: SileroText,
  private val speakers: Map<String, Long>,
  private val multiple: Int,
  private val nFft: Int,
  private val hop: Int,
  private val win: Int,
  private val window: FloatArray,
) {
  val sampleRate = 48000
  val speakerNames: List<String> get() = speakers.keys.toList()

  class Result(val audio: FloatArray, val accented: String, val synthMs: Long)

  /** Озвучить текст (слова в *звёздочках* — логическое ударение). */
  fun synthesize(input: String, speaker: String): Result {
    val started = System.nanoTime()
    val plain = input.replace("*", "")
    val prepared = text.prepare(plain)
    require(prepared.any { it.isLetter() }) { "В реплике нет слов для озвучки" }
    val accented = text.accent(prepared)
    val seq = text.toIds(accented)
    val t = seq.size
    val spk = longArrayOf(speakers[speaker] ?: speakers.values.first())

    // 1. Длительности символов (кадры).
    val logDur = infer("dur", mapOf("seq" to longs(seq, 1, t), "spk" to longs(spk, 1))).first
    val dur = postDurations(logDur)

    // 2. Интонация с типом фразы и логическим ударением.
    val typeIds = text.typeIds(plain, t)
    val focus = text.focusMask(input, accented, t)
    val pitchName = if (focus != null) "pitch_focus" else "pitch"
    val pitch = infer(pitchName, mapOf(
      "seq" to longs(seq, 1, t), "spk" to longs(spk, 1),
      "type_ids" to longs(typeIds, 1, t), "focus" to longs(focus ?: LongArray(t), 1, t),
    )).first
    for (i in pitch.indices) if (kotlin.math.abs(pitch[i]) < 0.001f) pitch[i] = 0f

    // 3. Акустика: encoder -> растяжка по длительностям -> decoder (3 части, дополнение до кратной длины).
    val (enc, encShape) = infer("encoder", mapOf("seq" to longs(seq, 1, t), "spk" to longs(spk, 1), "pitch" to floats(pitch, 1, 1, t)))
    val channels = encShape[2].toInt()
    val expanded = lengthRegulate(enc, channels, dur)
    val frames = expanded.size / channels
    val (pre, _) = infer("dec_pre", mapOf("x" to floats(expanded, 1, frames, channels)))
    val padded = ((frames + multiple - 1) / multiple) * multiple
    val xp = pre.copyOf(padded * channels)
    val (mid, _) = infer("dec_mid", mapOf("x" to floats(xp, 1, padded, channels)))
    val (mel, melShape) = infer("dec_post", mapOf("x" to floats(mid.copyOf(frames * channels), 1, frames, channels)))

    // 4. Вокодер (амплитуда и фаза) -> обратное FFT с перекрытием.
    val melTensor = floats(mel, 1, melShape[1].toInt(), melShape[2].toInt())
    val voc = sessions.getValue("vocoder").run(mapOf("mel" to melTensor)).use { out ->
      val mag = out[0] as OnnxTensor
      val phase = out[1] as OnnxTensor
      val shape = mag.info.shape
      istft(toArray(mag.floatBuffer), toArray(phase.floatBuffer), shape[1].toInt(), shape[2].toInt())
    }
    melTensor.close()
    return Result(voc, accented, (System.nanoTime() - started) / 1_000_000)
  }

  private fun infer(name: String, inputs: Map<String, OnnxTensor>): Pair<FloatArray, LongArray> {
    val session = sessions.getValue(name)
    val used = inputs.filterKeys { it in session.inputNames }
    try {
      return session.run(used).use { out ->
        val tensor = out[0] as OnnxTensor
        Pair(toArray(tensor.floatBuffer), tensor.info.shape)
      }
    } finally {
      inputs.values.forEach { it.close() }
    }
  }

  private fun longs(values: LongArray, vararg shape: Int) =
    OnnxTensor.createTensor(env, LongBuffer.wrap(values), shape.map { it.toLong() }.toLongArray())

  private fun floats(values: FloatArray, vararg shape: Int) =
    OnnxTensor.createTensor(env, FloatBuffer.wrap(values), shape.map { it.toLong() }.toLongArray())

  private fun toArray(buffer: FloatBuffer): FloatArray {
    val out = FloatArray(buffer.remaining())
    buffer.get(out)
    return out
  }

  /** exp(x)-1, отрицательные -> 0, округление и ограничения краёв — как MultiTTSModel.forward. */
  private fun postDurations(logDur: FloatArray): FloatArray {
    val d = FloatArray(logDur.size) { maxOf(0f, (exp(logDur[it].toDouble()) - 1).toFloat()) }
    for (i in d.indices) d[i] = round(d[i])
    val n = d.size
    if (d[0] > 5) d[0] = 5f
    if (n >= 1 && d[n - 1] > 7) d[n - 1] = 7f
    if (n >= 2) d[n - 2] = 13f
    if (n >= 3 && d[n - 3] > 13) d[n - 3] = 13f
    return d
  }

  private fun lengthRegulate(enc: FloatArray, channels: Int, dur: FloatArray): FloatArray {
    val reps = IntArray(dur.size) { floor(maxOf(0f, dur[it]) + 0.5f).toInt() }
    val out = FloatArray(reps.sum() * channels)
    var pos = 0
    for (i in reps.indices) {
      repeat(reps[i]) {
        System.arraycopy(enc, i * channels, out, pos, channels)
        pos += channels
      }
    }
    return out
  }

  /** iSTFT с padding "same": irfft кадра * окно, сложение с шагом hop, деление на сумму квадратов окна. */
  private fun istft(mag: FloatArray, phase: FloatArray, bins: Int, frames: Int): FloatArray {
    val fft = FloatFFT_1D(nFft.toLong())
    val size = (frames - 1) * hop + win
    val y = FloatArray(size)
    val envelope = FloatArray(size)
    val buf = FloatArray(nFft)
    for (f in 0 until frames) {
      java.util.Arrays.fill(buf, 0f)
      for (k in 0 until bins) {
        val m = mag[k * frames + f]
        val p = phase[k * frames + f]
        val re = m * cos(p)
        val im = m * sin(p)
        when (k) {
          0 -> buf[0] = re
          nFft / 2 -> buf[1] = re
          else -> { buf[2 * k] = re; buf[2 * k + 1] = im }
        }
      }
      fft.realInverse(buf, true)
      val start = f * hop
      for (j in 0 until win) {
        y[start + j] += buf[j] * window[j]
        envelope[start + j] += window[j] * window[j]
      }
    }
    val pad = (win - hop) / 2
    val n = size - 2 * pad
    return FloatArray(n) { i ->
      val e = envelope[pad + i]
      val v = if (e > 1e-11f) y[pad + i] / e else 0f
      v.coerceIn(-1f, 1f)
    }
  }

  companion object {
    private const val DIR = "silero"
    private val MODELS = listOf("dur", "pitch", "pitch_focus", "encoder", "dec_pre", "dec_mid", "dec_post", "vocoder", "accent_heads")

    fun assetsPresent(context: Context): Boolean =
      runCatching { context.assets.list(DIR)?.contains("vocoder.onnx") == true }.getOrDefault(false)

    /** Модели лежат в APK (assets/silero); ONNX читает их из копии в памяти приложения. */
    fun load(context: Context): SileroEngine {
      val env = OrtEnvironment.getEnvironment()
      val dir = File(context.noBackupFilesDir, "silero-onnx").apply { mkdirs() }
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(4)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      val sessions = MODELS.associateWith { name -> env.createSession(copyAsset(context, "$name.onnx", dir).absolutePath, options) }

      val cfg = JSONObject(readText(context, "config.json"))
      val symbols = cfg.getString("symbols")
      val s2i = HashMap<Char, Long>()
      cfg.getJSONObject("symbol_to_id").let { o -> o.keys().forEach { k -> s2i[k[0]] = o.getLong(k) } }
      val speakers = LinkedHashMap<String, Long>()
      cfg.getJSONObject("speakers").let { o -> o.keys().forEach { k -> speakers[k] = o.getJSONObject(k).getJSONArray("ids").getLong(0) } }
      val istft = cfg.getJSONObject("istft")
      require(istft.getString("padding") == "same") { "Неожиданный режим iSTFT" }

      // Файлы записаны на Windows: строки могут кончаться на \r\n — lines() понимает оба варианта.
      val ngrams = readText(context, "accent_ngrams.txt").lines().map { it.trim() }.dropLastWhile { it.isEmpty() }
      val ngramIds = HashMap<String, Int>(ngrams.size * 2)
      ngrams.forEachIndexed { i, g -> ngramIds[g] = i }
      val emb = readFloats(context, "accent_emb.f32")
      require(emb.size % ngrams.size == 0) { "Словарь ударений не совпадает с таблицей: ${ngrams.size} n-грамм" }
      val dim = emb.size / ngrams.size
      val exceptions = HashMap<String, Pair<Int, Int>>()
      readText(context, "accent_exceptions.tsv").lines().forEach { line ->
        val p = line.trim().split('\t')
        if (p.size == 3) exceptions[p[0]] = Pair(p[1].toInt(), p[2].toInt())
      }
      val accentor = SileroAccentor(env, sessions.getValue("accent_heads"), ngramIds, emb, dim, exceptions)
      val text = SileroText(symbols, s2i, cfg.getString("sos")[0], cfg.getString("eos")[0], accentor)
      return SileroEngine(
        env, sessions, text, speakers, cfg.getInt("decoder_multiple"),
        istft.getInt("n_fft"), istft.getInt("hop"), istft.getInt("win"), readFloats(context, "istft_window.f32"),
      )
    }

    /** Копия модели из APK в память приложения; обновляется после каждой установки новой версии APK. */
    private fun copyAsset(context: Context, name: String, dir: File): File {
      val target = File(dir, name)
      val stamp = File(dir, "$name.stamp")
      val installed = context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime.toString()
      if (target.exists() && stamp.exists() && stamp.readText() == installed) return target
      val tmp = File(dir, "$name.tmp")
      context.assets.open("$DIR/$name").use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
      if (!tmp.renameTo(target)) { target.delete(); check(tmp.renameTo(target)) { "Не удалось сохранить модель $name" } }
      stamp.writeText(installed)
      return target
    }

    private fun readText(context: Context, name: String) =
      context.assets.open("$DIR/$name").use { it.readBytes().toString(Charsets.UTF_8) }

    private fun readFloats(context: Context, name: String): FloatArray {
      val bytes = context.assets.open("$DIR/$name").use { it.readBytes() }
      val fb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      return FloatArray(fb.remaining()).also { fb.get(it) }
    }
  }
}
