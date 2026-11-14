package expo.modules.nibikernelhost

/**
 * 进程内内核（`libnibi.so`）的原生绑定。
 *
 * 内核本体不属于本仓：`.so` 由独立的 npm 平台包提供，构建期由
 * `scripts/android-kernel/fetch.mjs` 按 `build.json.artifacts` 校验后落到
 * `android/prebuilt/jniLibs/arm64-v8a/`（不入库）。本对象只包 C ABI，不碰内核实现。
 *
 * 只有 arm64-v8a 产物，因此 x86_64 模拟器上加载必然失败——[loadError] 记录原因，
 * 上层按不可用降级，不抛到 JS。
 */
internal object NibiKernelHostNative {
  /** 加载失败原因；null = 可用。 */
  val loadError: String? = try {
    // libnibi.so 的 DT_NEEDED 里有 libc++_shared.so；先显式加载，缺依赖时报得更清楚。
    System.loadLibrary("c++_shared")
    System.loadLibrary("nibi")
    System.loadLibrary("nibi_kernel_jni")
    null
  } catch (t: Throwable) {
    t.message ?: t.javaClass.simpleName
  }

  val isAvailable: Boolean get() = loadError == null

  /** 内核线程回调面；实现方负责把数据交给 JS（本层不持有 JS 引用）。 */
  interface Sink {
    /** 一行完整 JSON（JNI 层已按 LF 切帧；UTF-8 由 Kotlin 解码）。 */
    fun onLine(line: String)

    /** 内核异步错误（启动失败 / app-server 异常退出）。 */
    fun onError(message: String)
  }

  external fun nativeAbiVersion(): Int

  external fun nativeStart(sink: Sink): Boolean

  external fun nativeSend(bytes: ByteArray): Boolean

  external fun nativeStop(): Boolean

  external fun nativeDestroy()
}
