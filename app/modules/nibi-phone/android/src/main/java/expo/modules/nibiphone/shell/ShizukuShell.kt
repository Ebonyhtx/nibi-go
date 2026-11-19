package expo.modules.nibiphone.shell

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.Settings
import java.io.ByteArrayOutputStream
import java.io.InputStream
import moe.shizuku.server.IRemoteProcess
import moe.shizuku.server.IShizukuService
import rikka.shizuku.Shizuku

data class ShellState(
  val installed: Boolean,
  val running: Boolean,
  val permission: String,
)

data class ShellResult(val text: String, val ok: Boolean)

/**
 * 开关 2：通过 Shizuku 的 shell uid 执行一次非交互命令。
 *
 * 关于进程 API：Shizuku 13.1.5 里 `Shizuku.newProcess` 已是 private（计划在 API 14 移除），
 * 因此这里直接用它内部同款的 `IShizukuService` AIDL（由 `dev.rikka.shizuku:api` 以 compile
 * 依赖带入）发起 `newProcess`，再用 `IRemoteProcess` 读写流、等待退出与 destroy。
 * 凭据与命令文本都不写日志；命令不重试。
 */
object ShizukuShell {
  /** Shizuku 管理器；Sui 用户通常没有可启动的管理器。 */
  private const val MANAGER_PACKAGE = "moe.shizuku.privileged.api"

  /** Sui 以模块形式提供同样的 binder；包名仅用于“已安装”探测。 */
  private const val SUI_PACKAGE = "com.sui.manager"

  private const val REQUEST_CODE = 4205
  private const val MAX_OUTPUT_BYTES = 8 * 1024
  private const val DESTROY_GRACE_MS = 1_500L
  private const val READER_GRACE_MS = 2_000L

  private val listenerLock = Any()

  @Volatile
  private var listenerRegistered = false

