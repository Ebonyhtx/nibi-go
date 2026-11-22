package expo.modules.nibikernelhost

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.nio.file.Files
import java.util.concurrent.TimeUnit

/**
 * 严格受限的内置 npm 安装桥：仅用于 NIBI-GO 插件市场安装纯 JS 标准 npm MCP 包。
 *
 * 安全边界：
 * - 不接受任意 shell 命令，固定调用随包 `bin/node` + `npm/bin/npm-cli.js`；
 * - 固定传 `--ignore-scripts --omit=dev --omit=optional --no-audit --no-fund`，禁止执行任何 postinstall；
 * - registry 仅允许 npmmirror / npmjs 白名单；packageName 与 version 严格正则校验（不接受 latest/URL）；
 * - 目标目录必须是 `filesDir/plugins/` 下的规范化子路径；
 * - 安装完成后扫描 `node_modules/`，拦截任何 `.node`/`.so`/`.dylib`/`.dll`/`.exe` 或 ELF 原生二进制，
 *   并按 `package-lock.json` 核验 `expectedIntegrity`（若提供）。
 */
internal object NpmPluginInstaller {
  private const val TAG = "NpmPluginInstaller"
  private const val TIMEOUT_SECONDS = 120L
  private const val MAX_OUTPUT_CHARS = 32 * 1024
  private const val MAX_FILES = 15_000
  private const val MAX_TOTAL_BYTES = 80L * 1024L * 1024L

  private val NPM_NAME_RE =
    Regex("^(?:@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$")
  private val VERSION_RE =
    Regex("^\\d{1,6}(?:\\.\\d{1,6}){0,2}(?:[-+][0-9A-Za-z.-]{1,32})?$")
  private val SRI_RE = Regex("^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$")
  private val ALLOWED_REGISTRIES = setOf(
    "https://registry.npmmirror.com",
    "https://registry.npmjs.org",
  )
  private val NATIVE_EXTENSIONS = setOf(".node", ".so", ".dylib", ".dll", ".exe")

