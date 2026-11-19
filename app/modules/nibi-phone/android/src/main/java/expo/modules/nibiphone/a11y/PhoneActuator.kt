package expo.modules.nibiphone.a11y

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.nibiphone.mcp.ToolResult
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 把模型的动作落到实时节点上：先节点动作，不可点时用手势兜底。
 * 返回值：null 表示已执行，否则是给模型的错误文本。
 *
 * 不记录屏幕文字、输入内容或图片字节。
 */
class PhoneActuator(private val service: AccessibilityService) {
  fun tap(captured: CapturedScreen, node: ScreenNode, longPress: Boolean): String? {
    val target = captured.handles[node.index]
      ?: return "元素已失效：先重新调用 screen。"

    val action = if (longPress) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK
    val direct = isEnabled(target) && (try {
      if (longPress) target.isLongClickable else target.isClickable
    } catch (_: Throwable) {
      false
    })
    if (direct && perform(target, action)) return null

    if (clickAncestor(target, longPress, node.bounds.centerX, node.bounds.centerY)) return null

    if (Build.VERSION.SDK_INT < 24) return "此系统版本不支持手势点按（需要 Android 7.0+）。"
    val point = visiblePoint(node.bounds) ?: return "元素不在当前屏幕内：先重新调用 screen。"
    val duration = if (longPress) LONG_PRESS_MS else TAP_MS
    val accepted = dispatch(tapGesture(point.first, point.second, duration), duration)
    return if (accepted) null else "点按失败：系统没有接受手势。请重新读取屏幕后重试。"
  }

