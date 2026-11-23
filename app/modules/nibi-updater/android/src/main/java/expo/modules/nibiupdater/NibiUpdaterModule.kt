package expo.modules.nibiupdater

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * NIBI-GO 应用内更新安装器（A4）。
 * - sha256File：流式摘要（大 APK 不进 JS 内存）
 * - downloadApk：多 URL 依次尝试、Range 断点续传、进度事件、完成后 SHA-256 校验
 * - cancelDownload：中断当前连接
 * - installApk：FileProvider + ACTION_VIEW 调起系统 PackageInstaller
 */
class NibiUpdaterModule : Module() {
  private val cancelled = AtomicBoolean(false)

  @Volatile
  private var activeConnection: HttpURLConnection? = null

  /** RN 的 FileSystem 返回 file:// URI；原生 File 需要普通路径。 */
  private fun pathOf(raw: String): String {
    return if (raw.startsWith("file://")) Uri.parse(raw).path ?: raw else raw
  }

  override fun definition() = ModuleDefinition {
    Name("NibiUpdater")

    Events("onDownloadProgress")

    Function("sha256File") { path: String ->
      val file = File(pathOf(path))
      if (!file.exists() || !file.isFile) return@Function null
      try {
        sha256Of(file)
      } catch (error: Exception) {
        null
      }
    }

    Function("installApk") { path: String ->
      val context = appContext.reactContext ?: return@Function false
      val file = File(pathOf(path))
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

    Function("cancelDownload") {
      cancelled.set(true)
      activeConnection?.disconnect()
    }

    AsyncFunction("downloadApk") {
        urls: List<String>,
        destination: String,
        sha256: String,
        expectedSize: Double,
        promise: Promise,
      ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_DOWNLOAD", "应用上下文不可用", null)
        return@AsyncFunction
      }
      try {
        if (urls.isEmpty()) throw IOException("没有可用的下载地址")
        if (!sha256.matches(Regex("^[0-9a-fA-F]{64}$"))) throw IOException("SHA-256 格式不合法")
        val size = expectedSize.toLong()
        if (size < 0L) throw IOException("APK 大小不合法")
        val target = File(pathOf(destination)).canonicalFile
        val roots = listOf(context.cacheDir.canonicalFile, context.filesDir.canonicalFile)
        if (roots.none { target.path.startsWith(it.path + File.separator) }) {
          throw IOException("下载目标必须位于应用缓存或文件目录")
        }
        if (target.parentFile?.exists() != true) target.parentFile?.mkdirs()

        cancelled.set(false)
        Thread {
          try {
            downloadAll(urls, target, sha256.lowercase(), size)
            promise.resolve(mapOf("path" to target.absolutePath, "verified" to true))
          } catch (error: CancellationException) {
            promise.reject("E_CANCELLED", "下载已取消", null)
          } catch (error: Exception) {
            promise.reject("E_DOWNLOAD", error.message ?: error.javaClass.simpleName, null)
          } finally {
            activeConnection = null
          }
        }.start()
      } catch (error: Exception) {
        promise.reject("E_DOWNLOAD", error.message ?: error.javaClass.simpleName, null)
      }
    }
  }

  private fun downloadAll(urls: List<String>, target: File, sha256: String, expectedSize: Long) {
    val part = File("${target.absolutePath}.part")
    ensureFreeSpace(part, expectedSize)
    var lastError: String? = null

    for (url in urls) {
      if (cancelled.get()) throw CancellationException("下载已取消")
      if (!url.startsWith("https://")) {
        lastError = "只接受 https 下载地址"
        continue
      }
      try {
        downloadOne(url, part, sha256, expectedSize)
        if (target.exists() && !target.delete()) {
          throw IOException("无法覆盖旧安装包")
        }
        if (!part.renameTo(target)) {
          part.copyTo(target, overwrite = true)
          if (!part.delete()) part.deleteOnExit()
        }
        return
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        if (cancelled.get()) throw CancellationException("下载已取消")
        lastError = error.message ?: error.javaClass.simpleName
      }
    }

    if (cancelled.get()) throw CancellationException("下载已取消")
    throw IOException(lastError ?: "所有下载地址均失败")
  }

