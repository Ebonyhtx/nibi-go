package expo.modules.nibiphone.a11y

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScreenFormatTest {
  @Test
  fun rendersHeaderAndNodes() {
    val snapshot = snapshot(
      nodes = listOf(
        node(1, role = "按钮", label = "确定", clickable = true),
        node(2, role = "文本", label = "欢迎使用"),
      ),
    )
    val text = ScreenFormat.render(snapshot)
    val lines = text.lines()
    assertEquals("屏幕 s3 · 示例应用 · 竖屏 · 键盘收起 · 共 2 项", lines[0])
    assertEquals("1. [按钮] 确定 [可点]", lines[1])
    assertEquals("2. [文本] 欢迎使用", lines[2])
  }

  @Test
  fun rendersKeyboardAndLandscape() {
    val text = ScreenFormat.render(
      snapshot(nodes = emptyList(), keyboardOpen = true, orientation = "横屏", secure = true),
    )
    assertTrue(text.startsWith("屏幕 s3 · 示例应用 · 横屏 · 键盘展开 · 共 0 项"))
  }

  @Test
  fun rendersValueAndAllFlags() {
    val text = ScreenFormat.render(
      snapshot(
        nodes = listOf(
          node(
            1,
            role = "输入框",
            label = "手机号",
            value = "138****0000",
            clickable = true,
            scrollable = true,
            checkable = true,
            checked = true,
            enabled = false,
            sensitive = true,
          ),
        ),
      ),
    )
    assertTrue(
      text.contains("1. [输入框] 手机号 当前=\"138****0000\" [可点 可滚动 可勾选 已选 禁用 ⚠]"),
    )
  }

  @Test
  fun collapsesWhitespaceInLabel() {
    val text = ScreenFormat.render(
      snapshot(nodes = listOf(node(1, role = "文本", label = "第一行\n第二行\t结尾"))),
    )
    assertTrue(text.contains("1. [文本] 第一行 第二行 结尾"))
  }

  @Test
  fun fallsBackForBlankRole() {
    val text = ScreenFormat.render(snapshot(nodes = listOf(node(1, role = "", label = "目标"))))
    assertTrue(text.contains("1. [元素] 目标"))
  }

  @Test
  fun appendsSecureLine() {
    val text = ScreenFormat.render(snapshot(nodes = emptyList(), secure = true))
    assertTrue(text.contains("安全页面"))
    assertTrue(text.length <= ScreenFormat.MAX_CHARS)
  }

  @Test
  fun notesCaptureTruncation() {
    val text = ScreenFormat.render(snapshot(nodes = listOf(node(1)), truncated = true))
    assertTrue(text.contains("节点上限"))
    assertTrue(text.contains("可能还有未捕获内容"))
  }

  @Test
  fun truncatesAtLineBoundaryUnderMaxChars() {
    val nodes = (1..300).map { index ->
      node(index, role = "文本", label = "第${index}项" + "很长的标签".repeat(8))
    }
    val text = ScreenFormat.render(snapshot(nodes = nodes))
    assertTrue("输出应不超过 3000 字符", text.length <= ScreenFormat.MAX_CHARS)
    assertTrue(text.contains("…还有"))
    assertTrue(text.contains("cursor=\"s3:"))
    assertTrue(text.lines().last().startsWith("…还有"))
    // 头部与每个保留行都是完整行，不会在半行处结束。
    assertTrue(text.lines().dropLast(1).all { it.isNotBlank() })
  }

  @Test
  fun paginatesLongScreensWithoutChangingIndices() {
    val nodes = (1..120).map { index ->
      node(index, role = "文本", label = "第${index}项" + "很长的标签".repeat(8))
    }
    val snapshot = snapshot(nodes = nodes)
    val first = ScreenFormat.page(snapshot, 0)
    assertTrue(first.text.length <= ScreenFormat.MAX_CHARS)
    val cursor = first.nextCursor
    assertTrue("第一页应有下一页", cursor != null)
    val parsed = ScreenFormat.parseCursor(cursor!!)
    assertTrue("cursor 应可解析", parsed != null)
    val (screenId, offset) = parsed!!
    assertEquals(3, screenId)
    assertTrue("偏移应落在节点范围内", offset in 1 until nodes.size)

    val second = ScreenFormat.page(snapshot, offset)
    assertTrue(second.text.contains("从第 ${offset + 1} 项起"))
    assertTrue(second.text.length <= ScreenFormat.MAX_CHARS)
    // 第二页从 offset 对应的编号继续，元素编号本身不变。
    assertTrue(second.text.contains("${nodes[offset].index}. ["))
    // 已到末页时不再给 cursor。
    val last = ScreenFormat.page(snapshot, nodes.size)
    assertEquals(null, last.nextCursor)
    assertTrue(last.text.contains("没有更多内容"))
  }

  @Test
  fun rejectsInvalidCursor() {
    assertEquals(null, ScreenFormat.parseCursor(""))
    assertEquals(null, ScreenFormat.parseCursor("s1"))
    assertEquals(null, ScreenFormat.parseCursor("s0:3"))
    assertEquals(null, ScreenFormat.parseCursor("s1:-1"))
    assertEquals(4 to 12, ScreenFormat.parseCursor(" s4:12 "))
  }

  private fun node(
    index: Int,
    role: String = "按钮",
    label: String = "确定",
    value: String? = null,
    clickable: Boolean = false,
    scrollable: Boolean = false,
    checkable: Boolean = false,
    checked: Boolean = false,
    enabled: Boolean = true,
    sensitive: Boolean = false,
  ): ScreenNode = ScreenNode(
    index = index,
    packageName = "com.example.app",
    role = role,
    label = label,
    value = value,
    clickable = clickable,
    longClickable = false,
    scrollable = scrollable,
    editable = role == "输入框",
    checkable = checkable,
    checked = checked,
    enabled = enabled,
    focused = false,
    password = false,
    sensitive = sensitive,
    bounds = ScreenBounds(0, 0, 100, 50),
  )

  private fun snapshot(
    nodes: List<ScreenNode>,
    keyboardOpen: Boolean = false,
    orientation: String = "竖屏",
    truncated: Boolean = false,
    secure: Boolean = false,
  ): ScreenSnapshot = ScreenSnapshot(
    id = 3,
    packageName = "com.example.app",
    appLabel = "示例应用",
    orientation = orientation,
    keyboardOpen = keyboardOpen,
    nodes = nodes,
    capturedAt = 1_760_000_000_000L,
    truncated = truncated,
    secure = secure,
  )
}