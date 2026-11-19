package expo.modules.nibiphone

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityWindowInfo
import expo.modules.nibiphone.a11y.CapturedScreen
import expo.modules.nibiphone.a11y.PhoneAction
import expo.modules.nibiphone.a11y.PhoneActuator
import expo.modules.nibiphone.a11y.SafetyGate
import expo.modules.nibiphone.a11y.ScreenFormat
import expo.modules.nibiphone.a11y.TreeCapture
import expo.modules.nibiphone.apps.AppCatalog
import expo.modules.nibiphone.mcp.PhoneToolHandler
import expo.modules.nibiphone.mcp.ToolResult
import expo.modules.nibiphone.shell.ShizukuShell
import org.json.JSONObject

/**
 * 手机工具的路由：能力门禁、快照新鲜度、安全拒绝与结果渲染。
 * 真正的读屏/手势在 a11y 包，shell 在 ShizukuShell。
 */
class PhoneTools(private val context: Context) : PhoneToolHandler {
  private val settings = PhoneSettings(context)

  @Volatile
  private var last: CapturedScreen? = null

  private var screenSeq = 0

  override fun call(name: String, args: JSONObject): ToolResult = try {
    when (name) {
      "apps" -> apps(args)
      "open" -> open(args)
      "screen" -> screen(args)
      "tap" -> tap(args)
      "type" -> type(args)
      "scroll" -> scroll(args)
      "key" -> key(args)
      "screenshot" -> screenshot()
      "android_shell" -> androidShell(args)
      else -> ToolResult.error("未知手机工具：$name")
    }
  } catch (error: Exception) {
    ToolResult.error(
      "手机操控出错：${error.javaClass.simpleName}" +
        (error.message?.let { "：$it" } ?: ""),
    )
  }

  private fun apps(args: JSONObject): ToolResult {
    val gate = requireSwitch1()
    if (gate != null) return gate
    val query = args.optString("query").trim().takeIf { it.isNotEmpty() }
    val entries = AppCatalog.list(context, query)
    if (entries.isEmpty()) {
      return ToolResult(if (query == null) "没有可启动的应用。" else "没有匹配「$query」的应用。")
    }
    return ToolResult(
      buildString {
        append("可启动应用（${entries.size}）：")
        entries.forEach { entry ->
          append("\n").append(entry.label).append(" · ").append(entry.packageName)
        }
      },
    )
  }

