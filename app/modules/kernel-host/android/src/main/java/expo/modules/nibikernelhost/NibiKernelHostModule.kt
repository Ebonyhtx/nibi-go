package expo.modules.nibikernelhost

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo 模块 `NibiKernelHost`：把内核的 C ABI 暴露给 JS。
 *
 * 两种承载模式（D19/D20）：
 * - 默认（进程内）：在 UI 进程 dlopen `libnibi.so`，内核线程与 App 同生共死；
 * - `start(env, useService = true)`：绑定 `KernelService`（`android:process=":kernel"`），
 *   控制面走 Binder，帧流走 socketpair；UI 进程只做桥接，不跑内核。
 *
 * JS 面保持同一套语义：`start/send/stop/destroy` + `onKernelLine/onKernelError`；
 * 服务模式下另有 `onKernelRestart`（binder death 后的退避重连状态）。
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

  private var serviceClient: KernelServiceClient? = null
  private var startedInProcess = false

  override fun definition() = ModuleDefinition {
    Name("NibiKernelHost")
    Events("onKernelLine", "onKernelError", "onKernelRestart")

    Function("isAvailable") { NibiKernelHostNative.isAvailable }
    Function("loadError") { NibiKernelHostNative.loadError }
    Function("abiVersion") {
      if (NibiKernelHostNative.isAvailable) NibiKernelHostNative.nativeAbiVersion() else -1
    }

    // 额外环境变量只给开发期冒烟用（例如把模型指到本机 mock）；产品路径不传。
    // useService=true 时内核跑在 :kernel 进程（D20）。
    AsyncFunction("start") { extraEnv: Map<String, String>?, useService: Boolean? ->
      if (useService == true) {
        startService(extraEnv ?: emptyMap())
      } else {
        requireAvailable()
        prepareEnvironment()
        extraEnv?.forEach { (name, value) -> setEnv(name, value) }
        NibiKernelHostNative.nativeStart(sink).also { startedInProcess = it }
      }
    }

    Function("send") { line: String ->
      serviceClient?.send(line) ?: run {
        requireAvailable()
        NibiKernelHostNative.nativeSend(line.toByteArray(Charsets.UTF_8))
      }
    }

    Function("stop") {
      serviceClient?.stop() ?: run {
        if (!NibiKernelHostNative.isAvailable) return@Function false
        NibiKernelHostNative.nativeStop()
      }
    }

    Function("destroy") {
      serviceClient?.destroy()
      serviceClient = null
      if (startedInProcess && NibiKernelHostNative.isAvailable) {
        NibiKernelHostNative.nativeDestroy()
      }
      startedInProcess = false
    }

    /** 调试：杀 :kernel 进程，验证 binder death / 重连。 */
    Function("killKernelForTest") {
      serviceClient?.killForTest()
    }

    OnDestroy {
      // React context 销毁只解绑：内核进程 + 前台服务继续跑（D20.2），下次绑定接回。
      serviceClient?.dispose()
      serviceClient = null
      if (startedInProcess && NibiKernelHostNative.isAvailable) {
        NibiKernelHostNative.nativeStop()
        NibiKernelHostNative.nativeDestroy()
      }
      startedInProcess = false
    }
  }

  private fun startService(env: Map<String, String>): Boolean {
    val context = appContext.reactContext ?: throw IllegalStateException("缺少 Android Context")
    val previous = serviceClient
    serviceClient = null
    // Activity 重建会再次 start：旧客户端只解绑，不能把还在跑的内核一起销毁。
    previous?.dispose()
    val client = KernelServiceClient(
      context = context.applicationContext,
      onLine = { bytes -> sendEvent("onKernelLine", mapOf("line" to String(bytes, Charsets.UTF_8))) },
      onError = { message -> sendEvent("onKernelError", mapOf("message" to message)) },
      onRestart = { status, attempt ->
        sendEvent("onKernelRestart", mapOf("status" to status, "attempt" to attempt))
      },
    )
    serviceClient = client
    val started = client.start(env)
    if (!started) {
      client.destroy()
      serviceClient = null
    }
    return started
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
