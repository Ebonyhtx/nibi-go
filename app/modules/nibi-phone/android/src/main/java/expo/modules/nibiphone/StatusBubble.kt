package expo.modules.nibiphone

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.widget.FrameLayout
import android.widget.TextView

/**
 * 全局悬浮状态气泡：44dp 圆形悬浮球，固定在屏幕右侧竖直居中（拖动留待后续）。
 * 与审批悬浮卡同一条权限路（TYPE_APPLICATION_OVERLAY + canDrawOverlays），不抢焦点。
 * 状态由 RN 调 setState 驱动，原生不做自动状态机；每次 setState 换背景并启停对应动效：
 * - running：墨蓝底 + 旋转（1.2s 一圈，LinearInterpolator）；
 * - tools：橙底 + 同款旋转（正在执行手机工具/操控）；
 * - waiting：金底 + 脉冲缩放（等待审批/提问）；
 * - done：绿底对勾，停留 2 秒后自动收起（回合完成）；
 * - hidden：移除悬浮球。
 * 单击气泡把 NIBI-GO 主任务切回前台；ColorOS 的「后台弹出界面」未授权时静默失败。
 */
class StatusBubble(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var view: View? = null
  private var label: TextView? = null
  private var animator: ValueAnimator? = null
  private var autoHide: Runnable? = null

  companion object {
    private const val BG_RUNNING = "#1c2f4e"
    private const val BG_TOOLS = "#e08a3e"
    private const val BG_WAITING = "#e8c491"
    private const val BG_DONE = "#34c26b"
    /** done 绿点停留时长（回合完成提示）。 */
    private const val DONE_STAY_MS = 2_000L
  }

  fun canDraw(): Boolean = try {
    Settings.canDrawOverlays(context)
  } catch (_: Throwable) {
    false
  }

  /** RN 驱动的状态入口：hidden/running/tools/waiting/done；未认识的值按收起处理。 */
  fun setState(state: String) {
    handler.post { apply(state) }
  }

  /** 直接收起（模块销毁时用）。 */
  fun hide() {
    handler.post { removeInternal() }
  }

  private fun apply(state: String) {
    cancelAutoHide()
    when (state) {
      "running" -> showBall(BG_RUNNING, "N", Color.WHITE).also { startRotate() }
      "tools" -> showBall(BG_TOOLS, "N", Color.WHITE).also { startRotate() }
      "waiting" -> {
        // 金底上白字对比不够，字母用墨蓝。
        showBall(BG_WAITING, "N", Color.parseColor(BG_RUNNING)).also { startPulse() }
      }
      "done" -> {
        showBall(BG_DONE, "✓", Color.WHITE)
        autoHide = Runnable { removeInternal() }.also {
          handler.postDelayed(it, DONE_STAY_MS)
        }
      }
      else -> removeInternal()
    }
  }

  /** 已挂上去就只换肤（避免 remove/add 闪一下）；没挂上去就加进去。 */
  private fun showBall(bgHex: String, text: String, textColor: Int) {
    if (!canDraw()) return
    val current = view
    if (current == null) {
      val ball = buildBall()
      try {
        windowManager.addView(ball, params())
        view = ball
      } catch (_: Throwable) {
        // 权限刚被收回等情况下 addView 会抛；保持无球状态。
        view = null
        label = null
        return
      }
    }
    val ball = view ?: return
    ball.background = rounded(Color.parseColor(bgHex))
    label?.let {
      it.text = text
      it.setTextColor(textColor)
    }
  }

  private fun buildBall(): View {
    val ball = FrameLayout(context).apply {
      isClickable = true
      isFocusable = false
      elevation = dp(6).toFloat()
      contentDescription = "NIBI-GO 运行状态，点按回到应用"
      setOnClickListener { openMain() }
    }
    val text = TextView(context).apply {
      text = "N"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
      setTextColor(Color.WHITE)
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    // 44dp 固定尺寸由这一层决定；窗口 WRAP_CONTENT 会跟着它走。
    text.layoutParams = FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER)
    label = text
    ball.addView(text)
    return ball
  }

  /** 旋转动效：0→360、1.2s 循环、LinearInterpolator（running/tools）。 */
  private fun startRotate() {
    stopAnimator()
    val current = view ?: return
    animator = ObjectAnimator.ofFloat(current, "rotation", 0f, 360f).apply {
      duration = 1_200
      repeatCount = ValueAnimator.INFINITE
      interpolator = LinearInterpolator()
      start()
    }
  }

  /** 脉冲动效：scaleX/scaleY 1→1.15 往复循环（waiting）。 */
  private fun startPulse() {
    stopAnimator()
    val current = view ?: return
    animator = ValueAnimator.ofFloat(1f, 1.15f).apply {
      duration = 600
      repeatMode = ValueAnimator.REVERSE
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { animation ->
        val scale = animation.animatedValue as Float
        current.scaleX = scale
        current.scaleY = scale
      }
      start()
    }
  }

  private fun stopAnimator() {
    animator?.cancel()
    animator = null
    // 回到基准外观：旋转归零、缩放归一。
    view?.rotation = 0f
    view?.scaleX = 1f
    view?.scaleY = 1f
  }

  private fun cancelAutoHide() {
    autoHide?.let { handler.removeCallbacks(it) }
    autoHide = null
  }

  private fun removeInternal() {
    cancelAutoHide()
    stopAnimator()
    val current = view ?: return
    view = null
    label = null
    try {
      windowManager.removeViewImmediate(current)
    } catch (_: Throwable) {
      // 已经被系统移除时忽略。
    }
  }

  /** 单击：把主任务切回前台。singleTask 启动模式会复用既有任务栈。 */
  private fun openMain() {
    try {
      val intent = Intent()
        .setClassName(context.packageName, "${context.packageName}.MainActivity")
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    } catch (_: Throwable) {
      // 「后台弹出界面」未授权或应用被杀时静默失败。
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
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      // 右侧竖直居中，贴边留一点缝。
      gravity = Gravity.END or Gravity.CENTER_VERTICAL
      x = dp(6)
    }
  }

  private fun rounded(fill: Int): GradientDrawable = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = dp(22).toFloat()
  }

  private fun dp(value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
