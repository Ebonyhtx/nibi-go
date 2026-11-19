package expo.modules.nibiphone.mcp

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 真正起 socket 的 loopback 集成测试：auth、POST /mcp、202 通知与 GET 405。 */
class McpHttpIntegrationTest {
  private class FakeHandler : PhoneToolHandler {
    override fun call(name: String, args: JSONObject): ToolResult =
      ToolResult("handled $name")
  }

  private data class Response(val code: Int, val body: String)

  private fun request(
    port: Int,
    method: String,
    token: String? = "test-token",
    body: String? = null,
    path: String = "/mcp",
  ): Response {
    val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
    connection.requestMethod = method
    connection.connectTimeout = 3_000
    connection.readTimeout = 3_000
    connection.setRequestProperty("Connection", "close")
    if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
    if (body != null) {
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
    }
    val code = connection.responseCode
    val stream = if (code in 200..299) connection.inputStream else connection.errorStream
    val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
    connection.disconnect()
    return Response(code, text)
  }

  @Test
  fun fallsBackToAnotherPortWhenPreferredIsTaken() {
    val loopback = java.net.InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))
    val blocker = java.net.ServerSocket(0, 1, loopback)
    val taken = blocker.localPort
    val server = McpHttpServer("test-token", FakeHandler(), preferredPort = taken) { "instr" }
    val port = server.start()
    try {
      assertTrue("应当回退到可用端口", port > 0 && port != taken)
    } finally {
      server.stop()
      blocker.close()
    }
  }

  @Test
  fun socketEnforcesAuthAndServesMcp() {
    val server = McpHttpServer("test-token", FakeHandler()) { "instr" }
    val port = server.start()
    try {
      val unauthorized = request(
        port,
        "POST",
        token = "wrong",
        body = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}""",
      )
      assertEquals(401, unauthorized.code)

      val initialize = request(
        port,
        "POST",
        body = """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}""",
      )
      assertEquals(200, initialize.code)
      val init = JSONObject(initialize.body)
      assertEquals("2.0", init.getString("jsonrpc"))
      assertEquals("2025-06-18", init.getJSONObject("result").getString("protocolVersion"))

      val call = request(
        port,
        "POST",
        body = """{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"screen","arguments":{}}}""",
      )
      assertEquals(200, call.code)
      val result = JSONObject(call.body).getJSONObject("result")
      assertEquals(
        "handled screen",
        result.getJSONArray("content").getJSONObject(0).getString("text"),
      )

      val notification = request(
        port,
        "POST",
        body = """{"jsonrpc":"2.0","method":"notifications/initialized"}""",
      )
      assertEquals(202, notification.code)
      assertTrue(notification.body.isEmpty())

      val get = request(port, "GET")
      assertEquals(405, get.code)

      val wrongPath = request(
        port,
        "POST",
        body = "{}",
        path = "/other",
      )
      assertEquals(404, wrongPath.code)
    } finally {
      server.stop()
    }
  }
}