// D20：宿主 ↔ :kernel 进程的控制面（Binder）。
//
// 帧流不走 Binder（1 MB 事务上限）：`openFrames()` 传一个 socketpair 的宿主端 fd，
// 之后双向 JSON 行都走这个 fd。其余方法只做生命周期与状态查询。
package expo.modules.nibikernelhost;

import android.os.ParcelFileDescriptor;

interface INibiKernelService {
  /** 内核 C ABI 版本；不可用时 -1。 */
  int abiVersion();

  /** .so 加载失败原因；null = 可用。 */
  String loadError();

  /**
   * 起内核线程。env 是 "NAME=VALUE" 列表（开发期模型指向等）；进程环境
   * （HOME / NIBI_DATA_BASE_DIR / TMPDIR）由 Service 先设好。
   */
  boolean start(in String[] env);

  /**
   * 分配帧通道：返回宿主端 fd，Service 保留另一端。
   * 重复调用会关掉上一对（只允许一个宿主连接）。
   */
  ParcelFileDescriptor openFrames();

  /** 取消内核循环（不释放句柄）。 */
  boolean stop();

  /** 停止并释放内核句柄。 */
  void destroy();

  /** 仅供调试：直接杀掉 :kernel 进程，验证宿主的 binder death/重连。 */
  void killForTest();
}
