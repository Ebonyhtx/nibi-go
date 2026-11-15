package expo.modules.nibikernelhost

import android.content.Context

/**
 * 进程内内核（`libnibi.so`）的原生绑定。
 *
 * 内核本体在仓库 `kernel/`（D24 fork），构建期由 `scripts/android-kernel/build.mjs` 交叉编译
 * 并校验后落到 `android/prebuilt/jniLibs/arm64-v8a/`（不入库）。本对象只包 C ABI，不碰内核实现。
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

  /**
   * 内核线程回调面；实现方负责把数据交给 JS（本层不持有 JS 引用）。
   *
   * 入参刻意是 `ByteArray` 而不是 `String`：JNI 层不做 modified-UTF-8 转换（4 字节字符
   * 与 NUL 会坏），只按 LF 切帧后原样给字节，UTF-8 解码留在 Kotlin。
   */
  interface Sink {
    /** 一行完整 JSON 的 UTF-8 字节（JNI 层已按 LF 切帧）。 */
    fun onLine(bytes: ByteArray)

    /** 内核异步错误（启动失败 / app-server 异常退出）的 UTF-8 字节。 */
    fun onError(bytes: ByteArray)
  }

  external fun nativeAbiVersion(): Int

  /**
   * T8 S2：把 JVM 与 `Context` 交给内核，必须在 [nativeStart] 之前调用。
   *
   * 返回 false 表示平台信任库没接上（内核继续用内置 Mozilla 根兜底，公开 HTTPS 仍可用）；
   * 不是启动失败，调用方只记日志。
   */
  external fun nativeAttach(context: Context): Boolean

  external fun nativeStart(sink: Sink): Boolean

  external fun nativeSend(bytes: ByteArray): Boolean

  external fun nativeStop(): Boolean

  external fun nativeDestroy()
}
