package expo.modules.nibiphone

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 全局悬浮像素宠物气泡：离开 NIBI-GO 或手机操控执行中时，NIBI 像素小鸟跟随你到桌面/其他应用。
 *
 * 与应用内 PetView 共享同一套 `assets/pet/{pack.json,sheets/,sheets-dark/}` 真源：
 * - 整数倍最近邻绘制（64×M 物理像素，`isFilterBitmap = false`），像素清晰不发糊且顶部零裁切；
 * - 按 `pack.json` 变长帧表 + `Handler.postDelayed` 精准推进（仅 ~10-18fps 刷帧，省电）；
 * - 柔和纸感/墨夜半透明圆垫底衬，确保浅色/深色/照片背景上都清晰可读；
 * - 拖动悬浮小鸟时自动展翅切入 `flying`，松手恢复当前任务态；单击把 NIBI-GO 主任务切回前台。
 */
class StatusBubble(private val context: Context) {
  private val handler = Handler(Looper.getMainLooper())
  private val windowManager =
    context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private var rootView: FrameLayout? = null
  private var petView: PetSpriteView? = null
  private var autoHide: Runnable? = null

  // 悬浮小鸟位置（绝对坐标，TOP|START；拖动后进程内跨状态记忆）。
  private var positionX = -1f
  private var positionY = -1f

  companion object {
    private const val CELL_PX = 64
    private const val DONE_STAY_MS = 2_400L
    private const val ERROR_STAY_MS = 3_200L
  }

  private data class FrameSpec(val index: Int, val ms: Long)
  private data class AnimSpec(
    val sheetLight: String,
    val sheetDark: String,
    val frames: List<FrameSpec>,
    val totalMs: Long,
  )

  private data class PackData(
    val enterMap: Map<String, String>,
    val anims: Map<String, AnimSpec>,
  )

  private var cachedPack: PackData? = null
  private val bitmapCache = HashMap<String, Bitmap>()

  fun canDraw(): Boolean = try {
    Settings.canDrawOverlays(context)
  } catch (_: Throwable) {
    false
  }

  /**
   * RN 驱动的状态入口：
   * hidden / thinking / working / running / tools / carrying / waiting / done / error。
   * scheme: "light" | "dark" | "system"（可选，默认随系统深浅色）。
   */
  fun setState(state: String, scheme: String? = null) {
    handler.post { apply(state, scheme) }
  }

  /** 直接收起（模块销毁时用）。 */
  fun hide() {
    handler.post { removeInternal() }
  }

  private fun mapPetState(raw: String): String? = when (raw) {
    "thinking" -> "thinking"
    "working", "running", "tools" -> "working"
    "carrying" -> "carrying"
    "waiting" -> "waiting"
    "done" -> "done"
    "error" -> "error"
    "flying" -> "flying"
    else -> null
  }

  private fun resolveDark(scheme: String?): Boolean = when (scheme) {
    "dark" -> true
    "light" -> false
    else -> {
      val mode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
      mode == Configuration.UI_MODE_NIGHT_YES
    }
  }

  private fun apply(rawState: String, scheme: String?) {
    cancelAutoHide()
    val petState = mapPetState(rawState)
    if (petState == null) {
      removeInternal()
      return
    }
    showPet(petState, resolveDark(scheme))
    if (petState == "done" || petState == "error") {
      val delay = if (petState == "done") DONE_STAY_MS else ERROR_STAY_MS
      autoHide = Runnable { removeInternal() }.also {
        handler.postDelayed(it, delay)
      }
    }
  }

  private fun loadPack(): PackData? {
    cachedPack?.let { return it }
    return try {
      val text = context.assets.open("pet/pack.json").bufferedReader().use { it.readText() }
      val root = JSONObject(text)
      val enterMap = HashMap<String, String>()
      val states = root.optJSONArray("states")
      if (states != null) {
        for (i in 0 until states.length()) {
          val obj = states.optJSONObject(i) ?: continue
          val id = obj.optString("id", "")
          val enter = obj.optString("enter", "")
          if (id.isNotEmpty() && enter.isNotEmpty() && enter != "null") {
            enterMap[id] = enter
          }
        }
      }
      val anims = HashMap<String, AnimSpec>()
      val animsObj = root.optJSONObject("animations")
      if (animsObj != null) {
        val keys = animsObj.keys()
        while (keys.hasNext()) {
          val key = keys.next()
          val obj = animsObj.optJSONObject(key) ?: continue
          val sheetLight = obj.optString("sheet", "")
          val sheetDark = obj.optString("sheetDark", sheetLight)
          val framesJson = obj.optJSONArray("frames") ?: continue
          val frames = ArrayList<FrameSpec>(framesJson.length())
          var acc = 0L
          for (j in 0 until framesJson.length()) {
            val f = framesJson.optJSONObject(j) ?: continue
            val idx = f.optInt("i", 0)
            val ms = f.optLong("ms", 80L).coerceAtLeast(16L)
            frames.add(FrameSpec(idx, ms))
            acc += ms
          }
          if (frames.isNotEmpty() && sheetLight.isNotEmpty()) {
            val total = obj.optLong("totalMs", acc).coerceAtLeast(16L)
            anims[key] = AnimSpec(sheetLight, sheetDark, frames, total)
          }
        }
      }
      PackData(enterMap, anims).also { cachedPack = it }
    } catch (_: Throwable) {
      null
    }
  }

