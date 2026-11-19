package expo.modules.nibiphone

import android.content.Context

/** 手机操控的两个 App 内开关；系统无障碍开关与 Shizuku 授权另行检测。 */
class PhoneSettings(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  var a11yEnabled: Boolean
    get() = prefs.getBoolean(KEY_A11Y, false)
    set(value) {
      prefs.edit().putBoolean(KEY_A11Y, value).apply()
    }

  var shellEnabled: Boolean
    get() = prefs.getBoolean(KEY_SHELL, false)
    set(value) {
      prefs.edit().putBoolean(KEY_SHELL, value).apply()
    }

  /**
   * loopback MCP 的 bearer token。只存在应用私有 SharedPreferences（不是日志/文件导出面），
   * 让进程被系统回收后服务器能用同一个 token 重新起来，内核里的旧配置继续有效。
   */
  var mcpToken: String?
    get() = prefs.getString(KEY_TOKEN, null)?.takeIf { it.isNotEmpty() }
    set(value) {
      prefs.edit().putString(KEY_TOKEN, value).apply()
    }

  private companion object {
    const val PREFS = "nibi-phone"
    const val KEY_A11Y = "a11y_enabled"
    const val KEY_SHELL = "shell_enabled"
    const val KEY_TOKEN = "mcp_token"
  }
}