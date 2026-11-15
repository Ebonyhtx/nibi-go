package expo.modules.nibikernelhost

import android.app.Service
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.system.Os
import android.util.Log
import org.json.JSONObject
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException

/**
 * D20：内核的承载进程（`android:process=":kernel"`）。
 *
 * 为什么是普通进程而不是 `isolatedProcess`：隔离进程没有网络权限，内核出不了网。
 * 这里只做两件事：
 *  1. 在本进程 dlopen 包内 `libnibi.so` 并起内核线程（D19 不变）；
 *  2. 通过 Binder 暴露生命周期，通过 socketpair 传帧（不走 Binder 的 1 MB 事务上限）。
 *
 * 帧协议：一行一个 UTF-8 JSON 帧。Service → 宿主是内核输出；宿主 → Service 是命令帧。
 * 内核的异步错误包成保留通知 `nibi/hostError` 走同一条通道，宿主桥接层再转成事件。
 */
class KernelService : Service() {
  private val binder = ServiceBinder()

  @Volatile
  private var output: FileOutputStream? = null

  @Volatile
  private var input: FileInputStream? = null

  @Volatile
  private var channel: ParcelFileDescriptor? = null

  @Volatile
  private var hostEnd: ParcelFileDescriptor? = null

  @Volatile
  private var reader: Thread? = null

  @Volatile
  private var reading = false

  // 宿主 Activity 重建后会重新 bind + start；内核已经在这条进程里跑着时不能再起一次。
  @Volatile
  private var kernelStarted = false

  private val writeLock = Any()

  private val sink = object : NibiKernelHostNative.Sink {
    override fun onLine(bytes: ByteArray) {
      writeFrame(bytes)
    }

    override fun onError(bytes: ByteArray) {
      // 保留通知：宿主桥接层识别它，转成 onKernelError 事件，不当作会话帧。
      val message = String(bytes, Charsets.UTF_8)
      val payload = JSONObject()
        .put("method", HOST_ERROR_METHOD)
        .put("params", JSONObject().put("message", message))
        .toString()
      writeFrame(payload.toByteArray(Charsets.UTF_8))
    }
  }

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onDestroy() {
    kernelStarted = false
    reading = false
    reader?.interrupt()
    reader = null
    if (NibiKernelHostNative.isAvailable) {
      NibiKernelHostNative.nativeStop()
      NibiKernelHostNative.nativeDestroy()
    }
    closeChannel()
    super.onDestroy()
  }

  private fun writeFrame(bytes: ByteArray) {
    val stream = output ?: return
    synchronized(writeLock) {
      try {
        stream.write(bytes)
        stream.write('\n'.code)
        stream.flush()
      } catch (error: IOException) {
        Log.w(TAG, "写入帧通道失败", error)
      }
    }
  }

  private fun openChannel(): ParcelFileDescriptor? {
    closeChannel()
    return try {
      // Unix stream socket pair：返回 [宿主端, Service 端]。
      val pair = ParcelFileDescriptor.createSocketPair()
      val host = pair[0]
      val service = pair[1]
      hostEnd = host
      channel = service
      input = FileInputStream(service.fileDescriptor)
      output = FileOutputStream(service.fileDescriptor)
      startReader(input!!)
      host
    } catch (error: Throwable) {
      Log.w(TAG, "创建帧通道失败", error)
      closeChannel()
      null
    }
  }

  private fun startReader(stream: FileInputStream) {
    reading = true
    reader = Thread({
      val buffer = ByteArray(8192)
      // 必须按字节攒到 LF 再整行 UTF-8 解码：按块解码会把跨块的多字节字符切坏。
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
          if (line.isNotEmpty()) {
            NibiKernelHostNative.nativeSend(line.toByteArray(Charsets.UTF_8))
          }
        }
        if (start > 0) {
          pending.reset()
          pending.write(bytes, start, bytes.size - start)
        }
      }
    }, "nibi-kernel-service-frames").also {
      it.isDaemon = true
      it.start()
    }
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
      channel?.close()
    } catch (_: Throwable) {
    }
    try {
      hostEnd?.close()
    } catch (_: Throwable) {
    }
    input = null
    output = null
    channel = null
    hostEnd = null
  }

  private fun prepareEnvironment() {
    val files = applicationContext.filesDir.absolutePath
    setEnv("HOME", files)
    setEnv("NIBI_DATA_BASE_DIR", files)
    setEnv("TMPDIR", applicationContext.cacheDir.absolutePath)
  }

  private fun setEnv(name: String, value: String) {
    try {
      Os.setenv(name, value, true)
    } catch (error: Throwable) {
      Log.w(TAG, "设置 $name 失败", error)
    }
  }

  inner class ServiceBinder : INibiKernelService.Stub() {
    override fun abiVersion(): Int =
      if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeAbiVersion() else -1

    override fun loadError(): String? = NibiKernelHostNative.loadError

    override fun start(env: Array<out String>?): Boolean {
      if (!NibiKernelHostNative.isAvailable) return false
      if (kernelStarted) return true
      prepareEnvironment()
      env?.forEach { entry ->
        val at = entry.indexOf('=')
        if (at > 0) setEnv(entry.substring(0, at), entry.substring(at + 1))
      }
      return NibiKernelHostNative.nativeStart(sink).also { kernelStarted = it }
    }

    override fun openFrames(): ParcelFileDescriptor? = openChannel()

    override fun stop(): Boolean {
      kernelStarted = false
      return if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeStop() else false
    }

    override fun destroy() {
      kernelStarted = false
      if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeDestroy()
      closeChannel()
    }

    override fun killForTest() {
      val debuggable =
        (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
      if (!debuggable) return
      Log.w(TAG, "killForTest：杀掉 :kernel 进程")
      android.os.Process.killProcess(android.os.Process.myPid())
    }
  }

  companion object {
    private const val TAG = "NibiKernelService"
    const val HOST_ERROR_METHOD = "nibi/hostError"
  }
}
