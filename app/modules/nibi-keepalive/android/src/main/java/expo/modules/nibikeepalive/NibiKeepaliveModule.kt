package expo.modules.nibikeepalive

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * NIBI-GO KeepAlive 模块（A4）。
 * start(title, text) / stop() / isRunning() —— 对应 index.ts 绑定。
 */
class NibiKeepaliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NibiKeepalive")

    Function("start") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, KeepAliveService::class.java).apply {
        putExtra(KeepAliveService.EXTRA_TITLE, title)
        putExtra(KeepAliveService.EXTRA_TEXT, text)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      true
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function false
      context.stopService(Intent(context, KeepAliveService::class.java))
      true
    }

    Function("isRunning") { KeepAliveService.running }
  }
}