  fun type(captured: CapturedScreen, node: ScreenNode, text: String, submit: Boolean): String? {
    val target = captured.handles[node.index]
      ?: return "元素已失效：先重新调用 screen。"
    val editable = try {
      target.isEditable
    } catch (_: Throwable) {
      false
    }
    if (!editable) return "这个元素不是输入框（没有可编辑能力）。"
    if (!isEnabled(target)) return "输入框已禁用，无法输入。"
    if (submit && Build.VERSION.SDK_INT < 30) {
      return "此系统版本不支持输入后提交（需要 Android 11+）。"
    }

    val focused = try {
      target.isFocused
    } catch (_: Throwable) {
      false
    }
    if (!focused) perform(target, AccessibilityNodeInfo.ACTION_FOCUS)

    val args = Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    if (!perform(target, AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
      return "写入失败：系统没有接受输入。请先点按输入框，再重新读取屏幕后重试。"
    }

    if (submit) {
      if (Build.VERSION.SDK_INT >= 30) {
        val submitted = perform(target, AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        if (!submitted) return "已写入，但提交失败：系统没有接受回车。请让用户手动提交。"
      }
    }
    return null
  }

  fun scroll(
    captured: CapturedScreen,
    node: ScreenNode?,
    direction: String,
    amount: Int,
  ): String? {
    val times = amount.coerceIn(1, 5)
    val dir = direction.lowercase()
    val target = node?.let { captured.handles[it.index] }
    if (target != null && isEnabled(target)) {
      val actions = scrollActions(target, dir)
      var scrolled = false
      for (step in 0 until times) {
        val acted = actions.any { action -> perform(target, action) }
        if (acted) {
          scrolled = true
        } else {
          break
        }
      }
      if (scrolled) return null
    }

    val area = swipeArea(node) ?: return "当前窗口没有可滚动区域：先重新读取屏幕。"
    val fraction = min(0.45f, 0.15f + 0.06f * times)
    val dx = min((area.width * fraction).roundToInt(), max(1, area.width / 2 - 2)).coerceAtLeast(1)
    val dy = min((area.height * fraction).roundToInt(), max(1, area.height / 2 - 2)).coerceAtLeast(1)
    val centerX = area.centerX
    val centerY = area.centerY

    val accepted = when (dir) {
      // 手指向上滑 = 看下面的内容。
      "down" -> swipe(centerX, centerY + dy, centerX, centerY - dy)
      "up" -> swipe(centerX, centerY - dy, centerX, centerY + dy)
      "right" -> swipe(centerX + dx, centerY, centerX - dx, centerY)
      "left" -> swipe(centerX - dx, centerY, centerX + dx, centerY)
      else -> return "direction 只能是 up/down/left/right。"
    }
    return if (accepted) null else "滚动失败：系统没有接受手势。请重新读取屏幕后重试。"
  }

  fun key(name: String): String? {
    val action = when (name.lowercase()) {
      "back" -> AccessibilityService.GLOBAL_ACTION_BACK
      "home" -> AccessibilityService.GLOBAL_ACTION_HOME
      "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
      "notifications" -> {
        if (Build.VERSION.SDK_INT < 31) {
          return "此系统版本不支持打开通知栏（需要 Android 12+）。"
        }
        AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
      }
      else -> return "name 只能是 back、home、recents、notifications。"
    }
    val accepted = try {
      service.performGlobalAction(action)
    } catch (_: Throwable) {
      false
    }
    return if (accepted) null else "系统没有执行「$name」键。请稍后重试。"
  }

  fun screenshot(): ToolResult {
    if (Build.VERSION.SDK_INT < 30) {
      return ToolResult.error("此系统版本不支持无障碍截屏（需要 Android 11+）。")
    }

    val latch = CountDownLatch(1)
    val lock = Any()
    var shot: Bitmap? = null
    var failure = 0
    var abandoned = false
    // 直接在当前回调线程执行，避免超时后关闭线程池导致系统投递回调被拒绝。
    val executor = Executor { command -> command.run() }
    return run {
      val callback = object : AccessibilityService.TakeScreenshotCallback {
        override fun onSuccess(screenshot: AccessibilityService.ScreenshotResult) {
          val buffer = try {
            screenshot.hardwareBuffer
          } catch (_: Throwable) {
            null
          }
          var copy: Bitmap? = null
          var hardware: Bitmap? = null
          try {
            hardware = buffer?.let { hardwareBuffer ->
              Bitmap.wrapHardwareBuffer(hardwareBuffer, screenshot.colorSpace)
            }
            copy = hardware?.copy(Bitmap.Config.ARGB_8888, false)
          } catch (_: Throwable) {
            copy = null
          } finally {
            hardware?.recycle()
            try {
              buffer?.close()
            } catch (_: Throwable) {
              // 系统已经回收时忽略。
            }
            synchronized(lock) {
              if (abandoned) {
                copy?.recycle()
              } else {
                shot = copy
                latch.countDown()
              }
            }
          }
        }

        override fun onFailure(errorCode: Int) {
          synchronized(lock) {
            if (!abandoned) {
              failure = errorCode
              latch.countDown()
            }
          }
        }
      }

      val requested = try {
        service.takeScreenshot(Display.DEFAULT_DISPLAY, executor, callback)
        true
      } catch (_: Throwable) {
        false
      }
      if (!requested) {
        synchronized(lock) {
          abandoned = true
          shot?.recycle()
          shot = null
        }
        return ToolResult.error("截图失败：系统拒绝了截屏请求。请确认无障碍服务已启用并允许截屏。")
      }

      val finished = try {
        latch.await(5, TimeUnit.SECONDS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        false
      }

      var bitmap: Bitmap? = null
      var errorCode = 0
      synchronized(lock) {
        if (finished) {
          bitmap = shot
          shot = null
          errorCode = failure
        } else {
          abandoned = true
          shot?.recycle()
          shot = null
        }
      }

      if (!finished) return ToolResult.error("截图超时：系统没有在 5 秒内返回画面。请稍后重试。")
      if (errorCode != 0) {
        bitmap?.recycle()
        return ToolResult.error(screenshotFailure(errorCode))
      }
      val raw = bitmap ?: return ToolResult.error("截图失败：系统返回了空画面。")
      // 部分 OEM（PHK110 / Android 16 实测）对 FLAG_SECURE 窗口不返回错误码，而是给一张
      // 除了状态栏以外全黑的图。直接报安全错误，避免把黑图当成成功结果交给模型。
      if (almostBlack(raw)) {
        raw.recycle()
        return ToolResult.error(
          "安全页面不可截屏：系统只返回了全黑画面（当前窗口可能设置了 FLAG_SECURE 或屏幕已关闭）。请让用户自己截图。",
        )
      }

      val longest = max(raw.width, raw.height)
      var scaled = raw
      try {
        if (longest > MAX_SIDE) {
          val factor = MAX_SIDE.toFloat() / longest
          val width = (raw.width * factor).roundToInt().coerceAtLeast(1)
          val height = (raw.height * factor).roundToInt().coerceAtLeast(1)
          scaled = Bitmap.createScaledBitmap(raw, width, height, true)
        }
        var jpeg = compress(scaled, 70)
        if (jpeg.size > MAX_BYTES) jpeg = compress(scaled, 55)
        ToolResult(
          text = "已截屏 ${scaled.width}x${scaled.height}（JPEG，${jpeg.size} 字节）",
          image = jpeg,
          imageMime = "image/jpeg",
        )
      } finally {
        if (scaled !== raw) scaled.recycle()
        raw.recycle()
      }
    }
  }

  /** 采样判断是否几乎全黑：FLAG_SECURE 的返回图只有状态栏是亮的，暗色应用会有更多可见像素。 */
  private fun almostBlack(bitmap: Bitmap): Boolean {
    val stepX = (bitmap.width / 40).coerceAtLeast(1)
    val stepY = (bitmap.height / 80).coerceAtLeast(1)
    var dark = 0
    var total = 0
    var y = 0
    while (y < bitmap.height) {
      var x = 0
      while (x < bitmap.width) {
        val pixel = bitmap.getPixel(x, y)
        val red = (pixel shr 16) and 0xFF
        val green = (pixel shr 8) and 0xFF
        val blue = pixel and 0xFF
        if (red <= 8 && green <= 8 && blue <= 8) dark += 1
        total += 1
        x += stepX
      }
      y += stepY
    }
    return total > 0 && dark.toDouble() / total >= 0.97
  }

  private fun scrollActions(node: AccessibilityNodeInfo, direction: String): List<Int> {
    val className = try {
      node.className?.toString().orEmpty()
    } catch (_: Throwable) {
      ""
    }
    val actionIds = try {
      node.actionList.map { it.id }.toSet()
    } catch (_: Throwable) {
      emptySet<Int>()
    }
    val left = AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT.id
    val up = AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP.id
    val down = AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id
    val horizontal = className.contains("Horizontal") || className.contains("ViewPager") ||
      (left in actionIds && up !in actionIds && down !in actionIds)

    return when (direction) {
      "down" -> if (horizontal) {
        emptyList()
      } else {
        listOf(
          AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN.id,
          AccessibilityNodeInfo.ACTION_SCROLL_FORWARD,
        )
      }
      "up" -> if (horizontal) {
        emptyList()
      } else {
        listOf(
          AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP.id,
          AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD,
        )
      }
      "left" -> listOf(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT.id) +
        if (horizontal) listOf(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) else emptyList()
      "right" -> listOf(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT.id) +
        if (horizontal) listOf(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) else emptyList()
      else -> emptyList()
    }
  }

  private fun clickAncestor(
    start: AccessibilityNodeInfo,
    longPress: Boolean,
    centerX: Int,
    centerY: Int,
  ): Boolean {
    val action = if (longPress) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK
    val rect = Rect()
    var parent = try {
      start.parent
    } catch (_: Throwable) {
      null
    }
    var level = 0
    while (parent != null && level < 4) {
      val clickable = try {
        if (longPress) parent.isLongClickable else parent.isClickable
      } catch (_: Throwable) {
        false
      }
      if (clickable && isEnabled(parent)) {
        try {
          parent.getBoundsInScreen(rect)
        } catch (_: Throwable) {
          rect.setEmpty()
        }
        if (rect.contains(centerX, centerY) && perform(parent, action)) return true
      }
      parent = try {
        parent.parent
      } catch (_: Throwable) {
        null
      }
      level += 1
    }
    return false
  }

  private fun swipeArea(node: ScreenNode?): ScreenBounds? {
    val metrics = service.resources.displayMetrics
    val screenWidth = metrics.widthPixels
    val screenHeight = metrics.heightPixels
    if (screenWidth <= 0 || screenHeight <= 0) return null

    val full = ScreenBounds(0, 0, screenWidth, screenHeight)
    val clipped = node?.bounds?.let { bounds ->
      ScreenBounds(
        max(bounds.left, 0),
        max(bounds.top, 0),
        min(bounds.right, screenWidth),
        min(bounds.bottom, screenHeight),
      )
    }
    val usable = if (clipped != null && clipped.width >= 80 && clipped.height >= 80) clipped else full

    // 避开状态栏和底部手势导航区。
    val left = usable.left + usable.width / 40
    val right = usable.right - usable.width / 40
    val top = usable.top + usable.height / 20
    val bottom = usable.bottom - usable.height / 16
    if (right - left < 40 || bottom - top < 40) return null
    return ScreenBounds(left, top, right, bottom)
  }

  private fun visiblePoint(bounds: ScreenBounds): Pair<Int, Int>? {
    val metrics = service.resources.displayMetrics
    val left = max(bounds.left, 0)
    val top = max(bounds.top, 0)
    val right = min(bounds.right, metrics.widthPixels)
    val bottom = min(bounds.bottom, metrics.heightPixels)
    if (right <= left || bottom <= top) return null
    return ((left + right) / 2) to ((top + bottom) / 2)
  }

  private fun tapGesture(x: Int, y: Int, durationMs: Long): GestureDescription {
    val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
    return GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
      .build()
  }

  private fun swipeGesture(
    startX: Int,
    startY: Int,
    endX: Int,
    endY: Int,
  ): GestureDescription {
    val path = Path().apply {
      moveTo(startX.toFloat(), startY.toFloat())
      lineTo(endX.toFloat(), endY.toFloat())
    }
    return GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0, SWIPE_MS))
      .build()
  }

  private fun swipe(startX: Int, startY: Int, endX: Int, endY: Int): Boolean =
    dispatch(swipeGesture(startX, startY, endX, endY), SWIPE_MS)

  private fun dispatch(gesture: GestureDescription, durationMs: Long): Boolean {
    if (Build.VERSION.SDK_INT < 24) return false
    val latch = CountDownLatch(1)
    var completed = false
    val callback = object : AccessibilityService.GestureResultCallback() {
      override fun onCompleted(gestureDescription: GestureDescription?) {
        completed = true
        latch.countDown()
      }

      override fun onCancelled(gestureDescription: GestureDescription?) {
        latch.countDown()
      }
    }
    val accepted = try {
      service.dispatchGesture(gesture, callback, Handler(Looper.getMainLooper()))
    } catch (_: Throwable) {
      false
    }
    if (!accepted) return false
    return try {
      latch.await(durationMs + 2_000L, TimeUnit.MILLISECONDS) && completed
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
  }

  private fun isEnabled(node: AccessibilityNodeInfo): Boolean = try {
    node.isEnabled
  } catch (_: Throwable) {
    false
  }

  private fun perform(node: AccessibilityNodeInfo, action: Int, args: Bundle? = null): Boolean = try {
    if (args == null) node.performAction(action) else node.performAction(action, args)
  } catch (_: Throwable) {
    false
  }

  private fun compress(bitmap: Bitmap, quality: Int): ByteArray =
    ByteArrayOutputStream().use { out ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
      out.toByteArray()
    }

  /** takeScreenshot 的系统错误码是负数；-5 为安全窗口（API 34+ 才有常量）。 */
  private fun screenshotFailure(code: Int): String = when (code) {
    -1 -> "截图失败：系统内部错误。请稍后重试。"
    -2 -> "截图失败：无障碍服务没有截屏权限。请重新启用「NIBI-GO 手机操控」无障碍服务。"
    -3 -> "截图失败：系统正在处理其他交互。请稍后再试。"
    -4 -> "截图失败：当前显示无效。请回到手机主屏幕后重试。"
    -5 -> "安全页面不可截屏：系统禁止截取当前窗口。请让用户自己截图。"
    else -> "截图失败（错误码 $code）。请稍后重试。"
  }

  private companion object {
    const val TAP_MS = 60L
    const val LONG_PRESS_MS = 600L
    const val SWIPE_MS = 350L
    const val MAX_SIDE = 720
    const val MAX_BYTES = 200 * 1024
  }
}