  fun state(context: Context): ShellState {
    val installed = isInstalled(context)
    val running = try {
      Shizuku.pingBinder()
    } catch (_: Throwable) {
      false
    }
    val permission = if (!running) {
      "unknown"
    } else {
      try {
        if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) {
          "granted"
        } else {
          "denied"
        }
      } catch (_: Throwable) {
        "unknown"
      }
    }
    return ShellState(installed, running, permission)
  }

  /**
   * 发起一次授权请求；返回是否已把请求交给 Shizuku。
   * 结果监听器只注册一次（回调在主线程，状态页下次读取时会重新探测，无需在回调里做任何事）。
   */
  fun requestPermission(): Boolean {
    val running = try {
      Shizuku.pingBinder()
    } catch (_: Throwable) {
      false
    }
    if (!running) return false
    return try {
      ensurePermissionListener()
      Shizuku.requestPermission(REQUEST_CODE)
      true
    } catch (_: Throwable) {
      false
    }
  }

  fun openManager(context: Context): Boolean = try {
    val intent = context.packageManager.getLaunchIntentForPackage(MANAGER_PACKAGE)
      ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    true
  } catch (_: Throwable) {
    false
  }

  /** 系统无线调试是否开启；Shizuku 用它启动服务（配对在 Shizuku 内完成）。 */
  fun wirelessDebugging(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 30) return false
    return try {
      Settings.Global.getInt(context.contentResolver, "adb_wifi_enabled", 0) == 1
    } catch (_: Throwable) {
      false
    }
  }

  /** 执行一次 `sh -c <command>`；超时会 destroy 进程并返回 ok=false。 */
  fun exec(command: String, timeoutMs: Long): ShellResult {
    val running = try {
      Shizuku.pingBinder()
    } catch (_: Throwable) {
      false
    }
    if (!running) {
      return ShellResult(
        "Shizuku 未运行：先打开 Shizuku 应用并启动服务，再回到 App 重试。",
        false,
      )
    }
    val granted = try {
      Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (_: Throwable) {
      false
    }
    if (!granted) {
      return ShellResult(
        "Shizuku 未授权：在 Shizuku 应用里允许 NIBI-GO 使用 shell，然后重试。",
        false,
      )
    }
    val text = command.trim()
    if (text.isEmpty()) {
      return ShellResult("命令为空：请提供要执行的 sh 命令。", false)
    }
    val timeout = timeoutMs.coerceAtLeast(1L)
    val uid = try {
      Shizuku.getUid()
    } catch (_: Throwable) {
      -1
    }
    val binder = Shizuku.getBinder()
      ?: return ShellResult("Shizuku 未连接：先启动 Shizuku 服务后重试。", false)
    val remote: IRemoteProcess = try {
      IShizukuService.Stub.asInterface(binder)
        .newProcess(arrayOf("sh", "-c", text), null, null)
    } catch (error: Throwable) {
      return ShellResult(
        "无法启动 shell（${error.javaClass.simpleName}）：确认 Shizuku 正在运行且已授权，然后重试。",
        false,
      )
    }

    val stdout = CappedBuffer(MAX_OUTPUT_BYTES)
    val stderr = CappedBuffer(MAX_OUTPUT_BYTES)
    val stdoutStream = try {
      ParcelFileDescriptor.AutoCloseInputStream(remote.inputStream)
    } catch (error: Throwable) {
      runCatching { remote.destroy() }
      return ShellResult(
        "无法读取 shell 输出（${error.javaClass.simpleName}）：请重启 Shizuku 后重试。",
        false,
      )
    }
    val stderrStream = try {
      ParcelFileDescriptor.AutoCloseInputStream(remote.errorStream)
    } catch (error: Throwable) {
      runCatching { stdoutStream.close() }
      runCatching { remote.destroy() }
      return ShellResult(
        "无法读取 shell 输出（${error.javaClass.simpleName}）：请重启 Shizuku 后重试。",
        false,
      )
    }
    // 非交互命令：立即关闭 stdin，避免读取 stdin 的命令挂到超时。
    runCatching { remote.outputStream?.close() }
    val stdoutThread = Thread({ pump(stdoutStream, stdout) }, "nibi-shell-out").apply {
      isDaemon = true
    }
    val stderrThread = Thread({ pump(stderrStream, stderr) }, "nibi-shell-err").apply {
      isDaemon = true
    }
    stdoutThread.start()
    stderrThread.start()

    val status = ExitStatus()
    val waiter = Thread({
      try {
        status.code = remote.waitFor()
      } catch (error: Throwable) {
        status.error = error
      }
    }, "nibi-shell-wait").apply { isDaemon = true }
    waiter.start()

    try {
      waiter.join(timeout)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      runCatching { remote.destroy() }
      return ShellResult("命令等待被中断：已请求终止进程。uid=$uid", false)
    }

    if (waiter.isAlive) {
      // 超时：destroy 是唯一动作，不重试；已产生的副作用无法回滚。
      runCatching { remote.destroy() }
      joinQuietly(waiter, DESTROY_GRACE_MS)
      // 关闭本地管道，读线程即使等不到远端 EOF 也能退出。
      runCatching { stdoutStream.close() }
      runCatching { stderrStream.close() }
      stdoutThread.interrupt()
      stderrThread.interrupt()
      joinQuietly(stdoutThread, DESTROY_GRACE_MS)
      joinQuietly(stderrThread, DESTROY_GRACE_MS)
      val output = renderOutput(stdout, stderr)
      return ShellResult(
        buildString {
          append("uid=").append(uid).append(" exit=timeout\n")
          append("命令在 ").append(timeout).append(" ms 内未结束，已发送终止请求；")
          append("已产生的副作用不会撤销，命令不会重试。")
          if (output.isNotEmpty()) append('\n').append(output)
        },
        false,
      )
    }

    joinQuietly(stdoutThread, READER_GRACE_MS)
    joinQuietly(stderrThread, READER_GRACE_MS)

    val error = status.error
    if (error != null) {
      return ShellResult(
        "读取命令结果失败（${error.javaClass.simpleName}）：Shizuku 可能已停止，重启后重试。uid=$uid",
        false,
      )
    }
    val exit = status.code ?: -1
    val output = renderOutput(stdout, stderr)
    return ShellResult(
      buildString {
        append("uid=").append(uid).append(" exit=").append(exit).append('\n')
        append(if (output.isEmpty()) "(无输出)" else output)
      },
      true,
    )
  }

  private fun ensurePermissionListener() {
    if (listenerRegistered) return
    synchronized(listenerLock) {
      if (listenerRegistered) return
      Shizuku.addRequestPermissionResultListener(
        object : Shizuku.OnRequestPermissionResultListener {
          override fun onRequestPermissionResult(requestCode: Int, grantResult: Int) {
            // 状态按需重新探测；这里不做缓存或额外动作。
          }
        },
      )
      listenerRegistered = true
    }
  }

  @Suppress("DEPRECATION")
  private fun isInstalled(context: Context): Boolean {
    val manager = context.packageManager
    for (name in MANAGER_PACKAGES) {
      try {
        manager.getPackageInfo(name, 0)
        return true
      } catch (_: PackageManager.NameNotFoundException) {
        // 继续看下一个包名。
      } catch (_: SecurityException) {
        // 包可见性限制：没有 <queries> 的包可能被系统隐藏，按未安装处理。
      } catch (_: Throwable) {
        // 厂商实现异常不影响其余探测。
      }
    }
    return false
  }

  private val MANAGER_PACKAGES = listOf(MANAGER_PACKAGE, SUI_PACKAGE)

  private fun pump(stream: InputStream, sink: CappedBuffer) {
    val chunk = ByteArray(8 * 1024)
    try {
      while (true) {
        val read = stream.read(chunk)
        if (read < 0) break
        if (read > 0) sink.append(chunk, read)
      }
    } catch (_: Throwable) {
      // 进程退出或被 destroy 时流关闭/中断是预期行为。
    } finally {
      runCatching { stream.close() }
    }
  }

  private fun joinQuietly(thread: Thread, millis: Long) {
    try {
      thread.join(millis)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  private fun renderOutput(stdout: CappedBuffer, stderr: CappedBuffer): String {
    val outText = decodeUtf8(stdout.snapshot())
    val errText = decodeUtf8(stderr.snapshot())
    val combined = when {
      outText.isEmpty() -> errText
      errText.isEmpty() -> outText
      else -> outText + "\n[stderr]\n" + errText
    }
    val bytes = combined.toByteArray(Charsets.UTF_8)
    val overflow = bytes.size > MAX_OUTPUT_BYTES
    val kept = if (overflow) truncateUtf8(bytes, MAX_OUTPUT_BYTES) else combined
    return if (stdout.truncated || stderr.truncated || overflow) {
      kept + "…[truncated]"
    } else {
      kept
    }
  }

  /** 解到完整 UTF-8 字符为止（读缓冲区可能截断多字节字符）。 */
  private fun decodeUtf8(bytes: ByteArray): String =
    String(bytes, 0, safeEnd(bytes, bytes.size), Charsets.UTF_8)

  private fun truncateUtf8(bytes: ByteArray, limit: Int): String =
    String(bytes, 0, safeEnd(bytes, limit), Charsets.UTF_8)

  /** 返回不超过 [limit] 且落在 UTF-8 字符边界上的字节数。 */
  private fun safeEnd(bytes: ByteArray, limit: Int): Int {
    if (limit <= 0 || bytes.isEmpty()) return 0
    val capped = minOf(limit, bytes.size)
    var start = capped - 1
    while (start > 0 && (bytes[start].toInt() and 0xC0) == 0x80) start--
    val lead = bytes[start].toInt() and 0xFF
    val need = when {
      (lead and 0x80) == 0 -> 1
      (lead and 0xE0) == 0xC0 -> 2
      (lead and 0xF0) == 0xE0 -> 3
      (lead and 0xF8) == 0xF0 -> 4
      else -> 1
    }
    return if (start + need <= capped) capped else start
  }

  private class CappedBuffer(private val limit: Int) {
    private val bytes = ByteArrayOutputStream()

    @Volatile
    var truncated = false
      private set

    @Synchronized
    fun append(chunk: ByteArray, count: Int) {
      val room = limit - bytes.size()
      if (room <= 0) {
        truncated = true
        return
      }
      if (count > room) {
        bytes.write(chunk, 0, room)
        truncated = true
      } else {
        bytes.write(chunk, 0, count)
      }
    }

    @Synchronized
    fun snapshot(): ByteArray = bytes.toByteArray()
  }

  private class ExitStatus {
    @Volatile
    var code: Int? = null

    @Volatile
    var error: Throwable? = null
  }
}