  private fun open(args: JSONObject): ToolResult {
    val gate = requireSwitch1()
    if (gate != null) return gate
    val app = args.optString("app").trim().takeIf { it.isNotEmpty() }
    val url = args.optString("url").trim().takeIf { it.isNotEmpty() }
    if ((app == null) == (url == null)) {
      return ToolResult.error("app 与 url 必须二选一。")
    }
    if (app != null) {
      val packageName = AppCatalog.resolve(context, app)
        ?: return ToolResult.error("没有找到应用「$app」：先调用 apps 查包名。")
      if (!AppCatalog.launchApp(context, packageName)) {
        return ToolResult.error("打开「$app」失败：系统没有接受启动请求。")
      }
    } else {
      if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url!!)) {
        return ToolResult.error("只支持 http/https 链接。")
      }
      if (!AppCatalog.launchUrl(context, url)) {
        return ToolResult.error("没有能打开这个链接的应用。")
      }
    }
    SystemClock.sleep(800)
    val service = NibiA11yService.service()
    if (service == null) return ToolResult("已打开；无障碍服务未连接，无法读取新屏幕。")
    val captured = capture(service) ?: return ToolResult("已打开；当前屏幕不可读。")
    last = captured
    return ToolResult("已打开。\n" + ScreenFormat.render(captured.snapshot))
  }

  private fun screen(args: JSONObject): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    val service = NibiA11yService.service() ?: return connectedError()
    val cursor = args.optString("cursor").trim().takeIf { it.isNotEmpty() }
    if (cursor != null) {
      val (screenId, offset) = ScreenFormat.parseCursor(cursor)
        ?: return ToolResult.error("cursor 格式无效：请原样使用 screen 返回的 cursor。")
      val current = last
        ?: return ToolResult.error("cursor 已失效：先不带 cursor 重新调用 screen。")
      if (current.snapshot.id != screenId) {
        return ToolResult.error(
          "cursor 已失效：屏幕快照 s$screenId 不是最近一次读取。请不带 cursor 重新调用 screen。",
        )
      }
      val stale = staleReason(current)
      if (stale != null) return stale
      return ToolResult(ScreenFormat.page(current.snapshot, offset).text)
    }
    val captured = capture(service)
      ?: return ToolResult.error("读取屏幕失败：当前窗口没有可读内容（可能是安全页面）。")
    last = captured
    return ToolResult(ScreenFormat.page(captured.snapshot, 0).text)
  }

  private fun tap(args: JSONObject): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    val index = args.optInt("index", -1)
    if (index < 1) return ToolResult.error("index 必须是最近一次 screen 返回的正整数编号。")
    val lookup = lastLive()
    lookup.error?.let { return it }
    val captured = lookup.screen!!
    // 先按整屏规则拒绝（安全页面/本应用/支付/系统），再看元素；否则空节点安全页会先报“没有编号”。
    SafetyGate.denyAction(context.packageName, captured.snapshot, null, PhoneAction.TAP)?.let {
      return ToolResult.error(it)
    }
    val node = captured.snapshot.nodes.firstOrNull { it.index == index }
      ?: return ToolResult.error("没有编号 $index：先重新调用 screen 获取当前元素。")
    val service = NibiA11yService.service() ?: return connectedError()
    val error = PhoneActuator(service).tap(captured, node, args.optBoolean("long_press", false))
    if (error != null) return ToolResult.error(error)
    return refresh(service)
  }

  private fun type(args: JSONObject): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    val index = args.optInt("index", -1)
    if (index < 1) return ToolResult.error("index 必须是最近一次 screen 返回的正整数编号。")
    if (!args.has("text")) return ToolResult.error("缺少 text。")
    val text = args.optString("text")
    val lookup = lastLive()
    lookup.error?.let { return it }
    val captured = lookup.screen!!
    SafetyGate.denyAction(context.packageName, captured.snapshot, null, PhoneAction.TYPE)?.let {
      return ToolResult.error(it)
    }
    val node = captured.snapshot.nodes.firstOrNull { it.index == index }
      ?: return ToolResult.error("没有编号 $index：先重新调用 screen 获取当前元素。")
    SafetyGate.denyAction(context.packageName, captured.snapshot, node, PhoneAction.TYPE)?.let {
      return ToolResult.error(it)
    }
    val service = NibiA11yService.service() ?: return connectedError()
    val error = PhoneActuator(service).type(captured, node, text, args.optBoolean("submit", false))
    if (error != null) return ToolResult.error(error)
    return refresh(service)
  }

  private fun scroll(args: JSONObject): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    val direction = args.optString("direction").lowercase()
    if (direction !in setOf("up", "down", "left", "right")) {
      return ToolResult.error("direction 只能是 up/down/left/right。")
    }
    val lookup = lastLive()
    lookup.error?.let { return it }
    val captured = lookup.screen!!
    val node = args.optInt("index", -1).let { index ->
      if (index < 1) null
      else captured.snapshot.nodes.firstOrNull { it.index == index }
        ?: return ToolResult.error("没有编号 $index：先重新调用 screen。")
    }
    // 整屏滚动也必须过安全门（index 省略时 node 为 null）。
    SafetyGate.denyAction(context.packageName, captured.snapshot, node, PhoneAction.SCROLL)?.let {
      return ToolResult.error(it)
    }
    val service = NibiA11yService.service() ?: return connectedError()
    val amount = args.optInt("amount", 1).coerceIn(1, 5)
    val error = PhoneActuator(service).scroll(captured, node, direction, amount)
    if (error != null) return ToolResult.error(error)
    return refresh(service)
  }

  private fun key(args: JSONObject): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    val name = args.optString("name").lowercase()
    if (name !in setOf("back", "home", "recents", "notifications")) {
      return ToolResult.error("name 只能是 back、home、recents、notifications。")
    }
    val service = NibiA11yService.service() ?: return connectedError()
    // KEY 是退路：安全页也允许；只有本应用自己拒绝。读不到屏幕时退回包名判断。
    val captured = capture(service)
    if (captured != null) {
      last = captured
      SafetyGate.denyAction(context.packageName, captured.snapshot, null, PhoneAction.KEY)?.let {
        return ToolResult.error(it)
      }
    } else if (service.currentPackage == context.packageName) {
      return ToolResult.error("这是 NIBI-GO 自己的界面，不执行按键（防止自我循环）。请让用户手动操作。")
    }
    val error = PhoneActuator(service).key(name)
    if (error != null) return ToolResult.error(error)
    return refresh(service)
  }

  private fun screenshot(): ToolResult {
    val gate = requireConnected()
    if (gate != null) return gate
    if (Build.VERSION.SDK_INT < 30) {
      return ToolResult.error("此系统版本不支持无障碍截屏（需要 Android 11+）。")
    }
    val service = NibiA11yService.service() ?: return connectedError()
    val captured = capture(service)
    if (captured != null) {
      last = captured
      SafetyGate.denyAction(context.packageName, captured.snapshot, null, PhoneAction.SCREENSHOT)?.let {
        return ToolResult.error(it)
      }
    }
    return PhoneActuator(service).screenshot()
  }

  private fun androidShell(args: JSONObject): ToolResult {
    if (!settings.shellEnabled) {
      return ToolResult.error("高级手机操控未开启：在 设置 → 手机操控 打开开关 2。")
    }
    val command = args.optString("command").trim()
    if (command.isEmpty()) return ToolResult.error("缺少 command。")
    if (command.toByteArray(Charsets.UTF_8).size > 2048) {
      return ToolResult.error("command 超过 2048 字节；请拆成更小的命令。")
    }
    val timeout = args.optLong("timeout_ms", 30_000L).coerceIn(100L, 60_000L)
    val result = ShizukuShell.exec(command, timeout)
    return ToolResult(result.text, isError = !result.ok)
  }

  private fun requireSwitch1(): ToolResult? {
    if (!settings.a11yEnabled) {
      return ToolResult.error("手机操控未开启：在 设置 → 手机操控 打开开关 1。")
    }
    return null
  }

  private fun requireConnected(): ToolResult? {
    requireSwitch1()?.let { return it }
    if (!NibiA11yService.isConnected()) return connectedError()
    return null
  }

  private fun connectedError(): ToolResult = ToolResult.error(
    "无障碍服务未连接：去系统设置 → 无障碍 启用「NIBI-GO 手机操控」，再回到 App 重试。",
  )

  private fun lastLive(): Lookup {
    val captured = last
      ?: return Lookup(error = ToolResult.error("还没有屏幕快照：先调用 screen。"))
    val stale = staleReason(captured)
    if (stale != null) return Lookup(error = stale)
    return Lookup(screen = captured)
  }

  /** 快照过期或前台应用已变时返回可操作错误；分页与动作共用同一套新鲜度。 */
  private fun staleReason(captured: CapturedScreen): ToolResult? {
    val age = System.currentTimeMillis() - captured.snapshot.capturedAt
    if (age > 30_000L) {
      return ToolResult.error("屏幕快照已过期：先重新调用 screen。")
    }
    // 不用 service.currentPackage：输入法、状态栏、审批悬浮卡都可能成为“当前”窗口，
    // 会把仍在目标应用上的快照误判成已切换。按活动应用窗口自己的包名比较。
    val current = activeApplicationPackage(NibiA11yService.service())
    if (
      current != null &&
      captured.snapshot.packageName.isNotEmpty() &&
      current != captured.snapshot.packageName
    ) {
      return ToolResult.error("屏幕已经切换：先重新调用 screen。")
    }
    return null
  }

  /** 当前活动应用窗口的包名；输入法与本应用（审批悬浮卡）不算，读不到时返回 null。 */
  private fun activeApplicationPackage(service: AccessibilityService?): String? {
    if (service == null) return null
    val windows = try {
      service.windows
    } catch (_: Throwable) {
      return null
    }
    val active = windows
      .filter { window ->
        try {
          window.isActive
        } catch (_: Throwable) {
          false
        }
      }
      .sortedByDescending { window ->
        try {
          window.layer
        } catch (_: Throwable) {
          0
        }
      }
    for (window in active) {
      val type = try {
        window.type
      } catch (_: Throwable) {
        continue
      }
      if (type == AccessibilityWindowInfo.TYPE_INPUT_METHOD) continue
      val packageName = try {
        window.root?.packageName?.toString().orEmpty()
      } catch (_: Throwable) {
        ""
      }
      if (packageName.isEmpty() || packageName == context.packageName) continue
      return packageName
    }
    return null
  }

  private fun capture(service: AccessibilityService): CapturedScreen? {
    screenSeq += 1
    return TreeCapture.capture(service, screenSeq)
  }

  private fun refresh(service: AccessibilityService): ToolResult {
    SystemClock.sleep(500)
    val captured = capture(service)
      ?: return ToolResult("操作已执行，但当前屏幕不可读（可能是安全页面）。")
    last = captured
    return ToolResult(ScreenFormat.render(captured.snapshot))
  }

  private data class Lookup(
    val screen: CapturedScreen? = null,
    val error: ToolResult? = null,
  )
}