package com.imeet.voice

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer
import kotlin.math.exp
import kotlin.math.min

/**
 * Подготовка текста для встроенного Silero — построчный перенос кода пакета Silero v5_5
 * (prepare_text_input, AccentorNgram, classify_text, build_type_ids_inference, parse_focus_from_text).
 * Сверено на ПК: ударения и звук совпадают с оригиналом (tools/silero-onnx/export_v3.py).
 */
class SileroText(
  symbols: String,
  private val symbolToId: Map<Char, Long>,
  private val sos: Char,
  private val eos: Char,
  private val accentor: SileroAccentor,
  private val homo: SileroHomo?,
) {
  private val allowed: Set<Char> = (symbols.substring(3) + "^").toSet()

  /** prepare_text_input + clean_star_text. */
  fun prepare(text: String): String {
    val lowered = text.lowercase().replace("—", "–").replace("‑", "-")
    val kept = StringBuilder()
    for (ch in lowered) if (ch in allowed) kept.append(ch)
    var t = kept.toString().replace("^", " ^")
    t = WHITESPACE.replace(t, " ").trim().replace("^ ", "^")
    t = Regex("\\^+").replace(t, "^").trim()
    if (t.endsWith("^")) t = t.dropLast(1).trim()
    return t
  }

  /** SileroStress: сначала омографы (замо́к / за́мок), потом ударения остальных слов. */
  fun accent(prepared: String): String = accentor.accent(homo?.solve(prepared) ?: prepared)

  val hasHomographs: Boolean get() = homo != null

  /**
   * Омографы по всей реплике до деления на куски: короткий кусок даёт BERT мало смысла
   * («что ты написал.» → «нап+исал»). Возвращает исходный текст, где у омографов уже стоит «+».
   */
  fun homographHints(raw: String): String {
    val solver = homo ?: return raw
    val prepared = prepare(raw.replace("*", ""))
    val solved = solver.solve(prepared)
    if (solved == prepared) return raw
    val solvedWords = SOLVED_WORD.findAll(solved).map { it.value }.toList()
    val rawWords = RAW_WORD.findAll(raw).toList()
    if (solvedWords.size != rawWords.size) return raw
    val out = StringBuilder()
    var last = 0
    rawWords.forEachIndexed { i, m ->
      val s = solvedWords[i]
      out.append(raw, last, m.range.first)
      if (s.contains('+') && !m.value.contains('+') && s.replace("+", "").length == m.value.length) {
        var k = 0
        for (ch in s) {
          if (ch == '+') { out.append('+'); continue }
          out.append(if (m.value[k].isUpperCase()) ch.uppercaseChar() else ch)
          k++
        }
      } else {
        out.append(m.value)
      }
      last = m.range.last + 1
    }
    out.append(raw, last, raw.length)
    return out.toString()
  }

  /** preprocess_tacotron: sos + текст + eos -> номера символов. */
  fun toIds(accented: String): LongArray {
    val all = "$sos$accented$eos"
    return LongArray(all.length) { symbolToId[all[it]] ?: 0L }
  }

  fun typeIds(plain: String, length: Int): LongArray {
    val typeStr = classifyText(plain)
    val types = typeStr.split('|')
    val trimmed = plain.trim()
    val sentences = if (trimmed.isNotEmpty()) SENT_SPLIT.split(trimmed) else listOf("")
    val perChar = ArrayList<Long>()
    sentences.forEachIndexed { i, s ->
      val tid = TYPE2ID[types.getOrElse(i) { types.last() }] ?: 0L
      repeat(s.length) { perChar.add(tid) }
      if (i < sentences.size - 1) perChar.add(tid)
    }
    val ids = LongArray(length)
    if (perChar.isEmpty()) return ids
    val default = TYPE2ID[types[0]] ?: 0L
    ids[0] = default
    var idx = 1
    for (tid in perChar) {
      if (idx < length) ids[idx] = tid
      idx++
    }
    while (idx < length) ids[idx++] = default
    return ids
  }

  /** Логическое ударение: слова в *звёздочках* получают силу 3. null — выделений нет. */
  fun focusMask(original: String, accented: String, length: Int): LongArray? {
    if (!original.contains('*')) return null
    val focusWords = original.trim().split(WHITESPACE).filter { it.contains('*') }
      .map { it.replace("*", "").replace("+", "").lowercase() }.toMutableList()
    val marked = accented.trim().split(WHITESPACE).filter { it.isNotEmpty() }.joinToString(" ") { word ->
      val clean = word.replace("+", "").lowercase()
      if (focusWords.remove(clean)) "*$word*" else word
    }
    val flags = ArrayList<Boolean>()
    var inFocus = false
    for (ch in marked) {
      if (ch == '*') { inFocus = !inFocus; continue }
      flags.add(inFocus)
    }
    val processed = marked.replace("*", "").lowercase()
    val mask = LongArray(length)
    var idx = 1
    processed.forEachIndexed { i, ch ->
      if (symbolToId.containsKey(ch) && idx < length) {
        if (flags.isNotEmpty() && flags[min(i, flags.size - 1)]) mask[idx] = 3
        idx++
      }
    }
    return mask
  }

  companion object {
    val WHITESPACE = Regex("\\s+")
    private val SOLVED_WORD = Regex("[а-яё+]+")
    private val RAW_WORD = Regex("[А-Яа-яЁё+]+")
    val SENT_SPLIT = Regex("(?<=[.!?])\\s+")
    val TYPE2ID = mapOf("st" to 0L, "wh_q" to 1L, "general_q" to 2L, "alternative_q" to 3L, "tag_q" to 4L, "exclam" to 5L)

    private val WH_FORMS = setOf(
      "кто", "кого", "кому", "кем", "ком", "что", "чего", "чему", "чем", "чём", "чё", "чо",
      "где", "куда", "откуда", "когда", "почему", "зачем", "как", "почём", "отчего", "насколько",
      "сколько", "скольких", "скольким", "сколькими", "какой", "какая", "какое", "какие",
      "какого", "каких", "какому", "каким", "какими", "каком", "какую",
      "чей", "чья", "чьё", "чье", "чьи", "чьего", "чьей", "чьих", "чьему", "чьим", "чьими", "чьём", "чьем", "чью",
      "который", "которая", "которое", "которые", "которого", "которой", "которых",
      "которому", "которым", "которыми", "котором", "которую", "каков", "какова", "каково", "каковы",
    )
    private val LEADING_FILLERS = setOf(
      "а", "ну", "и", "так", "вот", "слышь", "слушай", "скажите", "скажи", "пожалуйста",
      "вобще", "вообще", "типа", "короче",
    )
    private val TAG_RE = Regex(
      "(?:[,\\s]+(правда|верно|да)\\s*\\?$)|(?:[,\\s]+(не\\s+так\\s+ли|не\\s+правда\\s+ли|разве\\s+не\\s+так|ведь\\s+так)\\s*\\?$)|" +
        "(?:[,\\s]+ведь\\s*\\?$)|(?:[,\\s]+а\\s*\\?$)",
      RegexOption.IGNORE_CASE,
    )
    // \b по Юникоду: флаг (?U) Android не поддерживает, поэтому границы слова заданы явно.
    private val OR_RE = Regex("(?<![\\p{L}\\p{N}_])или(?![\\p{L}\\p{N}_])", RegexOption.IGNORE_CASE)
    private val WORD_RE = Regex("[а-яёa-z]+", RegexOption.IGNORE_CASE)
    private val QUOTE_OPEN = setOf('"', '«', '“', '„')
    private val QUOTE_CLOSE = setOf('"', '»', '”', '’')

    private fun stripOuterQuotes(text: String): String {
      var s = text.trim()
      while (s.isNotEmpty() && s[0] in QUOTE_OPEN) s = s.substring(1).trim()
      while (s.isNotEmpty() && s[s.length - 1] in QUOTE_CLOSE) s = s.dropLast(1).trim()
      return s
    }

    private fun normalizeForClf(text: String): String {
      val s = stripOuterQuotes(text).replace("+", "").replace("ё", "е").replace("Ё", "Е")
      return WHITESPACE.replace(s, " ").trim()
    }

    private fun hasWhPrefix(text: String): Boolean {
      val words = WORD_RE.findAll(text.lowercase()).map { it.value }.take(8)
      val content = ArrayList<String>()
      for (w in words) {
        if (w in LEADING_FILLERS) continue
        content.add(w)
        if (content.size >= 4) break
      }
      return content.any { it in WH_FORMS }
    }

    fun classifySentence(sentence: String): String {
      val s = sentence.trim()
      if (s.isEmpty()) return "st"
      val clean = stripOuterQuotes(s)
      if (clean.isEmpty()) return "st"
      var tail = clean
      if (tail.endsWith("?!") || tail.endsWith("?..") || tail.endsWith("?...")) tail = tail.trimEnd('.', '!')
      if (tail.endsWith("?")) {
        val q = normalizeForClf(tail)
        if (TAG_RE.containsMatchIn(q)) return "tag_q"
        if (hasWhPrefix(q)) return "wh_q"
        if (OR_RE.containsMatchIn(q)) return "alternative_q"
        return "general_q"
      }
      return if (clean.endsWith("!")) "exclam" else "st"
    }

    fun classifyText(text: String): String {
      if (text.isBlank()) return "st"
      val sentences = SENT_SPLIT.split(text.trim()).map { it.trim() }.filter { it.isNotEmpty() }
      return sentences.joinToString("|") { classifySentence(it) }
    }
  }
}

