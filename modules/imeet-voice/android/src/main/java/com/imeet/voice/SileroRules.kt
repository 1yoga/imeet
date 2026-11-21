package com.imeet.voice

/**
 * Правила чтения перед Silero — словари из экспорта настроек RuVoice (assets/rules):
 *  - replace.txt: «образец = замена». ~ — регулярное выражение, $ — с учётом регистра,
 *    * — любые буквы (в замене подставляются по порядку). Здесь подсказки для омографов
 *    («старинный замок» → «з+амок»), «кто-то» → «кт+ото», «от нас» → «отн+ас» и т. п.
 *  - stress.txt: «слово ударение» — ~115 тыс. слов, где модель ошибается.
 * Правила применяются по порядку файла; проверяются только те, чьё ключевое слово есть в тексте.
 */
class SileroRules(replaceText: String, stressText: String) {
  private class Rule(val pattern: String, val replacement: String, val regex: Boolean, val caseSensitive: Boolean)

  private val rules = ArrayList<Rule>()
  private val index = HashMap<String, MutableList<Int>>()
  private val always = ArrayList<Int>()
  private val compiled = java.util.concurrent.ConcurrentHashMap<Int, Pair<Regex, String>>()
  private val stress = HashMap<String, String>(140_000)

  init {
    replaceText.lineSequence().forEach { raw ->
      val line = raw.trimEnd('\r')
      if (line.isEmpty() || line.startsWith("#")) return@forEach
      val sep = line.indexOf(" = ")
      if (sep <= 0) return@forEach
      var pattern = line.substring(0, sep)
      val replacement = line.substring(sep + 3)
      val i = rules.size
      if (pattern.startsWith("~")) {
        rules.add(Rule(pattern.substring(1), replacement, regex = true, caseSensitive = false))
        always.add(i)
        return@forEach
      }
      val caseSensitive = pattern.startsWith("$")
      if (caseSensitive) pattern = pattern.substring(1)
      rules.add(Rule(pattern, replacement, regex = false, caseSensitive = caseSensitive))
      val key = KEY_WORD.findAll(pattern).map { it.value.lowercase() }.maxByOrNull { it.length }
      if (key == null) always.add(i) else index.getOrPut(key) { ArrayList(1) }.add(i)
    }
    // Правила со * и регулярные (~600) компилируем заранее в фоне: на телефоне компиляция сотен
    // регулярных выражений при первой реплике занимала больше секунды. Остальные — простой поиск строки.
    Thread {
      rules.indices.filter { rules[it].regex || rules[it].pattern.contains('*') }.forEach { compile(it) }
    }.apply { isDaemon = true; name = "imeet-rules"; start() }
    stressText.lineSequence().forEach { raw ->
      val line = raw.trimEnd('\r')
      if (line.isEmpty() || line.startsWith("#")) return@forEach
      val sp = line.indexOf(' ')
      if (sp > 0) stress[line.substring(0, sp)] = line.substring(sp + 1)
    }
  }

  val ruleCount: Int get() = rules.size
  val stressCount: Int get() = stress.size

  fun apply(text: String): String {
    val words = WORD.findAll(text).map { it.value.lowercase() }.toSet()
    val candidates = sortedSetOf<Int>()
    candidates.addAll(always)
    for (w in words) index[w]?.let(candidates::addAll)
    var out = text
    for (i in candidates) {
      val rule = rules[i]
      if (!rule.regex && !rule.pattern.contains('*')) {
        out = replaceLiteral(out, rule)
        continue
      }
      val (regex, replacement) = compile(i) ?: continue
      out = runCatching { regex.replace(out, replacement) }.getOrDefault(out)
    }
    // Словарь ударений: слова без «+» (уже размеченные правилами не трогаем).
    return TOKEN.replace(out) { m ->
      val w = m.value
      if (w.contains('+')) return@replace w
      val low = w.lowercase()
      val v = stress[low] ?: stress[low.replace('ё', 'е')] ?: return@replace w
      if (w[0].isUpperCase()) v.replaceFirstChar { it.uppercaseChar() } else v
    }
  }

  /** Образец без * и ~: поиск по символам, пробел образца — любой пробельный промежуток, границы слов. */
  private fun replaceLiteral(text: String, rule: Rule): String {
    val p = rule.pattern
    val ignore = !rule.caseSensitive
    val needStart = p.first().isLetterOrDigit()
    val needEnd = p.last().isLetterOrDigit()
    var out: StringBuilder? = null
    var last = 0
    var i = 0
    while (i < text.length) {
      if (!text[i].equals(p[0], ignore) || (needStart && i > 0 && isWordChar(text[i - 1]))) { i++; continue }
      var t = i
      var k = 0
      while (k < p.length && t < text.length) {
        if (p[k] == ' ') {
          if (!text[t].isWhitespace()) break
          while (t < text.length && text[t].isWhitespace()) t++
          k++
        } else if (text[t].equals(p[k], ignore)) {
          t++; k++
        } else break
      }
      if (k == p.length && !(needEnd && t < text.length && isWordChar(text[t]))) {
        if (out == null) out = StringBuilder(text.length + 8)
        out.append(text, last, i).append(rule.replacement)
        last = t
        i = t
      } else {
        i++
      }
    }
    if (out == null) return text
    out.append(text, last, text.length)
    return out.toString()
  }

  private fun isWordChar(c: Char) = c.isLetterOrDigit() || c == '_' || c == '+'

  private fun compile(i: Int): Pair<Regex, String>? {
    compiled[i]?.let { return it }
    val made = build(rules[i]) ?: return null
    compiled[i] = made
    return made
  }

  private fun build(rule: Rule): Pair<Regex, String>? {
    return runCatching {
      if (rule.regex) {
        Pair(Regex(rule.pattern, RegexOption.IGNORE_CASE), rule.replacement)
      } else {
        val body = StringBuilder()
        for (ch in rule.pattern) {
          when {
            ch == '*' -> body.append("(\\p{L}*)")
            ch == ' ' -> body.append("\\s+")
            ch.isLetterOrDigit() -> body.append(ch)
            else -> body.append("\\Q").append(ch).append("\\E")
          }
        }
        val first = rule.pattern.first()
        val last = rule.pattern.last()
        if (first.isLetterOrDigit() || first == '*') body.insert(0, "(?<![\\p{L}\\p{N}_+])")
        if (last.isLetterOrDigit() || last == '*') body.append("(?![\\p{L}\\p{N}_+])")
        val repl = StringBuilder()
        var k = 0
        for (ch in rule.replacement) {
          when (ch) {
            '*' -> { k++; repl.append('$').append(k) }
            '$', '\\' -> repl.append('\\').append(ch)
            else -> repl.append(ch)
          }
        }
        val options = if (rule.caseSensitive) emptySet() else setOf(RegexOption.IGNORE_CASE)
        Pair(Regex(body.toString(), options), repl.toString())
      }
    }.getOrNull()
  }

  private companion object {
    val WORD = Regex("\\p{L}+")
    val TOKEN = Regex("[\\p{L}+]+")
    // Целые слова образца (не части со звёздочкой) — по ним правило ищется в индексе.
    val KEY_WORD = Regex("(?<![\\p{L}\\p{N}_*])\\p{L}+(?![\\p{L}\\p{N}_*])")
  }
}
