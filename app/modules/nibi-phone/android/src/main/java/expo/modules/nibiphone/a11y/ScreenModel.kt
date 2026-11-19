package expo.modules.nibiphone.a11y

import android.view.accessibility.AccessibilityNodeInfo

/** 屏幕坐标（纯数据，便于 JVM 单测；不依赖 android.graphics.Rect）。 */
data class ScreenBounds(
  val left: Int,
  val top: Int,
  val right: Int,
  val bottom: Int,
) {
  val centerX: Int get() = (left + right) / 2
  val centerY: Int get() = (top + bottom) / 2
  val width: Int get() = right - left
  val height: Int get() = bottom - top
}

/** 一个可被模型引用的屏幕元素（已脱敏）。 */
data class ScreenNode(
  val index: Int,
  val packageName: String,
  val role: String,
  val label: String,
  val value: String?,
  val clickable: Boolean,
  val longClickable: Boolean,
  val scrollable: Boolean,
  val editable: Boolean,
  val checkable: Boolean,
  val checked: Boolean,
  val enabled: Boolean,
  val focused: Boolean,
  val password: Boolean,
  val sensitive: Boolean,
  val bounds: ScreenBounds,
)

/** 一次读屏的结果；id 对应模型看到的 sN。 */
data class ScreenSnapshot(
  val id: Int,
  val packageName: String,
  val appLabel: String,
  val orientation: String,
  val keyboardOpen: Boolean,
  val nodes: List<ScreenNode>,
  val capturedAt: Long,
  val truncated: Boolean,
  val secure: Boolean,
)

/** 快照 + 用于执行动作的实时节点句柄（只在本进程内使用）。 */
class CapturedScreen(
  val snapshot: ScreenSnapshot,
  val handles: Map<Int, AccessibilityNodeInfo>,
  val root: AccessibilityNodeInfo?,
)