  private fun loadSheetBitmap(relPath: String): Bitmap? {
    bitmapCache[relPath]?.let { if (!it.isRecycled) return it }
    return try {
      val opts = BitmapFactory.Options().apply {
        inScaled = false
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      context.assets.open("pet/$relPath").use { stream ->
        BitmapFactory.decodeStream(stream, null, opts)
      }?.also { bmp ->
        bitmapCache[relPath] = bmp
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun bubbleBoxPx(): Int {
    val density = context.resources.displayMetrics.density
    val multiple = ((64f * density) / CELL_PX).roundToInt().coerceIn(2, 4)
    val spritePx = CELL_PX * multiple
    val padPx = (6f * density).roundToInt()
    return spritePx + padPx * 2
  }

  private fun showPet(petState: String, dark: Boolean) {
    if (!canDraw()) return
    val currentPet = petView
    if (rootView == null || currentPet == null) {
      val root = FrameLayout(context)
      val boxPx = bubbleBoxPx()
      val sprite = PetSpriteView(context, boxPx)
      root.addView(
        sprite,
        FrameLayout.LayoutParams(boxPx, boxPx, Gravity.CENTER),
      )
      root.isClickable = true
      root.isFocusable = false
      root.elevation = dp(6).toFloat()
      root.contentDescription = "NIBI 小鸟悬浮状态，点按回到应用，拖动可移动位置"
      root.setOnTouchListener(dragTouch)
      try {
        windowManager.addView(root, params(boxPx))
        rootView = root
        petView = sprite
        sprite.setPetState(petState, dark)
      } catch (_: Throwable) {
        // 权限被系统收回或 ROM 拦截悬浮窗时静默放弃。
      }
    } else {
      currentPet.setPetState(petState, dark)
    }
  }

  private val dragTouch = object : View.OnTouchListener {
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var downRawX = 0f
    private var downRawY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      val lp = v.layoutParams as? WindowManager.LayoutParams ?: return false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downRawX = event.rawX
          downRawY = event.rawY
          startX = lp.x
          startY = lp.y
          dragging = false
          return true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downRawX
          val dy = event.rawY - downRawY
          if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
            dragging = true
            petView?.setDragging(true)
          }
          if (dragging) {
            lp.x = clampX((startX + dx).roundToInt(), v.width)
            lp.y = clampY((startY + dy).roundToInt(), v.height)
            positionX = lp.x.toFloat()
            positionY = lp.y.toFloat()
            try {
              windowManager.updateViewLayout(v, lp)
            } catch (_: Throwable) {
            }
          }
          return true
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            dragging = false
            petView?.setDragging(false)
          } else {
            openMain()
          }
          return true
        }
        MotionEvent.ACTION_CANCEL -> {
          if (dragging) {
            dragging = false
            petView?.setDragging(false)
          }
          return true
        }
      }
      return false
    }
  }

  private fun clampX(x: Int, sizePx: Int): Int {
    val metrics = context.resources.displayMetrics
    val max = (metrics.widthPixels - sizePx.coerceAtLeast(dp(64))).coerceAtLeast(0)
    return x.coerceIn(0, max)
  }

  private fun clampY(y: Int, sizePx: Int): Int {
    val metrics = context.resources.displayMetrics
    val min = dp(28)
    val max = (metrics.heightPixels - sizePx.coerceAtLeast(dp(64)) - dp(24)).coerceAtLeast(min)
    return y.coerceIn(min, max)
  }

  /**
   * 像素宠物绘制视图：
   * - 底层画柔和暖纸/墨夜圆角垫底与状态细描边，兼容任意第三方应用背景；
   * - 上层按精确 64*M 最近邻像素直接 blit 单帧 srcRect -> dstRect，零裁切、零每帧堆分配；
   * - 用 Handler.postDelayed 按 pack.json 帧时长推进，离开窗口立即停表。
   */
  private inner class PetSpriteView(
    context: Context,
    private val boxPx: Int,
  ) : View(context) {
    private val density = resources.displayMetrics.density
    private val multiple = ((64f * density) / CELL_PX).roundToInt().coerceIn(2, 4)
    private val spritePx = CELL_PX * multiple

    private val spritePaint = Paint().apply {
      isFilterBitmap = false
      isAntiAlias = false
      isDither = false
    }
    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = (1.25f * density).coerceAtLeast(1.5f)
    }

    private val srcRect = Rect()
    private val dstRect = Rect()
    private val bgRect = RectF()

    private var baseState = "working"
    private var darkScheme = false
    private var dragging = false
    private var activeAnimId: String? = null
    private var activeAnim: AnimSpec? = null
    private var inEnterPhase = false
    private var frameStep = 0
    private var activeBitmap: Bitmap? = null
    private var tickRunnable: Runnable? = null

    fun setPetState(state: String, dark: Boolean) {
      val stateChanged = state != baseState
      val schemeChanged = dark != darkScheme
      baseState = state
      darkScheme = dark
      if (stateChanged || schemeChanged || activeAnim == null) {
        startCurrentAnimation(playEnter = stateChanged && !dragging)
      }
    }

    fun setDragging(isDragging: Boolean) {
      if (dragging == isDragging) return
      dragging = isDragging
      startCurrentAnimation(playEnter = false)
    }

    private fun startCurrentAnimation(playEnter: Boolean) {
      stopTick()
      val pack = loadPack() ?: run {
        invalidate()
        return
      }
      val target = if (dragging) "flying" else baseState
      val enterId = if (playEnter) pack.enterMap[target] else null
      val animId = if (enterId != null && pack.anims.containsKey(enterId)) enterId else target
      val anim = pack.anims[animId] ?: pack.anims["working"] ?: pack.anims["idle"] ?: return

      activeAnimId = animId
      activeAnim = anim
      inEnterPhase = animId == enterId
      frameStep = 0
      val relPath = if (darkScheme) anim.sheetDark else anim.sheetLight
      activeBitmap = loadSheetBitmap(relPath) ?: loadSheetBitmap(anim.sheetLight)
      invalidate()
      scheduleNextFrame()
    }

    private fun scheduleNextFrame() {
      val anim = activeAnim ?: return
      if (anim.frames.size <= 1 && !inEnterPhase) return
      val stepSpec = anim.frames[frameStep.coerceIn(0, anim.frames.lastIndex)]
      val runnable = Runnable {
        val cur = activeAnim ?: return@Runnable
        val nextStep = frameStep + 1
        if (nextStep >= cur.frames.size) {
          if (inEnterPhase) {
            // 进场过渡播完 → 无缝切入目标循环态。
            startCurrentAnimation(playEnter = false)
            return@Runnable
          }
          frameStep = 0
        } else {
          frameStep = nextStep
        }
        invalidate()
        scheduleNextFrame()
      }
      tickRunnable = runnable
      handler.postDelayed(runnable, stepSpec.ms)
    }

    private fun stopTick() {
      tickRunnable?.let { handler.removeCallbacks(it) }
      tickRunnable = null
    }

    override fun onDraw(canvas: Canvas) {
      val w = width.toFloat()
      val h = height.toFloat()
      val strokeInset = borderPaint.strokeWidth / 2f + 1f
      bgRect.set(strokeInset, strokeInset, w - strokeInset, h - strokeInset)

      // 纸上鸟暖纸垫底 / 墨夜深暖灰垫底；等待/完成/报错给一圈语义强调边，其他保持克制发丝线。
      bgPaint.color = if (darkScheme) Color.argb(232, 34, 32, 30) else Color.argb(238, 255, 251, 243)
      val visualState = if (dragging) "flying" else baseState
      borderPaint.color = when (visualState) {
        "waiting" -> Color.argb(220, 224, 138, 62)
        "done" -> Color.argb(220, 63, 143, 95)
        "error" -> Color.argb(220, 194, 91, 78)
        else -> if (darkScheme) Color.argb(68, 242, 233, 219) else Color.argb(46, 28, 47, 78)
      }
      val corner = (18f * density).coerceAtMost(w * 0.32f)
      canvas.drawRoundRect(bgRect, corner, corner, bgPaint)
      canvas.drawRoundRect(bgRect, corner, corner, borderPaint)

      val bmp = activeBitmap
      val anim = activeAnim
      if (bmp != null && !bmp.isRecycled && anim != null && anim.frames.isNotEmpty()) {
        val frameIndex = anim.frames[frameStep.coerceIn(0, anim.frames.lastIndex)].index
        val leftSrc = frameIndex * CELL_PX
        if (leftSrc + CELL_PX <= bmp.width && CELL_PX <= bmp.height) {
          srcRect.set(leftSrc, 0, leftSrc + CELL_PX, CELL_PX)
          val offsetX = (width - spritePx) / 2
          val offsetY = (height - spritePx) / 2
          dstRect.set(offsetX, offsetY, offsetX + spritePx, offsetY + spritePx)
          canvas.drawBitmap(bmp, srcRect, dstRect, spritePaint)
        }
      }
    }

    override fun onDetachedFromWindow() {
      stopTick()
      super.onDetachedFromWindow()
    }
  }

  private fun cancelAutoHide() {
    autoHide?.let { handler.removeCallbacks(it) }
    autoHide = null
  }

  private fun removeInternal() {
    cancelAutoHide()
    val current = rootView ?: return
    rootView = null
    petView = null
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
  private fun params(boxPx: Int): WindowManager.LayoutParams {
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
      gravity = Gravity.TOP or Gravity.START
      val metrics = context.resources.displayMetrics
      if (positionX < 0) positionX = (metrics.widthPixels - boxPx - dp(6)).toFloat()
      if (positionY < 0) positionY = (metrics.heightPixels - boxPx) / 2f
      x = clampX(positionX.roundToInt(), boxPx)
      y = clampY(positionY.roundToInt(), boxPx)
    }
  }

  private fun dp(value: Int): Int =
    (value * context.resources.displayMetrics.density).toInt()
}
