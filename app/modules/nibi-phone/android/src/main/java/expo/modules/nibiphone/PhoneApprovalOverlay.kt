package expo.modules.nibiphone

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 手机工具审批的悬浮卡：不抢焦点（FLAG_NOT_FOCUSABLE），目标应用保持前台。
 * 需要「显示在其他应用上层」权限；没有权限时返回 false，由 App 回退到应用内审批卡。
 */
class PhoneApprovalOverlay(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var view: View? = null
  private var currentId: String? = null
  private var onDecision: ((String, String) -> Unit)? = null

  fun canDraw(): Boolean = try {
    Settings.canDrawOverlays(context)
  } catch (_: Throwable) {
    false
  }

  /**
   * 展示审批卡；返回是否真的加上去了。调用方据此决定是否隐藏应用内卡片。
   * 回调在主线程执行，参数是 (interactionId, optionId)。
   */
  fun show(
    interactionId: String,
    toolName: String,
    summary: String,
    detail: String,
    allowOptionId: String,
    alwaysOptionId: String?,
    denyOptionId: String,
    onDecision: (String, String) -> Unit,
  ): Boolean {
    if (!canDraw()) return false
    val latch = CountDownLatch(1)
    var added = false
    handler.post {
      try {
        removeInternal()
        val card = buildCard(
          interactionId = interactionId,
          toolName = toolName,
          summary = summary,
          detail = detail,
          allowOptionId = allowOptionId,
          alwaysOptionId = alwaysOptionId,
          denyOptionId = denyOptionId,
          onDecision = onDecision,
        )
        windowManager.addView(card, params())
        view = card
        currentId = interactionId
        this.onDecision = onDecision
        added = true
      } catch (_: Throwable) {
        added = false
      } finally {
        latch.countDown()
      }
    }
    return try {
      latch.await(1500, TimeUnit.MILLISECONDS) && added
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      false
    }
  }

  /** interactionId 为 null 时移除当前任意一张；不匹配时不动。 */
  fun hide(interactionId: String? = null) {
    handler.post {
      if (interactionId == null || interactionId == currentId) removeInternal()
    }
  }

  private fun removeInternal() {
    val current = view ?: return
    view = null
    currentId = null
    onDecision = null
    try {
      windowManager.removeViewImmediate(current)
    } catch (_: Throwable) {
      // 已经被系统移除时忽略。
    }
  }

  @Suppress("DEPRECATION")
  private fun params(): WindowManager.LayoutParams {
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      WindowManager.LayoutParams.TYPE_PHONE
    }
    return WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.BOTTOM
      y = dp(8)
    }
  }

  private fun buildCard(
    interactionId: String,
    toolName: String,
    summary: String,
    detail: String,
    allowOptionId: String,
    alwaysOptionId: String?,
    denyOptionId: String,
    onDecision: (String, String) -> Unit,
  ): View {
    val root = FrameLayout(context).apply {
      setPadding(dp(16), 0, dp(16), dp(20))
      isClickable = false
      isFocusable = false
    }
    val card = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(16), dp(20), dp(16))
      background = rounded(Color.WHITE, dp(20), Color.parseColor("#E5E7EB"), dp(1))
      isClickable = true
      elevation = dp(10).toFloat()
    }

    val label = text("NIBI-GO · 手机操控", 11f, Color.parseColor("#C2662F"), bold = true)
    card.addView(label)

    val shortName = toolName.removePrefix("mcp__phone__").ifBlank { "手机工具" }
    card.addView(
      text("允许使用 $shortName？", 17f, Color.parseColor("#111827"), bold = true).apply {
        setPadding(0, dp(4), 0, 0)
      },
    )

    val hint = text(
      "该调用会读取屏幕或模拟操作；确认后只执行这一次。",
      13f,
      Color.parseColor("#4B5563"),
    ).apply {
      setPadding(0, dp(6), 0, 0)
      maxLines = 3
      ellipsize = TextUtils.TruncateAt.END
    }
    card.addView(hint)

    val summaryText = summary.trim()
    if (
      summaryText.isNotEmpty() &&
      summaryText.length <= 160 &&
      !summaryText.startsWith("NIBI requested")
    ) {
      card.addView(
        text(summaryText, 12f, Color.parseColor("#6B7280")).apply {
          setPadding(0, dp(6), 0, 0)
          maxLines = 2
          ellipsize = TextUtils.TruncateAt.END
        },
      )
    }

    val detailText = detail.trim()
    if (detailText.isNotEmpty()) {
      card.addView(
        text(detailText, 12f, Color.parseColor("#374151")).apply {
          setPadding(0, dp(6), 0, 0)
          maxLines = 3
          ellipsize = TextUtils.TruncateAt.END
          setTextIsSelectable(false)
        },
      )
    }

    val buttons = LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(0, dp(14), 0, 0)
    }
    if (alwaysOptionId != null) {
      // 对应内核的 allowAlways：按工具（部分工具还按参数，如 open 的 url）记住规则。
      val always = action(
        "始终允许",
        Color.parseColor("#FFF4EC"),
        Color.parseColor("#A8541F"),
      ) {
        finish(interactionId, alwaysOptionId, onDecision)
      }
      buttons.addView(
        always,
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(40)),
      )
    }
    val row = LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      if (alwaysOptionId != null) setPadding(0, dp(8), 0, 0)
    }
    val deny = action("拒绝", Color.parseColor("#F3F4F6"), Color.parseColor("#374151")) {
      finish(interactionId, denyOptionId, onDecision)
    }
    val allow = action("允许一次", Color.parseColor("#C2662F"), Color.WHITE) {
      finish(interactionId, allowOptionId, onDecision)
    }
    row.addView(
      deny,
      LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(8) },
    )
    row.addView(
      allow,
      LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginStart = dp(8) },
    )
    buttons.addView(row)
    card.addView(buttons)

    root.addView(
      card,
      FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM,
      ),
    )
    return root
  }

  private fun finish(interactionId: String, optionId: String, callback: (String, String) -> Unit) {
    // 只回调当前这张卡；旧卡已被替换时不再应答。
    if (interactionId != currentId) return
    val decision = callback
    removeInternal()
    decision(interactionId, optionId)
  }

  private fun action(
    label: String,
    fill: Int,
    foreground: Int,
    onClick: () -> Unit,
  ): TextView = text(label, 14f, foreground, bold = true).apply {
    gravity = Gravity.CENTER
    setBackground(rounded(fill, dp(12), 0, 0))
    isClickable = true
    isFocusable = true
    contentDescription = label
    setOnClickListener { onClick() }
  }

  private fun text(
    value: String,
    sizeSp: Float,
    color: Int,
    bold: Boolean = false,
  ): TextView = TextView(context).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
    setTextColor(color)
    if (bold) typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
  }

  private fun rounded(fill: Int, radius: Int, stroke: Int, strokeWidth: Int): GradientDrawable =
    GradientDrawable().apply {
      setColor(fill)
      cornerRadius = radius.toFloat()
      if (strokeWidth > 0) setStroke(strokeWidth, stroke)
    }

  private fun dp(value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}