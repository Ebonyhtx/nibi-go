package expo.modules.nibiphone

import android.content.Context
import android.os.Build
import android.util.Log
import expo.modules.nibiphone.mcp.McpHttpServer
import expo.modules.nibiphone.mcp.PhoneToolHandler
import expo.modules.nibiphone.mcp.ToolResult
import expo.modules.nibiphone.shell.ShizukuShell
import expo.modules.nibiphone.shell.ShellState
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/**
 * 进程内的单例：开关、MCP 服务器与状态。
 * 服务器懒启动；token 只存在内存，不落盘、不写日志。
 */
object PhoneRuntime {
  private const val TAG = "NibiPhone"

  /**
   * 固定的回环端口。进程被系统回收后 a11y 服务会重启进程，服务器用同一端口/token
   * 重新起来，内核里的 MCP 配置不用换；端口被占用时回退到系统分配的随机端口。
   */
  private const val PREFERRED_PORT = 39617

  @Volatile
  private var settings: PhoneSettings? = null

  @Volatile
  private var server: McpHttpServer? = null

  @Volatile
  private var tools: PhoneTools? = null

  /** 在途工具调用计数（悬浮气泡的 tools 状态信号）；服务器未启动时为 null。 */
  @Volatile
  private var busyHandler: BusyTrackingHandler? = null

  /**
   * 服务器代次：启动或关闭时递增。App 侧比较代次，发现 loopback 服务器被重建
   * （进程回收、dev reload、启动失败后恢复）就 resume 当前会话，重新挂上新地址。
   */
  @Volatile
  var generation: Int = 0
    private set

  fun settings(context: Context): PhoneSettings {
    settings?.let { return it }
    return synchronized(this) {
      settings ?: PhoneSettings(context.applicationContext).also { settings = it }
    }
  }

  fun status(context: Context): Map<String, Any> {
    val stored = settings(context)
    val shell = try {
      ShizukuShell.state(context)
    } catch (error: Throwable) {
      Log.w(TAG, "Shizuku 状态探测失败", error)
      ShellState(installed = false, running = false, permission = "unknown")
    }
    return mapOf(
      "available" to true,
      "a11y" to mapOf(
        "enabled" to stored.a11yEnabled,
        "connected" to NibiA11yService.isConnected(),
        "canScreenshot" to (Build.VERSION.SDK_INT >= 30),
      ),
      "shell" to mapOf(
        "enabled" to stored.shellEnabled,
        "installed" to shell.installed,
        "running" to shell.running,
        "wirelessDebugging" to ShizukuShell.wirelessDebugging(context),
        "permission" to shell.permission,
      ),
    )
  }

  /** 两个开关都关时不提供服务器；否则返回内核 mcpServers 的一项。 */
  fun mcpServer(context: Context): Map<String, Any>? {
    val stored = settings(context)
    if (!stored.a11yEnabled && !stored.shellEnabled) return null
    val running = ensureServer(context.applicationContext) ?: return null
    return mapOf(
      "name" to "phone",
      "type" to "http",
      "url" to "http://127.0.0.1:${running.port}/mcp",
      "headers" to listOf(
        mapOf("name" to "Authorization", "value" to "Bearer ${running.token}"),
      ),
      "alwaysLoad" to true,
    )
  }

  fun shutdown() {
    synchronized(this) {
      server?.stop()
      server = null
      tools = null
      busyHandler = null
      generation += 1
    }
  }

  /** 是否有手机工具正在执行（悬浮气泡的 tools 状态；RN 侧轮询这一位）。 */
  fun toolsBusy(): Boolean = (busyHandler?.inFlight?.get() ?: 0) > 0

  /** 无障碍服务连上时调用：系统重启进程后由它把 loopback 服务器带起来。 */
  fun ensureServerForA11y(context: Context) {
    val stored = settings(context)
    if (!stored.a11yEnabled) return
    ensureServer(context.applicationContext)
  }

  @Synchronized
  private fun ensureServer(context: Context): McpHttpServer? {
    server?.let { return it }
    return try {
      val stored = settings(context)
      val token = stored.mcpToken ?: newToken().also { stored.mcpToken = it }
      val handler = PhoneTools(context)
      val tracked = BusyTrackingHandler(handler)
      val created = McpHttpServer(
        token = token,
        handler = tracked,
        instructions = { instructions(context) },
        preferredPort = PREFERRED_PORT,
      )
      created.start()
      tools = handler
      busyHandler = tracked
      server = created
      generation += 1
      created
    } catch (error: Exception) {
      // 不打印 token/URL 之外的敏感内容；这里只有异常类型与消息。
      Log.w(TAG, "loopback MCP 服务器启动失败", error)
      null
    }
  }

  private fun newToken(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString(separator = "") { "%02x".format(it) }
  }

  private fun instructions(context: Context): String {
    val stored = settings(context)
    val connected = NibiA11yService.isConnected()
    val a11y = when {
      connected -> "已连接"
      stored.a11yEnabled -> "已开启但服务未连接"
      else -> "未开启"
    }
    val shell = try {
      ShizukuShell.state(context)
    } catch (error: Throwable) {
      ShellState(false, false, "unknown")
    }
    val shellText = when {
      !stored.shellEnabled -> "未开启"
      shell.running && shell.permission == "granted" -> "已连接"
      shell.installed -> "未就绪"
      else -> "未安装 Shizuku"
    }
    return buildString {
      append("手机操控（NIBI-GO）。无障碍：").append(a11y)
      append("；截屏：").append(if (Build.VERSION.SDK_INT >= 30) "可用" else "不支持")
      append("；高级模式：").append(shellText).append("。\n")
      append("先调用 screen 获取屏幕号与元素编号；tap/type 只能使用最近一次 screen 的编号。")
      append("长页面分页：页尾 cursor 原样传给 screen 继续读同一份快照，编号不变。")
      append("支付/银行/系统设置页面只读；密码与验证码字段不可填写；安全页面不可截屏。")
      append("所有操作都会经过宿主审批。")
    }
  }
}

/** 给工具执行套一层在途计数：调用同步、退出必减（异常也减），供 toolsBusy() 读。 */
private class BusyTrackingHandler(
  private val origin: PhoneToolHandler,
) : PhoneToolHandler {
  val inFlight = AtomicInteger(0)

  override fun call(name: String, args: JSONObject): ToolResult {
    inFlight.incrementAndGet()
    try {
      return origin.call(name, args)
    } finally {
      inFlight.decrementAndGet()
    }
  }
}