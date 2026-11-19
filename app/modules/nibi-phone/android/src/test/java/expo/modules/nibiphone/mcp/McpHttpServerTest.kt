package expo.modules.nibiphone.mcp

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** McpHttpServer.dispatch 的纯 JVM 测试：不启动任何 socket。 */
class McpHttpServerTest {
  private class FakeHandler(
    private val respond: (String, JSONObject) -> ToolResult,
  ) : PhoneToolHandler {
    var calls = 0
      private set

    var lastName: String? = null
      private set

    var lastArgs: JSONObject? = null
      private set

    override fun call(name: String, args: JSONObject): ToolResult {
      calls += 1
      lastName = name
      lastArgs = args
      return respond(name, args)
    }
  }

  private fun server(
    handler: PhoneToolHandler = FakeHandler { _, _ -> ToolResult("ok") },
  ): McpHttpServer = McpHttpServer("test-token", handler) { INSTRUCTIONS }

  private fun dispatch(server: McpHttpServer, message: String): JSONObject? =
    server.dispatch(message)?.let { JSONObject(it) }

  @Test
  fun initializeEchoesKnownVersionAndIncludesInstructions() {
    val response = dispatch(
      server(),
      """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-03-26",
        "capabilities":{},
        "clientInfo":{"name":"test","version":"1"}}}""",
    )!!

    assertEquals(1, response.getInt("id"))
    val result = response.getJSONObject("result")
    assertEquals("2025-03-26", result.getString("protocolVersion"))
    assertFalse(
      result.getJSONObject("capabilities").getJSONObject("tools").getBoolean("listChanged"),
    )
    assertEquals("nibi-phone", result.getJSONObject("serverInfo").getString("name"))
    assertEquals("1", result.getJSONObject("serverInfo").getString("version"))
    assertEquals(INSTRUCTIONS, result.getString("instructions"))
  }

  @Test
  fun initializeFallsBackToLatestVersionForUnknownRequest() {
    val response = dispatch(
      server(),
      """{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}""",
    )!!

    assertEquals(
      "2025-06-18",
      response.getJSONObject("result").getString("protocolVersion"),
    )
  }

  @Test
  fun toolsListContainsTheNinePhoneTools() {
    val response = dispatch(
      server(),
      """{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}""",
    )!!

    val tools = response.getJSONObject("result").getJSONArray("tools")
    val names = (0 until tools.length())
      .map { tools.getJSONObject(it).getString("name") }
      .toSet()
    assertEquals(EXPECTED_TOOLS, names)
  }

  @Test
  fun toolsCallSuccessReturnsTextContent() {
    val handler = FakeHandler { name, args ->
      assertEquals("screen", name)
      assertEquals(0, args.length())
      ToolResult("hello")
    }
    val response = dispatch(
      server(handler),
      """{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"screen","arguments":{}}}""",
    )!!

    assertEquals("a", response.getString("id"))
    val result = response.getJSONObject("result")
    assertFalse(result.getBoolean("isError"))
    val content = result.getJSONArray("content")
    assertEquals(1, content.length())
    assertEquals("text", content.getJSONObject(0).getString("type"))
    assertEquals("hello", content.getJSONObject(0).getString("text"))
    assertEquals(1, handler.calls)
    assertEquals("screen", handler.lastName)
  }

  @Test
  fun toolsCallErrorSetsIsErrorAndKeepsText() {
    val handler = FakeHandler { _, _ -> ToolResult.error("boom") }
    val response = dispatch(
      server(handler),
      """{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"tap","arguments":{"index":2}}}""",
    )!!

    val result = response.getJSONObject("result")
    assertTrue(result.getBoolean("isError"))
    assertEquals(
      "boom",
      result.getJSONArray("content").getJSONObject(0).getString("text"),
    )
    assertEquals(1, handler.calls)
  }

  @Test
  fun toolsCallWithoutNameReturnsInvalidParams() {
    val handler = FakeHandler { _, _ -> ToolResult("unused") }
    val response = dispatch(
      server(handler),
      """{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"arguments":{}}}""",
    )!!

    assertEquals(-32602, response.getJSONObject("error").getInt("code"))
    assertEquals(0, handler.calls)
  }

  @Test
  fun notificationReturnsNull() {
    val response = server().dispatch(
      """{"jsonrpc":"2.0","method":"notifications/initialized"}""",
    )

    assertNull(response)
  }

  @Test
  fun unknownMethodReturnsMethodNotFound() {
    val response = dispatch(
      server(),
      """{"jsonrpc":"2.0","id":9,"method":"server/discover","params":{}}""",
    )!!

    val error = response.getJSONObject("error")
    assertEquals(-32601, error.getInt("code"))
    assertEquals(9, response.getInt("id"))
  }

  @Test
  fun unknownNotificationReturnsNull() {
    val response = server().dispatch(
      """{"jsonrpc":"2.0","method":"some/unknown"}""",
    )

    assertNull(response)
  }

  @Test
  fun parseErrorReturns32700() {
    val response = dispatch(server(), """{"jsonrpc":"2.0","id":1,"method":""")!!

    val error = response.getJSONObject("error")
    assertEquals(-32700, error.getInt("code"))
    assertTrue(response.isNull("id"))
  }

  @Test
  fun batchDropsNotificationsAndReturnsRemainingResponses() {
    // 批量结果是 JSON 数组字符串，用 JSONArray 解析。
    val response = server().dispatch(
      """[
        {"jsonrpc":"2.0","id":1,"method":"ping"},
        {"jsonrpc":"2.0","method":"notifications/initialized"}
      ]""",
    )!!
    val array = JSONArray(response)
    assertEquals(1, array.length())
    assertEquals(1, array.getJSONObject(0).getInt("id"))
    assertTrue(array.getJSONObject(0).has("result"))
  }

  private companion object {
    const val INSTRUCTIONS = "测试手机操控指令"

    val EXPECTED_TOOLS = setOf(
      "apps",
      "open",
      "screen",
      "tap",
      "type",
      "scroll",
      "key",
      "screenshot",
      "android_shell",
    )
  }
}