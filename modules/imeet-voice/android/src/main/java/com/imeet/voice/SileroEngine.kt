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
  private val meanStdCoef: FloatArray,
  private val rules: SileroRules?,
) {
  /** rules — словари чтения RuVoice; pitch — высота голоса (1 — как модель; RuVoice у тебя играет ×0.86). */
  data class Options(val rules: Boolean = true, val pitch: Float = 1f)

  /** Куда пришлась граница куска — от этого зависит добавочная пауза после него. */
  enum class Boundary { SENTENCE, COMMA, DASH, PARAGRAPH, END }
  val sampleRate = 48000
  val speakerNames: List<String> get() = speakers.keys.toList()

  /** focusSymbols — сколько символов получили логическое ударение (0 — звёздочки не сработали). */
  class Result(val audio: FloatArray, val accented: String, val types: String, val synthMs: Long, val focusSymbols: Int)

  val homographs: Boolean get() = text.hasHomographs

  /** Перед делением на куски: словари и омографы по всей реплике (кускам потом словари не нужны). */
  fun prepareForChunks(raw: String, options: Options): String {
    val ruled = if (options.rules && rules != null) rules.apply(raw) else raw
    return text.homographHints(ruled)
  }
  val rulesInfo: String get() = rules?.let { "${it.ruleCount} правил, ${it.stressCount} слов" } ?: "нет"

  /** Озвучить текст (слова в *звёздочках* — логическое ударение). */
  fun synthesize(rawInput: String, speaker: String, options: Options = Options()): Result {
    val started = System.nanoTime()
    val input = if (options.rules && rules != null) rules.apply(rawInput) else rawInput
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
    // update_pitch_coef: нули остаются нулями, остальное p*c + (c-1)*mean_std_coef[диктор].
    val c = options.pitch
    val shift = (c - 1f) * meanStdCoef.getOrElse(spk[0].toInt()) { 0f }
    for (i in pitch.indices) {
      pitch[i] = if (kotlin.math.abs(pitch[i]) < 0.001f) 0f else pitch[i] * c + shift
    }

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
    val focused = focus?.count { it != 0L } ?: 0
    return Result(voc, accented, SileroText.classifyText(plain), (System.nanoTime() - started) / 1_000_000, focused)
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

    /** Деление реплики на предложения (как в Silero: после . ! ? и пробела). */
    fun sentences(input: String): List<String> =
      SileroText.SENT_SPLIT.split(input.trim()).map { it.trim() }.filter { s -> s.any { it.isLetter() } }

    /**
     * Деление на куски: абзацы (перевод строки), предложения, а при byPhrases ещё запятые / ; / :
     * и тире между словами. Возвращает куски и тип границы после каждого.
     */
    fun split(input: String, byPhrases: Boolean): List<Pair<String, Boundary>> {
      val out = ArrayList<Pair<String, Boundary>>()
      val paragraphs = input.split(Regex("\\s*\\n\\s*")).filter { p -> p.any { it.isLetter() } }
      paragraphs.forEachIndexed { pi, para ->
        val splitter = if (byPhrases) PHRASE_SPLIT else SileroText.SENT_SPLIT
        val pieces = splitter.split(para.trim()).map { it.trim() }.filter { it.isNotEmpty() }
        val merged = ArrayList<String>()
        for (p in pieces) {     // кусок без букв (одинокое тире) приклеиваем к следующему
          if (merged.isNotEmpty() && !merged.last().any { it.isLetter() }) merged[merged.size - 1] = merged.last() + " " + p else merged.add(p)
        }
        merged.forEachIndexed { i, piece ->
          val kind = when {
            i == merged.size - 1 -> if (pi == paragraphs.size - 1) Boundary.END else Boundary.PARAGRAPH
            merged[i + 1].startsWith("–") || merged[i + 1].startsWith("—") -> Boundary.DASH
            piece.last() in ",;:" -> Boundary.COMMA
            else -> Boundary.SENTENCE
          }
          out.add(piece to kind)
        }
      }
      return out
    }

    private val PHRASE_SPLIT = Regex("(?<=[.!?…,;:])\\s+|\\s+(?=[–—]\\s)")
    private val MODELS = listOf("dur", "pitch", "pitch_focus", "encoder", "dec_pre", "dec_mid", "dec_post", "vocoder", "accent_heads")

    /** Модели скачаны (или взяты из APK сборки для разработки) — см. VoiceModelStore. */
    fun modelsReady(context: Context): Boolean = VoiceModelStore.isReady(context)

    /** Модели лежат в папке приложения (VoiceModelStore); словари чтения — в APK (assets/rules). */
    fun load(context: Context): SileroEngine {
      val env = OrtEnvironment.getEnvironment()
      check(VoiceModelStore.isReady(context)) { "Модели голоса ещё не скачаны" }
      val dir = VoiceModelStore.dir(context)
      val options = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(4)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      val sessions = MODELS.associateWith { name -> env.createSession(File(dir, "$name.onnx").absolutePath, options) }

      val cfg = JSONObject(readText(dir, "config.json"))
      val symbols = cfg.getString("symbols")
      val s2i = HashMap<Char, Long>()
      cfg.getJSONObject("symbol_to_id").let { o -> o.keys().forEach { k -> s2i[k[0]] = o.getLong(k) } }
      val speakers = LinkedHashMap<String, Long>()
      cfg.getJSONObject("speakers").let { o -> o.keys().forEach { k -> speakers[k] = o.getJSONObject(k).getJSONArray("ids").getLong(0) } }
      val istft = cfg.getJSONObject("istft")
      require(istft.getString("padding") == "same") { "Неожиданный режим iSTFT" }

      // Файлы записаны на Windows: строки могут кончаться на \r\n — lines() понимает оба варианта.
      val ngrams = readText(dir, "accent_ngrams.txt").lines().map { it.trim() }.dropLastWhile { it.isEmpty() }
      val ngramIds = HashMap<String, Int>(ngrams.size * 2)
      ngrams.forEachIndexed { i, g -> ngramIds[g] = i }
      val emb = readFloats(dir, "accent_emb.f32")
      require(emb.size % ngrams.size == 0) { "Словарь ударений не совпадает с таблицей: ${ngrams.size} n-грамм" }
      val dim = emb.size / ngrams.size
      val exceptions = HashMap<String, Pair<Int, Int>>()
      readText(dir, "accent_exceptions.tsv").lines().forEach { line ->
        val p = line.trim().split('\t')
        if (p.size == 3) exceptions[p[0]] = Pair(p[1].toInt(), p[2].toInt())
      }
      val accentor = SileroAccentor(env, sessions.getValue("accent_heads"), ngramIds, emb, dim, exceptions)
      // Омографы — если их модель вложена в сборку (tools/silero-onnx/run.cmd её экспортирует).
      val homo = if (File(dir, "homo.onnx").exists()) {
        SileroHomo(env, env.createSession(File(dir, "homo.onnx").absolutePath, options),
          readText(dir, "homo_tokenizer.json"), readText(dir, "homodict.json"))
      } else null
      val text = SileroText(symbols, s2i, cfg.getString("sos")[0], cfg.getString("eos")[0], accentor, homo)
      val msc = cfg.optJSONArray("mean_std_coef")
      val meanStd = FloatArray(msc?.length() ?: 0) { msc!!.getDouble(it).toFloat() }
      // Словари чтения (assets/rules, из экспорта настроек RuVoice) — если вложены в сборку.
      val rules = runCatching {
        val replace = context.assets.open("rules/replace.txt").use { it.readBytes().toString(Charsets.UTF_8) } + "\n" +
          runCatching { context.assets.open("rules/custom.txt").use { it.readBytes().toString(Charsets.UTF_8) } }.getOrDefault("")
        val stress = context.assets.open("rules/stress.txt").use { it.readBytes().toString(Charsets.UTF_8) }
        SileroRules(replace, stress)
      }.getOrNull()
      return SileroEngine(
        env, sessions, text, speakers, cfg.getInt("decoder_multiple"),
        istft.getInt("n_fft"), istft.getInt("hop"), istft.getInt("win"), readFloats(dir, "istft_window.f32"),
        meanStd, rules,
      )
    }

    private fun readText(dir: File, name: String) = File(dir, name).readText(Charsets.UTF_8)

    private fun readFloats(dir: File, name: String): FloatArray {
      val bytes = File(dir, name).readBytes()
      val fb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      return FloatArray(fb.remaining()).also { fb.get(it) }
    }
  }
}