  fun install(
    context: Context,
    packageName: String,
    version: String,
    registry: String,
    targetDir: String,
    expectedIntegrity: String?,
  ): Map<String, Any?> {
    val cleanName = packageName.trim()
    val cleanVersion = version.trim()
    val cleanRegistry = registry.trim().trimEnd('/')
    val cleanIntegrity = expectedIntegrity?.trim()?.takeIf { it.isNotEmpty() }

    if (cleanName.isEmpty() || cleanName.length > 214 || !NPM_NAME_RE.matches(cleanName) || cleanName.contains("..")) {
      return fail("npm 包名不合法：$cleanName")
    }
    if (!VERSION_RE.matches(cleanVersion)) {
      return fail("npm 版本必须是精确版本号：$cleanVersion")
    }
    if (cleanRegistry !in ALLOWED_REGISTRIES) {
      return fail("不支持的 npm 源：$cleanRegistry")
    }
    if (cleanIntegrity != null && !SRI_RE.matches(cleanIntegrity)) {
      return fail("expectedIntegrity 格式不合法")
    }

    val pluginsRoot = File(context.filesDir, "plugins").apply { mkdirs() }.canonicalFile
    val targetFile = File(targetDir).let { raw ->
      if (raw.isAbsolute) raw else File(pluginsRoot, targetDir)
    }
    val canonicalTarget = try {
      targetFile.mkdirs()
      targetFile.canonicalFile
    } catch (t: Throwable) {
      return fail("无法创建插件目录：${t.message ?: t.javaClass.simpleName}")
    }
    if (!canonicalTarget.path.startsWith(pluginsRoot.path + File.separator)) {
      return fail("目标目录越界：必须位于 App 插件目录内")
    }

    val runtimeRoot = File(context.filesDir, "runtime")
    val nodeBin = File(runtimeRoot, "bin/node")
    val npmCli = File(runtimeRoot, "npm/bin/npm-cli.js")
    if (!nodeBin.exists() || !npmCli.isFile) {
      NibiRuntime.install(context)
    }
    if (!nodeBin.exists() || !npmCli.isFile) {
      return fail("随包 Node.js / npm 运行时未就绪，请重启应用后再试")
    }

    // 写入最小宿主 package.json，确保 npm 写入 package-lock.json 供 integrity 核验。
    File(canonicalTarget, "package.json").writeText(
      "{\n  \"name\": \"nibi-go-plugin-host\",\n  \"private\": true\n}\n",
    )

    val command = listOf(
      nodeBin.absolutePath,
      npmCli.absolutePath,
      "install",
      "--omit=dev",
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=$cleanRegistry",
      "$cleanName@$cleanVersion",
    )

    val nativeDir = context.applicationInfo.nativeLibraryDir
    val binDir = File(runtimeRoot, "bin")
    val etcDir = File(runtimeRoot, "etc")
    val caBundle = File(etcDir, "cacert.pem")
    val npmCache = File(context.cacheDir, "npm-plugin-cache").apply { mkdirs() }

    val pb = ProcessBuilder(command).apply {
      directory(canonicalTarget)
      redirectErrorStream(true)
      val env = environment()
      env["HOME"] = context.filesDir.absolutePath
      env["TMPDIR"] = context.cacheDir.absolutePath
      val prevLd = env["LD_LIBRARY_PATH"]
      env["LD_LIBRARY_PATH"] = if (prevLd.isNullOrBlank()) nativeDir else "$nativeDir:$prevLd"
      env["PATH"] = "${binDir.absolutePath}:/system/bin:/system/xbin"
      env["NPM_CONFIG_CACHE"] = npmCache.absolutePath
      env["NPM_CONFIG_IGNORE_SCRIPTS"] = "true"
      env["NPM_CONFIG_AUDIT"] = "false"
      env["NPM_CONFIG_FUND"] = "false"
      env["NPM_CONFIG_UPDATE_NOTIFIER"] = "false"
      env["NPM_CONFIG_PROGRESS"] = "false"
      env["NO_COLOR"] = "1"
      if (caBundle.isFile) {
        env["SSL_CERT_FILE"] = caBundle.absolutePath
        env["NODE_EXTRA_CA_CERTS"] = caBundle.absolutePath
      }
    }

    val output = StringBuilder()
    val process = try {
      pb.start()
    } catch (t: Throwable) {
      Log.w(TAG, "启动 npm 失败", t)
      return fail("无法启动内置 npm：${t.message ?: t.javaClass.simpleName}")
    }

    val reader = Thread {
      try {
        process.inputStream.bufferedReader(Charsets.UTF_8).use { br ->
          val buf = CharArray(4096)
          while (true) {
            val n = br.read(buf)
            if (n < 0) break
            if (output.length < MAX_OUTPUT_CHARS) {
              val remaining = MAX_OUTPUT_CHARS - output.length
              output.append(buf, 0, minOf(n, remaining))
            }
          }
        }
      } catch (_: Throwable) {
        // 进程终止或流关闭时忽略
      }
    }.apply { start() }

    val finished = try {
      process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (t: InterruptedException) {
      process.destroyForcibly()
      Thread.currentThread().interrupt()
      return fail("npm 安装被中断")
    }
    if (!finished) {
      process.destroyForcibly()
      reader.join(1_000)
      return fail("npm 安装超时（${TIMEOUT_SECONDS}s），请检查网络或切换国内/国外源")
    }
    reader.join(2_000)

    val exitCode = process.exitValue()
    val logText = output.toString().trim()
    if (exitCode != 0) {
      val tail = logText.lines().takeLast(6).joinToString(" | ").take(360)
      return fail("npm 安装失败（退出码 $exitCode）${if (tail.isNotEmpty()) "：$tail" else ""}", logText)
    }

    // 1) 校验包目录与 package.json 存在
    val pkgRoot = File(canonicalTarget, "node_modules/$cleanName")
    val pkgJsonFile = File(pkgRoot, "package.json")
    if (!pkgJsonFile.isFile) {
      return fail("安装完成但找不到 node_modules/$cleanName/package.json", logText)
    }

    // 2) 扫描 node_modules，拦截原生二进制与异常体量
    val nodeModules = File(canonicalTarget, "node_modules")
    val scanResult = scanNodeModules(nodeModules)
    if (scanResult.error != null) {
      return fail(scanResult.error, logText)
    }

    // 3) 读取 package-lock.json 核验版本与 integrity
    var resolvedVersion: String? = null
    var resolvedIntegrity: String? = null
    val lockFile = File(canonicalTarget, "package-lock.json")
    if (lockFile.isFile) {
      try {
        val lock = JSONObject(lockFile.readText(Charsets.UTF_8))
        val entry = lock.optJSONObject("packages")?.optJSONObject("node_modules/$cleanName")
        if (entry != null) {
          resolvedVersion = entry.optString("version", "").takeIf { it.isNotEmpty() }
          resolvedIntegrity = entry.optString("integrity", "").takeIf { it.isNotEmpty() }
        }
      } catch (t: Throwable) {
        Log.w(TAG, "解析 package-lock.json 失败", t)
      }
    }

    if (cleanIntegrity != null && resolvedIntegrity != cleanIntegrity) {
      return fail(
        "包 integrity 校验失败（期望 $cleanIntegrity，实际 ${resolvedIntegrity ?: "缺失"}）",
        logText,
      )
    }

    val pkgJsonText = try {
      pkgJsonFile.readText(Charsets.UTF_8)
    } catch (t: Throwable) {
      return fail("读取包 package.json 失败：${t.message ?: t.javaClass.simpleName}", logText)
    }

    return mapOf(
      "ok" to true,
      "packageJson" to pkgJsonText,
      "resolvedVersion" to (resolvedVersion ?: cleanVersion),
      "resolvedIntegrity" to resolvedIntegrity,
      "fileCount" to scanResult.fileCount,
      "totalBytes" to scanResult.totalBytes,
      "output" to logText.takeLast(2000),
    )
  }

  private data class ScanOutcome(
    val fileCount: Int,
    val totalBytes: Long,
    val error: String?,
  )

  private fun scanNodeModules(root: File): ScanOutcome {
    if (!root.isDirectory) return ScanOutcome(0, 0L, "缺少 node_modules 目录")
    var files = 0
    var bytes = 0L
    val stack = ArrayDeque<File>()
    stack.add(root)
    val magic = ByteArray(4)

    while (stack.isNotEmpty()) {
      val current = stack.removeLast()
      val children = current.listFiles() ?: continue
      for (child in children) {
        // 跳过符号链接（避免循环与逃逸）
        if (Files.isSymbolicLink(child.toPath())) continue
        if (child.isDirectory) {
          stack.add(child)
          continue
        }
        if (!child.isFile) continue

        files += 1
        if (files > MAX_FILES) {
          return ScanOutcome(files, bytes, "依赖文件数超过上限（$MAX_FILES），已拒绝安装")
        }
        val length = child.length()
        bytes += length
        if (bytes > MAX_TOTAL_BYTES) {
          return ScanOutcome(files, bytes, "依赖总体积超过 80 MiB，手机端已拒绝安装")
        }

        val lowerName = child.name.lowercase()
        val rel = child.relativeTo(root).path
        for (ext in NATIVE_EXTENSIONS) {
          if (lowerName.endsWith(ext)) {
            return ScanOutcome(files, bytes, "检测到原生二进制文件（$rel），手机端仅支持纯 JS npm 包")
          }
        }
        if (length >= 4 && isElfBinary(child, magic)) {
          return ScanOutcome(files, bytes, "检测到 ELF 可执行二进制（$rel），手机端仅支持纯 JS npm 包")
        }
      }
    }
    return ScanOutcome(files, bytes, null)
  }

  private fun isElfBinary(file: File, buf: ByteArray): Boolean = try {
    FileInputStream(file).use { input ->
      val read = input.read(buf, 0, 4)
      read == 4 &&
        buf[0] == 0x7F.toByte() &&
        buf[1] == 'E'.code.toByte() &&
        buf[2] == 'L'.code.toByte() &&
        buf[3] == 'F'.code.toByte()
    }
  } catch (_: Throwable) {
    false
  }

  private fun fail(reason: String, output: String? = null): Map<String, Any?> = mapOf(
    "ok" to false,
    "error" to reason,
    "output" to output?.takeLast(2000),
  )
}
