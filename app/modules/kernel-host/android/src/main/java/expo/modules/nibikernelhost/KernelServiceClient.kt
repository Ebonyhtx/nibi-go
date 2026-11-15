package expo.modules.nibikernelhost

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.util.Log
import org.json.JSONObject
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * D20：UI 进程侧的 `:kernel` 客户端。
 *
 * 控制面走 Binder（`INibiKernelService`），帧流走 `openFrames()` 给的 socketpair fd。
 * 绑定关系：`BIND_AUTO_CREATE`；Service 随 UI 进程的绑定存活（START_STICKY/FGS 在后续切片）。
 *
 * 死亡与重连：binder death → 关通道 → 按 250ms/500ms/1000ms/2000ms 退避重绑；
 * 重绑成功后重新 `openFrames` + `start`（内核进程是新的，状态靠内核自己的持久化 +
 * 宿主重新 resume，不在这里重放）。`onRestart("restarting"|"ready", attempt)` 通知 JS。
 */
internal class KernelServiceClient(
  private val context: Context,
  private val onLine: (ByteArray) -> Unit,
  private val onError: (String) -> Unit,
  private val onRestart: (status: String, attempt: Int) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private var binder: INibiKernelService? = null
  private var connection: ServiceConnection? = null
  private var binding = false
  private var destroyed = false
  private var attempt = 0
  private var env: Map<String, String> = emptyMap()

  @Volatile
  private var input: FileInputStream? = null

  @Volatile
  private var output: FileOutputStream? = null

  @Volatile
  private var hostFd: ParcelFileDescriptor? = null

  @Volatile
  private var reader: Thread? = null

  @Volatile
  private var reading = false

  private val writeLock = Any()
  private val deathRecipient = IBinder.DeathRecipient { onBinderDied() }

  /** 同步启动（AsyncFunction 在后台线程调用；Binder 回调在主线程）。 */
  fun start(environment: Map<String, String>): Boolean {
    env = environment
    attempt = 0
    val latch = CountDownLatch(1)
    var ok = false
    main.post {
      if (!bind { result ->
          ok = result
          latch.countDown()
        }
      ) {
        latch.countDown()
      }
    }
    latch.await(20, TimeUnit.SECONDS)
    return ok
  }

  fun send(line: String): Boolean {
    val stream = output ?: return false
    return try {
      synchronized(writeLock) {
        stream.write(line.toByteArray(Charsets.UTF_8))
        stream.write('\n'.code)
        stream.flush()
      }
      true
    } catch (error: IOException) {
      Log.w(TAG, "写入帧通道失败", error)
      false
    }
  }

  fun abiVersion(): Int {
    val service = binder ?: return -1
    return try {
      service.abiVersion()
    } catch (_: Throwable) {
      -1
    }
  }

  fun loadError(): String? {
    val service = binder ?: return null
    return try {
      service.loadError()
    } catch (_: Throwable) {
      null
    }
  }

  fun stop(): Boolean {
    val service = binder ?: return false
    return try {
      service.stop()
    } catch (_: Throwable) {
      false
    }
  }

  fun destroy() {
    destroyed = true
    reading = false
    reader?.interrupt()
    reader = null
    try {
      binder?.destroy()
    } catch (_: Throwable) {
    }
    releaseBinder()
    closeChannel()
    unbind()
  }

  fun killForTest() {
    try {
      binder?.killForTest()
    } catch (error: Throwable) {
      Log.w(TAG, "killForTest 失败", error)
    }
  }

  /** 绑定 + openFrames + start；完成后回调。返回是否发起了绑定。 */
  private fun bind(onReady: (Boolean) -> Unit): Boolean {
    if (destroyed) return false
    if (binder != null) {
      onReady(true)
      return true
    }
    if (binding) return false
    binding = true
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
        binding = false
        if (destroyed || service == null) {
          onReady(false)
          return
        }
        try {
          service.linkToDeath(deathRecipient, 0)
          binder = INibiKernelService.Stub.asInterface(service)
          val started = prepareChannelAndStart()
          if (started) {
            onReady(true)
            onRestart("ready", attempt)
            attempt = 0
          } else {
            releaseBinder()
            closeChannel()
            onReady(false)
          }
        } catch (error: Throwable) {
          Log.w(TAG, "连接内核服务失败", error)
          releaseBinder()
          closeChannel()
          onReady(false)
        }
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        // binder death 的常规回调；统一在 DeathRecipient 里处理重绑。
      }
    }
    this.connection = connection
    val intent = Intent(context, KernelService::class.java)
    val bound = try {
      context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
    } catch (error: Throwable) {
      Log.w(TAG, "bindService 失败", error)
      false
    }
    if (!bound) {
      binding = false
      this.connection = null
    }
    return bound
  }

  private fun prepareChannelAndStart(): Boolean {
    val service = binder ?: return false
    closeChannel()
    val fd = service.openFrames() ?: return false
    hostFd = fd
    val input = FileInputStream(fd.fileDescriptor)
    val output = FileOutputStream(fd.fileDescriptor)
    this.input = input
    this.output = output
    startReader(input)
    val args = env.map { (name, value) -> "$name=$value" }.toTypedArray()
    return try {
      service.start(args)
    } catch (error: Throwable) {
      Log.w(TAG, "内核 start 失败", error)
      false
    }
  }

  private fun startReader(stream: FileInputStream) {
    reading = true
    reader = Thread({
      val buffer = ByteArray(8192)
      // 按字节攒到 LF 再整行解码：帧里是中文 JSON，按块解码会切坏跨块的多字节字符。
      val pending = java.io.ByteArrayOutputStream()
      while (reading) {
        val read = try {
          stream.read(buffer)
        } catch (error: IOException) {
          if (reading) Log.w(TAG, "读取帧通道失败", error)
          break
        }
        if (read < 0) break
        pending.write(buffer, 0, read)
        val bytes = pending.toByteArray()
        var start = 0
        for (index in bytes.indices) {
          if (bytes[index] != '\n'.code.toByte()) continue
          val line = String(bytes, start, index - start, Charsets.UTF_8).trimEnd('\r')
          start = index + 1
          if (line.isEmpty()) continue
          if (line.contains(KernelService.HOST_ERROR_METHOD)) {
            val message = try {
              JSONObject(line).optJSONObject("params")?.optString("message").orEmpty()
            } catch (_: Throwable) {
              line
            }
            onError(message.ifEmpty { line })
          } else {
            onLine(line.toByteArray(Charsets.UTF_8))
          }
        }
        if (start > 0) {
          pending.reset()
          pending.write(bytes, start, bytes.size - start)
        }
      }
    }, "nibi-kernel-client-frames").also {
      it.isDaemon = true
      it.start()
    }
  }

  private fun onBinderDied() {
    if (destroyed) return
    Log.w(TAG, "内核进程 binder death")
    releaseBinder()
    closeChannel()
    scheduleRebind()
  }

  /** 退避重绑：250/500/1000/2000ms 封顶；成功后 attempt 归零。 */
  private fun scheduleRebind() {
    if (destroyed) return
    attempt += 1
    onRestart("restarting", attempt)
    val delay = minOf(2000L, 250L shl minOf(attempt - 1, 4))
    main.postDelayed({
      if (destroyed) return@postDelayed
      val initiated = bind { ok ->
        if (!ok) scheduleRebind()
      }
      if (!initiated) scheduleRebind()
    }, delay)
  }

  private fun releaseBinder() {
    try {
      binder?.asBinder()?.unlinkToDeath(deathRecipient, 0)
    } catch (_: Throwable) {
    }
    binder = null
  }

  private fun closeChannel() {
    reading = false
    reader?.interrupt()
    reader = null
    try {
      input?.close()
    } catch (_: Throwable) {
    }
    try {
      output?.close()
    } catch (_: Throwable) {
    }
    try {
      hostFd?.close()
    } catch (_: Throwable) {
    }
    input = null
    output = null
    hostFd = null
  }

  private fun unbind() {
    val connection = connection ?: return
    this.connection = null
    try {
      context.unbindService(connection)
    } catch (_: Throwable) {
    }
  }

  companion object {
    private const val TAG = "NibiKernelClient"
  }
}
