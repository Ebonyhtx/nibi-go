package expo.modules.nibiphone

import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout

/**
 * 全局悬浮状态气泡：NIBI 瓦片鸟脸（与消息流 AgentFace 同一形象——圆角方块机身 +
 * 两只眼），44dp 瓦片悬浮在屏幕右侧竖直居中，外面一圈 60dp 的活动区给运行轨道点。
 * 与审批悬浮卡同一条权限路（TYPE_APPLICATION_OVERLAY + canDrawOverlays），不抢焦点。
 *
 * 状态由 RN 调 setState 驱动，每个状态换机身色与眼型并启停对应动效：
 * - running：墨蓝机身，专注眼，眨眼 + 呼吸 + 白点绕瓦片公转（1.2s 一圈）；
 * - tools：橙机身，同 running 的动效（正在执行手机工具/操控）；
 * - waiting：奶油金机身，短「困惑」眼 + 脉冲缩放（等待审批/提问）；
 * - done：绿机身 + 白色对勾，弹性放大一次，停 2 秒自动收起（回合完成）；
 * - hidden：移除悬浮球。
 * 单击气泡把 NIBI-GO 主任务切回前台；ColorOS 的「后台弹出界面」未授权时静默失败。
 */
class StatusBubble(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var view: View? = null
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
      "running" -> showFace(FaceConfig(BG_RUNNING, FaceMode.WORK, eyesDark = false))
      "tools" -> showFace(FaceConfig(BG_TOOLS, FaceMode.WORK, eyesDark = false))
      // 金底上白眼对比不够，眼用墨蓝。
      "waiting" -> showFace(FaceConfig(BG_WAITING, FaceMode.WAIT, eyesDark = true))
      "done" -> {
        showFace(FaceConfig(BG_DONE, FaceMode.DONE, eyesDark = false))
        autoHide = Runnable { removeInternal() }.also {
          handler.postDelayed(it, DONE_STAY_MS)
        }
      }
      else -> removeInternal()
    }
  }

  private enum class FaceMode {
    /** 运行态：专注眼 + 眨眼呼吸 + 轨道点公转。 */
    WORK,
    /** 等待态：短眼 + 脉冲。 */
    WAIT,
    /** 完成态：白色对勾 + 弹性放大。 */
    DONE,
  }

  private data class FaceConfig(val bodyHex: String, val mode: FaceMode, val eyesDark: Boolean)

  /** 已挂上去就只换肤（避免 remove/add 闪一下）；没挂上去就加进去。 */
  private fun showFace(config: FaceConfig) {
    if (!canDraw()) return
    val current = view
    if (current == null) {
      val root = FrameLayout(context)
      val face = TileFaceView(context)
      root.addView(
        face,
        FrameLayout.LayoutParams(dp(60), dp(60), Gravity.CENTER),
      )
      root.isClickable = true
      root.isFocusable = false
      root.elevation = dp(6).toFloat()
      root.contentDescription = "NIBI-GO 运行状态，点按回到应用"
      root.setOnClickListener { openMain() }
      try {
        windowManager.addView(root, params())
        view = root
      } catch (_: Throwable) {
        // 权限刚被收回等情况下 addView 会抛；保持无球状态。
        view = null
        return
      }
    }
    (((view as? ViewGroup)?.getChildAt(0)) as? TileFaceView)?.applyConfig(config)
  }

  /**
   * 瓦片鸟脸本体：60dp 画布中央画 44dp 圆角方块机身 + 眼（或对勾），
   * 运行态再画一枚绕瓦片公转的白点。动画全走 ValueAnimator + invalidate。
   */
  private class TileFaceView(context: Context) : View(context) {
    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val eyePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val orbitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.FILL
      color = Color.WHITE
    }
    private val orbitRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      // 浅色壁纸上白点会隐形：加一圈半透明墨蓝描边。
      color = Color.parseColor("#551c2f4e")
      strokeWidth = dp(1.2f)
    }
    private val checkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      color = Color.WHITE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    private val tileRect = RectF()

    private var mode = FaceMode.WORK
    private var eyesDark = false
    private var bodyHex = BG_RUNNING

    // 动画量：呼吸/脉冲共用 scale；orbit 角度；blink 由 handler 打拍。
    private var scale = 1f
    private var orbitAngle = 0f
    private var blink = false

    private var scaleAnim: ValueAnimator? = null
    private var orbitAnim: ValueAnimator? = null
    private val blinkTicker = object : Runnable {
      override fun run() {
        blink = true
        invalidate()
        handler.postDelayed({
          blink = false
          invalidate()
        }, 180)
        handler.postDelayed(this, 1_400)
      }
    }
    private val handler = Handler(Looper.getMainLooper())

    fun applyConfig(config: FaceConfig) {
      mode = config.mode
      eyesDark = config.eyesDark
      bodyHex = config.bodyHex
      stopAnimations()
      when (mode) {
        FaceMode.WORK -> {
          startBreath()
          startOrbit()
          handler.postDelayed(blinkTicker, 1_400)
        }
        FaceMode.WAIT -> startPulse()
        FaceMode.DONE -> startPop()
      }
      invalidate()
    }

    private fun stopAnimations() {
      scaleAnim?.cancel()
      scaleAnim = null
      orbitAnim?.cancel()
      orbitAnim = null
      handler.removeCallbacks(blinkTicker)
      blink = false
      scale = 1f
      orbitAngle = 0f
    }

    private fun startBreath() {
      scaleAnim = ValueAnimator.ofFloat(1f, 1.06f).apply {
        duration = 700
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener { animation ->
          scale = animation.animatedValue as Float
          invalidate()
        }
        start()
      }
    }

    private fun startPulse() {
      scaleAnim = ValueAnimator.ofFloat(1f, 1.12f).apply {
        duration = 600
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener { animation ->
          scale = animation.animatedValue as Float
          invalidate()
        }
        start()
      }
    }

    /** 完成态：0.6→1 弹性放大一次（Overshoot 回弹）。 */
    private fun startPop() {
      scaleAnim = ValueAnimator.ofFloat(0.6f, 1f).apply {
        duration = 320
        interpolator = OvershootInterpolator(2f)
        addUpdateListener { animation ->
          scale = animation.animatedValue as Float
          invalidate()
        }
        start()
      }
    }

    private fun startOrbit() {
      orbitAnim = ValueAnimator.ofFloat(0f, 360f).apply {
        duration = 1_200
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener { animation ->
          orbitAngle = animation.animatedValue as Float
          invalidate()
        }
        start()
      }
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val half = dp(22f)
      canvas.save()
      canvas.translate(cx, cy)
      canvas.scale(scale, scale)
      bodyPaint.color = Color.parseColor(bodyHex)
      tileRect.set(-half, -half, half, half)
      canvas.drawRoundRect(tileRect, dp(10f), dp(10f), bodyPaint)

      when (mode) {
        FaceMode.DONE -> {
          // 大白勾：从左中起笔、中点下压、右上收笔。
          checkPaint.strokeWidth = dp(4f)
          val check = android.graphics.Path()
          check.moveTo(-dp(9f), dp(1f))
          check.lineTo(-dp(2f), dp(8f))
          check.lineTo(dp(10f), -dp(8f))
          canvas.drawPath(check, checkPaint)
        }
        else -> drawEyes(canvas)
      }
      canvas.restore()

      // 轨道点画在瓦片外（不在 scale 里，公转半径固定）。
      if (mode == FaceMode.WORK) {
        val radius = dp(27f)
        val rad = Math.toRadians(orbitAngle.toDouble()) - Math.PI / 2
        val x = cx + radius * Math.cos(rad).toFloat()
        val y = cy + radius * Math.sin(rad).toFloat()
        canvas.drawCircle(x, y, dp(2.6f), orbitPaint)
        canvas.drawCircle(x, y, dp(2.6f), orbitRingPaint)
      }
    }

    /** 两只眼：20 格几何按 44dp 瓦片缩放（与 RN AgentFace 同一比例）。 */
    private fun drawEyes(canvas: Canvas) {
      val unit = dp(44f) / 20f
      eyePaint.color = if (eyesDark) Color.parseColor(BG_RUNNING) else Color.WHITE
      for (left in intArrayOf(7, 13)) {
        val x = (left - 10) * unit
        if (blink) {
          val lid = RectF(x, -2f * unit - unit * 0.4f, x + 4f * unit, -2f * unit + unit * 0.4f)
          canvas.drawRoundRect(lid, unit * 0.4f, unit * 0.4f, eyePaint)
        } else {
          // 专注眼：4×6 格圆角竖矩形，中心在 (cx±3, -2) 格。
          val eye = RectF(x, -2f * unit - 3f * unit, x + 4f * unit, -2f * unit + 3f * unit)
          canvas.drawRoundRect(eye, unit * 2f, unit * 2f, eyePaint)
        }
      }
    }

    override fun onDetachedFromWindow() {
      stopAnimations()
      super.onDetachedFromWindow()
    }

    private fun dp(value: Float): Float = value * resources.displayMetrics.density
  }

  private fun cancelAutoHide() {
    autoHide?.let { handler.removeCallbacks(it) }
    autoHide = null
  }

  private fun removeInternal() {
    cancelAutoHide()
    val current = view ?: return
    view = null
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
      x = dp(4)
    }
  }

  private fun dp(value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
