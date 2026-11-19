package expo.modules.nibiphone.mcp

import android.util.Base64
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/**
 * 127.0.0.1 上的 loopback MCP 服务器（streamable HTTP，JSON 响应）。
 *
 * - 只接受 `POST /mcp` + `Authorization: Bearer <token>`；其余请求 401/404/405。
 * - 传输层是 MCP legacy 世代（2025-06-18）：initialize / ping / tools/list / tools/call /
 *   notifications/initialized；`server/discover` 与未知方法回 -32601，让内核回退到 legacy。
 * - token 与请求体永不写日志；服务器只存在于本进程内存里。
 */
class McpHttpServer(
  val token: String,
  private val handler: PhoneToolHandler,
  private val preferredPort: Int? = null,
  private val instructions: () -> String,
) {
  @Volatile
  var port: Int = 0
    private set

  private val startLock = Any()

  /** 手机同一时刻只有一块屏幕：工具调用串行执行，避免并发动作互相覆盖。 */
  private val callLock = Any()

  private val sockets: MutableSet<Socket> =
    Collections.newSetFromMap<Socket>(ConcurrentHashMap<Socket, Boolean>())

  @Volatile
  private var running = false

  private var listener: ServerSocket? = null
  private var acceptor: Thread? = null
  private var workers: ExecutorService? = null

  /** 绑定回环地址的随机端口并开始接受连接；返回实际端口。 */
  fun start(): Int {
    synchronized(startLock) {
      if (running) return port
      // Android 的 InetAddress.getLoopbackAddress() 返回 ::1；内核 URL 固定是 127.0.0.1，
      // 所以显式绑定 IPv4 回环，否则 IPv4 连接会连不上。
      // 优先固定端口：进程被系统回收后服务器能用同一地址回来，内核旧配置继续有效。
      // 端口被占用时回退到系统分配的随机端口（App 侧靠代次变化重新 resume）。
      val server = try {
        ServerSocket(preferredPort ?: 0, 16, IPV4_LOOPBACK)
      } catch (_: IOException) {
        ServerSocket(0, 16, IPV4_LOOPBACK)
      }
      val pool = Executors.newFixedThreadPool(WORKER_THREADS, daemonFactory("nibi-mcp-http"))
      listener = server
      workers = pool
      port = server.localPort
      running = true
      val thread = Thread({ acceptLoop(server, pool) }, "nibi-mcp-accept").apply {
        isDaemon = true
      }
      acceptor = thread
      thread.start()
      return port
    }
  }

  /** 关闭监听与连接；可重复调用。 */
  fun stop() {
    synchronized(startLock) {
      running = false
      runCatching { listener?.close() }
      listener = null
      acceptor?.interrupt()
      acceptor = null
      workers?.shutdownNow()
      workers = null
      sockets.toList().forEach { socket -> runCatching { socket.close() } }
      sockets.clear()
      port = 0
    }
  }

  private fun acceptLoop(server: ServerSocket, pool: ExecutorService) {
    while (running) {
      val socket = try {
        server.accept()
      } catch (_: SocketException) {
        break
      } catch (_: IOException) {
        if (!running) break
        continue
      }
      if (!running) {
        runCatching { socket.close() }
        break
      }
      sockets.add(socket)
      try {
        pool.execute { handle(socket) }
      } catch (_: RejectedExecutionException) {
        sockets.remove(socket)
        runCatching { socket.close() }
      }
    }
  }

  private fun handle(socket: Socket) {
    try {
      socket.soTimeout = SOCKET_TIMEOUT_MS
      socket.tcpNoDelay = true
      val input = BufferedInputStream(socket.getInputStream())
      val request = try {
        readRequest(input)
      } catch (error: HttpFailure) {
        respond(socket, error.status, jsonError(error.reason))
        return
      }
      if (request.path != ENDPOINT) {
        respond(socket, 404, jsonError("not found"))
        return
      }
      if (request.method != "POST") {
        respond(socket, 405, jsonError("method not allowed"), allow = "POST")
        return
      }
      if (!isAuthorized(request.headers)) {
        respond(socket, 401, jsonError("unauthorized"), authenticate = true)
        return
      }
      val body = try {
        readBody(input, request)
      } catch (error: HttpFailure) {
        respond(socket, error.status, jsonError(error.reason))
        return
      }
      val response = dispatch(String(body, Charsets.UTF_8))
      if (response == null) {
        respond(socket, 202, null)
      } else {
        respond(socket, 200, response.toByteArray(Charsets.UTF_8))
      }
    } catch (_: SocketTimeoutException) {
      runCatching { respond(socket, 408, jsonError("request timeout")) }
    } catch (_: IOException) {
      // 对端关闭、超时或本端 stop()；请求内容不记录。
    } catch (_: Exception) {
      runCatching { respond(socket, 500, jsonError("internal error")) }
    } finally {
      sockets.remove(socket)
      runCatching { socket.close() }
    }
  }

  // ---- HTTP 解析 ----

  private data class HttpRequest(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
  )

  private class HttpFailure(val status: Int, val reason: String) : Exception(reason)

  private fun readRequest(input: BufferedInputStream): HttpRequest {
    var budget = MAX_HEADER_BYTES
    val requestLine = readLine(input, budget) ?: throw HttpFailure(400, "bad request")
    budget -= requestLine.toByteArray(Charsets.UTF_8).size + 2
    val parts = requestLine.trim().split(Regex("\\s+"))
    if (parts.size != 3 || !parts[2].startsWith("HTTP/")) {
      throw HttpFailure(400, "bad request")
    }
    val method = parts[0].uppercase()
    val path = parts[1].substringBefore('?')

    val headers = LinkedHashMap<String, String>(16)
    var count = 0
    while (true) {
      if (budget < 0) throw HttpFailure(400, "headers too large")
      val line = readLine(input, budget) ?: throw HttpFailure(400, "bad request")
      budget -= line.toByteArray(Charsets.UTF_8).size + 2
      if (line.isEmpty()) break
      count += 1
      if (count > MAX_HEADERS) throw HttpFailure(400, "too many headers")
      val colon = line.indexOf(':')
      if (colon <= 0) throw HttpFailure(400, "bad request")
      val name = line.substring(0, colon).trim().lowercase()
      val value = line.substring(colon + 1).trim()
      if (name.isEmpty()) throw HttpFailure(400, "bad request")
      val previous = headers[name]
      if (name == "content-length" && previous != null && previous != value) {
        throw HttpFailure(400, "bad request")
      }
      headers[name] = if (name == "transfer-encoding" && previous != null) {
        "$previous,$value"
      } else {
        value
      }
    }

    // 请求体长度在路由/鉴权之后才校验，保证 GET/DELETE 先得到 405、错误路径先得到 404。
    return HttpRequest(method, path, headers)
  }

  /**
   * 读一行（以 \n 结尾；可带 \r）。单行最多 [limit] 字节，防住没有换行的长行。
   * 返回 null 表示流在行首结束。
   */
  private fun readLine(input: InputStream, limit: Int): String? {
    val buffer = ByteArrayOutputStream()
    while (true) {
      val value = input.read()
      if (value < 0) {
        return if (buffer.size() == 0) null else String(buffer.toByteArray(), Charsets.UTF_8)
      }
      if (value == '\n'.code) break
      if (buffer.size() >= limit) throw HttpFailure(400, "headers too large")
      buffer.write(value)
    }
    val bytes = buffer.toByteArray()
    val length = if (bytes.isNotEmpty() && bytes.last() == '\r'.code.toByte()) {
      bytes.size - 1
    } else {
      bytes.size
    }
    return String(bytes, 0, length, Charsets.UTF_8)
  }

  private fun readBody(input: BufferedInputStream, request: HttpRequest): ByteArray {
    val transferEncoding = request.headers["transfer-encoding"]?.lowercase()
    val chunked = transferEncoding
      ?.split(',')
      ?.map { it.trim() }
      ?.contains("chunked") == true
    if (transferEncoding != null && !chunked) {
      throw HttpFailure(400, "bad request")
    }
    val contentLength = request.headers["content-length"]?.let { text ->
      val parsed = text.toLongOrNull() ?: throw HttpFailure(400, "bad request")
      if (parsed < 0) throw HttpFailure(400, "bad request")
      parsed
    }
    if (chunked) {
      // 同时给两种长度解析方式时拒绝，避免请求走私。
      if (contentLength != null) throw HttpFailure(400, "bad request")
      return readChunked(input)
    }
    if (contentLength == null) throw HttpFailure(411, "length required")
    if (contentLength > MAX_BODY_BYTES) throw HttpFailure(413, "payload too large")
    val body = ByteArray(contentLength.toInt())
    var offset = 0
    while (offset < body.size) {
      val read = input.read(body, offset, body.size - offset)
      if (read < 0) throw HttpFailure(400, "bad request")
      offset += read
    }
    return body
  }

  /** 最小 chunked：十六进制块长（可带扩展）、块数据、尾随头。 */
  private fun readChunked(input: BufferedInputStream): ByteArray {
    val body = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val line = readLine(input, MAX_HEADER_BYTES) ?: throw HttpFailure(400, "bad request")
      val sizeText = line.substringBefore(';').trim()
      if (sizeText.isEmpty()) throw HttpFailure(400, "bad request")
      val size = sizeText.toLongOrNull(16) ?: throw HttpFailure(400, "bad request")
      if (size < 0) throw HttpFailure(400, "bad request")
      if (size == 0L) {
        var trailerBudget = MAX_HEADER_BYTES
        while (true) {
          val trailer = readLine(input, trailerBudget) ?: throw HttpFailure(400, "bad request")
          trailerBudget -= trailer.toByteArray(Charsets.UTF_8).size + 2
          if (trailer.isEmpty()) break
          if (trailerBudget < 0) throw HttpFailure(400, "bad request")
        }
        return body.toByteArray()
      }
      if (size > MAX_BODY_BYTES - body.size().toLong()) {
        throw HttpFailure(413, "payload too large")
      }
      var remaining = size
      while (remaining > 0) {
        val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
        if (read < 0) throw HttpFailure(400, "bad request")
        body.write(buffer, 0, read)
        remaining -= read
      }
      // 块数据后面必须是空行（CRLF 经 readLine 变成空串）。
      val separator = readLine(input, 4) ?: throw HttpFailure(400, "bad request")
      if (separator.isNotEmpty()) throw HttpFailure(400, "bad request")
    }
  }

  private fun isAuthorized(headers: Map<String, String>): Boolean {
    val supplied = headers["authorization"] ?: return false
    // 常量时间比较完整的 "Bearer <token>"，不单独比较 token 片段。
    val expected = "Bearer $token".toByteArray(Charsets.UTF_8)
    return MessageDigest.isEqual(expected, supplied.toByteArray(Charsets.UTF_8))
  }

  private fun respond(
    socket: Socket,
    status: Int,
    body: ByteArray?,
    allow: String? = null,
    authenticate: Boolean = false,
  ) {
    val output = socket.getOutputStream().buffered()
    val header = buildString {
      append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n")
      append("Connection: close\r\n")
      append("Content-Type: application/json; charset=utf-8\r\n")
      append("Content-Length: ").append(body?.size ?: 0).append("\r\n")
      if (allow != null) append("Allow: ").append(allow).append("\r\n")
      if (authenticate) append("WWW-Authenticate: Bearer\r\n")
      append("\r\n")
    }
    output.write(header.toByteArray(Charsets.UTF_8))
    if (body != null && body.isNotEmpty()) output.write(body)
    output.flush()
  }

  private fun jsonError(reason: String): ByteArray =
    JSONObject().put("error", reason).toString().toByteArray(Charsets.UTF_8)

  private fun reason(status: Int): String = when (status) {
    200 -> "OK"
    202 -> "Accepted"
    400 -> "Bad Request"
    401 -> "Unauthorized"
    404 -> "Not Found"
    405 -> "Method Not Allowed"
    408 -> "Request Timeout"
    411 -> "Length Required"
    413 -> "Payload Too Large"
    else -> "Internal Server Error"
  }

  // ---- JSON-RPC ----

  /** 处理一条 JSON-RPC 消息；通知返回 null。单测直接走这里，不启动 socket。 */
  fun dispatch(body: String): String? {
    val parsed = try {
      val tokener = JSONTokener(body)
      val value = tokener.nextValue()
      if (tokener.nextClean() != 0.toChar()) {
        return errorLine(null, PARSE_ERROR, "Parse error")
      }
      value
    } catch (_: JSONException) {
      return errorLine(null, PARSE_ERROR, "Parse error")
    }
    return when (parsed) {
      is JSONObject -> dispatchMessage(parsed)?.toString()
      is JSONArray -> dispatchBatch(parsed)
      else -> errorLine(null, INVALID_REQUEST, "Invalid Request")
    }
  }

  private fun dispatchBatch(messages: JSONArray): String? {
    if (messages.length() == 0) {
      return errorLine(null, INVALID_REQUEST, "Invalid Request")
    }
    val responses = JSONArray()
    for (index in 0 until messages.length()) {
      val item = messages.opt(index)
      val response = if (item is JSONObject) {
        dispatchMessage(item)
      } else {
        errorObject(null, INVALID_REQUEST, "Invalid Request")
      }
      if (response != null) responses.put(response)
    }
    return if (responses.length() == 0) null else responses.toString()
  }

  /** 一条消息的响应；通知（没有 id）返回 null。 */
  private fun dispatchMessage(message: JSONObject): JSONObject? {
    val hasId = message.has("id")
    if (message.optString("jsonrpc", "") != "2.0") {
      return if (hasId) errorObject(null, INVALID_REQUEST, "Invalid Request") else null
    }
    val method = message.optString("method", "")
    if (method.isEmpty()) {
      // 客户端发来的响应（result/error）直接忽略；带 id 的残缺消息才算无效请求。
      return if (hasId && !message.has("result") && !message.has("error")) {
        errorObject(null, INVALID_REQUEST, "Invalid Request")
      } else {
        null
      }
    }
    // 通知不回复，也不执行 tools/call（MCP 只把 tools/call 当请求）。
    if (!hasId) return null
    val id = when (val raw = message.opt("id")) {
      null, JSONObject.NULL -> JSONObject.NULL
      is String -> raw
      is Number -> raw
      else -> return errorObject(null, INVALID_REQUEST, "Invalid Request")
    }
    val params = message.optJSONObject("params") ?: JSONObject()
    return when (method) {
      "initialize" -> resultObject(id, initializeResult(params))
      "ping" -> resultObject(id, JSONObject())
      "tools/list" -> resultObject(id, toolsResult())
      "tools/call" -> callTool(id, params)
      "notifications/initialized" -> null
      else -> errorObject(id, METHOD_NOT_FOUND, "Method not found")
    }
  }

  private fun initializeResult(params: JSONObject): JSONObject {
    val requested = params.optString("protocolVersion", "")
    val version = if (requested in KNOWN_PROTOCOL_VERSIONS) {
      requested
    } else {
      LATEST_PROTOCOL_VERSION
    }
    val text = try {
      instructions()
    } catch (_: Exception) {
      ""
    }
    return JSONObject()
      .put("protocolVersion", version)
      .put(
        "capabilities",
        JSONObject().put("tools", JSONObject().put("listChanged", false)),
      )
      .put(
        "serverInfo",
        JSONObject().put("name", "nibi-phone").put("version", "1"),
      )
      .put("instructions", text)
  }

  private fun toolsResult(): JSONObject {
    val tools = JSONArray()
    PhoneToolCatalog.json().forEach { tool -> tools.put(tool) }
    return JSONObject().put("tools", tools)
  }

  private fun callTool(id: Any, params: JSONObject): JSONObject {
    val name = params.optString("name", "").trim()
    if (name.isEmpty()) {
      return errorObject(id, INVALID_PARAMS, "tools/call requires a tool name")
    }
    val arguments = when (val raw = params.opt("arguments")) {
      null, JSONObject.NULL -> JSONObject()
      is JSONObject -> raw
      else -> return errorObject(id, INVALID_PARAMS, "tools/call arguments must be an object")
    }
    val result = try {
      synchronized(callLock) { handler.call(name, arguments) }
    } catch (error: Exception) {
      ToolResult.error("手机工具执行异常：${error.javaClass.simpleName}")
    }
    return resultObject(
      id,
      JSONObject()
        .put("content", contentOf(result))
        .put("isError", result.isError),
    )
  }

  private fun contentOf(result: ToolResult): JSONArray {
    val content = JSONArray()
    content.put(JSONObject().put("type", "text").put("text", result.text))
    val image = result.image
    val mime = result.imageMime
    if (image != null && !mime.isNullOrBlank()) {
      val encoded = Base64.encodeToString(image, Base64.NO_WRAP)
      if (encoded != null) {
        content.put(
          JSONObject()
            .put("type", "image")
            .put("data", encoded)
            .put("mimeType", mime),
        )
      }
    }
    return content
  }

  private fun resultObject(id: Any, result: Any): JSONObject =
    JSONObject()
      .put("jsonrpc", "2.0")
      .put("id", id)
      .put("result", result)

  private fun errorObject(id: Any?, code: Int, message: String): JSONObject =
    JSONObject()
      .put("jsonrpc", "2.0")
      .put("id", id ?: JSONObject.NULL)
      .put("error", JSONObject().put("code", code).put("message", message))

  private fun errorLine(id: Any?, code: Int, message: String): String =
    errorObject(id, code, message).toString()

  private companion object {
    const val ENDPOINT = "/mcp"
    const val MAX_HEADER_BYTES = 16 * 1024
    const val MAX_HEADERS = 64
    const val MAX_BODY_BYTES = 1024L * 1024L
    const val SOCKET_TIMEOUT_MS = 15_000
    const val WORKER_THREADS = 4

    const val PARSE_ERROR = -32700
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602

    const val LATEST_PROTOCOL_VERSION = "2025-06-18"
    val KNOWN_PROTOCOL_VERSIONS = setOf("2024-11-05", "2025-03-26", "2025-06-18")

    /** 127.0.0.1：不依赖 Android 的 IPv6 回环选择。 */
    val IPV4_LOOPBACK: InetAddress = InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))

    fun daemonFactory(prefix: String): ThreadFactory {
      val sequence = AtomicInteger(0)
      return object : ThreadFactory {
        override fun newThread(runnable: Runnable): Thread =
          Thread(runnable, "$prefix-${sequence.incrementAndGet()}").apply {
            isDaemon = true
          }
      }
    }
  }
}
