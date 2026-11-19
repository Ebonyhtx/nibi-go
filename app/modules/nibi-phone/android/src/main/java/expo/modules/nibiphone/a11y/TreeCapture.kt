package expo.modules.nibiphone.a11y

import android.accessibilityservice.AccessibilityService
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/**
 * 按需抓取当前活动窗口的可见节点树：rootInActiveWindow + 活动窗口，跳过输入法窗口。
 *
 * 只收可见且有边界的节点；点击容器不吸收后代（后代仍各自占编号，点按由执行器向上找
 * 可点祖先）。节点上限 2000、深度 80、时间预算 2 秒。
 */
object TreeCapture {
  private const val MAX_NODES = 2000
  private const val MAX_DEPTH = 80
  private const val BUDGET_MS = 2000L

  private val WHITESPACE = Regex("\\s+")

  fun capture(service: AccessibilityService, screenId: Int): CapturedScreen? {
    val deadline = SystemClock.uptimeMillis() + BUDGET_MS
    val windows = try {
      service.windows
    } catch (_: Throwable) {
      null
    }
    val activeRoot = try {
      service.rootInActiveWindow
    } catch (_: Throwable) {
      null
    }
    val keyboardOpen = windows.orEmpty().any { window ->
      try {
        window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD
      } catch (_: Throwable) {
        false
      }
    }

    var rootsTruncated = false
    val roots = try {
      collectRoots(windows, activeRoot)
    } catch (_: Throwable) {
      // 窗口枚举异常时至少尝试活动窗口。
      rootsTruncated = true
      listOfNotNull(activeRoot)
    }
    val state = State(deadline)
    for (root in roots) {
      if (SystemClock.uptimeMillis() > state.deadline) {
        state.truncated = true
        break
      }
      try {
        walk(root, 0, state)
      } catch (_: Throwable) {
        // 单个窗口读取失败不应清空已经读到的内容。
        state.truncated = true
      }
    }

    val activeWindowId = activeRoot?.let { node -> windowIdOf(node) }
    val primaryRoot = activeWindowId?.let { id ->
      roots.firstOrNull { windowIdOf(it) == id }
    } ?: roots.firstOrNull()
    val packageName = runCatching {
      primaryRoot?.packageName?.toString()?.takeIf { it.isNotEmpty() }
        ?: roots.asSequence()
          .mapNotNull { root -> root.packageName?.toString()?.takeIf { it.isNotEmpty() } }
          .firstOrNull()
    }.getOrNull().orEmpty()

    val orientation = try {
      if (service.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
        "横屏"
      } else {
        "竖屏"
      }
    } catch (_: Throwable) {
      "竖屏"
    }

    val snapshot = ScreenSnapshot(
      id = screenId,
      packageName = packageName,
      appLabel = resolveAppLabel(service, packageName),
      orientation = orientation,
      keyboardOpen = keyboardOpen,
      nodes = state.nodes,
      capturedAt = System.currentTimeMillis(),
      truncated = state.truncated || rootsTruncated,
      secure = roots.isEmpty() || state.nodes.isEmpty(),
    )
    return CapturedScreen(snapshot, state.handles, primaryRoot)
  }

  /**
   * 顶层窗口按 layer 从高到低；输入法窗口整体跳过。
   * 某些窗口的 root 拿不到时，用 rootInActiveWindow 补上活动窗口。
   */
  private fun collectRoots(
    windows: List<AccessibilityWindowInfo>?,
    activeRoot: AccessibilityNodeInfo?,
  ): List<AccessibilityNodeInfo> {
    val out = mutableListOf<AccessibilityNodeInfo>()
    val seenWindowIds = mutableSetOf<Int>()
    val inputMethodWindowIds = mutableSetOf<Int>()
    val activeWindowId = activeRoot?.let { node -> windowIdOf(node) }

    val sorted = windows.orEmpty().sortedByDescending { it.layer }
    for (window in sorted) {
      if (window.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
        try {
          inputMethodWindowIds += window.id
        } catch (_: Throwable) {
          // 少数设备上窗口 id 不可读；跳过输入法时不必依赖它。
        }
        continue
      }
      val root = try {
        window.root
      } catch (_: Throwable) {
        null
      } ?: continue
      val windowId = windowIdOf(root) ?: continue
      // 状态栏/导航栏是 TYPE_SYSTEM 但不是活动窗口：不混进应用快照（否则它们的节点
      // 会带上应用的快照包名，绕过硬拒绝）。通知栏打开时它就是活动窗口，仍会读到。
      if (window.type == AccessibilityWindowInfo.TYPE_SYSTEM && windowId != activeWindowId) {
        continue
      }
      if (seenWindowIds.add(windowId)) out += root
    }

    if (activeRoot != null && activeWindowId != null &&
      activeWindowId !in inputMethodWindowIds
    ) {
      if (seenWindowIds.add(activeWindowId)) out += activeRoot
    }
    return out
  }

  private fun windowIdOf(node: AccessibilityNodeInfo): Int? = try {
    node.windowId
  } catch (_: Throwable) {
    null
  }

  private class State(val deadline: Long) {
    val nodes = mutableListOf<ScreenNode>()
    val handles = LinkedHashMap<Int, AccessibilityNodeInfo>()
    var visited = 0
    var truncated = false
    var lastKey: Triple<String, String, String?>? = null
  }

