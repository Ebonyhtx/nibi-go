package expo.modules.nibiphone.mcp

import org.json.JSONObject

/**
 * 固定的手机工具目录。目录不随权限状态变化：能力不足时由调用返回可操作错误，
 * 避免工具清单变化破坏提示缓存。
 */
data class PhoneTool(
  val name: String,
  val description: String,
  val properties: Map<String, Any?>,
  val required: List<String> = emptyList(),
) {
  fun toJson(): JSONObject = JSONObject(
    linkedMapOf(
      "name" to name,
      "description" to description,
      "inputSchema" to linkedMapOf<String, Any?>(
        "type" to "object",
        "properties" to properties,
        "additionalProperties" to false,
        "required" to required,
      ),
    ),
  )
}

object PhoneToolCatalog {
  private fun str(description: String): Map<String, Any?> =
    linkedMapOf("type" to "string", "description" to description)

  private fun bool(description: String): Map<String, Any?> =
    linkedMapOf("type" to "boolean", "description" to description)

  private fun int(description: String, minimum: Int? = null, maximum: Int? = null): Map<String, Any?> =
    linkedMapOf<String, Any?>("type" to "integer", "description" to description).apply {
      if (minimum != null) put("minimum", minimum)
      if (maximum != null) put("maximum", maximum)
    }

  private fun enum(values: List<String>, description: String): Map<String, Any?> =
    linkedMapOf("type" to "string", "enum" to values, "description" to description)

  private val INDEX = int("元素编号，取自最近一次 screen 的返回；编号只在该次快照内有效", 1)
  private val DIRECTIONS = enum(listOf("up", "down", "left", "right"), "滚动方向")
  private val KEYS = enum(listOf("back", "home", "recents", "notifications"), "全局按键")

  val tools: List<PhoneTool> = listOf(
    PhoneTool(
      "apps",
      "列出这台手机上能启动的应用（名称 · 包名），最多 100 个。query 可按名称或包名筛选。",
      linkedMapOf("query" to str("按名称或包名筛选，可省略")),
    ),
    PhoneTool(
      "open",
      "打开应用或网页（app 与 url 二选一）。app 接受包名或应用名；url 只接受 http/https。打开后返回新屏幕。",
      linkedMapOf(
        "app" to str("包名或应用名"),
        "url" to str("http 或 https 链接"),
      ),
    ),
    PhoneTool(
      "screen",
      "读取当前屏幕的文字快照（已脱敏）。返回屏幕号 sN、元素编号、角色、标签与状态；元素编号只在本次快照内有效。" +
        "长页面分页：页尾会给出 cursor，把它原样传回 cursor 继续读同一份快照（不会改变编号）。",
      linkedMapOf(
        "cursor" to str("上一页返回的 cursor，如 s3:37；省略时重新读当前屏幕"),
      ),
    ),
    PhoneTool(
      "tap",
      "点按最近一次 screen 返回的元素；long_press=true 时长按。返回新屏幕。",
      linkedMapOf(
        "index" to INDEX,
        "long_press" to bool("是否长按，默认 false"),
      ),
      listOf("index"),
    ),
    PhoneTool(
      "type",
      "向最近一次 screen 返回的输入框写入文字；submit=true 时尝试提交（需要 Android 11+）。密码、验证码、支付字段会被拒绝。返回新屏幕。",
      linkedMapOf(
        "index" to INDEX,
        "text" to str("要写入的文字"),
        "submit" to bool("是否在写入后提交，默认 false"),
      ),
      listOf("index", "text"),
    ),
    PhoneTool(
      "scroll",
      "滚动可滚动元素或当前屏幕。index 省略时滚整屏。返回新屏幕。",
      linkedMapOf(
        "index" to int("可滚动元素编号，省略时在屏幕内滑动", 1),
        "direction" to DIRECTIONS,
        "amount" to int("滑动强度 1–5，默认 1", 1, 5),
      ),
      listOf("direction"),
    ),
    PhoneTool(
      "key",
      "执行全局按键：back、home、recents、notifications。返回新屏幕。",
      linkedMapOf("name" to KEYS),
      listOf("name"),
    ),
    PhoneTool(
      "screenshot",
      "截取当前屏幕并作为图片返回。安全页面（FLAG_SECURE）会拒绝。",
      emptyMap(),
    ),
    PhoneTool(
      "android_shell",
      "在本机 Android 执行一次非交互 sh 命令（shell uid，需开关 2 + Shizuku 授权）。每条命令仍需对话审批；输出限量 8 KiB；超时或取消不会撤销已产生的副作用。",
      linkedMapOf(
        "command" to str("完整 Android sh 命令，不带 adb shell 前缀"),
        "timeout_ms" to int("超时毫秒，100–60000，默认 30000", 100, 60000),
      ),
      listOf("command"),
    ),
  )

  fun json(): List<JSONObject> = tools.map { it.toJson() }
}