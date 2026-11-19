package expo.modules.nibiphone.a11y

/**
 * 把快照渲染成给模型的紧凑文字：头部一行、每个元素一行，单页最多 3000 字符。
 *
 * 长页面分页：页尾给 `cursor="s<屏幕号>:<偏移>"`，模型把 cursor 原样交给 `screen`
 * 就能继续读同一份快照；分页不会改变屏幕号与元素编号，tap/type 仍可用同一批编号。
 * 纯 Kotlin，可在 JVM 单测。
 */
object ScreenFormat {
  const val MAX_CHARS = 3000

  private const val APP_CAP = 60
  private const val LABEL_CAP = 240
  private const val VALUE_CAP = 160
  /** 为页尾的「还有 N 项 / cursor」提示预留的空间。 */
  private const val NEXT_NOTE_RESERVE = 72
  private const val SECURE_LINE =
    "⚠ 当前窗口没有可读内容（可能是安全页面、游戏或自绘界面），不能操作。请让用户自己完成。"
  private val WHITESPACE = Regex("\\s+")
  private val CURSOR = Regex("^s(\\d+):(\\d+)$")

  /** 一页文字与下一页游标；nextCursor 为 null 表示已到最后一页。 */
  data class Page(val text: String, val nextCursor: String?)

  /** 兼容旧调用：渲染第一页。 */
  fun render(snapshot: ScreenSnapshot): String = page(snapshot, 0).text

  /** 解析 `s<屏幕号>:<偏移>`；格式不对返回 null。 */
  fun parseCursor(cursor: String): Pair<Int, Int>? {
    val match = CURSOR.find(cursor.trim()) ?: return null
    val id = match.groupValues[1].toIntOrNull() ?: return null
    val offset = match.groupValues[2].toIntOrNull() ?: return null
    if (id <= 0 || offset < 0) return null
    return id to offset
  }

  /**
   * 渲染从第 [start] 个节点（0 起）开始的一页。
   * [start] 超出节点数时返回“没有更多内容”，不抛异常。
   */
  fun page(snapshot: ScreenSnapshot, start: Int): Page {
    val app = oneLine(snapshot.appLabel)
      .ifBlank { oneLine(snapshot.packageName) }
      .ifBlank { "未知应用" }
      .take(APP_CAP)
    val orientation = oneLine(snapshot.orientation).ifBlank { "竖屏" }.take(12)
    val keyboard = if (snapshot.keyboardOpen) "键盘展开" else "键盘收起"
    val baseHeader = "屏幕 s${snapshot.id} · $app · $orientation · $keyboard · 共 ${snapshot.nodes.size} 项"
    val from = start.coerceIn(0, snapshot.nodes.size)
    val header = if (from > 0) "$baseHeader · 从第 ${from + 1} 项起" else baseHeader

    val fixed = mutableListOf(header)
    if (snapshot.secure) fixed += SECURE_LINE
    val lines = snapshot.nodes.map { nodeLine(it) }

    if (from >= lines.size) {
      val tail = if (snapshot.truncated) {
        "（读取到节点上限，可能还有未捕获内容；共 ${snapshot.nodes.size} 项）"
      } else {
        "（没有更多内容；共 ${snapshot.nodes.size} 项）"
      }
      return Page(enforceBudget((fixed + tail).joinToString("\n")), null)
    }

    // 先按字符预算装入节点行；页尾提示的空间也要预留。
    var used = fixed.joinToString("\n").length
    val kept = mutableListOf<String>()
    var end = from
    while (end < lines.size) {
      val line = lines[end]
      val reserve = if (end + 1 < lines.size || snapshot.truncated) NEXT_NOTE_RESERVE else 0
      if (used + 1 + line.length + reserve > MAX_CHARS && end > from) break
      kept += line
      used += 1 + line.length
      end += 1
    }
    return assemble(fixed, kept, lines.size, snapshot, end)
  }

  /**
   * 拼页尾提示；超预算时从页尾回退节点行，保证「nextCursor 指向的项还没显示」。
   * 极端情况下（单行就超预算）交给 enforceBudget 硬截。
   */
  private fun assemble(
    fixed: List<String>,
    keptInput: MutableList<String>,
    totalLines: Int,
    snapshot: ScreenSnapshot,
    endInput: Int,
  ): Page {
    var kept = keptInput
    var end = endInput
    while (true) {
      val nextCursor = if (end < totalLines) "s${snapshot.id}:$end" else null
      val notes = mutableListOf<String>()
      if (nextCursor != null) {
        notes += "…还有 ${totalLines - end} 项；继续调用 screen cursor=\"$nextCursor\""
      } else if (snapshot.truncated) {
        notes += "（读取到节点上限，可能还有未捕获内容）"
      }
      val text = (fixed + kept + notes).joinToString("\n")
      if (text.length <= MAX_CHARS) {
        return Page(enforceBudget(text), nextCursor)
      }
      if (kept.isEmpty()) return Page(enforceBudget(text), nextCursor)
      kept = kept.dropLast(1).toMutableList()
      end -= 1
    }
  }

  private fun nodeLine(node: ScreenNode): String {
    val builder = StringBuilder()
    builder.append(node.index)
    builder.append(". [").append(oneLine(node.role).ifBlank { "元素" }).append(']')

    val label = oneLine(node.label).take(LABEL_CAP)
    if (label.isNotEmpty()) builder.append(' ').append(label)

    val value = node.value?.let { raw -> oneLine(raw) }?.takeIf { it.isNotEmpty() }
    if (value != null) builder.append(" 当前=\"").append(value.take(VALUE_CAP)).append('"')

    val flags = flagList(node)
    if (flags.isNotEmpty()) builder.append(" [").append(flags.joinToString(" ")).append(']')
    return builder.toString()
  }

  private fun flagList(node: ScreenNode): List<String> {
    val out = mutableListOf<String>()
    if (node.clickable) out += "可点"
    if (node.scrollable) out += "可滚动"
    if (node.checkable) out += "可勾选"
    if (node.checked) out += "已选"
    if (!node.enabled) out += "禁用"
    if (node.sensitive) out += "⚠"
    return out
  }

  private fun oneLine(value: String): String = WHITESPACE.replace(value, " ").trim()

  /** 极端情况下按最后一个完整行截断，保证不超过 [MAX_CHARS]。 */
  private fun enforceBudget(text: String): String {
    if (text.length <= MAX_CHARS) return text
    val cut = text.lastIndexOf('\n', MAX_CHARS - 1)
    return if (cut > 0) text.substring(0, cut) else text.take(MAX_CHARS)
  }
}