  @Suppress("DEPRECATION")
  private fun walk(node: AccessibilityNodeInfo, depth: Int, state: State) {
    if (state.visited >= MAX_NODES || SystemClock.uptimeMillis() > state.deadline) {
      state.truncated = true
      return
    }
    state.visited += 1

    val visible = try {
      node.isVisibleToUser
    } catch (_: Throwable) {
      false
    }
    if (!visible) return

    val rect = Rect()
    try {
      node.getBoundsInScreen(rect)
    } catch (_: Throwable) {
      return
    }
    if (rect.right <= rect.left || rect.bottom <= rect.top) return

    val text = clean(node.text?.toString())
    val description = clean(node.contentDescription?.toString())
    val hint = if (Build.VERSION.SDK_INT >= 26) clean(node.hintText?.toString()) else null
    val editable = node.isEditable
    val password = node.isPassword
    val rawLabel = (if (editable) {
      description ?: hint ?: text
    } else {
      text ?: description ?: hint
    }).orEmpty()
    val label = ScreenMask.mask(rawLabel)
    // 打码后的标签（如「银行卡 ****1234」）也算敏感，避免裸卡号只隐藏值不标 ⚠。
    val sensitive = password || SensitiveWords.isSensitive(rawLabel) ||
      SensitiveWords.isSensitive(label)
    // isSecretField = password || isSensitive(label)，与上面的并集一致。
    val secret = sensitive

    // 输入框显示 hint 时 text 不是用户内容，不当作当前值。
    val showingHint = if (Build.VERSION.SDK_INT >= 26) {
      try {
        node.isShowingHintText
      } catch (_: Throwable) {
        false
      }
    } else {
      false
    }
    val rawValue = if (editable && !showingHint) text else null
    val value = if (secret) null else rawValue?.let { ScreenMask.mask(it) }

    val role = roleOf(node)
    val clickable = node.isClickable
    val longClickable = node.isLongClickable
    val scrollable = node.isScrollable
    val checkable = node.isCheckable
    val range = try {
      node.rangeInfo
    } catch (_: Throwable) {
      null
    }
    val hasText = text != null || description != null || hint != null
    val action = clickable || longClickable || scrollable || checkable || editable ||
      (range != null && role == "滑块")

    if (hasText || action) {
      val key = Triple(role, label, value)
      if (key != state.lastKey) {
        val index = state.nodes.size + 1
        state.nodes += ScreenNode(
          index = index,
          packageName = try {
            node.packageName?.toString().orEmpty()
          } catch (_: Throwable) {
            ""
          },
          role = role,
          label = label,
          value = value,
          clickable = clickable,
          longClickable = longClickable,
          scrollable = scrollable,
          editable = editable,
          checkable = checkable,
          checked = node.isChecked,
          enabled = node.isEnabled,
          focused = node.isFocused,
          password = password,
          sensitive = sensitive,
          bounds = ScreenBounds(rect.left, rect.top, rect.right, rect.bottom),
        )
        state.handles[index] = node
        state.lastKey = key
      }
    }

    if (depth >= MAX_DEPTH) {
      if (node.childCount > 0) state.truncated = true
      return
    }

    val childCount = try {
      node.childCount
    } catch (_: Throwable) {
      0
    }
    for (position in 0 until childCount) {
      if (state.visited >= MAX_NODES || SystemClock.uptimeMillis() > state.deadline) {
        state.truncated = true
        break
      }
      val child = try {
        node.getChild(position)
      } catch (_: Throwable) {
        null
      } ?: continue
      walk(child, depth + 1, state)
    }
  }

  /** className 后缀决定角色；未知类名时再用可编辑/可勾选/可滚动/可点等标志兜底。 */
  private fun roleOf(node: AccessibilityNodeInfo): String {
    val simple = node.className?.toString().orEmpty().substringAfterLast('.')
    return when {
      simple.endsWith("EditText") -> "输入框"
      simple.endsWith("ToggleButton") || simple.endsWith("Switch") ||
        simple.endsWith("SwitchCompat") -> "开关"
      simple.endsWith("CheckBox") || simple.endsWith("CheckedTextView") -> "勾选框"
      simple.endsWith("RadioButton") -> "单选"
      simple.endsWith("SeekBar") || simple.endsWith("RatingBar") ||
        simple.contains("Slider") -> "滑块"
      simple.endsWith("AutoCompleteTextView") -> "下拉框"
      simple.endsWith("Spinner") -> "下拉框"
      simple.endsWith("RecyclerView") || simple.endsWith("ListView") ||
        simple.endsWith("GridView") || simple.endsWith("ScrollView") ||
        simple.endsWith("ViewPager") || simple.endsWith("ViewPager2") -> "列表"
      simple.endsWith("WebView") -> "网页"
      simple.endsWith("Button") -> "按钮"
      simple.endsWith("ImageView") || simple == "Image" -> "图片"
      simple.endsWith("TextView") -> "文本"
      node.isEditable -> "输入框"
      node.isCheckable -> "勾选框"
      node.isScrollable -> "列表"
      node.isClickable || node.isLongClickable -> "按钮"
      else -> "元素"
    }
  }

  private fun clean(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    val flat = WHITESPACE.replace(raw, " ").trim()
    return flat.ifEmpty { null }
  }

  @Suppress("DEPRECATION")
  private fun resolveAppLabel(service: AccessibilityService, packageName: String): String {
    if (packageName.isEmpty()) return "未知应用"
    return runCatching {
      val info = service.packageManager.getApplicationInfo(packageName, 0)
      service.packageManager.getApplicationLabel(info).toString().takeIf { it.isNotBlank() }
    }.getOrNull() ?: packageName
  }
}