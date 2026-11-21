package com.imeet.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import org.json.JSONObject
import java.nio.LongBuffer

/**
 * Омографы Silero (за́мок / замо́к, все / всё): маленький BERT смотрит на предложение целиком
 * и выбирает вариант из словаря. Перенос HomoSolver + SimpleBertTokenizer из пакета v5_5,
 * сверено с оригиналом в tools/silero-onnx/export_v3.py.
 */
class SileroHomo(
  private val env: OrtEnvironment,
  private val session: OrtSession,
  tokenizerJson: String,
  homodictJson: String,
) {
  private val vocab = HashMap<String, Long>()
  private val neverSplit = HashSet<String>()
  private val cls: Long
  private val sep: Long
  private val pad: Long
  private val unk: Long
  private val homoStart: Long
  private val homoEnd: Long
  private val homodict = HashMap<String, List<String>>()

  init {
    val cfg = JSONObject(tokenizerJson)
    cfg.getJSONObject("vocab").let { o -> o.keys().forEach { k -> vocab[k] = o.getLong(k) } }
    cfg.getJSONArray("never_split").let { a -> for (i in 0 until a.length()) neverSplit.add(a.getString(i)) }
    cls = cfg.getLong("cls"); sep = cfg.getLong("sep"); pad = cfg.getLong("pad"); unk = cfg.getLong("unk")
    homoStart = cfg.getLong("homo_start"); homoEnd = cfg.getLong("homo_end")
    JSONObject(homodictJson).let { o ->
      o.keys().forEach { k ->
        val arr = o.getJSONArray(k)
        homodict[k] = List(arr.length()) { arr.getString(it) }.sorted()   // sorted(...) в Python: по кодам символов
      }
    }
  }

  val size: Int get() = homodict.size

  fun solve(sentence: String): String {
    class Found(val start: Int, val end: Int, val word: String, val ids: LongArray)
    val found = ArrayList<Found>()
    for (m in PATTERN.findAll(sentence)) {
      val word = m.value
      if (word.lowercase() !in homodict) continue
      val mark = sentence.substring(0, m.range.first) + " [HOMO] " + word + " [/HOMO] " + sentence.substring(m.range.last + 1)
      found.add(Found(m.range.first, m.range.last + 1, word, encode(mark)))
    }
    if (found.isEmpty()) return sentence

    val n = found.size
    val len = found.maxOf { it.ids.size }
    val ids = LongArray(n * len) { pad }
    found.forEachIndexed { i, f -> System.arraycopy(f.ids, 0, ids, i * len, f.ids.size) }
    val starts = LongArray(n) { i -> found[i].ids.indexOf(homoStart).toLong() }
    val ends = LongArray(n) { i -> found[i].ids.indexOf(homoEnd).toLong() }
    val logits = run(ids, n, len, starts, ends)

    var out = sentence
    var offset = 0
    found.forEachIndexed { i, f ->
      val pred = if (logits[i] > 0f) 1 else 0          // round(sigmoid(x))
      val variants = homodict.getValue(f.word.lowercase())
      var variant = variants[pred.coerceAtMost(variants.size - 1)]
      val stressIdx = variant.indexOf('+')
      variant = variant.replace("+", "")
      // Регистр как в исходном слове (zip в Python обрезает по более короткому).
      val cased = StringBuilder()
      for (k in 0 until minOf(f.word.length, variant.length)) {
        cased.append(if (f.word[k].isLowerCase()) variant[k].lowercaseChar() else variant[k].uppercaseChar())
      }
      val s = f.start + offset
      val e = f.end + offset
      var replacement = cased.toString()
      if (stressIdx >= 0 && stressIdx <= replacement.length) {
        replacement = replacement.substring(0, stressIdx) + "+" + replacement.substring(stressIdx)
        offset += 1
      }
      out = out.substring(0, s) + replacement + out.substring(e)
    }
    return out
  }

  private fun run(ids: LongArray, n: Int, len: Int, starts: LongArray, ends: LongArray): FloatArray {
    val inputs = mapOf(
      "ids" to OnnxTensor.createTensor(env, LongBuffer.wrap(ids), longArrayOf(n.toLong(), len.toLong())),
      "starts" to OnnxTensor.createTensor(env, LongBuffer.wrap(starts), longArrayOf(n.toLong())),
      "ends" to OnnxTensor.createTensor(env, LongBuffer.wrap(ends), longArrayOf(n.toLong())),
    )
    try {
      return session.run(inputs).use { out ->
        val buf = (out[0] as OnnxTensor).floatBuffer
        FloatArray(buf.remaining()).also { buf.get(it) }
      }
    } finally {
      inputs.values.forEach { it.close() }
    }
  }

  /** SimpleBertTokenizer.encode: [CLS] + WordPiece(BasicTokenizer(text)) + [SEP]. */
  private fun encode(text: String): LongArray {
    val clean = StringBuilder()
    for (ch in text) {
      if (ch.code == 0 || ch.code == 0xFFFD || isControl(ch)) continue
      clean.append(if (isWhitespace(ch)) ' ' else ch)
    }
    val words = ArrayList<String>()
    for (token in clean.toString().trim().split(WHITESPACE)) {
      if (token.isEmpty()) continue
      if (token in neverSplit) { words.add(token); continue }
      val cur = StringBuilder()
      for (ch in token) {
        if (isPunctuation(ch)) {
          if (cur.isNotEmpty()) { words.add(cur.toString()); cur.clear() }
          words.add(ch.toString())
        } else {
          cur.append(ch)
        }
      }
      if (cur.isNotEmpty()) words.add(cur.toString())
    }
    val ids = ArrayList<Long>()
    ids.add(cls)
    for (w in words) {
      if (w.length > 100) { ids.add(unk); continue }
      val sub = ArrayList<Long>()
      var start = 0
      var bad = false
      while (start < w.length) {
        var end = w.length
        var hit: Long? = null
        while (start < end) {
          val piece = (if (start > 0) "##" else "") + w.substring(start, end)
          val id = vocab[piece]
          if (id != null) { hit = id; break }
          end--
        }
        if (hit == null) { bad = true; break }
        sub.add(hit)
        start = end
      }
      if (bad) ids.add(unk) else ids.addAll(sub)
    }
    ids.add(sep)
    return ids.toLongArray()
  }

  private fun isControl(ch: Char): Boolean {
    if (ch == '\t' || ch == '\n' || ch == '\r') return false
    return when (Character.getType(ch).toByte()) {
      Character.CONTROL, Character.FORMAT, Character.PRIVATE_USE, Character.SURROGATE, Character.UNASSIGNED -> true
      else -> false
    }
  }

  private fun isWhitespace(ch: Char): Boolean =
    ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' || Character.getType(ch).toByte() == Character.SPACE_SEPARATOR

  private fun isPunctuation(ch: Char): Boolean {
    val cp = ch.code
    if (cp in 33..47 || cp in 58..64 || cp in 91..96 || cp in 123..126) return true
    return when (Character.getType(ch).toByte()) {
      Character.CONNECTOR_PUNCTUATION, Character.DASH_PUNCTUATION, Character.START_PUNCTUATION,
      Character.END_PUNCTUATION, Character.INITIAL_QUOTE_PUNCTUATION, Character.FINAL_QUOTE_PUNCTUATION,
      Character.OTHER_PUNCTUATION -> true
      else -> false
    }
  }

  private companion object {
    // (?=.*[а-яё])[а-яё+]+ с IGNORECASE; текст к этому моменту уже в нижнем регистре.
    val PATTERN = Regex("(?=.*[а-яёА-ЯЁ])[а-яёА-ЯЁ+]+")
    val WHITESPACE = Regex(" +")
  }
}
