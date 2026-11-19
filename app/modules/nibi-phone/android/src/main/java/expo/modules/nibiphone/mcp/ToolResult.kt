package expo.modules.nibiphone.mcp

/** 一次手机工具调用的结果：一段文字，可选一张图片（截屏）。 */
data class ToolResult(
  val text: String,
  val isError: Boolean = false,
  val image: ByteArray? = null,
  val imageMime: String? = null,
) {
  companion object {
    fun error(text: String): ToolResult = ToolResult(text, isError = true)
  }
}

/** MCP 服务器只依赖这一层，便于单测用假实现替换。 */
interface PhoneToolHandler {
  fun call(name: String, args: org.json.JSONObject): ToolResult
}