  private fun downloadOne(urlText: String, part: File, sha256: String, expectedSize: Long) {
    var current = URL(urlText)
    var redirects = 0

    while (true) {
      if (cancelled.get()) throw CancellationException("下载已取消")
      val existing = if (part.exists()) part.length() else 0L
      val connection = (current.openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        instanceFollowRedirects = false
        setRequestProperty("Accept-Encoding", "identity")
        setRequestProperty("User-Agent", "NIBI-GO-Updater")
        if (existing > 0) setRequestProperty("Range", "bytes=$existing-")
      }
      activeConnection = connection
      try {
        val status = connection.responseCode
        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
          val location = connection.getHeaderField("Location")
            ?: throw IOException("重定向缺少 Location")
          connection.disconnect()
          redirects += 1
          if (redirects > 5) throw IOException("重定向次数过多")
          current = URL(current, location)
          continue
        }
        if (status == 416) {
          connection.disconnect()
          if (expectedSize > 0 && part.length() == expectedSize) {
            verifyOrDelete(part, sha256)
            return
          }
          if (!part.delete()) part.deleteOnExit()
          throw IOException("断点位置无效，已重置")
        }
        if (status != 200 && status != 206) {
          throw IOException("HTTP $status")
        }

        val serverIgnoredRange = status == 200 && existing > 0
        val append = status == 206 && existing > 0
        if (serverIgnoredRange && !part.delete()) {
          throw IOException("无法重置未完成的下载")
        }
        val startOffset = if (append) existing else 0L
        val total = when {
          status == 206 -> parseContentRangeTotal(connection.getHeaderField("Content-Range"))
          connection.contentLengthLong > 0 -> startOffset + connection.contentLengthLong
          else -> expectedSize
        }

        emitProgress(startOffset, total)
        connection.inputStream.use { input ->
          FileOutputStream(part, append).use { output ->
            val buffer = ByteArray(64 * 1024)
            var loaded = startOffset
            var lastEmit = 0L
            while (true) {
              if (cancelled.get()) throw CancellationException("下载已取消")
              val read = input.read(buffer)
              if (read <= 0) break
              output.write(buffer, 0, read)
              loaded += read
              val now = System.currentTimeMillis()
              if (now - lastEmit >= 250) {
                emitProgress(loaded, total)
                lastEmit = now
              }
            }
            output.flush()
            emitProgress(loaded, total)
          }
        }
        connection.disconnect()

        if (expectedSize > 0 && part.length() != expectedSize) {
          throw IOException("下载大小不一致（${part.length()} / $expectedSize）")
        }
        verifyOrDelete(part, sha256)
        return
      } finally {
        activeConnection = null
        connection.disconnect()
      }
    }
  }

  private fun parseContentRangeTotal(header: String?): Long {
    // bytes 123-456/789
    val total = header?.substringAfterLast('/')?.trim()?.toLongOrNull()
    return if (total != null && total > 0) total else 0L
  }

  private fun ensureFreeSpace(part: File, expectedSize: Long) {
    val remaining = (expectedSize - (if (part.exists()) part.length() else 0L)).coerceAtLeast(0L)
    val usable = part.parentFile?.usableSpace ?: Long.MAX_VALUE
    if (usable < remaining + 32L * 1024L * 1024L) {
      throw IOException("剩余空间不足，无法下载更新包")
    }
  }

  private fun emitProgress(loaded: Long, total: Long) {
    sendEvent(
      "onDownloadProgress",
      mapOf(
        "loaded" to loaded,
        "total" to if (total > 0) total else 0L,
      ),
    )
  }

  private fun verifyOrDelete(part: File, expectedSha256: String) {
    val actual = sha256Of(part).lowercase()
    if (actual != expectedSha256.lowercase()) {
      if (!part.delete()) part.deleteOnExit()
      throw IOException("更新包校验失败，已丢弃")
    }
  }

  private fun sha256Of(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
  }
}