/** Ударения и «ё»: n-граммы слова -> среднее эмбеддингов -> два маленьких классификатора (accent_heads.onnx). */
class SileroAccentor(
  private val env: OrtEnvironment,
  private val heads: OrtSession,
  private val ngramIds: Map<String, Int>,
  private val emb: FloatArray,
  private val dim: Int,
  private val exceptions: Map<String, Pair<Int, Int>>,
) {
  private val unk = ngramIds["UNK"] ?: 0

  fun accent(sentence: String): String {
    val tokens = ArrayList<String>()
    val clean = ArrayList<String>()
    val need = ArrayList<Boolean>()
    for (word in splitKeeping(sentence)) {
      val parts = word.split("-")
      val cur: List<String>
      val mask: MutableList<Boolean>
      if (parts.size == 1) {
        cur = parts
        mask = mutableListOf(true)
      } else {
        cur = parts.dropLast(1).map { "$it-" } + parts.last()
        mask = (MutableList(parts.size - 1) { true } + (parts.last() != "то")).toMutableList()
      }
      cur.forEachIndexed { i, token ->
        val c = NON_CYRILLIC.replace(token.lowercase(), "")
        tokens.add(token)
        clean.add(c)
        need.add(c.isNotEmpty() && mask[i])
      }
    }
    val rows = clean.indices.filter { need[it] }
    if (rows.isEmpty()) return tokens.joinToString("")
    val input = FloatArray(rows.size * dim)
    rows.forEachIndexed { r, i -> embedWord(clean[i], input, r * dim) }
    val (stress, yo) = OnnxTensor.createTensor(env, FloatBuffer.wrap(input), longArrayOf(rows.size.toLong(), dim.toLong())).use { tensor ->
      heads.run(mapOf("emb" to tensor)).use { out ->
        @Suppress("UNCHECKED_CAST")
        Pair((out[0].value as Array<FloatArray>), (out[1].value as Array<FloatArray>))
      }
    }
    val rowOf = HashMap<Int, Int>()
    rows.forEachIndexed { r, i -> rowOf[i] = r }

    val result = StringBuilder()
    tokens.forEachIndexed { i, rawToken ->
      var raw = rawToken
      val low = raw.lowercase()
      val r = rowOf[i]
      if (!need[i] || r == null) { result.append(raw); return@forEachIndexed }
      val haveStress = low.contains('+')
      val haveYo = low.contains('ё')
      if (haveStress && haveYo) { result.append(raw); return@forEachIndexed }
      if (!haveStress && haveYo) {
        val positions = low.indices.filter { low[it] == 'ё' }
        positions.forEachIndexed { k, p -> raw = raw.substring(0, p + k) + "+" + raw.substring(p + k) }
        result.append(raw); return@forEachIndexed
      }
      exceptions[clean[i]]?.let { (sPos, yPos) ->
        if (haveStress) {
          // Ударение уже поставил решатель омографов: «ё» из словаря — только если совпадает с ним.
          val marks = raw.indices.filter { raw[it] == '+' }
          var word = raw.replace("+", "")
          if (yPos != -1 && (yPos + 1) in marks && yPos < word.length) {
            word = word.substring(0, yPos) + (if (word[yPos].isLowerCase()) "ё" else "Ё") + word.substring(yPos + 1)
          }
          for (m in marks) word = word.substring(0, m) + "+" + word.substring(m)
          result.append(word)
          return@forEachIndexed
        }
        if (yPos != -1 && yPos < raw.length) raw = raw.substring(0, yPos) + (if (raw[yPos].isLowerCase()) "ё" else "Ё") + raw.substring(yPos + 1)
        result.append(raw.substring(0, sPos)).append('+').append(raw.substring(sPos))
        return@forEachIndexed
      }
      val sp = softmax(stress[r])
      val yp = softmax(yo[r])
      val sIdx = argmax(sp)
      var setStress = sp[sIdx] > 0.5f && !haveStress
      val yIdx = argmax(yp)
      val setYo = yp[yIdx] > 0.5f
      // Если ударение уже стоит (омограф), «ё» сверяем с ним, а не с предсказанием.
      val stressedIds = if (haveStress) low.split('+').map { part -> part.count { it in VOWELS } } else listOf(sIdx)
      val vowelIds = low.indices.filter { low[it] in VOWELS }
      val yeIds = low.indices.filter { low[it] == 'е' }
      var stressPos = stressedIds.filter { it < vowelIds.size }.map { vowelIds[it] }
      val yoPos = if (yIdx > 0 && yIdx - 1 < yeIds.size) listOf(yeIds[yIdx - 1]) else emptyList()
      if (vowelIds.isEmpty()) { result.append(raw); return@forEachIndexed }
      for (y in yoPos) {
        if (y in stressPos && setYo && low[y] == 'е') {
          raw = raw.substring(0, y) + (if (raw[y].isLowerCase()) "ё" else "Ё") + raw.substring(y + 1)
        }
      }
      if (vowelIds.size == 1) {
        stressPos = listOf(vowelIds[0])
        setStress = true
      }
      if (!haveStress && setStress) {
        stressPos.forEachIndexed { k, s -> raw = raw.substring(0, s + k) + "+" + raw.substring(s + k) }
      }
      result.append(raw)
    }
    return result.toString()
  }

  /** Среднее эмбеддингов n-грамм слова (fastText EmbeddingBag, mode="mean"). */
  private fun embedWord(word: String, out: FloatArray, offset: Int) {
    val t = "<$word>"
    val ids = ArrayList<Int>()
    for (n in 1..word.length + 3) {
      for (i in 0..t.length - n) ngramIds[t.substring(i, i + n)]?.let(ids::add)
    }
    if (word.isEmpty()) ngramIds[word]?.let(ids::add)
    if (ids.isEmpty()) ids.add(unk)
    for (id in ids) {
      val base = id * dim
      for (d in 0 until dim) out[offset + d] += emb[base + d]
    }
    for (d in 0 until dim) out[offset + d] /= ids.size.toFloat()
  }

  private fun softmax(x: FloatArray): FloatArray {
    val m = x.maxOrNull() ?: 0f
    val e = FloatArray(x.size) { exp((x[it] - m).toDouble()).toFloat() }
    val sum = e.sum()
    return FloatArray(e.size) { e[it] / sum }
  }

  private fun argmax(x: FloatArray): Int = x.indices.maxByOrNull { x[it] } ?: 0

  /** re.split с захватом разделителей: [слово, разделитель, слово, ...]. */
  private fun splitKeeping(text: String): List<String> {
    val out = ArrayList<String>()
    var last = 0
    for (m in SEPARATORS.findAll(text)) {
      out.add(text.substring(last, m.range.first))
      out.add(m.value)
      last = m.range.last + 1
    }
    out.add(text.substring(last))
    return out
  }

  private companion object {
    val SEPARATORS = Regex("[\\s.,!?;:<>=()/\\\\]+")
    val NON_CYRILLIC = Regex("[^А-Яа-яёЁ]")
    const val VOWELS = "аоуыэиеяёю"
  }
}
