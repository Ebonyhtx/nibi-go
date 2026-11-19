package expo.modules.nibiphone

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo

/**
 * 开关 1 的无障碍服务：只在桥调用时读屏/执行动作，不主动采集。
 * 服务实例只用于“是否已连接”；真正的读屏与手势在 TreeCapture / PhoneActuator。
 */
class NibiA11yService : AccessibilityService() {
  @Volatile
  var currentPackage: String? = null
    private set

  override fun onServiceConnected() {
    super.onServiceConnected()
    currentPackage = null
    instance = this
    // 系统在进程被回收后会重新绑定无障碍服务；顺手把 loopback MCP 服务器带起来，
    // 这样内核不需要等 App UI 启动就能继续用手机工具。
    PhoneRuntime.ensureServerForA11y(applicationContext)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val safeEvent = event ?: return
    val type = safeEvent.eventType
    if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      type != AccessibilityEvent.TYPE_WINDOWS_CHANGED
    ) {
      return
    }
    val name = safeEvent.packageName?.toString() ?: return
    if (name.isEmpty() || isInputMethod(name)) return
    // 输入法窗口的显示/隐藏不算应用切换，否则打开键盘后快照会被误判过期。
    currentPackage = name
  }

  /** 事件包名是否属于当前显示中的输入法窗口。 */
  private fun isInputMethod(packageName: String): Boolean {
    val all = try {
      windows
    } catch (_: Throwable) {
      null
    } ?: return false
    for (window in all) {
      val type = try {
        window.type
      } catch (_: Throwable) {
        continue
      }
      if (type != AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
      val rootPackage = try {
        window.root?.packageName?.toString()
      } catch (_: Throwable) {
        null
      }
      if (rootPackage == packageName) return true
    }
    return false
  }

  override fun onInterrupt() {
    // 读屏是按需的；系统中断不改变开关状态。
  }

  override fun onUnbind(intent: Intent?): Boolean {
    if (instance === this) instance = null
    currentPackage = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    currentPackage = null
    super.onDestroy()
  }

  companion object {
    @Volatile
    private var instance: NibiA11yService? = null

    fun service(): NibiA11yService? = instance

    fun isConnected(): Boolean = instance != null

    /** 系统无障碍列表里是否勾选了本服务（不要求当前已连接）。 */
    fun isEnabled(context: Context): Boolean {
      val expected = ComponentName(context, NibiA11yService::class.java)
        .flattenToString()
        .lowercase()
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false
      return enabled.split(':').any { it.trim().lowercase() == expected }
    }
  }
}