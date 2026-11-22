package expo.modules.nibikernelhost

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

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
        // 先应用调试 env，再装运行时：SHELL/PATH/GIT_* 必须由运行时口径最后落定。
        extraEnv?.forEach { (name, value) -> setEnv(name, value) }
        prepareEnvironment()
        // T8 S2：必须在 nativeStart 前把 JVM + Context 交给内核；失败只降级内置根，不阻塞启动。
        val context = appContext.reactContext ?: throw IllegalStateException("缺少 Android Context")
        if (!NibiKernelHostNative.nativeAttach(context.applicationContext)) {
          android.util.Log.w("NibiKernelHost", "平台信任库未就绪，回退内置 Mozilla 根")
        }
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

    /**
     * 严格受限的内置 npm 安装桥：只安装纯 JS 标准 npm MCP 包到 filesDir/plugins/ 下，
     * 强制 --ignore-scripts --omit=dev --omit=optional 并拦截原生二进制与校验 integrity。
     */
    AsyncFunction("installNpmPackage") {
      packageName: String,
      version: String,
      registry: String,
      targetDir: String,
      expectedIntegrity: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("缺少 Android Context")
      NpmPluginInstaller.install(
        context = context.applicationContext,
        packageName = packageName,
        version = version,
        registry = registry,
        targetDir = targetDir,
        expectedIntegrity = expectedIntegrity,
      )
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
    // 会话级 HOME/TMPDIR：内核按 NIBI_SESSION_HOME 把用户命令的 HOME 指向会话 workspace、
    // TMPDIR 指向 cacheDir/sessions/<sessionId>；内核自身仍用上面的 filesDir。
    setEnv("NIBI_SESSION_HOME", "1")
    setEnv("NIBI_SESSION_TMP_ROOT", context.cacheDir.absolutePath + "/sessions")
    prepareRuntime(context)
  }

  /**
   * D25 Phase 2：随包 bash/busybox/git 安装到 filesDir/runtime；jniLibs 只放 lib*.so，
   * 用户可见命令全部是 symlink（指向 nativeLibraryDir）。没有运行时回退 /system/bin/sh。
   */
  private fun prepareRuntime(context: android.content.Context) {
    val installed = NibiRuntime.install(context)
    NibiRuntime.applyEnvironment(context, installed)
    NibiRuntime.logFailure(installed)
  }

  private fun setEnv(name: String, value: String) {
    try {
      android.system.Os.setenv(name, value, true)
    } catch (t: Throwable) {
      android.util.Log.w("NibiKernelHost", "设置 $name 失败", t)
    }
  }
}
