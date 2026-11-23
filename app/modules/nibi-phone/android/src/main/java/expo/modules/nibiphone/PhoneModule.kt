package expo.modules.nibiphone

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.HapticFeedbackConstants
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.nibiphone.shell.ShizukuShell

/** Expo 模块 `NibiPhone`：状态、两个开关、系统设置引导、悬浮审批与 loopback MCP 配置。 */
class PhoneModule : Module() {
  private var approvalOverlay: PhoneApprovalOverlay? = null
  private var statusBubble: StatusBubble? = null

  private fun context(): Context? = appContext.reactContext?.applicationContext

  private fun overlay(): PhoneApprovalOverlay? {
    val ctx = context() ?: return null
    return approvalOverlay ?: PhoneApprovalOverlay(ctx).also { approvalOverlay = it }
  }

  private fun bubble(): StatusBubble? {
    val ctx = context() ?: return null
    return statusBubble ?: StatusBubble(ctx).also { statusBubble = it }
  }

  private fun unavailable(): Map<String, Any> = mapOf(
    "available" to false,
    "a11y" to mapOf("enabled" to false, "connected" to false, "canScreenshot" to false),
    "shell" to mapOf(
      "enabled" to false,
      "installed" to false,
      "running" to false,
      "wirelessDebugging" to false,
      "permission" to "unknown",
    ),
  )

  override fun definition() = ModuleDefinition {
    Name("NibiPhone")
    Events("onPhoneApproval")

    Function("status") {
      val ctx = context() ?: return@Function unavailable()
      PhoneRuntime.status(ctx)
    }

    Function("setA11yEnabled") { enabled: Boolean ->
      val ctx = context() ?: return@Function unavailable()
      PhoneRuntime.settings(ctx).a11yEnabled = enabled
      PhoneRuntime.status(ctx)
    }

    Function("setShellEnabled") { enabled: Boolean ->
      val ctx = context() ?: return@Function unavailable()
      PhoneRuntime.settings(ctx).shellEnabled = enabled
      PhoneRuntime.status(ctx)
    }

    Function("openAccessibilitySettings") {
      val ctx = context() ?: return@Function false
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      true
    }

    Function("requestShellPermission") {
      try {
        ShizukuShell.requestPermission()
      } catch (error: Throwable) {
        false
      }
    }

    Function("openShellManager") {
      val ctx = context() ?: return@Function false
      try {
        ShizukuShell.openManager(ctx)
      } catch (error: Throwable) {
        false
      }
    }

    Function("mcpServer") {
      val ctx = context() ?: return@Function null
      PhoneRuntime.mcpServer(ctx)
    }

    /** 服务器代次：每次启动/关闭都会变；App 侧据此发现 loopback 服务器已重建。 */
    Function("mcpGeneration") { PhoneRuntime.generation }

    /** 悬浮审批：返回是否真的显示了悬浮卡；false 时 App 保留应用内审批卡。 */
    AsyncFunction("showApproval") { request: Map<String, Any?> ->
      val target = overlay() ?: return@AsyncFunction false
      val interactionId = request["interactionId"] as? String
        ?: return@AsyncFunction false
      target.show(
        interactionId = interactionId,
        toolName = request["toolName"] as? String ?: "",
        summary = request["summary"] as? String ?: "",
        detail = request["detail"] as? String ?: "",
        allowOptionId = request["allowOptionId"] as? String ?: "allowOnce",
        alwaysOptionId = request["alwaysOptionId"] as? String,
        denyOptionId = request["denyOptionId"] as? String ?: "deny",
      ) { id, optionId ->
        sendEvent(
          "onPhoneApproval",
          mapOf("interactionId" to id, "optionId" to optionId),
        )
      }
    }

    AsyncFunction("hideApproval") { interactionId: String? ->
      overlay()?.hide(interactionId)
    }

    Function("canShowApproval") { overlay()?.canDraw() == true }

    Function("openOverlaySettings") {
      val ctx = context() ?: return@Function false
      return@Function try {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${ctx.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
      } catch (error: Throwable) {
        false
      }
    }

    /** ColorOS 等系统的「后台弹出界面」在应用信息/权限里；打开本应用详情页让用户自己授权。 */
    Function("openAppSettings") {
      val ctx = context() ?: return@Function false
      return@Function try {
        val intent = Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.parse("package:${ctx.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
        true
      } catch (error: Throwable) {
        false
      }
    }

    /** 悬浮状态气泡：与审批悬浮卡同一条「显示在其他应用上层」权限。 */
    Function("canShowBubble") { bubble()?.canDraw() == true }

    /**
     * 气泡状态由 RN 驱动（hidden/thinking/working/carrying/running/tools/waiting/done/error）；
     * 原生只渲染对应的像素宠物小鸟与明暗图集，不做自动状态机。
     */
    AsyncFunction("setBubbleState") { state: String, scheme: String? ->
      bubble()?.setState(state, scheme)
    }

    /** 原生侧当前是否有手机工具在执行（气泡的 tools 信号；RN 轮询这一位）。 */
    Function("toolsBusy") { PhoneRuntime.toolsBusy() }

    /** 原生线性马达触觉（服从系统触感总开关，不用 FLAG_IGNORE_GLOBAL_SETTING）。 */
    Function("haptic") { kind: String ->
      val activity = appContext.currentActivity ?: return@Function false
      val view = activity.window?.decorView ?: return@Function false
      val code = when (kind) {
        "tick" -> HapticFeedbackConstants.CLOCK_TICK
        "tap" -> HapticFeedbackConstants.CONTEXT_CLICK
        "threshold" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          HapticFeedbackConstants.GESTURE_START
        } else {
          HapticFeedbackConstants.CLOCK_TICK
        }
        "confirm" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          HapticFeedbackConstants.CONFIRM
        } else {
          HapticFeedbackConstants.CONTEXT_CLICK
        }
        "reject" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          HapticFeedbackConstants.REJECT
        } else {
          HapticFeedbackConstants.LONG_PRESS
        }
        "longPress" -> HapticFeedbackConstants.LONG_PRESS
        else -> HapticFeedbackConstants.CLOCK_TICK
      }
      activity.runOnUiThread {
        try {
          view.performHapticFeedback(code)
        } catch (_: Throwable) {
          // 某些 ROM 在窗口切换期可能抛异常，静默忽略。
        }
      }
      true
    }

    OnDestroy {
      approvalOverlay?.hide()
      statusBubble?.hide()
      // 不关闭 loopback 服务器：dev reload 只销毁 Expo 模块，原生进程还在。
      // 服务器存活、配置不变，内核里正在跑的回合不会因为 resume 拿到 “MCP is shut down”。
      // 进程真正退出时 socket 由系统释放；token/端口都是稳定的。
    }
  }
}