package expo.modules.nibikernelhost

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo 模块 `NibiKernelHost`：把进程内内核的 C ABI 暴露给 JS。
 *
 * 语义（对应 nibi-client `docs/android-cdylib-abi.md`）：
 * - `start()` 起内核线程；输出按 LF 切成行后经 `onKernelLine` 事件送出；
 * - `send(line)` 送入 Host → kernel 的 JSON 帧（缺 LF 由内核补）；
 * - `stop()` 取消内核循环，`destroy()` 等待线程退出并释放；
 * - 一个进程只允许一个实例。
 */
class NibiKernelHostModule : Module() {
  private val sink = object : NibiKernelHostNative.Sink {
    override fun onLine(bytes: ByteArray) {
      sendEvent("onKernelLine", mapOf("line" to String(bytes, Charsets.UTF_8)))
    }

    override fun onError(bytes: ByteArray) {
      sendEvent("onKernelError", mapOf("message" to String(bytes, Charsets.UTF_8)))
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NibiKernelHost")
    Events("onKernelLine", "onKernelError")

    Function("isAvailable") { NibiKernelHostNative.isAvailable }
    Function("loadError") { NibiKernelHostNative.loadError }
    Function("abiVersion") {
      if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeAbiVersion() else -1
    }

    AsyncFunction("start") {
      requireAvailable()
      prepareEnvironment()
      NibiKernelHostNative.nativeStart(sink)
    }

    Function("send") { line: String ->
      requireAvailable()
      NibiKernelHostNative.nativeSend(line.toByteArray(Charsets.UTF_8))
    }

    Function("stop") {
      if (!NibiKernelHostNative.isAvailable) return@Function false
      NibiKernelHostNative.nativeStop()
    }

    Function("destroy") {
      if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeDestroy()
    }

    OnDestroy {
      if (NibiKernelHostNative.isAvailable) {
        NibiKernelHostNative.nativeStop()
        NibiKernelHostNative.nativeDestroy()
      }
    }
  }

  private fun requireAvailable() {
    val error = NibiKernelHostNative.loadError
    if (error != null) {
      throw IllegalStateException("libnibi.so 不可用：$error")
    }
  }

  /**
   * 内核在 `nibi_app_server_start` 时只读一次进程环境（ABI 文档「宿主前置」）。
   * Android 进程默认没有 HOME，必须指向 App 私有目录，否则 `~/.nibi` 无处落。
   */
  private fun prepareEnvironment() {
    val context = appContext.reactContext ?: run {
      throw IllegalStateException("缺少 Android Context，无法准备内核环境")
    }
    val files = context.filesDir.absolutePath
    setEnv("HOME", files)
    setEnv("NIBI_DATA_BASE_DIR", files)
    setEnv("TMPDIR", context.cacheDir.absolutePath)
  }

  private fun setEnv(name: String, value: String) {
    try {
      android.system.Os.setenv(name, value, true)
    } catch (t: Throwable) {
      android.util.Log.w("NibiKernelHost", "设置 $name 失败", t)
    }
  }
}
