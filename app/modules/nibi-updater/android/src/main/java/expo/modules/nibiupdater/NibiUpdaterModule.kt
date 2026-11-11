package expo.modules.nibiupdater

import android.content.Intent
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * NIBI-GO 应用内更新安装器（A4）。
 * - sha256File：流式摘要（80MB APK 不进 JS 内存）
 * - installApk：FileProvider + ACTION_VIEW 调起系统 PackageInstaller
 */
class NibiUpdaterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NibiUpdater")

    Function("sha256File") { path: String ->
      val file = File(path)
      if (!file.exists() || !file.isFile) return@Function null
      try {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
          }
        }
        digest.digest().joinToString("") { byte -> "%02x".format(byte) }
      } catch (error: Exception) {
        null
      }
    }

    Function("installApk") { path: String ->
      val context = appContext.reactContext ?: return@Function false
      val file = File(path)
      if (!file.exists()) return@Function false
      try {
        val uri = FileProvider.getUriForFile(
          context,
          "${context.packageName}.nibi-updater",
          file,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/vnd.android.package-archive")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        true
      } catch (error: Exception) {
        false
      }
    }
  }
}
